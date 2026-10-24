import { config } from './config.js';
import { applyPlayerProfilesAndLineups, buildAutomaticPlayerProfiles, enhanceTeamProfiles, parseHistoricalEventSummary } from './advancedMetrics.js';
import { normalizeEntityName } from './intelligenceStore.js';
import { historicalEvidenceBefore, ingestFeatureEvidence } from './featureWarehouse.js';
import { corroborateOfficialSources } from './officialSources.js';
import { compactEspnPlays } from './playByPlay.js';
import { cachedFetchJson } from './providerCache.js';
import { buildAutomaticScheduleContext } from './situationalAutomation.js';
import { applyOfficialAndEnvironmentContext, buildOfficialProfiles, extractEventEnvironment } from './sourceIntelligence.js';
import { sportProfile } from './sportProfiles.js';
import {applyAvailabilitySnapshotFile} from './availabilityProvider.js';
import {enrichNhlGoalieResearch} from './nhlGoalieResearch.js';
import {collectNativeNhlHistory,mergeNativeNhlHistory} from './nativeNhlHistory.js';
import { localDateKey } from './time.js';

/** Official/native IDs are not ESPN event IDs; only explicit or ESPN-origin numeric identities route there. */
export function espnSummaryEventId(row = {}) {
  if(row.espnEventId !== undefined)return /^\d+$/.test(String(row.espnEventId)) ? String(row.espnEventId) : null;
  const id=String(row.id || '');
  const espnOrigin=row.sourceMeta?.provider==='ESPN'||/ESPN/i.test(row.source || '')||id.startsWith('espn:');
  const candidate=id.replace(/^espn:/,'');
  return espnOrigin&&/^\d+$/.test(candidate)?candidate:null;
}

const DAY_MS = 86_400_000;

function compactEspnSummary(payload = {}) {
  return {
    header: payload.header ? { competitions: payload.header.competitions || [] } : undefined,
    boxscore: payload.boxscore ? { teams: payload.boxscore.teams || [], players: payload.boxscore.players || [] } : undefined,
    rosters: payload.rosters || [],
    injuries: payload.injuries || [],
    pickcenter: payload.pickcenter || [],
    plays: config.playByPlayEnabled ? compactEspnPlays(payload.plays || []) : [],
    gameInfo: payload.gameInfo ? {
      weather: payload.gameInfo.weather,
      officials: payload.gameInfo.officials || [],
      venue: payload.gameInfo.venue
    } : undefined
  };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function finite(value, fallback = null) {
  if (value === null || value === undefined || typeof value === 'boolean' || (typeof value === 'string' && !value.trim())) return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function dateParam(date) {
  return date.toISOString().slice(0, 10).replaceAll('-', '');
}

function dateAtNoonUtc(dateKey) {
  return new Date(`${dateKey}T12:00:00.000Z`);
}

function leagueLookbackDays(league) {
  // NCAA basketball produces hundreds of events per week. A 14-day window
  // stays below the provider's 999-event ceiling and retains the most recent
  // games instead of truncating the back half of a longer range.
  const byLeague = { ncaab: 14, ncaaw: 14, nfl: 365, ncaaf: 365, ufc: 365, atp: 90, wta: 90 };
  const byGroup = { Baseball: 45, Basketball: 90, Football: 365, Hockey: 120, Soccer: 180, Combat: 365, Tennis: 90 };
  return Math.min(config.autoHistoryMaxDays, byLeague[league.key] || byGroup[league.group] || 120);
}

function teamFromCompetitors(competitors, side) {
  const row = competitors.find((item) => item.homeAway === side) || competitors[side === 'away' ? 0 : 1] || {};
  const team = row.team || row.athlete || {};
  return {
    id: String(team.id || row.id || ''),
    name: team.displayName || team.shortDisplayName || team.name || row.displayName || side,
    abbr: team.abbreviation || team.shortDisplayName || ''
  };
}

function venueDetails(venue = {}) {
  return {
    id: String(venue.id || ''),
    name: venue.fullName || venue.shortName || venue.name || '',
    address: {
      city: venue.address?.city || '',
      state: venue.address?.state || '',
      country: venue.address?.country || ''
    }
  };
}

function probableStarters(competition, away, home) {
  const output = [];
  for (const side of ['away', 'home']) {
    const competitor = competition?.competitors?.find((item) => item.homeAway === side) || {};
    const team = side === 'away' ? away : home;
    for (const probable of competitor.probables || []) {
      const athlete = probable.athlete || {};
      const name = athlete.displayName || athlete.fullName || athlete.shortName || '';
      if (!name) continue;
      output.push({
        athleteId: String(athlete.id || probable.playerId || ''),
        name,
        team: team.name,
        side,
        role: athlete.position?.displayName || athlete.position?.name || athlete.position || probable.displayName || probable.name || 'Probable starter'
      });
    }
  }
  return output;
}

export function parseEspnHistoryEvents(payload, league, cutoffDateKey = '', sourceMeta = {}) {
  const rows = [];
  for (const event of payload?.events || []) {
    const competition = event.competitions?.[0];
    if (!competition?.competitors?.length || !(event.status?.type?.completed || competition.status?.type?.completed)) continue;
    const status = event.status?.type || competition.status?.type || {};
    if (/cancel|postpon|delay|abandon|suspend|no contest/i.test(`${status.name || ''} ${status.detail || ''} ${status.shortDetail || ''}`)) continue;
    const startTime = event.date || competition.date || '';
    if (cutoffDateKey && localDateKey(new Date(startTime)) >= cutoffDateKey) continue;
    const away = teamFromCompetitors(competition.competitors, 'away');
    const home = teamFromCompetitors(competition.competitors, 'home');
    const awayRow = competition.competitors.find((item) => item.homeAway === 'away') || competition.competitors[0];
    const homeRow = competition.competitors.find((item) => item.homeAway === 'home') || competition.competitors[1];
    const awayScore = finite(awayRow?.score);
    const homeScore = finite(homeRow?.score);
    if (!away.name || !home.name || awayScore === null || homeScore === null || awayScore < 0 || homeScore < 0) continue;
    rows.push({
      id: `espn:${event.id || competition.id}`,
      dateKey: localDateKey(new Date(startTime)),
      startTime,
      league: league.label,
      leagueKey: league.key,
      sportGroup: league.group,
      awayTeam: away.name,
      awayTeamId: away.id,
      awayAbbr: away.abbr,
      homeTeam: home.name,
      homeTeamId: home.id,
      homeAbbr: home.abbr,
      awayScore,
      homeScore,
      neutralSite: Boolean(competition.neutralSite),
      venueDetails: venueDetails(competition.venue),
      probableStarters: probableStarters(competition, away, home),
      seasonYear: finite(event.season?.year ?? competition.season?.year),
      seasonType: finite(event.season?.type ?? competition.season?.type),
      seasonSlug: event.season?.slug || competition.season?.slug || '',
      source: 'ESPN automatic history',
      sourceMeta: {
        provider: 'ESPN',
        fetchedAt: sourceMeta.fetchedAt || '',
        cacheState: sourceMeta.cacheState || 'unknown',
        truncated: Boolean(sourceMeta.truncated)
      }
    });
  }
  return rows;
}

export function applyHistoricalStarterRest(games = [], results = []) {
  let matched = 0;
  for (const game of games) {
    const gameTime = new Date(game.startTime || `${game.dateKey}T12:00:00Z`).getTime();
    if (!Number.isFinite(gameTime)) continue;
    for (const player of game.autoPlayers || []) {
      if (!player.starter || !/pitcher|goalie|goaltender|quarterback|\bqb\b/i.test(String(player.role || ''))) continue;
      const athleteId = String(player.sourceAthleteId || player.athleteId || '');
      const name = normalizeEntityName(player.name);
      const team = normalizeEntityName(player.team);
      const prior = results
        .filter((result) => new Date(result.startTime || `${result.dateKey}T12:00:00Z`).getTime() < gameTime)
        .flatMap((result) => (result.probableStarters || []).map((starter) => ({ ...starter, startTime: result.startTime || `${result.dateKey}T12:00:00Z` })))
        .filter((starter) => normalizeEntityName(starter.team) === team && ((athleteId && String(starter.athleteId) === athleteId) || normalizeEntityName(starter.name) === name))
        .sort((a, b) => new Date(b.startTime) - new Date(a.startTime))[0];
      if (!prior) continue;
      const daysSinceLastStart = Math.max(0, Math.floor((gameTime - new Date(prior.startTime).getTime()) / DAY_MS));
      player.stats = { ...(player.stats || {}), daysSinceLastStart, previousStartTime: prior.startTime };
      player.starterRestSource = 'ESPN cached historical probable starters';
      matched += 1;
    }
  }
  return matched;
}

function mean(values) {
  return values.length ? values.reduce((total, value) => total + value, 0) / values.length : 0;
}

function standardDeviation(values) {
  if (values.length < 2) return 1;
  const average = mean(values);
  return Math.max(0.01, Math.sqrt(mean(values.map((value) => (value - average) ** 2))));
}

function profileId(league, name) {
  return `auto__${normalizeEntityName(league)}__${normalizeEntityName(name)}`;
}

export function buildAutomaticTeamProfiles(results = [], predictionDate = new Date(), fetchedAt = '', options = {}) {
  const currentSeasonByLeague = new Map((options.currentGames || []).map((game) => [game.leagueKey || game.league, {
    year: finite(game.seasonYear), type: finite(game.seasonType)
  }]));
  const byLeague = new Map();
  for (const result of results) {
    const key = result.leagueKey || result.league;
    const current = currentSeasonByLeague.get(key);
    // NHL native composite seasons and provider four-digit labels are different scales.
    const comparableSeason=key!=='nhl'||String(current?.year||'').length===String(result.seasonYear||'').length;
    if (comparableSeason && current?.year && result.seasonYear && result.seasonYear > current.year) continue;
    if (current?.type === 2 && result.seasonType === 1) continue;
    if (!byLeague.has(key)) byLeague.set(key, []);
    byLeague.get(key).push(result);
  }
  const profiles = {};
  for (const [leagueKey, leagueResults] of byLeague) {
    const teams = new Map();
    const ensure = (name, abbr, league, sportGroup) => {
      const key = normalizeEntityName(name);
      if (!teams.has(key)) teams.set(key, { name, aliases: new Set([abbr].filter(Boolean)), league, leagueKey, sportGroup, games: [] });
      else if (abbr) teams.get(key).aliases.add(abbr);
      return teams.get(key);
    };
    for (const result of [...leagueResults].sort((a, b) => new Date(a.startTime) - new Date(b.startTime))) {
      const away = ensure(result.awayTeam, result.awayAbbr, result.league, result.sportGroup);
      const home = ensure(result.homeTeam, result.homeAbbr, result.league, result.sportGroup);
      away.games.push({ date: result.startTime || `${result.dateKey}T12:00:00Z`, scored: result.awayScore, allowed: result.homeScore, points: result.awayScore === result.homeScore ? 0.5 : result.awayScore > result.homeScore ? 1 : 0, side: 'away', venue: result.venueDetails, seasonYear: result.seasonYear, seasonType: result.seasonType, sourceMeta: result.sourceMeta || {} });
      home.games.push({ date: result.startTime || `${result.dateKey}T12:00:00Z`, scored: result.homeScore, allowed: result.awayScore, points: result.homeScore === result.awayScore ? 0.5 : result.homeScore > result.awayScore ? 1 : 0, side: 'home', venue: result.venueDetails, seasonYear: result.seasonYear, seasonType: result.seasonType, sourceMeta: result.sourceMeta || {} });
    }

    const metrics = [...teams.values()].map((team) => {
      const games = team.games;
      const recent = games.slice(-10);
      const scored = mean(games.map((game) => game.scored));
      const allowed = mean(games.map((game) => game.allowed));
      const winPct = (games.reduce((total, game) => total + game.points, 0) + 4) / (games.length + 8);
      const recentPct = (recent.reduce((total, game) => total + game.points, 0) + 2.5) / (recent.length + 5);
      return { team, games, recent, scored, allowed, winPct, recentPct, differential: scored - allowed };
    });
    const scoredMean = mean(metrics.map((row) => row.scored));
    const allowedMean = mean(metrics.map((row) => row.allowed));
    const diffMean = mean(metrics.map((row) => row.differential));
    const scoredSd = standardDeviation(metrics.map((row) => row.scored));
    const allowedSd = standardDeviation(metrics.map((row) => row.allowed));
    const diffSd = standardDeviation(metrics.map((row) => row.differential));

    for (const row of metrics) {
      const sampleReliability = row.games.length / (row.games.length + 8);
      const recentReliability = row.recent.length / (row.recent.length + 5);
      const offenseRaw = 50 + ((row.scored - scoredMean) / scoredSd) * 12;
      const defenseRaw = 50 - ((row.allowed - allowedMean) / allowedSd) * 12;
      const winRating = 50 + (row.winPct - 0.5) * 70;
      const marginRating = 50 + ((row.differential - diffMean) / diffSd) * 11;
      const powerRaw = winRating * 0.65 + marginRating * 0.35;
      const formRaw = 50 + (row.recentPct - 0.5) * 65;
      const lastGameTime = new Date(row.games.at(-1)?.date || '').getTime();
      const gapDays = Number.isFinite(lastGameTime) ? Math.max(0, Math.floor((predictionDate.getTime() - lastGameTime) / DAY_MS)) : null;
      const restDays = Number.isFinite(lastGameTime)
        ? clamp(Math.floor((predictionDate.getTime() - lastGameTime) / DAY_MS) - 1, 0, 30)
        : null;
      const transitionThreshold = { Baseball: 80, Basketball: 75, Football: 120, Hockey: 90, Soccer: 75, Tennis: 45, Combat: 120 }[row.team.sportGroup] || 90;
      const seasonTransitionRisk = gapDays === null ? 0 : clamp((gapDays - transitionThreshold) / transitionThreshold, 0, 1);
      const transitionReliability = 1 - seasonTransitionRisk * 0.48;
      const predictionTime = predictionDate.getTime();
      const gamesLast3 = row.games.filter((game) => predictionTime - new Date(game.date).getTime() <= 3 * DAY_MS).length;
      const gamesLast7 = row.games.filter((game) => predictionTime - new Date(game.date).getTime() <= 7 * DAY_MS).length;
      let awayStreak = 0;
      for (const gameRow of [...row.games].reverse()) {
        if (gameRow.side !== 'away') break;
        awayStreak += 1;
      }
      const id = profileId(leagueKey, row.team.name);
      profiles[id] = {
        id,
        name: row.team.name,
        league: row.team.league || leagueKey,
        leagueKey,
        sportGroup: row.team.sportGroup,
        aliases: [...row.team.aliases],
        powerRating: clamp(50 + (powerRaw - 50) * sampleReliability * transitionReliability, 20, 80),
        offense: clamp(50 + (offenseRaw - 50) * sampleReliability * transitionReliability, 20, 80),
        defense: clamp(50 + (defenseRaw - 50) * sampleReliability * transitionReliability, 20, 80),
        form: clamp(50 + (formRaw - 50) * recentReliability * transitionReliability, 20, 80),
        restDays,
        lastVenue: row.games.at(-1)?.venue || null,
        seasonTransitionRisk,
        coaching: null,
        chemistry: null,
        homeAdvantage: null,
        travelKm: null,
        stats: {
          historyGames: row.games.length,
          recentGames: row.recent.length,
          winPct: row.winPct,
          recentWinPct: row.recentPct,
          gamesLast3,
          gamesLast7,
          awayStreak,
          gapDays,
          averageScored: row.scored,
          averageAllowed: row.allowed,
          averageDifferential: row.differential
        },
        sampleSize: row.games.length,
        autoGenerated: true,
        source: 'Automatic cached historical results',
        sourceProviders: [...new Set(row.games.map(game=>game.sourceMeta?.provider||'unknown'))],
        sourceReceiptTimes: row.games.map(game=>game.sourceMeta?.fetchedAt||null),
        sourceCacheState: row.games.some(game=>game.sourceMeta?.cacheState==='stale')?'stale':row.games.at(-1)?.sourceMeta?.cacheState || 'unknown',
        sourceFetchedAt: row.games.at(-1)?.sourceMeta?.fetchedAt || '',
        sourceTruncated: row.games.some((game) => game.sourceMeta?.truncated),
        updatedAt: row.games.at(-1)?.sourceMeta?.fetchedAt || fetchedAt || new Date().toISOString(),
        updatedBy: 'automatic-enrichment'
      };
    }
  }
  return profiles;
}

function injuryAvailability(status, type = {}) {
  const text = `${status || ''} ${type.name || ''} ${type.description || ''} ${type.abbreviation || ''}`.toLowerCase().replace(/_/g, ' ');
  if (/\bout\b|\binactive\b|\bsuspend(?:ed|sion)?\b|\breserve\b|\bil\b|\bil\d+\b/.test(text)) return 0;
  if (/doubtful/.test(text)) return 25;
  if (/questionable|game.?time/.test(text)) return 52;
  if (/day.?to.?day/.test(text)) return 65;
  if (/probable|limited/.test(text)) return 82;
  if (/^(available|healthy|active)$/i.test(String(status || '').trim())) return 100;
  return null; // Unrecognized reports are not measured participation probabilities.
}

function automaticPlayerImpact(game, position, starter) {
  const profile = sportProfile(game);
  const role = String(position || '').toLowerCase();
  let impact = 1.2;
  if (profile.key === 'baseball') impact = /starting pitcher|\bsp\b/.test(role) ? 6 : /pitcher|\brp\b|closer/.test(role) ? 2.2 : /catcher|\bc\b/.test(role) ? 2 : 1.2;
  if (profile.key === 'basketball') impact = 2.3;
  if (profile.key === 'football') impact = /quarterback|\bqb\b/.test(role) ? 6.5 : /tackle|\bot\b|receiver|\bwr\b|running back|\brb\b|corner/.test(role) ? 2.4 : 1.5;
  if (profile.key === 'hockey') impact = /goalie|goaltender|\bg\b/.test(role) ? 5.5 : 1.8;
  if (profile.key === 'soccer') impact = /goalkeeper|\bgk\b/.test(role) ? 4.5 : /forward|striker/.test(role) ? 2.8 : 1.8;
  if (profile.key === 'tennis' || profile.key === 'combat') impact = 7;
  return clamp(impact * (starter ? 1.35 : 1), 0.5, 9);
}

function americanToProbability(price) {
  if (price === null || price === undefined || typeof price === 'boolean' || !String(price).trim()) return null;
  const value = Number(price);
  if (!Number.isFinite(value) || Math.abs(value) < 100) return null;
  return value > 0 ? 100 / (value + 100) : Math.abs(value) / (Math.abs(value) + 100);
}

function parseFreeMarket(summary, game, fetchedAt) {
  const row = (summary?.pickcenter || []).find((item) => item?.awayTeamOdds?.moneyLine && item?.homeTeamOdds?.moneyLine);
  if (!row) return null;
  const awayRaw = americanToProbability(row.awayTeamOdds.moneyLine);
  const homeRaw = americanToProbability(row.homeTeamOdds.moneyLine);
  const drawPrice = finite(row.drawOdds?.moneyLine ?? row.drawTeamOdds?.moneyLine);
  const drawRaw = americanToProbability(drawPrice);
  const profile = sportProfile(game);
  if (awayRaw === null || homeRaw === null || (!profile.twoWay && drawRaw === null)) return null;
  const total = awayRaw + homeRaw + (drawRaw || 0);
  const bookmaker = row.provider?.name || 'ESPN line feed';
  const quote = (side, price, raw) => ({
    side,
    bookmaker,
    price: Number(price),
    rawImplied: raw,
    fairProbability: raw / total,
    implied: raw / total,
    quoteCount: 1,
    lastUpdate: fetchedAt,
    timestampSource: 'fetch_time'
  });
  const homePoint = finite(row.spread ?? row.pointSpread?.home?.close?.line);
  const awayPoint = homePoint === null ? null : -homePoint;
  const totalPoint = finite(row.overUnder ?? String(row.total?.over?.close?.line || '').replace(/[^0-9.-]/g, ''));
  return {
    eventId: game.id,
    commenceTime: game.startTime,
    h2h: {
      away: quote('away', row.awayTeamOdds.moneyLine, awayRaw),
      home: quote('home', row.homeTeamOdds.moneyLine, homeRaw),
      draw: drawRaw === null ? null : quote('draw', drawPrice, drawRaw),
      bookmakerCount: 1,
      dispersion: 0,
      lastUpdate: fetchedAt,
      source: 'ESPN cached single-book line'
    },
    spread: homePoint === null ? null : {
      away: { side: 'away', bookmaker, point: awayPoint, price: finite(row.pointSpread?.away?.close?.odds) },
      home: { side: 'home', bookmaker, point: homePoint, price: finite(row.pointSpread?.home?.close?.odds) },
      favorite: homePoint < 0 ? { side: 'home', bookmaker, point: homePoint } : { side: 'away', bookmaker, point: awayPoint }
    },
    total: totalPoint === null ? null : {
      over: { bookmaker, point: totalPoint, price: finite(row.overOdds ?? row.total?.over?.close?.odds) },
      under: { bookmaker, point: totalPoint, price: finite(row.underOdds ?? row.total?.under?.close?.odds) }
    },
    matchStatus: 'matched_free_single_book',
    bookmakerCount: 1,
    lastUpdate: fetchedAt,
    cacheState: 'summary',
    fetchedAt,
    freeProvider: true
  };
}

function weatherContext(summary, fetchedAt) {
  const weather = summary?.gameInfo?.weather;
  const environment = extractEventEnvironment(summary);
  const condition = String(weather?.displayValue || weather?.condition || weather?.conditionId || environment.condition || '');
  const temperature = finite(weather?.temperature, environment.temperatureF);
  const windSpeed = finite(weather?.windSpeed, environment.windSpeedMph);
  let severity = 0;
  if (/rain|snow|storm|thunder|sleet|freez/i.test(condition)) severity += 0.45;
  if (temperature !== null && (temperature <= 32 || temperature >= 95)) severity += 0.3;
  if (windSpeed !== null && windSpeed >= 20) severity += 0.3;
  const factors = { weatherSeverity: clamp(severity, 0, 1) };
  if (windSpeed !== null) factors.windSpeedMph = windSpeed;
  if (environment.precipitation) factors.precipitation = 1;
  if (environment.indoor) factors.indoorVenue = 1;
  if (environment.surface) factors.playingSurfaceKnown = 1;
  if (!weather && !environment.officials.length && !environment.surface && !environment.indoor) return null;
  return {
    factors,
    officials: environment.officials,
    environment,
    notes: [condition, temperature === null ? '' : `${temperature}F`, windSpeed === null ? '' : `${windSpeed} mph wind`, environment.windDirection, environment.surface, environment.indoor ? 'indoor/closed roof' : ''].filter(Boolean).join(', '),
    autoGenerated: true,
    source: 'ESPN event environment',
    updatedAt: fetchedAt
  };
}

function probableStatistics(probable = {}) {
  const output = {};
  for (const row of probable.statistics?.splits?.categories || []) {
    const key = String(row.name || row.abbreviation || '').trim();
    const value = finite(row.value ?? row.displayValue);
    if (key && value !== null) output[key] = value;
  }
  return output;
}

function probableForm(game, role, stats) {
  const profile = sportProfile(game);
  if (profile.key === 'baseball' && /pitcher/i.test(role)) {
    const era = finite(stats.ERA ?? stats.era, 4.35);
    const whip = finite(stats.WHIP ?? stats.whip, 1.32);
    const innings = finite(stats.fullInnings, 0) + finite(stats.partInnings, 0) / 3;
    const strikeouts = finite(stats.strikeouts, 0);
    const walks = finite(stats.walks, 0);
    const command = innings > 10 ? (strikeouts - walks) / innings : 0;
    return clamp(50 + (4.35 - era) * 6.5 + (1.32 - whip) * 11 + command * 3.5, 24, 78);
  }
  return 50;
}

export function parseEspnSummary(summary, game, sourceMeta = {}) {
  const fetchedAt = sourceMeta.fetchedAt || new Date().toISOString();
  const starters = new Map();
  const lineups = [];
  for (const group of summary?.rosters || []) {
    for (const row of group.roster || []) {
      const athleteId = String(row.athlete?.id || '');
      const athlete = row.athlete || {};
      const team = group.team?.displayName || group.team?.name || '';
      if (athleteId && team) starters.set(`${normalizeEntityName(team)}__${athleteId}`, row.starter === true);
      const name = athlete.displayName || athlete.fullName || athlete.shortName || '';
      if (team && name) lineups.push({
        athleteId,
        name,
        team,
        role: row.position?.displayName || row.position?.name || row.position?.abbreviation || athlete.position?.displayName || '',
        starter: row.starter === true,
        confirmedStarter: row.starter === true,
        confirmationStatus: row.starter === true ? 'provider_roster_starter' : 'not_confirmed',
        active: row.active !== false,
        batOrder: finite(row.batOrder),
        formationPlace: row.formationPlace || '',
        source: 'ESPN current event roster', updatedAt: fetchedAt
      });
    }
  }

  const playerMap = new Map();
  const competition = summary?.header?.competitions?.[0];
  for (const competitor of competition?.competitors || []) {
    const teamName = competitor.team?.displayName || competitor.team?.name || '';
    for (const probable of competitor.probables || []) {
      const athlete = probable.athlete || {};
      const name = athlete.displayName || athlete.fullName || athlete.shortName || '';
      if (!teamName || !name) continue;
      const role = athlete.position?.displayName || athlete.position?.name || probable.displayName || probable.name || 'Probable starter';
      const stats = probableStatistics(probable);
      const row = {
        id: `auto-probable-${game.id}-${athlete.id || normalizeEntityName(name)}`,
        sourceAthleteId: String(athlete.id || probable.playerId || ''),
        name,
        team: teamName,
        league: game.league,
        leagueKey: game.leagueKey,
        role,
        impact: automaticPlayerImpact(game, role, true),
        availability: 100,
        availabilityEvidence: 'role_prior_not_injury_clearance',
        status: probable.displayName || 'probable starter',
        form: probableForm(game, role, stats),
        starter: true,
        confirmedStarter: starters.get(`${normalizeEntityName(teamName)}__${athlete.id || ''}`) === true,
        confirmationStatus: starters.get(`${normalizeEntityName(teamName)}__${athlete.id || ''}`) === true ? 'provider_roster_starter' : 'projected',
        stats,
        notes: 'Named in provider probable starter data; confirmation requires an event-roster starter record.',
        source: 'ESPN automatic probable starter',
        sources: ['ESPN automatic probable starter'],
        autoGenerated: true,
        updatedAt: fetchedAt,
        updatedBy: 'automatic-enrichment'
      };
      playerMap.set(`${normalizeEntityName(teamName)}__${row.sourceAthleteId || normalizeEntityName(name)}`, row);
    }
  }

  for (const group of summary?.injuries || []) {
    const teamName = group.team?.displayName || group.team?.name || '';
    for (const injury of group.injuries || []) {
      const athlete = injury.athlete || {};
      const name = athlete.displayName || athlete.fullName || athlete.shortName || '';
      if (!name || !teamName) continue;
      const role = athlete.position?.displayName || athlete.position?.name || athlete.position?.abbreviation || '';
      const starter = starters.get(`${normalizeEntityName(teamName)}__${athlete.id || ''}`) || false;
      const status = String(injury.status || injury.type?.description || injury.type?.abbreviation || 'injury report');
      const availability = injuryAvailability(status, injury.type);
      const row = {
        id: `auto-injury-${game.id}-${athlete.id || normalizeEntityName(name)}`,
        sourceAthleteId: String(athlete.id || ''),
        name,
        team: teamName,
        league: game.league,
        role,
        impact: automaticPlayerImpact(game, role, starter),
        availability,
        availabilityEvidence: availability === null ? 'unknown_reported_status' : 'reported_status',
        status,
        form: 50,
        starter,
        confirmedStarter: starter === true,
        stats: {},
        notes: [injury.details?.type, injury.details?.detail, injury.details?.side, injury.details?.returnDate ? `return ${injury.details.returnDate}` : ''].filter(Boolean).join(' | ').slice(0, 600),
        source: 'ESPN automatic injury report',
        sources: ['ESPN automatic injury report'],
        autoGenerated: true,
        updatedAt: fetchedAt,
        updatedBy: 'automatic-enrichment'
      };
      playerMap.set(`${normalizeEntityName(teamName)}__${row.sourceAthleteId || normalizeEntityName(name)}`, row);
    }
  }
  const players = [...playerMap.values()];
  const context = weatherContext(summary, fetchedAt);
  return {
    players,
    lineups,
    context,
    environment: context?.environment || extractEventEnvironment(summary),
    odds: parseFreeMarket(summary, game, fetchedAt),
    meta: {
      fetchedAt,
      cacheState: sourceMeta.cacheState || 'unknown',
      injuryGroupsPresent: Array.isArray(summary?.injuries),
      injuryTeams: (summary?.injuries || []).filter(group => Array.isArray(group.injuries))
        .map(group => group.team?.displayName || group.team?.name || '').filter(Boolean),
      injuryCount: players.filter((row) => /injury report/i.test(row.source)).length,
      rosterGroups: summary?.rosters?.length || 0,
      lineupPlayers: lineups.length,
      probableStarters: players.filter((row) => /probable starter/i.test(row.source)).length,
      pickcenterPresent: Array.isArray(summary?.pickcenter) && summary.pickcenter.length > 0,
      playCount: summary?.plays?.length || 0,
      officialCount: context?.officials?.length || 0
    }
  };
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}

function selectHistoricalBoxscores(results, games, max) {
  if (max <= 0) return [];
  const orderedTeams = [];
  for (const game of games) {
    for (const team of [game.away, game.home]) {
      const key = `${normalizeEntityName(game.leagueKey || game.league)}__${normalizeEntityName(team?.name)}`;
      if (!orderedTeams.some((row) => row.key === key)) orderedTeams.push({ key, league: game.leagueKey || game.league, name: team?.name });
    }
  }
  const queues = orderedTeams.map((team) => ({
    ...team,
    rows: results
      .filter((result) => normalizeEntityName(result.leagueKey || result.league) === normalizeEntityName(team.league) && [result.awayTeam, result.homeTeam].map(normalizeEntityName).includes(normalizeEntityName(team.name)))
      .sort((a, b) => new Date(b.startTime || b.dateKey) - new Date(a.startTime || a.dateKey))
  }));
  const selected = new Map();
  let pass = 0;
  while (selected.size < max && queues.some((queue) => queue.rows.length > pass)) {
    for (const queue of queues) {
      const row = queue.rows[pass];
      if (row) selected.set(row.id, row);
      if (selected.size >= max) break;
    }
    pass += 1;
  }
  return [...selected.values()];
}

function automaticProfileFor(game, side, profiles) {
  const team = game[side];
  const league = normalizeEntityName(game.leagueKey || game.league);
  const targets = [team?.name, team?.abbr].map(normalizeEntityName).filter(Boolean);
  return Object.values(profiles).find((row) => {
    if (normalizeEntityName(row.leagueKey || row.league) !== league) return false;
    const candidates = [row.name, ...(row.aliases || [])].map(normalizeEntityName).filter(Boolean);
    return targets.some((target) => candidates.includes(target));
  }) || null;
}

function mergeAutomaticContexts(existing, schedule) {
  if (!existing) return schedule;
  if (!schedule) return existing;
  return {
    ...schedule,
    ...existing,
    factors: { ...(schedule.factors || {}), ...(existing.factors || {}) },
    notes: [schedule.notes, existing.notes].filter(Boolean).join('; '),
    source: `${schedule.source} + ${existing.source}`
  };
}

export async function enrichGamesAutomatically(games, date, options = {}) {
  if (options.localOnly || config.localOnly || !config.autoEnrichEnabled) {
    const cutoffDateKey = localDateKey(date);
    const stored = config.featureWarehouseEnabled
      ? await historicalEvidenceBefore(cutoffDateKey)
      : { results: [], boxscores: [] };
    const fetchedAt = new Date().toISOString();
    const teamProfiles = enhanceTeamProfiles(
      buildAutomaticTeamProfiles(stored.results, date, fetchedAt, { currentGames: games }),
      stored.results,
      stored.boxscores
    );
    const playerProfiles = buildAutomaticPlayerProfiles(stored.boxscores);
    const playerApplication = applyPlayerProfilesAndLineups(games, playerProfiles);
    const officialProfiles = buildOfficialProfiles(stored.boxscores);
    for (const game of games) {
      const awayTeam = automaticProfileFor(game, 'away', teamProfiles);
      const homeTeam = automaticProfileFor(game, 'home', teamProfiles);
      game.autoContext = mergeAutomaticContexts(game.autoContext, buildAutomaticScheduleContext(game, awayTeam, homeTeam));
    }
    const officialProfileMatches = applyOfficialAndEnvironmentContext(games, officialProfiles);
    const localAvailability=await applyAvailabilitySnapshotFile(games,{file:config.availabilityProviderSnapshotFile});
    return {
      games,
      historyResults: stored.results,
      historicalSamples: stored.boxscores,
      teamProfiles,
      playerProfiles,
      diagnostics: [`Automatic network enrichment: skipped (${options.localOnly || config.localOnly ? 'LOCAL_ONLY=true' : 'AUTO_ENRICH_ENABLED=false'}); loaded ${stored.results.length} final(s) and ${stored.boxscores.length} box score(s) from the local feature warehouse.`,
        ...(localAvailability.status==='disabled'?[]:[`Availability provider: ${localAvailability.status}, ${localAvailability.accepted} local observation(s); no team health clearance implied.`])],
      externalCalls: 0,
      historyLeagues: 0,
      summaryGames: 0,
      historicalBoxscores: stored.boxscores.length,
      learnedInjuries: playerApplication.learnedInjuries,
      confirmedLineups: playerApplication.confirmedLineups,
      officialMatches: 0,
      officialStarters: 0,
      starterRestMatches: 0,
      playByPlayGames: stored.boxscores.filter((row) => row.playByPlay?.assignedPlays > 0).length,
      officialProfileMatches
    };
  }
  const leagueMap = new Map((options.leagues || []).map((league) => [league.key, league]));
  const activeKeys = [...new Set(games.map((game) => game.leagueKey).filter((key) => leagueMap.has(key)))];
  const activeLeagues = activeKeys
    .map((key) => leagueMap.get(key))
    .sort((a, b) => b.priority - a.priority)
    .slice(0, config.autoHistoryMaxLeagues);
  const cutoffDateKey = localDateKey(date);
  const cutoff = dateAtNoonUtc(cutoffDateKey);
  const historyResults = [];
  const diagnostics = [];
  let externalCalls = 0;

  await mapWithConcurrency(activeLeagues, 3, async (league) => {
    const end = new Date(cutoff.getTime() - DAY_MS);
    const start = new Date(end.getTime() - (leagueLookbackDays(league) - 1) * DAY_MS);
    // Some ESPN league routes silently fall back to a 25-event page at 1000;
    // 999 preserves the intended window. NCAA group IDs expand beyond Top 25.
    const groupQuery = league.groups ? `&groups=${encodeURIComponent(league.groups)}` : '';
    const url = `https://site.api.espn.com/apis/site/v2/sports/${encodeURIComponent(league.sport)}/${encodeURIComponent(league.league)}/scoreboard?limit=999&dates=${dateParam(start)}-${dateParam(end)}${groupQuery}`;
    const result = await cachedFetchJson(url, {
      namespace: `espn-history-${league.key}`,
      ttlMs: config.autoHistoryCacheHours * 60 * 60_000,
      staleMs: 7 * DAY_MS,
      timeoutMs: 20_000,
      transformJson: (payload) => ({ events: Array.isArray(payload?.events) ? payload.events : [] }),
      offline: Boolean(options.targetedPregame)
    });
    if (result.cacheState === 'network' || result.cacheState === 'revalidated') externalCalls += 1;
    if (!result.ok || !result.json) {
      diagnostics.push(`${league.label} auto history: unavailable (${result.error || 'no data'}).`);
      if(league.key==='nhl'&&config.nativeHistoryFallbackDays>0){
        const native=await collectNativeNhlHistory({cutoffDateKey,days:config.nativeHistoryFallbackDays,offline:Boolean(options.targetedPregame)});
        historyResults.push(...native.rows);externalCalls+=native.externalCalls;
        diagnostics.push(`NHL native history: ${native.rows.length} final(s), ${native.attemptedDates} recent dates, ${native.failures} failed/stale date(s); bounded history, not injury/goalie coverage.`);
        diagnostics.push(...native.diagnostics.map(row=>'NHL native history '+row));
        if(Object.keys(native.rejections).length)diagnostics.push('NHL native history rejections: '+JSON.stringify(native.rejections));
      }
      return;
    }
    const truncated = (result.json.events?.length || 0) >= 999;
    const parsed = parseEspnHistoryEvents(result.json, league, cutoffDateKey, {
      fetchedAt: result.fetchedAt,
      cacheState: result.cacheState,
      truncated
    });
    historyResults.push(...parsed);
    diagnostics.push(`${league.label} auto history: ${parsed.length} final(s), source=${result.cacheState}${truncated ? ', provider ceiling reached' : ''}.`);
  });

  const forcedSummaryIds = new Set((options.forceSummaryGameIds || []).map(String));
  const summaryEligible = games
    .filter((game) => ['scheduled', 'live'].includes(game.statusKey) && leagueMap.has(game.leagueKey) && (!options.targetedPregame || forcedSummaryIds.has(String(game.id))));
  const identitySkipped = summaryEligible.filter(game=>!espnSummaryEventId(game));
  for(const game of identitySkipped)game.summaryIdentity={provider:'ESPN',status:'unavailable',reason:'provider_event_mapping_not_verified'};
  if(identitySkipped.length)diagnostics.push(`ESPN summaries: ${identitySkipped.length} event(s) skipped; provider event mapping not verified.`);
  const summaryCandidates = summaryEligible.filter(game=>espnSummaryEventId(game))
    .sort((a, b) => Number(forcedSummaryIds.has(String(b.id))) - Number(forcedSummaryIds.has(String(a.id))) || Number(b.statusKey === 'scheduled') - Number(a.statusKey === 'scheduled') || (leagueMap.get(b.leagueKey)?.priority || 0) - (leagueMap.get(a.leagueKey)?.priority || 0) || new Date(a.startTime) - new Date(b.startTime))
    .slice(0, Math.max(config.autoSummaryMaxGames, forcedSummaryIds.size));
  await mapWithConcurrency(summaryCandidates, 4, async (game) => {
    const league = leagueMap.get(game.leagueKey);
    const url = `https://site.api.espn.com/apis/site/v2/sports/${encodeURIComponent(league.sport)}/${encodeURIComponent(league.league)}/summary?event=${encodeURIComponent(espnSummaryEventId(game))}`;
    const result = await cachedFetchJson(url, {
      namespace: `espn-summary-${league.key}`,
      ttlMs: config.autoSummaryCacheMinutes * 60_000,
      staleMs: 24 * 60 * 60_000,
      timeoutMs: 15_000,
      transformJson: compactEspnSummary,
      force: forcedSummaryIds.has(String(game.id))
    });
    if (result.cacheState === 'network' || result.cacheState === 'revalidated') externalCalls += 1;
    if (!result.ok || !result.json) {
      diagnostics.push(`${league.label} summary ${game.id}: unavailable (${result.error || 'no data'}).`);
      return;
    }
    const parsed = parseEspnSummary(result.json, game, result);
    game.autoPlayers = parsed.players;
    game.autoLineups = parsed.lineups;
    game.autoContext = parsed.context;
    game.eventEnvironment = parsed.environment;
    game.autoEnrichment = parsed.meta;
    if (parsed.odds) {
      if (!game.odds || (forcedSummaryIds.has(String(game.id)) && game.odds.freeProvider)) game.odds = parsed.odds;
      else if (forcedSummaryIds.has(String(game.id))) game.lateFreeOdds = parsed.odds;
    }
  });

  const goalieContext=await enrichNhlGoalieResearch(games,{maxGames:config.nhlGoalieContextMaxGames,forcedIds:options.targetedPregame?forcedSummaryIds:null});
  externalCalls+=goalieContext.externalCalls;
  if(goalieContext.eligible)diagnostics.push(`NHL goalie season context: ${goalieContext.available}/${goalieContext.attempted} available, ${goalieContext.capOmissions} omitted by cap, ${goalieContext.deferred} deferred; 0 confirmed starters; injuries unknown.`);
  const official = await corroborateOfficialSources(games, cutoffDateKey, { localOnly: false });
  externalCalls += official.externalCalls;
  diagnostics.push(...official.diagnostics);
  const availability=await applyAvailabilitySnapshotFile(games,{file:config.availabilityProviderSnapshotFile});
  if(availability.status!=='disabled')diagnostics.push(`Availability provider: ${availability.status}, ${availability.accepted} observation(s), rejections ${JSON.stringify(availability.rejected)}; no team health clearance implied.`);
  const starterRestMatches = applyHistoricalStarterRest(games, historyResults);
  if (starterRestMatches) diagnostics.push(`Starter rest: matched ${starterRestMatches} current starter(s) to cached historical starts.`);

  const storedEvidence = config.featureWarehouseEnabled
    ? await historicalEvidenceBefore(cutoffDateKey)
    : { results: [], boxscores: [] };
  const mergedHistory = mergeNativeNhlHistory([...storedEvidence.results, ...historyResults]);
  historyResults.length = 0;
  historyResults.push(...mergedHistory.rows);
  if(mergedHistory.duplicates||mergedHistory.conflicts||mergedHistory.unknownSeasonComparisons)diagnostics.push(`NHL historical source reconciliation: ${mergedHistory.duplicates} duplicate(s), ${mergedHistory.conflicts} conflicting event(s) excluded, ${mergedHistory.unknownSeasonComparisons} unverified season-format comparison(s).`);
  const historicalCandidates = selectHistoricalBoxscores(historyResults.filter(row=>espnSummaryEventId(row)), games, config.autoBoxscoreMaxEvents);
  const historicalSamples = [];
  let historicalFailures = 0;
  await mapWithConcurrency(historicalCandidates, 3, async (history) => {
    const league = leagueMap.get(history.leagueKey);
    if (!league) return;
    const eventId = espnSummaryEventId(history);
    const url = `https://site.api.espn.com/apis/site/v2/sports/${encodeURIComponent(league.sport)}/${encodeURIComponent(league.league)}/summary?event=${encodeURIComponent(eventId)}`;
    const result = await cachedFetchJson(url, {
      namespace: `espn-historical-box-${league.key}`,
      ttlMs: config.autoBoxscoreCacheDays * DAY_MS,
      staleMs: 365 * DAY_MS,
      timeoutMs: 18_000,
      transformJson: compactEspnSummary,
      offline: Boolean(options.targetedPregame)
    });
    if (result.cacheState === 'network' || result.cacheState === 'revalidated') externalCalls += 1;
    if (!result.ok || !result.json) {
      historicalFailures += 1;
      return;
    }
    historicalSamples.push(parseHistoricalEventSummary(result.json, history, result));
  });
  if (historicalCandidates.length) diagnostics.push(`Historical box scores: parsed ${historicalSamples.length}/${historicalCandidates.length} selected final(s)${historicalFailures ? `, ${historicalFailures} unavailable` : ''}.`);

  const mergedSamples = new Map([...storedEvidence.boxscores, ...historicalSamples].map((row) => [String(row.gameId || row.id || `${row.leagueKey}:${row.dateKey}:${row.awayTeam}:${row.homeTeam}`), row]));
  historicalSamples.length = 0;
  historicalSamples.push(...mergedSamples.values());
  const fetchedAt = new Date().toISOString();
  const teamProfiles = enhanceTeamProfiles(
    buildAutomaticTeamProfiles(historyResults, date, fetchedAt, { currentGames: games }),
    historyResults,
    historicalSamples
  );
  const playerProfiles = buildAutomaticPlayerProfiles(historicalSamples);
  const playerApplication = applyPlayerProfilesAndLineups(games, playerProfiles);
  const officialProfiles = buildOfficialProfiles(historicalSamples);
  for (const game of games) {
    const awayTeam = automaticProfileFor(game, 'away', teamProfiles);
    const homeTeam = automaticProfileFor(game, 'home', teamProfiles);
    game.autoContext = mergeAutomaticContexts(game.autoContext, buildAutomaticScheduleContext(game, awayTeam, homeTeam));
  }
  const officialProfileMatches = applyOfficialAndEnvironmentContext(games, officialProfiles);
  if (config.featureWarehouseEnabled) {
    await ingestFeatureEvidence({ dateKey: cutoffDateKey, games, historyResults, historicalSamples });
  }
  return {
    games,
    historyResults,
    historicalSamples,
    teamProfiles,
    playerProfiles,
    diagnostics,
    externalCalls,
    historyLeagues: activeLeagues.length,
    summaryGames: summaryCandidates.length,
    summaryIdentitySkipped: identitySkipped.length,
    historicalBoxscores: historicalSamples.length,
    learnedInjuries: playerApplication.learnedInjuries,
    confirmedLineups: playerApplication.confirmedLineups,
    officialMatches: official.matched,
    officialStarters: official.confirmedStarters,
    officialProbableStarters: official.probableStarters || 0,
    starterRestMatches,
    playByPlayGames: historicalSamples.filter((row) => row.playByPlay?.assignedPlays > 0).length,
    officialProfileMatches
  };
}
