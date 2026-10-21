import path from 'node:path';
import { config, dataDir } from './config.js';
import { normalizeEntityName } from './intelligenceStore.js';
import { corroborateScheduleRows } from './sourceIntelligence.js';
import { readJson, writeJson } from './storage.js';
import { finiteNumber, measuredCalculation } from './dataValidation.js';
import { advancedDatasetRequest, calendarDay, checkedDatasetRows, checkedNflSeasonRows, nflGameSeasonEvidence, nhlGameSeasonEvidence, nonemptyText } from './advancedDatasetContracts.js';
export { advancedDatasetRequest } from './advancedDatasetContracts.js';

const snapshotFile = path.join(dataDir, 'advanced-datasets.json');
const DAY_MS = 86_400_000;
let syncPromise = null;
let syncRequestKey = null;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function finite(value, fallback = null) {
  return finiteNumber(value, fallback);
}

const perGame = (total, games) => measuredCalculation([total, games], (value, count) => count > 0 ? value / count : null);
const difference = (home, away, scale = 1) => measuredCalculation([home, away], (h, a) => (h - a) / scale);

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
  const request = advancedDatasetRequest(options);
  if (!config.advancedDatasetsEnabled || options.localOnly || config.localOnly) {
    return { ...request, snapshot: await readAdvancedDatasetSnapshot(), externalCalls: 0, diagnostics: ['Advanced dataset sync skipped by configuration/local-only mode.'] };
  }
  const requestKey = JSON.stringify(request.requestIdentities);
  if (syncPromise) {
    if (syncRequestKey === requestKey) return syncPromise;
    await syncPromise;
    return syncAdvancedDatasets(options);
  }
  syncRequestKey = requestKey;
  syncPromise = (async () => {
    const current = await readAdvancedDatasetSnapshot();
    const clock = options.clock || Date.now, { now, year, seasonStart, requestIdentities } = request;
    const statuses = new Map((current.sources || []).map(row => [row.id, row]));
    const sourceDue = id => {
      const row = statuses.get(id), checked = Date.parse(row?.checkedAt || '');
      if (Date.parse(row?.providerRetryAfter || '') > now) return false;
      if (options.force) return true;
      if (row?.requestKey !== requestIdentities[id]) return true;
      if (!Number.isFinite(checked) || checked > now) return true;
      if (row.ok === false) return !(Date.parse(row.retryAfter || '') > now);
      if (row.ok !== true) return true;
      const success = Date.parse(row.lastSuccessAt || row.checkedAt || '');
      return !Number.isFinite(success) || success > now || now - success >= config.advancedDatasetSyncDays * DAY_MS;
    };
    const sourceIds = ['tennis-atp', 'tennis-wta', 'baseball-savant-batter', 'baseball-savant-pitcher',
      'nflverse-team-stats', 'nflverse-schedules', 'moneypuck-team-xg', 'statsbomb-open-data',
      ...(config.advancedNbaStatsEnabled ? ['nba-advanced-teams'] : [])];
    if (!sourceIds.some(sourceDue)) return { ...request, snapshot: current, externalCalls: 0,
      diagnostics: ['Advanced datasets: each enabled source is within its success cache or retry delay; retained row receipts are unchanged.'] };
    const snapshot = { tennis: {}, baseballPlayers: {}, footballTeams: {}, footballSchedules: [], hockeyTeams: {}, basketballTeams: {}, soccerCompetitions: [], ...current,
      version: 2, receiptPolicy: 'per-source-received-rows-v1', sources: [...statuses.values()], updatedAt: new Date(now).toISOString() };
    let externalCalls = 0;
    const providerFetch = options.fetchImpl || fetch;
    const fetchImpl = (...args) => { externalCalls += 1; return providerFetch(...args); };
    const sourceText = (url, timeoutMs) => fetchText(url, fetchImpl, timeoutMs, clock);
    const recordStatus = (id, url, ok, details) => {
      const previous = statuses.get(id);
      const row = sourceStatus(id, url, ok, { ...details, requestKey: requestIdentities[id],
        lastSuccessRequestKey: ok ? requestIdentities[id] : previous?.lastSuccessRequestKey || (previous?.ok ? previous.requestKey : null) || null }, previous, clock());
      statuses.set(id, row); snapshot.sources = [...statuses.values()];
    };
    const stamp = (row, sourceDatasetId) => ({ ...row, sourceDatasetId, sourceRequestKey: requestIdentities[sourceDatasetId], sourceFetchedAt: new Date(clock()).toISOString() });
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
        const parsed = checkedDatasetRows(parseCsv(text), { source: `tennis-${tour}`,
          keys: [['winner_name'],['loser_name'],['tourney_date']],
          identity: row => nonemptyText(row.winner_name) && nonemptyText(row.loser_name) && Boolean(calendarDay(row.tourney_date)) });
        const rows = parsed.rows.filter(row => calendarDay(row.tourney_date).startsWith(String(year)))
          .map(row => ({ ...row, tourney_date: calendarDay(row.tourney_date).replaceAll('-', '') }));
        if (!rows.length) throw new Error(`Advanced source tennis-${tour}: no observations for requested year`);
        snapshot.tennis[tour] = Object.fromEntries(Object.entries(buildTennisDataset(rows, tour)).map(([key, row]) => [key, stamp(row, `tennis-${tour}`)]));
        recordStatus(`tennis-${tour}`, usedUrl, true, { rows: rows.length, rejectedRows: parsed.rejectedRows,
          excludedPeriodRows: parsed.rows.length - rows.length, players: Object.keys(snapshot.tennis[tour]).length, license: 'non-commercial attribution/share-alike; see source repository' });
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
        const parsed = checkedDatasetRows(parseCsv(await sourceText(url)), { source: `baseball-savant-${role}`,
          keys: [['last_name, first_name','player_name'],['est_ba','est_slg','est_woba']], features: ['est_ba','est_slg','est_woba'],
          identity: row => nonemptyText(row['last_name, first_name'] || row.player_name) });
        const rows = parsed.rows;
        for (const row of rows) {
          const name = row['last_name, first_name'] || row.player_name || '';
          if (!name) continue;
          const parts = name.split(',').map((value) => value.trim());
          const displayName = parts.length === 2 ? `${parts[1]} ${parts[0]}` : name;
          snapshot.baseballPlayers[normalizeEntityName(displayName)] = stamp({
            name: displayName, role, playerId: row.player_id,
            expectedAverage: finite(row.est_ba), expectedSlugging: finite(row.est_slg), expectedWoba: finite(row.est_woba),
            sampleSize: finite(row.pa ?? row.bip)
          }, `baseball-savant-${role}`);
        }
        recordStatus(`baseball-savant-${role}`, url, true, { rows: rows.length, rejectedRows: parsed.rejectedRows, license: 'MLB Baseball Savant public CSV' });
        diagnostics.push(`Baseball Savant ${role}: ${rows.length} expected-stat row(s).`);
      } catch (error) {
        recordStatus(`baseball-savant-${role}`, url, false, { error: error.message, retryAfterMs: error.retryAfterMs });
        diagnostics.push(`Baseball Savant ${role} unavailable; retained prior data (${error.message}).`);
      }
    }

    const footballSeason = seasonStart;
    const nflUrl = `https://github.com/nflverse/nflverse-data/releases/download/stats_team/stats_team_reg_${footballSeason}.csv`;
    if (sourceDue('nflverse-team-stats')) {
      try {
        const parsed = checkedNflSeasonRows(parseCsv(await sourceText(nflUrl)), footballSeason);
        const rows = parsed.rows;
        snapshot.footballTeams = Object.fromEntries(rows.map((row) => [String(row.team || '').trim().toUpperCase(), stamp({
          team: String(row.team || '').trim().toUpperCase(), season: finite(row.season), seasonType: row.season_type, games: finite(row.games),
          epaPerGame: perGame(measuredCalculation([row.passing_epa, row.rushing_epa], (passing, rushing) => passing + rushing), row.games),
          passingEpaPerGame: perGame(row.passing_epa, row.games),
          rushingEpaPerGame: perGame(row.rushing_epa, row.games),
          cpoe: finite(row.passing_cpoe)
        }, 'nflverse-team-stats')]));
        recordStatus('nflverse-team-stats', nflUrl, true, { rows: rows.length, rejectedRows: parsed.rejectedRows, license: 'CC BY 4.0' });
        diagnostics.push(`nflverse team stats: ${rows.length} team row(s) for ${footballSeason}.`);
      } catch (error) {
        recordStatus('nflverse-team-stats', nflUrl, false, { error: error.message, retryAfterMs: error.retryAfterMs });
        diagnostics.push(`nflverse team stats unavailable; retained prior data (${error.message}).`);
      }
    }

    const nflScheduleUrl = 'https://github.com/nflverse/nflverse-data/releases/download/schedules/games.csv';
    if (sourceDue('nflverse-schedules')) {
      try {
        const parsed = checkedDatasetRows(parseCsv(await sourceText(nflScheduleUrl)), { source: 'nflverse-schedules',
          keys: [['season'],['gameday'],['away_team'],['home_team']],
          identity: row => finite(row.season) !== null && Boolean(calendarDay(row.gameday)) && nonemptyText(row.away_team) && nonemptyText(row.home_team) });
        const rows = parsed.rows;
        const schedules = rows
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
        if (!schedules.length) throw new Error('Advanced source nflverse-schedules: no observations for requested seasons');
        snapshot.footballSchedules = schedules;
        recordStatus('nflverse-schedules', nflScheduleUrl, true, { rows: schedules.length, rejectedRows: parsed.rejectedRows, excludedPeriodRows: rows.length - schedules.length, license: 'CC BY 4.0' });
        diagnostics.push(`nflverse schedule redundancy: ${snapshot.footballSchedules.length} recent game row(s).`);
      } catch (error) {
        recordStatus('nflverse-schedules', nflScheduleUrl, false, { error: error.message, retryAfterMs: error.retryAfterMs });
        diagnostics.push(`nflverse schedule redundancy unavailable; retained prior data (${error.message}).`);
      }
    }

    const hockeySeason = seasonStart;
    const moneyPuckUrl = `https://moneypuck.com/moneypuck/playerData/seasonSummary/${hockeySeason}/regular/teams.csv`;
    if (sourceDue('moneypuck-team-xg')) {
      try {
        const parsed = checkedDatasetRows(parseCsv(await sourceText(moneyPuckUrl)), { source: 'moneypuck-team-xg',
          keys: [['team'],['situation'],['xGoalsFor','xGoalsAgainst','goalsFor','goalsAgainst']],
          features: ['xGoalsFor','xGoalsAgainst','goalsFor','goalsAgainst'], identity: row => nonemptyText(row.team) && nonemptyText(row.situation) });
        const rows = parsed.rows;
        const allSituations = rows.filter((row) => String(row.situation).toLowerCase() === 'all');
        if (!allSituations.length) throw new Error('Advanced source moneypuck-team-xg: no all-situations observations');
        snapshot.hockeyTeams = Object.fromEntries(allSituations.map((row) => [String(row.team || '').trim().toUpperCase(), stamp({
          team: String(row.team || '').trim().toUpperCase(), games: finite(row.games_played),
          xGoalsFor: finite(row.xGoalsFor), xGoalsAgainst: finite(row.xGoalsAgainst),
          flurryXgFor: finite(row.flurryAdjustedxGoalsFor), flurryXgAgainst: finite(row.flurryAdjustedxGoalsAgainst),
          goalsFor: finite(row.goalsFor), goalsAgainst: finite(row.goalsAgainst)
        }, 'moneypuck-team-xg')]));
        recordStatus('moneypuck-team-xg', moneyPuckUrl, true, { rows: allSituations.length, rejectedRows: parsed.rejectedRows, attribution: 'MoneyPuck.com' });
        diagnostics.push(`MoneyPuck team xG: ${allSituations.length} team row(s) for ${hockeySeason}.`);
      } catch (error) {
        recordStatus('moneypuck-team-xg', moneyPuckUrl, false, { error: error.message, retryAfterMs: error.retryAfterMs });
        diagnostics.push(`MoneyPuck team xG unavailable; retained prior data (${error.message}).`);
      }
    }

    if (config.advancedNbaStatsEnabled && sourceDue('nba-advanced-teams')) {
      const seasonLabel = `${seasonStart}-${String(seasonStart + 1).slice(-2)}`;
      const nbaUrl = `https://stats.nba.com/stats/leaguedashteamstats?Conference=&DateFrom=&DateTo=&Division=&GameScope=&GameSegment=&LastNGames=0&LeagueID=00&Location=&MeasureType=Advanced&Month=0&OpponentTeamID=0&Outcome=&PORound=0&PaceAdjust=N&PerMode=PerGame&Period=0&PlusMinus=N&Rank=N&Season=${seasonLabel}&SeasonType=Regular%20Season&TeamID=0`;
      try {
        const payload = JSON.parse(await sourceText(nbaUrl, 8_000));
        const resultSet = payload.resultSets?.[0] || payload.resultSet || {};
        const headers = resultSet.headers, dataRows = resultSet.rowSet;
        if (!Array.isArray(headers) || !Array.isArray(dataRows) || dataRows.some(row => !Array.isArray(row))) throw new Error('Advanced source nba-advanced-teams: unsupported payload schema');
        const parsed = checkedDatasetRows(dataRows.map(values => Object.fromEntries(headers.map((header, index) => [header, values[index]]))),
          { source: 'nba-advanced-teams', keys: [['TEAM_NAME'],['PACE','NET_RATING','OFF_RATING','DEF_RATING']],
            features: ['PACE','NET_RATING','OFF_RATING','DEF_RATING'], identity: row => nonemptyText(row.TEAM_NAME) });
        const rows = parsed.rows;
        snapshot.basketballTeams = Object.fromEntries(rows.map((row) => [normalizeEntityName(row.TEAM_NAME), stamp({
          team: row.TEAM_NAME, teamId: row.TEAM_ID, games: row.GP, pace: row.PACE,
          offensiveRating: row.OFF_RATING, defensiveRating: row.DEF_RATING, netRating: row.NET_RATING
        }, 'nba-advanced-teams')]));
        recordStatus('nba-advanced-teams', nbaUrl, true, { rows: rows.length, rejectedRows: parsed.rejectedRows });
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
        const parsed = checkedDatasetRows(JSON.parse(text), { source: 'statsbomb-open-data', keys: [['competition_id'],['season_id']],
          identity: row => Number.isInteger(finite(row.competition_id)) && Number.isInteger(finite(row.season_id)) });
        const rows = parsed.rows;
        snapshot.soccerCompetitions = rows.map((row) => stamp({
          competitionId: row.competition_id,
          seasonId: row.season_id,
          competition: row.competition_name,
          season: row.season_name,
          matchAvailable: row.match_available
        }, 'statsbomb-open-data'));
        recordStatus('statsbomb-open-data', statsBombUrl, true, { competitions: snapshot.soccerCompetitions.length, rejectedRows: parsed.rejectedRows, license: 'StatsBomb Open Data terms' });
        diagnostics.push(`StatsBomb open-data catalog: ${snapshot.soccerCompetitions.length} competition-season record(s).`);
      } catch (error) {
        recordStatus('statsbomb-open-data', statsBombUrl, false, { error: error.message, retryAfterMs: error.retryAfterMs });
        diagnostics.push(`StatsBomb catalog unavailable; retained prior data (${error.message}).`);
      }
    }
    await writeJson(snapshotFile, snapshot, { compact: true, backup: true, mode: 0o600 });
    return { ...request, snapshot, externalCalls, diagnostics };
  })();
  const operation = syncPromise;
  try { return await operation; } finally { if (syncPromise === operation) { syncPromise = null; syncRequestKey = null; } }
}

function playerRecord(snapshot, tour, name) {
  const key = normalizeEntityName(name);
  return snapshot.tennis?.[tour]?.[key] || null;
}

function receiptProvenance(previous, rows) {
  const inherited = Array.isArray(previous?.sourceReceiptTimes) ? previous.sourceReceiptTimes
    : previous && Object.keys(previous).length ? [null] : [];
  return { sourceReceiptTimes: [...inherited, ...rows.map(row => row?.sourceFetchedAt || null)],
    sourceRequestKeys: [...(previous?.sourceRequestKeys || []), ...rows.map(row => row?.sourceRequestKey || null)],
    publicationTimeVerified: false, provenancePolicy: 'contributing-row-receipts-v1' };
}

export async function attachAdvancedDatasetContext(games = [], options = {}) {
  const sync = await syncAdvancedDatasets(options);
  const explicitPeriod = options.year !== undefined || options.seasonStart !== undefined;
  const eligibleRow = (row, sourceId) => !row ? null : row.sourceRequestKey
    ? row.sourceRequestKey === sync.requestIdentities[sourceId] ? row : null : explicitPeriod ? null : row;
  let matched = 0;
  const periodRejections = [];
  const provenance = (previous, rows, sourceId) => {
    const status = (sync.snapshot.sources || []).find(row => row.id === sourceId);
    return { ...receiptProvenance(previous, rows), requestedSourceKey: sync.requestIdentities[sourceId], sourceRefreshStatuses: [...(previous?.sourceRefreshStatuses || []), {
      sourceId, state: status?.ok === true ? 'success' : status?.ok === false ? 'failed' : 'unknown',
      requestKey: status?.requestKey || null, lastSuccessRequestKey: status?.lastSuccessRequestKey || null,
      checkedAt: status?.checkedAt || null, lastSuccessAt: status?.lastSuccessAt || (status?.ok ? status.checkedAt : null) || null,
      retryAfter: status?.retryAfter || null, providerRetryAfter: status?.providerRetryAfter || null
    }] };
  };
  const sourceCorroborations = config.sourceRedundancyEnabled ? corroborateScheduleRows(games.filter((game) => game.leagueKey === 'nfl'),
    (sync.snapshot.footballSchedules || []).filter(row => eligibleRow(row, 'nflverse-schedules')), {
    provider: 'nflverse independent schedule'
  }) : 0;
  for (const game of games) {
    if (game.advancedDataset) {
      const keys = Array.isArray(game.advancedDataset.sourceRequestKeys) ? game.advancedDataset.sourceRequestKeys : [];
      const incompatible = keys.some(key => {
        if (!key) return explicitPeriod;
        try { const source = JSON.parse(key).source; return sync.requestIdentities[source] !== key; }
        catch { return true; }
      });
      if (incompatible || explicitPeriod && !keys.length || game.advancedDataset.sourceRequestKeys && !Array.isArray(game.advancedDataset.sourceRequestKeys)) delete game.advancedDataset;
    }
    const leagueKey = String(game.leagueKey || '').toLowerCase();
    if (leagueKey === 'mlb') {
      const sideMetric = (side) => {
        const team = normalizeEntityName(game[side]?.name);
        const rows = (game.autoPlayers || []).filter((row) => normalizeEntityName(row.team) === team)
          .map((row) => sync.snapshot.baseballPlayers?.[normalizeEntityName(row.name)])
          .map(row => eligibleRow(row, 'baseball-savant-batter'))
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
      const away = eligibleRow(sync.snapshot.footballTeams?.[String(game.away?.abbr || '').toUpperCase()], 'nflverse-team-stats');
      const home = eligibleRow(sync.snapshot.footballTeams?.[String(game.home?.abbr || '').toUpperCase()], 'nflverse-team-stats');
      if (away || home) {
        const sourcePeriodEvidence = nflGameSeasonEvidence(game, [away, home]);
        const usable = away && home && !sourcePeriodEvidence.blocked;
        game.advancedDataset = { ...(game.advancedDataset || {}), ...provenance(game.advancedDataset, [away, home], 'nflverse-team-stats'),
          provider: 'nflverse team stats', sourcePeriodEvidence,
          epaDifference: usable ? difference(home.epaPerGame, away.epaPerGame, 60) : null,
          passingEpaDifference: usable ? difference(home.passingEpaPerGame, away.passingEpaPerGame, 38) : null,
          rushingEpaDifference: usable ? difference(home.rushingEpaPerGame, away.rushingEpaPerGame, 24) : null,
          cpoeDifference: usable ? difference(home.cpoe, away.cpoe) : null };
        if (usable) matched += 1;
        if (sourcePeriodEvidence.blocked) periodRejections.push({gameId:String(game.id||''),...sourcePeriodEvidence});
      }
      continue;
    }
    if (leagueKey === 'nhl') {
      const away = eligibleRow(sync.snapshot.hockeyTeams?.[String(game.away?.abbr || '').toUpperCase()], 'moneypuck-team-xg');
      const home = eligibleRow(sync.snapshot.hockeyTeams?.[String(game.home?.abbr || '').toUpperCase()], 'moneypuck-team-xg');
      if (away || home) {
        const sourcePeriodEvidence = nhlGameSeasonEvidence(game, [away, home]);
        const usable = away && home && !sourcePeriodEvidence.blocked;
        const netRate = (row, forField, againstField) => perGame(difference(row[forField], row[againstField]), row.games);
        game.advancedDataset = { ...(game.advancedDataset || {}), ...provenance(game.advancedDataset, [away, home], 'moneypuck-team-xg'), provider: 'MoneyPuck.com', sourcePeriodEvidence,
          awayXg: usable ? perGame(away.xGoalsFor, away.games) : null, homeXg: usable ? perGame(home.xGoalsFor, home.games) : null,
          xgDifference: usable ? difference(netRate(home, 'xGoalsFor', 'xGoalsAgainst'), netRate(away, 'xGoalsFor', 'xGoalsAgainst')) : null,
          gsaxDifference: usable ? difference(netRate(home, 'xGoalsAgainst', 'goalsAgainst'), netRate(away, 'xGoalsAgainst', 'goalsAgainst')) : null };
        if (usable) matched += 1;
        if (sourcePeriodEvidence.blocked) periodRejections.push({gameId:String(game.id||''),...sourcePeriodEvidence});
      }
      continue;
    }
    if (leagueKey === 'nba') {
      const away = eligibleRow(sync.snapshot.basketballTeams?.[normalizeEntityName(game.away?.name)], 'nba-advanced-teams');
      const home = eligibleRow(sync.snapshot.basketballTeams?.[normalizeEntityName(game.home?.name)], 'nba-advanced-teams');
      if (away && home) {
        game.advancedDataset = { ...(game.advancedDataset || {}), ...provenance(game.advancedDataset, [away, home], 'nba-advanced-teams'), provider: 'NBA.com advanced team stats', pace: measuredCalculation([away.pace, home.pace], (a, h) => (a + h) / 2), efficiencyDifference: difference(home.netRating, away.netRating) };
        matched += 1;
      }
      continue;
    }
    if (!['atp', 'wta'].includes(leagueKey)) continue;
    const tour = String(game.leagueKey).toLowerCase();
    const away = eligibleRow(playerRecord(sync.snapshot, tour, game.away?.name), `tennis-${tour}`);
    const home = eligibleRow(playerRecord(sync.snapshot, tour, game.home?.name), `tennis-${tour}`);
    if (!away || !home) continue;
    const surface = String(game.autoContext?.surface || game.autoContext?.factors?.surface || '').toLowerCase();
    const awaySurface = finite(away.surfaces?.[surface], finite(away.elo));
    const homeSurface = finite(home.surfaces?.[surface], finite(home.elo));
    game.advancedDataset = {
      provider: 'Jeff Sackmann tennis datasets',
      ...provenance(null, [away, home], `tennis-${tour}`),
      surface,
      surfaceEloDifference: difference(homeSurface, awaySurface),
      serveReturnDifference: measuredCalculation([home.serveWon, home.returnWon, away.serveWon, away.returnWon], (homeServe, homeReturn, awayServe, awayReturn) => homeServe + homeReturn - awayServe - awayReturn),
      awayMatches: away.matches,
      homeMatches: home.matches
    };
    matched += 1;
  }
  return { ...sync, matched, sourceCorroborations, periodRejections };
}

export { snapshotFile as advancedDatasetSnapshotFile };
