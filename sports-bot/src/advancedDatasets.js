import path from 'node:path';
import { config, dataDir } from './config.js';
import { normalizeEntityName } from './intelligenceStore.js';
import { corroborateScheduleRows } from './sourceIntelligence.js';
import { readJson, writeJson } from './storage.js';

const snapshotFile = path.join(dataDir, 'advanced-datasets.json');
const DAY_MS = 86_400_000;
let syncPromise = null;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function finite(value, fallback = null) {
  if (value === null || value === undefined || value === '') return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function parseCsv(text = '') {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') { field += '"'; index += 1; }
      else quoted = !quoted;
    } else if (character === ',' && !quoted) {
      row.push(field); field = '';
    } else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && text[index + 1] === '\n') index += 1;
      row.push(field); field = '';
      if (row.some((value) => value !== '')) rows.push(row);
      row = [];
    } else {
      field += character;
    }
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  if (rows.length < 2) return [];
  const headers = rows[0].map((value) => value.trim());
  return rows.slice(1).map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ''])));
}

function serveRate(row, prefix) {
  const servicePoints = finite(row[`${prefix}_svpt`]);
  const firstWon = finite(row[`${prefix}_1stWon`]);
  const secondWon = finite(row[`${prefix}_2ndWon`]);
  if (!servicePoints || firstWon === null || secondWon === null) return null;
  return clamp((firstWon + secondWon) / servicePoints, 0, 1);
}

export function buildTennisDataset(rows = [], tour = 'atp') {
  const players = new Map();
  const ensure = (name) => {
    const key = normalizeEntityName(name);
    if (!players.has(key)) players.set(key, { name, tour, elo: 1500, surfaces: {}, matches: 0, serveWon: 0, serveSamples: 0, returnWon: 0, returnSamples: 0 });
    return players.get(key);
  };
  const sorted = [...rows].sort((a, b) => String(a.tourney_date || '').localeCompare(String(b.tourney_date || '')));
  for (const row of sorted) {
    if (!row.winner_name || !row.loser_name) continue;
    const winner = ensure(row.winner_name);
    const loser = ensure(row.loser_name);
    const surface = String(row.surface || 'Unknown').toLowerCase();
    winner.surfaces[surface] ??= 1500;
    loser.surfaces[surface] ??= 1500;
    const expected = 1 / (1 + 10 ** ((loser.elo - winner.elo) / 400));
    const change = 24 * (1 - expected);
    winner.elo += change;
    loser.elo -= change;
    const surfaceExpected = 1 / (1 + 10 ** ((loser.surfaces[surface] - winner.surfaces[surface]) / 400));
    const surfaceChange = 28 * (1 - surfaceExpected);
    winner.surfaces[surface] += surfaceChange;
    loser.surfaces[surface] -= surfaceChange;
    winner.matches += 1;
    loser.matches += 1;
    const winnerServe = serveRate(row, 'w');
    const loserServe = serveRate(row, 'l');
    if (winnerServe !== null) { winner.serveWon += winnerServe; winner.serveSamples += 1; loser.returnWon += 1 - winnerServe; loser.returnSamples += 1; }
    if (loserServe !== null) { loser.serveWon += loserServe; loser.serveSamples += 1; winner.returnWon += 1 - loserServe; winner.returnSamples += 1; }
  }
  return Object.fromEntries([...players.entries()].map(([key, player]) => [key, {
    ...player,
    elo: Number(player.elo.toFixed(1)),
    surfaces: Object.fromEntries(Object.entries(player.surfaces).map(([surface, elo]) => [surface, Number(elo.toFixed(1))])),
    serveWon: player.serveSamples ? Number((player.serveWon / player.serveSamples).toFixed(4)) : null,
    returnWon: player.returnSamples ? Number((player.returnWon / player.returnSamples).toFixed(4)) : null
  }]));
}

async function fetchText(url, fetchImpl, timeoutMs = 25_000, clock = Date.now) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { signal: controller.signal, headers: { 'user-agent': 'OmniModSportsBot/6.0', accept: 'text/csv,application/json' } });
    if (!response.ok) {
      const raw = response.headers?.get?.('retry-after');
      const delay = raw && /^\d+(?:\.\d+)?$/.test(raw) ? Number(raw) * 1000 : Date.parse(raw || '') - clock();
      const error = new Error(`HTTP ${response.status}`);
      error.retryAfterMs = Number.isFinite(delay) && delay > 0 ? delay : 0;
      throw error;
    }
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

function sourceStatus(id, url, ok, details = {}, previous = {}, now = Date.now()) {
  const failures = ok ? 0 : Math.min(16, Math.max(0, Number(previous.failures) || 0) + 1);
  const providerDelay = Math.max(0, Number(details.retryAfterMs) || 0);
  return { id, url, ok, checkedAt: new Date(now).toISOString(), ...details, failures,
    lastSuccessAt: ok ? new Date(now).toISOString() : previous.lastSuccessAt || (previous.ok ? previous.checkedAt : null) || null,
    retryAfter: ok ? null : new Date(now + Math.max(Math.min(24, 2 ** (failures - 1)) * 3600000, providerDelay)).toISOString(),
    providerRetryAfter: providerDelay ? new Date(now + providerDelay).toISOString() : null };
}

export async function readAdvancedDatasetSnapshot() {
  return readJson(snapshotFile, { version: 2, updatedAt: '', tennis: {}, baseballPlayers: {}, footballTeams: {}, footballSchedules: [], hockeyTeams: {}, basketballTeams: {}, soccerCompetitions: [], sources: [] });
}

export async function syncAdvancedDatasets(options = {}) {
  if (!config.advancedDatasetsEnabled || options.localOnly || config.localOnly) {
    return { snapshot: await readAdvancedDatasetSnapshot(), externalCalls: 0, diagnostics: ['Advanced dataset sync skipped by configuration/local-only mode.'] };
  }
  if (syncPromise) return syncPromise;
  syncPromise = (async () => {
    const current = await readAdvancedDatasetSnapshot();
    const clock = options.clock || Date.now, now = clock();
    if (!Number.isFinite(now)) throw new Error('Valid advanced dataset observation time required');
    const statuses = new Map((current.sources || []).map(row => [row.id, row]));
    const sourceDue = id => {
      const row = statuses.get(id), checked = Date.parse(row?.checkedAt || '');
      if (Date.parse(row?.providerRetryAfter || '') > now) return false;
      if (options.force) return true;
      if (!Number.isFinite(checked) || checked > now) return true;
      if (row.ok === false) return !(Date.parse(row.retryAfter || '') > now);
      if (row.ok !== true) return true;
      const success = Date.parse(row.lastSuccessAt || row.checkedAt || '');
      return !Number.isFinite(success) || success > now || now - success >= config.advancedDatasetSyncDays * DAY_MS;
    };
    const sourceIds = ['tennis-atp', 'tennis-wta', 'baseball-savant-batter', 'baseball-savant-pitcher',
      'nflverse-team-stats', 'nflverse-schedules', 'moneypuck-team-xg', 'statsbomb-open-data',
      ...(config.advancedNbaStatsEnabled ? ['nba-advanced-teams'] : [])];
    if (!sourceIds.some(sourceDue)) return { snapshot: current, externalCalls: 0,
      diagnostics: ['Advanced datasets: each enabled source is within its success cache or retry delay; retained row receipts are unchanged.'] };
    const year = Number(options.year || new Date(now).getUTCFullYear());
    const snapshot = { tennis: {}, baseballPlayers: {}, footballTeams: {}, footballSchedules: [], hockeyTeams: {}, basketballTeams: {}, soccerCompetitions: [], ...current,
      version: 2, receiptPolicy: 'per-source-received-rows-v1', sources: [...statuses.values()], updatedAt: new Date(now).toISOString() };
    let externalCalls = 0;
    const providerFetch = options.fetchImpl || fetch;
    const fetchImpl = (...args) => { externalCalls += 1; return providerFetch(...args); };
    const sourceText = (url, timeoutMs) => fetchText(url, fetchImpl, timeoutMs, clock);
    const recordStatus = (id, url, ok, details) => {
      const row = sourceStatus(id, url, ok, details, statuses.get(id), clock());
      statuses.set(id, row); snapshot.sources = [...statuses.values()];
    };
    const stamp = (row, sourceDatasetId) => ({ ...row, sourceDatasetId, sourceFetchedAt: new Date(clock()).toISOString() });
    const diagnostics = [];

    const tennisSources = [
      ['atp', `https://raw.githubusercontent.com/JeffSackmann/tennis_atp/master/atp_matches_${year}.csv`, `https://raw.githubusercontent.com/Tennismylife/TML-Database/master/${year}.csv`],
      ['wta', `https://raw.githubusercontent.com/JeffSackmann/tennis_wta/master/wta_matches_${year}.csv`, 'https://raw.githubusercontent.com/36-SURE/2026/main/data/wta_matches_2021_2026.csv']
    ];
    for (const [tour, primaryUrl, fallbackUrl] of tennisSources) {
      if (!sourceDue(`tennis-${tour}`)) continue;
      try {
        let text;
        let usedUrl = primaryUrl;
        try {
          text = await sourceText(primaryUrl);
        } catch (primaryError) {
          if (!fallbackUrl || primaryError.retryAfterMs > 0 || /HTTP (401|403|429)/.test(primaryError.message)) throw primaryError;
          text = await sourceText(fallbackUrl);
          usedUrl = fallbackUrl;
        }
        const rows = parseCsv(text);
        snapshot.tennis[tour] = Object.fromEntries(Object.entries(buildTennisDataset(rows, tour)).map(([key, row]) => [key, stamp(row, `tennis-${tour}`)]));
        recordStatus(`tennis-${tour}`, usedUrl, true, { rows: rows.length, players: Object.keys(snapshot.tennis[tour]).length, license: 'non-commercial attribution/share-alike; see source repository' });
        diagnostics.push(`${tour.toUpperCase()} advanced snapshot: ${rows.length} match(es), ${Object.keys(snapshot.tennis[tour]).length} player(s).`);
      } catch (error) {
        recordStatus(`tennis-${tour}`, primaryUrl, false, { error: error.message, retryAfterMs: error.retryAfterMs });
        diagnostics.push(`${tour.toUpperCase()} advanced snapshot unavailable; retained prior data (${error.message}).`);
      }
    }

    const statcastSources = [
      ['batter', `https://baseballsavant.mlb.com/leaderboard/expected_statistics?type=batter&year=${year}&position=&team=&min=25&csv=true`],
      ['pitcher', `https://baseballsavant.mlb.com/leaderboard/expected_statistics?type=pitcher&year=${year}&position=&team=&min=25&csv=true`]
    ];
    for (const [role, url] of statcastSources) {
      if (!sourceDue(`baseball-savant-${role}`)) continue;
      try {
        const rows = parseCsv(await sourceText(url));
        for (const row of rows) {
          const name = row['last_name, first_name'] || row.player_name || '';
          if (!name) continue;
          const parts = name.split(',').map((value) => value.trim());
          const displayName = parts.length === 2 ? `${parts[1]} ${parts[0]}` : name;
          snapshot.baseballPlayers[normalizeEntityName(displayName)] = stamp({
            name: displayName, role, playerId: row.player_id,
            expectedAverage: finite(row.est_ba), expectedSlugging: finite(row.est_slg), expectedWoba: finite(row.est_woba),
            sampleSize: finite(row.pa ?? row.bip, 0)
          }, `baseball-savant-${role}`);
        }
        recordStatus(`baseball-savant-${role}`, url, true, { rows: rows.length, license: 'MLB Baseball Savant public CSV' });
        diagnostics.push(`Baseball Savant ${role}: ${rows.length} expected-stat row(s).`);
      } catch (error) {
        recordStatus(`baseball-savant-${role}`, url, false, { error: error.message, retryAfterMs: error.retryAfterMs });
        diagnostics.push(`Baseball Savant ${role} unavailable; retained prior data (${error.message}).`);
      }
    }

    const footballSeason = new Date(now).getUTCMonth() < 8 ? year - 1 : year;
    const nflUrl = `https://github.com/nflverse/nflverse-data/releases/download/stats_team/stats_team_reg_${footballSeason}.csv`;
    if (sourceDue('nflverse-team-stats')) {
      try {
        const rows = parseCsv(await sourceText(nflUrl));
        snapshot.footballTeams = Object.fromEntries(rows.map((row) => [String(row.team || '').toUpperCase(), stamp({
          team: String(row.team || '').toUpperCase(), games: finite(row.games, 0),
          epaPerGame: (finite(row.passing_epa, 0) + finite(row.rushing_epa, 0)) / Math.max(1, finite(row.games, 1)),
          passingEpaPerGame: finite(row.passing_epa, 0) / Math.max(1, finite(row.games, 1)),
          rushingEpaPerGame: finite(row.rushing_epa, 0) / Math.max(1, finite(row.games, 1)),
          cpoe: finite(row.passing_cpoe, 0)
        }, 'nflverse-team-stats')]));
        recordStatus('nflverse-team-stats', nflUrl, true, { rows: rows.length, license: 'CC BY 4.0' });
        diagnostics.push(`nflverse team stats: ${rows.length} team row(s) for ${footballSeason}.`);
      } catch (error) {
        recordStatus('nflverse-team-stats', nflUrl, false, { error: error.message, retryAfterMs: error.retryAfterMs });
        diagnostics.push(`nflverse team stats unavailable; retained prior data (${error.message}).`);
      }
    }

    const nflScheduleUrl = 'https://github.com/nflverse/nflverse-data/releases/download/schedules/games.csv';
    if (sourceDue('nflverse-schedules')) {
      try {
        const rows = parseCsv(await sourceText(nflScheduleUrl));
        snapshot.footballSchedules = rows
          .filter((row) => finite(row.season, 0) >= footballSeason - 1)
          .map((row) => stamp({
            game_id: row.game_id,
            season: finite(row.season),
            game_type: row.game_type,
            week: finite(row.week),
            gameday: row.gameday,
            gametime: row.gametime,
            away_team: row.away_team,
            home_team: row.home_team,
            roof: row.roof,
            surface: row.surface,
            temp: finite(row.temp),
            wind: finite(row.wind),
            referee: row.referee,
            stadium: row.stadium
          }, 'nflverse-schedules'));
        recordStatus('nflverse-schedules', nflScheduleUrl, true, { rows: snapshot.footballSchedules.length, license: 'CC BY 4.0' });
        diagnostics.push(`nflverse schedule redundancy: ${snapshot.footballSchedules.length} recent game row(s).`);
      } catch (error) {
        recordStatus('nflverse-schedules', nflScheduleUrl, false, { error: error.message, retryAfterMs: error.retryAfterMs });
        diagnostics.push(`nflverse schedule redundancy unavailable; retained prior data (${error.message}).`);
      }
    }

    const hockeySeason = new Date(now).getUTCMonth() < 8 ? year - 1 : year;
    const moneyPuckUrl = `https://moneypuck.com/moneypuck/playerData/seasonSummary/${hockeySeason}/regular/teams.csv`;
    if (sourceDue('moneypuck-team-xg')) {
      try {
        const rows = parseCsv(await sourceText(moneyPuckUrl));
        const allSituations = rows.filter((row) => String(row.situation).toLowerCase() === 'all');
        snapshot.hockeyTeams = Object.fromEntries(allSituations.map((row) => [String(row.team || '').toUpperCase(), stamp({
          team: String(row.team || '').toUpperCase(), games: finite(row.games_played, 0),
          xGoalsFor: finite(row.xGoalsFor), xGoalsAgainst: finite(row.xGoalsAgainst),
          flurryXgFor: finite(row.flurryAdjustedxGoalsFor), flurryXgAgainst: finite(row.flurryAdjustedxGoalsAgainst),
          goalsFor: finite(row.goalsFor), goalsAgainst: finite(row.goalsAgainst)
        }, 'moneypuck-team-xg')]));
        recordStatus('moneypuck-team-xg', moneyPuckUrl, true, { rows: allSituations.length, attribution: 'MoneyPuck.com' });
        diagnostics.push(`MoneyPuck team xG: ${allSituations.length} team row(s) for ${hockeySeason}.`);
      } catch (error) {
        recordStatus('moneypuck-team-xg', moneyPuckUrl, false, { error: error.message, retryAfterMs: error.retryAfterMs });
        diagnostics.push(`MoneyPuck team xG unavailable; retained prior data (${error.message}).`);
      }
    }

    if (config.advancedNbaStatsEnabled && sourceDue('nba-advanced-teams')) {
      const seasonStart = new Date(now).getUTCMonth() < 8 ? year - 1 : year;
      const seasonLabel = `${seasonStart}-${String(seasonStart + 1).slice(-2)}`;
      const nbaUrl = `https://stats.nba.com/stats/leaguedashteamstats?Conference=&DateFrom=&DateTo=&Division=&GameScope=&GameSegment=&LastNGames=0&LeagueID=00&Location=&MeasureType=Advanced&Month=0&OpponentTeamID=0&Outcome=&PORound=0&PaceAdjust=N&PerMode=PerGame&Period=0&PlusMinus=N&Rank=N&Season=${seasonLabel}&SeasonType=Regular%20Season&TeamID=0`;
      try {
        const payload = JSON.parse(await sourceText(nbaUrl, 8_000));
        const resultSet = payload.resultSets?.[0] || payload.resultSet || {};
        const headers = resultSet.headers || [];
        const rows = (resultSet.rowSet || []).map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index]])));
        snapshot.basketballTeams = Object.fromEntries(rows.map((row) => [normalizeEntityName(row.TEAM_NAME), stamp({
          team: row.TEAM_NAME, teamId: row.TEAM_ID, games: row.GP, pace: row.PACE,
          offensiveRating: row.OFF_RATING, defensiveRating: row.DEF_RATING, netRating: row.NET_RATING
        }, 'nba-advanced-teams')]));
        recordStatus('nba-advanced-teams', nbaUrl, true, { rows: rows.length });
        diagnostics.push(`NBA advanced teams: ${rows.length} team row(s) for ${seasonLabel}.`);
      } catch (error) {
        recordStatus('nba-advanced-teams', nbaUrl, false, { error: error.message, retryAfterMs: error.retryAfterMs });
        diagnostics.push(`NBA advanced teams unavailable; retained prior data (${error.message}).`);
      }
    } else if (!config.advancedNbaStatsEnabled) {
      diagnostics.push('NBA.com advanced-team adapter is available but disabled; cached ESPN possession/efficiency features remain active.');
    }

    const statsBombUrl = 'https://raw.githubusercontent.com/statsbomb/open-data/master/data/competitions.json';
    if (sourceDue('statsbomb-open-data')) {
      try {
        const text = await sourceText(statsBombUrl);
        const rows = JSON.parse(text);
        snapshot.soccerCompetitions = Array.isArray(rows) ? rows.map((row) => stamp({
          competitionId: row.competition_id,
          seasonId: row.season_id,
          competition: row.competition_name,
          season: row.season_name,
          matchAvailable: row.match_available
        }, 'statsbomb-open-data')) : [];
        recordStatus('statsbomb-open-data', statsBombUrl, true, { competitions: snapshot.soccerCompetitions.length, license: 'StatsBomb Open Data terms' });
        diagnostics.push(`StatsBomb open-data catalog: ${snapshot.soccerCompetitions.length} competition-season record(s).`);
      } catch (error) {
        recordStatus('statsbomb-open-data', statsBombUrl, false, { error: error.message, retryAfterMs: error.retryAfterMs });
        diagnostics.push(`StatsBomb catalog unavailable; retained prior data (${error.message}).`);
      }
    }
    await writeJson(snapshotFile, snapshot, { compact: true, backup: true, mode: 0o600 });
    return { snapshot, externalCalls, diagnostics };
  })();
  try { return await syncPromise; } finally { syncPromise = null; }
}

function playerRecord(snapshot, tour, name) {
  const key = normalizeEntityName(name);
  return snapshot.tennis?.[tour]?.[key] || null;
}

function receiptProvenance(previous, rows) {
  const inherited = Array.isArray(previous?.sourceReceiptTimes) ? previous.sourceReceiptTimes
    : previous && Object.keys(previous).length ? [null] : [];
  return { sourceReceiptTimes: [...inherited, ...rows.map(row => row?.sourceFetchedAt || null)],
    publicationTimeVerified: false, provenancePolicy: 'contributing-row-receipts-v1' };
}

export async function attachAdvancedDatasetContext(games = [], options = {}) {
  const sync = await syncAdvancedDatasets(options);
  let matched = 0;
  const provenance = (previous, rows, sourceId) => {
    const status = (sync.snapshot.sources || []).find(row => row.id === sourceId);
    return { ...receiptProvenance(previous, rows), sourceRefreshStatuses: [...(previous?.sourceRefreshStatuses || []), {
      sourceId, state: status?.ok === true ? 'success' : status?.ok === false ? 'failed' : 'unknown',
      checkedAt: status?.checkedAt || null, lastSuccessAt: status?.lastSuccessAt || (status?.ok ? status.checkedAt : null) || null,
      retryAfter: status?.retryAfter || null, providerRetryAfter: status?.providerRetryAfter || null
    }] };
  };
  const sourceCorroborations = config.sourceRedundancyEnabled ? corroborateScheduleRows(games.filter((game) => game.leagueKey === 'nfl'), sync.snapshot.footballSchedules || [], {
    provider: 'nflverse independent schedule'
  }) : 0;
  for (const game of games) {
    const leagueKey = String(game.leagueKey || '').toLowerCase();
    if (leagueKey === 'mlb') {
      const sideMetric = (side) => {
        const team = normalizeEntityName(game[side]?.name);
        const rows = (game.autoPlayers || []).filter((row) => normalizeEntityName(row.team) === team)
          .map((row) => sync.snapshot.baseballPlayers?.[normalizeEntityName(row.name)])
          .filter((row) => row?.role === 'batter' && Number.isFinite(row.expectedWoba));
        return { rows, value: rows.length ? rows.reduce((sum, row) => sum + row.expectedWoba, 0) / rows.length : null };
      };
      const away = sideMetric('away'), home = sideMetric('home');
      const awayXwoba = away.value, homeXwoba = home.value;
      if (awayXwoba !== null || homeXwoba !== null) {
        game.advancedDataset = { ...(game.advancedDataset || {}), ...provenance(game.advancedDataset, [...away.rows, ...home.rows], 'baseball-savant-batter'), provider: 'MLB Baseball Savant',
          awayLineupXwoba: awayXwoba, homeLineupXwoba: homeXwoba,
          lineupXwobaCoverage: awayXwoba !== null && homeXwoba !== null ? 'both_sides' : 'partial',
          lineupXwobaDifference: awayXwoba !== null && homeXwoba !== null ? homeXwoba - awayXwoba : null };
        matched += 1;
      }
      continue;
    }
    if (leagueKey === 'nfl') {
      const away = sync.snapshot.footballTeams?.[String(game.away?.abbr || '').toUpperCase()];
      const home = sync.snapshot.footballTeams?.[String(game.home?.abbr || '').toUpperCase()];
      if (away && home) {
        game.advancedDataset = { ...(game.advancedDataset || {}), ...provenance(game.advancedDataset, [away, home], 'nflverse-team-stats'), provider: 'nflverse team stats', epaDifference: (home.epaPerGame - away.epaPerGame) / 60, passingEpaDifference: (home.passingEpaPerGame - away.passingEpaPerGame) / 38, rushingEpaDifference: (home.rushingEpaPerGame - away.rushingEpaPerGame) / 24, cpoeDifference: home.cpoe - away.cpoe };
        matched += 1;
      }
      continue;
    }
    if (leagueKey === 'nhl') {
      const away = sync.snapshot.hockeyTeams?.[String(game.away?.abbr || '').toUpperCase()];
      const home = sync.snapshot.hockeyTeams?.[String(game.home?.abbr || '').toUpperCase()];
      if (away && home) {
        const awayGames = Math.max(1, away.games || 1);
        const homeGames = Math.max(1, home.games || 1);
        game.advancedDataset = { ...(game.advancedDataset || {}), ...provenance(game.advancedDataset, [away, home], 'moneypuck-team-xg'), provider: 'MoneyPuck.com', awayXg: away.xGoalsFor / awayGames, homeXg: home.xGoalsFor / homeGames, xgDifference: (home.xGoalsFor / homeGames - home.xGoalsAgainst / homeGames) - (away.xGoalsFor / awayGames - away.xGoalsAgainst / awayGames), gsaxDifference: ((home.xGoalsAgainst - home.goalsAgainst) / homeGames) - ((away.xGoalsAgainst - away.goalsAgainst) / awayGames) };
        matched += 1;
      }
      continue;
    }
    if (leagueKey === 'nba') {
      const away = sync.snapshot.basketballTeams?.[normalizeEntityName(game.away?.name)];
      const home = sync.snapshot.basketballTeams?.[normalizeEntityName(game.home?.name)];
      if (away && home) {
        game.advancedDataset = { ...(game.advancedDataset || {}), ...provenance(game.advancedDataset, [away, home], 'nba-advanced-teams'), provider: 'NBA.com advanced team stats', pace: (Number(away.pace) + Number(home.pace)) / 2, efficiencyDifference: Number(home.netRating) - Number(away.netRating) };
        matched += 1;
      }
      continue;
    }
    if (!['atp', 'wta'].includes(leagueKey)) continue;
    const tour = String(game.leagueKey).toLowerCase();
    const away = playerRecord(sync.snapshot, tour, game.away?.name);
    const home = playerRecord(sync.snapshot, tour, game.home?.name);
    if (!away || !home) continue;
    const surface = String(game.autoContext?.surface || game.autoContext?.factors?.surface || '').toLowerCase();
    const awaySurface = finite(away.surfaces?.[surface], away.elo);
    const homeSurface = finite(home.surfaces?.[surface], home.elo);
    game.advancedDataset = {
      provider: 'Jeff Sackmann tennis datasets',
      ...provenance(null, [away, home], `tennis-${tour}`),
      surface,
      surfaceEloDifference: homeSurface - awaySurface,
      serveReturnDifference: ((home.serveWon || 0.6) + (home.returnWon || 0.4)) - ((away.serveWon || 0.6) + (away.returnWon || 0.4)),
      awayMatches: away.matches,
      homeMatches: home.matches
    };
    matched += 1;
  }
  return { ...sync, matched, sourceCorroborations };
}

export { snapshotFile as advancedDatasetSnapshotFile };
