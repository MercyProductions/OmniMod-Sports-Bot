import {normalizeOddsPrice} from './oddsPricing.js';
import { config } from './config.js';
import { enrichGamesAutomatically } from './autoEnrichment.js';
import { attachAdvancedDatasetContext } from './advancedDatasets.js';
import { espnDateKey, formatLocalTime, localDateKey } from './time.js';
import { getGuildSettings } from './guildSettings.js';
import { normalizeEntityName, readIntelligenceStore } from './intelligenceStore.js';
import { loadModelContext } from './modelEvaluation.js';
import { captureMarketSnapshots, readFeatureWarehouse, recordSlateSnapshot, warehouseCandidateRowsBefore, warehouseInventory } from './featureWarehouse.js';
import { runHistoricalReplay } from './historicalReplay.js';
import { evaluatePredictionHorizons } from './horizonEvaluation.js';
import { readLocalMlModels, trainAndPersistLocalMlModels } from './localMl.js';
import { readModelRegistry, refreshModelRegistry } from './modelRegistry.js';
import { MODEL_VERSION, predictGame } from './predictionEngine.js';
import { cachedFetchJson } from './providerCache.js';
import { recordPredictionJournal } from './predictionJournal.js';
import { sportProfile } from './sportProfiles.js';
import { americanToProbability, finiteNumber, finalOutcomeSide, validScore } from './dataValidation.js';

const ESPN_LEAGUES = [
  { key: 'mlb', sport: 'baseball', league: 'mlb', label: 'MLB', group: 'Baseball', priority: 100 },
  { key: 'nba', sport: 'basketball', league: 'nba', label: 'NBA', group: 'Basketball', priority: 100 },
  { key: 'wnba', sport: 'basketball', league: 'wnba', label: 'WNBA', group: 'Basketball', priority: 94 },
  { key: 'ncaab', sport: 'basketball', league: 'mens-college-basketball', label: 'NCAAB', group: 'Basketball', priority: 86, limit: 300, groups: '50' },
  { key: 'ncaaw', sport: 'basketball', league: 'womens-college-basketball', label: 'NCAAW', group: 'Basketball', priority: 80, limit: 300, groups: '50' },
  { key: 'nhl', sport: 'hockey', league: 'nhl', label: 'NHL', group: 'Hockey', priority: 98 },
  { key: 'nfl', sport: 'football', league: 'nfl', label: 'NFL', group: 'Football', priority: 96 },
  { key: 'ncaaf', sport: 'football', league: 'college-football', label: 'NCAAF', group: 'Football', priority: 82, limit: 300, groups: '80' },
  { key: 'epl', sport: 'soccer', league: 'eng.1', label: 'Premier League', group: 'Soccer', priority: 92 },
  { key: 'mls', sport: 'soccer', league: 'usa.1', label: 'MLS', group: 'Soccer', priority: 88 },
  { key: 'laliga', sport: 'soccer', league: 'esp.1', label: 'LaLiga', group: 'Soccer', priority: 88 },
  { key: 'serie-a', sport: 'soccer', league: 'ita.1', label: 'Serie A', group: 'Soccer', priority: 84 },
  { key: 'bundesliga', sport: 'soccer', league: 'ger.1', label: 'Bundesliga', group: 'Soccer', priority: 84 },
  { key: 'ligue-1', sport: 'soccer', league: 'fra.1', label: 'Ligue 1', group: 'Soccer', priority: 78 },
  { key: 'liga-mx', sport: 'soccer', league: 'mex.1', label: 'Liga MX', group: 'Soccer', priority: 72 },
  { key: 'ucl', sport: 'soccer', league: 'uefa.champions', label: 'Champions League', group: 'Soccer', priority: 90 },
  { key: 'uel', sport: 'soccer', league: 'uefa.europa', label: 'Europa League', group: 'Soccer', priority: 70 },
  { key: 'ufc', sport: 'mma', league: 'ufc', label: 'UFC', group: 'Combat', priority: 68 },
  { key: 'atp', sport: 'tennis', league: 'atp', label: 'ATP Tennis', group: 'Tennis', priority: 62 },
  { key: 'wta', sport: 'tennis', league: 'wta', label: 'WTA Tennis', group: 'Tennis', priority: 62 }
];

const ODDS_SPORT_KEYS = {
  mlb: 'baseball_mlb', nba: 'basketball_nba', wnba: 'basketball_wnba',
  ncaab: 'basketball_ncaab', ncaaw: 'basketball_wncaab',
  nfl: 'americanfootball_nfl', ncaaf: 'americanfootball_ncaaf', nhl: 'icehockey_nhl',
  epl: 'soccer_epl', mls: 'soccer_usa_mls', laliga: 'soccer_spain_la_liga',
  'serie-a': 'soccer_italy_serie_a', bundesliga: 'soccer_germany_bundesliga',
  'ligue-1': 'soccer_france_ligue_one', 'liga-mx': 'soccer_mexico_ligamx',
  ucl: 'soccer_uefa_champs_league', uel: 'soccer_uefa_europa_league',
  ufc: 'mma_mixed_martial_arts', atp: 'tennis_atp', wta: 'tennis_wta'
};

const BOOKMAKERS = ['fanduel', 'draftkings', 'betmgm', 'espnbet', 'betrivers', 'williamhill_us', 'fanatics'].join(',');

export function supportedLeagues() {
  return ESPN_LEAGUES.map((league) => ({
    key: league.key,
    label: league.label,
    group: league.group,
    oddsKey: ODDS_SPORT_KEYS[league.key] || '',
    priority: league.priority
  }));
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function standardDeviation(values) {
  const clean = values.filter(Number.isFinite);
  if (clean.length < 2) return 0;
  const average = clean.reduce((total, value) => total + value, 0) / clean.length;
  return Math.sqrt(clean.reduce((total, value) => total + (value - average) ** 2, 0) / clean.length);
}

function normalizeName(value) {
  return normalizeEntityName(value);
}

function providerErrorMessage(result) {
  const json = result?.json;
  if (json && typeof json === 'object') {
    const message = json.message || json.error || json.detail || json.title;
    if (message) return String(message);
  }
  return result?.upstreamError || result?.error || `HTTP ${result?.status ?? 'unknown'}`;
}

function oddsApiAlertForResult(sportKey, result) {
  const message = providerErrorMessage(result);
  const remainingText = result?.headers?.['x-requests-remaining'];
  const remaining = Number.parseInt(String(remainingText ?? ''), 10);
  const looksLikeQuota = result?.status === 429 || remaining === 0 || /\b(quota|limit|rate|usage|exceeded|requests)\b/i.test(message);
  if (looksLikeQuota) {
    return { type: 'odds_api_limit', provider: 'The Odds API', sportKey, status: result?.status ?? 0, message, remaining: Number.isFinite(remaining) ? remaining : null };
  }
  if (result?.status === 401 || result?.status === 403) {
    return { type: 'odds_api_auth', provider: 'The Odds API', sportKey, status: result.status, message, remaining: Number.isFinite(remaining) ? remaining : null };
  }
  return null;
}

export function parseStatus(status) {
  const type = status?.type ?? {};
  const name = String(type.name ?? '').toLowerCase();
  const state = String(type.state ?? '').toLowerCase();
  const detail = String(type.shortDetail || type.detail || type.description || '').trim();
  if (/cancel|postpon|delay|abandon|suspend|no contest/i.test(`${name} ${detail}`)) return { key: 'alert', label: 'Alert', detail: detail || 'Status alert' };
  if (type.completed || state === 'post') return { key: 'final', label: 'Final', detail: detail || 'Final' };
  if (state === 'in' || name.includes('progress') || name.includes('live')) return { key: 'live', label: 'Live', detail: detail || 'Live' };
  if (name.includes('postponed') || name.includes('delayed') || detail.toLowerCase().includes('postponed')) return { key: 'alert', label: 'Alert', detail: detail || 'Status alert' };
  return { key: 'scheduled', label: 'Upcoming', detail: detail || 'Scheduled' };
}

function parseTeam(competitors, homeAway) {
  const selected = competitors.find((item) => item.homeAway === homeAway) ?? competitors[homeAway === 'away' ? 0 : 1] ?? {};
  const team = selected.team ?? selected.athlete ?? {};
  const records = Array.isArray(selected.records) ? selected.records : [];
  const name = team.displayName || team.shortDisplayName || team.name || selected.displayName || homeAway;
  const derivedAbbr = String(name).split(/\s+/).filter(Boolean).at(-1)?.slice(0, 6).toUpperCase() || homeAway.toUpperCase();
  return {
    id: String(team.id || selected.id || ''),
    name,
    abbr: team.abbreviation || team.shortDisplayName || selected.shortDisplayName || derivedAbbr,
    record: records.find((record) => record?.summary)?.summary || '',
    score: validScore(selected.score),
    winner: Boolean(selected.winner),
    logo: team.logo || ''
  };
}

export function parseEspnEvent(event, league, sourceMeta = {}) {
  const competition = Array.isArray(event.competitions) ? event.competitions[0] : null;
  if (!competition || !Array.isArray(competition.competitors)) return null;
  const status = parseStatus(event.status ?? competition.status);
  const away = parseTeam(competition.competitors, 'away');
  const home = parseTeam(competition.competitors, 'home');
  const startTime = event.date || competition.date || '';
  return {
    id: String(event.id || competition.id || `${league.key}-${away.abbr}-${home.abbr}-${startTime}`),
    league: league.label,
    leagueKey: league.key,
    sportGroup: league.group,
    matchup: `${away.abbr} @ ${home.abbr}`,
    startTime,
    startTimeLocal: formatLocalTime(startTime),
    dateKey: localDateKey(new Date(startTime)),
    statusKey: status.key,
    statusLabel: status.label,
    detail: status.detail,
    venue: competition.venue?.fullName || '',
    venueDetails: {
      id: String(competition.venue?.id || ''),
      name: competition.venue?.fullName || competition.venue?.shortName || '',
      address: {
        city: competition.venue?.address?.city || '',
        state: competition.venue?.address?.state || '',
        country: competition.venue?.address?.country || ''
      }
    },
    neutralSite: Boolean(competition.neutralSite),
    seasonYear: Number(event.season?.year ?? competition.season?.year) || null,
    seasonType: Number(event.season?.type ?? competition.season?.type) || null,
    seasonSlug: event.season?.slug || competition.season?.slug || '',
    away,
    home,
    odds: null,
    source: 'ESPN public scoreboard',
    sourceMeta: { provider: 'ESPN', ...sourceMeta }
  };
}

export function scoreboardEventsFromCdn(payload, league = null) {
  const data = payload?.content?.sbData;
  const events = Array.isArray(data?.events)
    ? data.events
    : Array.isArray(data?.scores)
      ? data.scores.flatMap((day) => Array.isArray(day?.events) ? day.events : [])
      : null;
  if (!events || league?.sport !== 'soccer') return events;
  // The CDN's soccer path returns a multi-league scoreboard even when a league
  // appears in the URL. Never label an event as a different competition.
  return events.filter((event) => String(event?.leagueId || '') === league.league);
}

export function parseNhlOfficialGame(game, league, sourceMeta = {}) {
  if (!game?.id || !game.startTimeUTC || !game.awayTeam?.abbrev || !game.homeTeam?.abbrev) return null;
  const state = String(game.gameState || '').toUpperCase();
  const statusKey = ['FINAL', 'OFF'].includes(state) ? 'final' : ['LIVE', 'CRIT'].includes(state) ? 'live' : 'scheduled';
  const awayScore = validScore(game.awayTeam.score);
  const homeScore = validScore(game.homeTeam.score);
  const team = (side, score, otherScore) => ({
    id: String(side.id || ''),
    name: side.name?.default || side.abbrev,
    abbr: side.abbrev,
    record: '',
    score,
    winner: statusKey === 'final' && score !== null && otherScore !== null && score > otherScore,
    logo: side.logo || ''
  });
  return {
    id: `nhl-${game.id}`,
    league: league.label, leagueKey: league.key, sportGroup: league.group,
    matchup: `${game.awayTeam.abbrev} @ ${game.homeTeam.abbrev}`,
    startTime: game.startTimeUTC,
    startTimeLocal: formatLocalTime(game.startTimeUTC),
    dateKey: localDateKey(new Date(game.startTimeUTC)),
    statusKey,
    statusLabel: statusKey === 'final' ? 'Final' : statusKey === 'live' ? 'Live' : 'Upcoming',
    detail: state || 'Scheduled',
    venue: game.venue?.default || '',
    venueDetails: { id: '', name: game.venue?.default || '', address: { city: '', state: '', country: '' } },
    neutralSite: false,
    seasonYear: Number(game.season) || null,
    seasonType: Number(game.gameType) || null,
    seasonSlug: '',
    away: team(game.awayTeam, awayScore, homeScore),
    home: team(game.homeTeam, homeScore, awayScore),
    odds: null,
    source: 'NHL official scoreboard',
    sourceMeta: { provider: 'NHL API', ...sourceMeta }
  };
}

function cdnScoreboardUrl(league, dateParam) {
  const route = league.sport === 'soccer' ? `soccer/${league.league}` : league.league;
  const url = new URL(`https://cdn.espn.com/core/${route}/scoreboard`);
  url.searchParams.set('xhr', '1');
  url.searchParams.set('dates', dateParam);
  if (league.groups) url.searchParams.set('groups', league.groups);
  if (league.limit) url.searchParams.set('limit', String(league.limit));
  return url.toString();
}

async function fetchEspnGames(date = new Date(), options = {}) {
  if (options.localOnly || config.localOnly) {
    return { games: [], diagnostics: ['ESPN scoreboard: skipped because LOCAL_ONLY=true.'], externalCalls: 0 };
  }
  const dateParam = espnDateKey(date);
  const requestedKeys = new Set((options.leagueKeys || []).map((key) => String(key).toLowerCase()));
  const leagues = [...ESPN_LEAGUES]
    .filter((league) => !requestedKeys.size || requestedKeys.has(league.key))
    .sort((a, b) => b.priority - a.priority || a.label.localeCompare(b.label))
    .slice(0, config.maxLeaguesPerRefresh);
  const diagnostics = [];
  const allGames = [];
  let externalCalls = 0;

  await Promise.all(leagues.map(async (league) => {
    const groupQuery = league.groups ? `&groups=${encodeURIComponent(league.groups)}` : '';
    const url = `https://site.api.espn.com/apis/site/v2/sports/${encodeURIComponent(league.sport)}/${encodeURIComponent(league.league)}/scoreboard?limit=${league.limit || 100}&dates=${dateParam}${groupQuery}`;
    const primary = await cachedFetchJson(url, {
      namespace: `espn-${league.key}`,
      ttlMs: config.scoreboardCacheMinutes * 60_000,
      staleMs: config.scoreboardStaleHours * 60 * 60_000,
      negativeTtlMs: 5 * 60_000,
      timeoutMs: 12_000,
      transformJson: (payload) => ({ events: Array.isArray(payload?.events) ? payload.events : [] })
    });
    let result = primary;
    let provider = 'ESPN';
    if (!primary.ok || !primary.json || primary.upstreamError) {
      const cdn = await cachedFetchJson(cdnScoreboardUrl(league, dateParam), {
        namespace: `espn-cdn-v2-${league.key}`,
        ttlMs: config.scoreboardCacheMinutes * 60_000,
        staleMs: config.scoreboardStaleHours * 60 * 60_000,
        negativeTtlMs: 5 * 60_000,
        timeoutMs: 12_000,
        transformJson: (payload) => ({ events: scoreboardEventsFromCdn(payload, league) })
      });
      if (cdn.cacheState === 'network' || cdn.cacheState === 'revalidated') externalCalls += 1;
      if (cdn.ok && Array.isArray(cdn.json?.events)) {
        result = cdn;
        provider = 'ESPN CDN';
        diagnostics.push(`${league.label}: primary scoreboard unavailable (${primary.upstreamError || primary.error || 'no response'}); using CDN feed.`);
      } else if (!primary.ok || !primary.json) {
        diagnostics.push(`${league.label}: primary ${primary.error || 'unavailable'}; CDN ${cdn.error || 'invalid scoreboard payload'}.`);
      } else {
        diagnostics.push(`${league.label}: primary stale (${primary.upstreamError}); CDN ${cdn.error || 'invalid scoreboard payload'}.`);
      }
    }
    if (league.key === 'nhl' && (!result.ok || !result.json || result.upstreamError)) {
      const officialDate = `${dateParam.slice(0, 4)}-${dateParam.slice(4, 6)}-${dateParam.slice(6, 8)}`;
      const official = await cachedFetchJson(`https://api-web.nhle.com/v1/score/${officialDate}`, {
        namespace: 'official-nhl-score',
        ttlMs: config.scoreboardCacheMinutes * 60_000,
        staleMs: config.scoreboardStaleHours * 60 * 60_000,
        negativeTtlMs: 5 * 60_000,
        timeoutMs: 12_000
      });
      if (official.cacheState === 'network' || official.cacheState === 'revalidated') externalCalls += 1;
      if (official.ok && Array.isArray(official.json?.games)) {
        for (const game of official.json.games) {
          const parsed = parseNhlOfficialGame(game, league, { fetchedAt: official.fetchedAt, cacheState: official.cacheState, upstreamError: official.upstreamError || '' });
          if (parsed && parsed.dateKey === localDateKey(date)) allGames.push(parsed);
        }
        diagnostics.push(`${league.label}: ${official.json.games.length} official event(s), source=${official.cacheState}.`);
        return;
      }
      diagnostics.push(`${league.label}: official feed ${official.error || 'invalid scoreboard payload'}.`);
    }
    if (result.cacheState === 'network' || result.cacheState === 'revalidated') externalCalls += 1;
    if (!result.ok || !result.json) {
      diagnostics.push(`${league.label}: ${result.error || 'no response'}`);
      return;
    }
    const events = Array.isArray(result.json.events)
      ? (league.sport === 'soccer' && provider === 'ESPN CDN'
          ? result.json.events.filter((event) => String(event?.leagueId || '') === league.league)
          : result.json.events)
      : [];
    for (const event of events) {
      const parsed = parseEspnEvent(event, league, {
        fetchedAt: result.fetchedAt,
        cacheState: result.cacheState,
        provider,
        upstreamError: result.upstreamError || ''
      });
      if (parsed && parsed.dateKey === localDateKey(date)) allGames.push(parsed);
    }
    diagnostics.push(`${league.label}: ${events.length} event(s), source=${result.cacheState}`);
  }));
  allGames.sort((a, b) => new Date(a.startTime) - new Date(b.startTime) || a.league.localeCompare(b.league));
  return { games: allGames, diagnostics, externalCalls };
}

function resolveLeague(row) {
  const key = normalizeName(row.leagueKey || row.league);
  return ESPN_LEAGUES.find((league) => [league.key, league.label, league.league].map(normalizeName).includes(key)) || {
    key: String(row.leagueKey || row.league || 'custom').toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    label: row.league || row.leagueKey || 'Custom',
    group: row.sportGroup || 'Custom'
  };
}

function manualGame(row) {
  const league = resolveLeague(row);
  const away = { id: '', name: row.awayTeam, abbr: row.awayAbbr || row.awayTeam.slice(0, 4).toUpperCase(), record: row.awayRecord || '', score: validScore(row.awayScore), winner: false, logo: '' };
  const home = { id: '', name: row.homeTeam, abbr: row.homeAbbr || row.homeTeam.slice(0, 4).toUpperCase(), record: row.homeRecord || '', score: validScore(row.homeScore), winner: false, logo: '' };
  return {
    id: row.id,
    league: league.label,
    leagueKey: league.key,
    sportGroup: row.sportGroup || league.group,
    matchup: `${away.abbr} @ ${home.abbr}`,
    startTime: row.startTime,
    startTimeLocal: formatLocalTime(row.startTime),
    dateKey: row.dateKey || String(row.startTime).slice(0, 10),
    statusKey: row.statusKey || 'scheduled',
    statusLabel: row.statusLabel || 'Upcoming',
    detail: row.notes || 'Manual schedule',
    venue: row.venue || '',
    neutralSite: Boolean(row.neutralSite),
    away,
    home,
    odds: null,
    source: 'Manual local schedule',
    sourceMeta: { provider: 'local', fetchedAt: row.updatedAt, cacheState: 'local' }
  };
}

function gamesMatch(left, right) {
  if (String(left.id) === String(right.id)) return true;
  return normalizeName(left.away?.name) === normalizeName(right.away?.name) &&
    normalizeName(left.home?.name) === normalizeName(right.home?.name) &&
    normalizeName(left.leagueKey || left.league) === normalizeName(right.leagueKey || right.league);
}

function mergeLocalGames(scoreboardGames, intelligence, dateKey) {
  const games = [...scoreboardGames];
  for (const row of Object.values(intelligence?.games || {})) {
    if (String(row.dateKey || row.startTime).slice(0, 10) !== dateKey) continue;
    const local = manualGame(row);
    const index = games.findIndex((game) => gamesMatch(game, local));
    if (index === -1) games.push(local);
    else games[index] = {
      ...games[index],
      venue: row.venue || games[index].venue,
      neutralSite: row.neutralSite ?? games[index].neutralSite,
      manualNotes: row.notes || '',
      source: `${games[index].source} + local schedule override`
    };
  }
  return games;
}

function bestQuote(quotes) {
  return [...quotes].sort((a, b) => a.rawImplied - b.rawImplied)[0] || null;
}

export function bestH2HMarket(bookmakers, game, { oddsFormat = 'american' } = {}) {
  const awayAliases = [normalizeName(game.away.name), normalizeName(game.away.abbr)];
  const homeAliases = [normalizeName(game.home.name), normalizeName(game.home.abbr)];
  const fairRows = [];
  const quoteGroups = { away: [], home: [], draw: [] };
  const twoWay = sportProfile(game).twoWay;
  const seenBooks = new Set();
  for (const bookmaker of bookmakers ?? []) {
    const bookId = bookmaker.key || bookmaker.title;
    if (!bookId || seenBooks.has(bookId)) continue;
    const market = (bookmaker.markets ?? []).find((row) => row.key === 'h2h');
    if (!market) continue;
    const book = {};
    for (const outcome of market.outcomes ?? []) {
      const normalized = normalizeName(outcome.name);
      const side = awayAliases.includes(normalized) ? 'away' : homeAliases.includes(normalized) ? 'home' : /draw|tie/i.test(String(outcome.name)) ? 'draw' : '';
      const normalizedPrice = normalizeOddsPrice(outcome.price, oddsFormat);
      const price = normalizedPrice?.americanOdds ?? null;
      const rawImplied = normalizedPrice?.impliedProbability ?? null;
      if (!side || rawImplied === null) continue;
      book[side] = { side, bookmaker: bookmaker.title || bookmaker.key || 'Book', bookmakerKey: bookmaker.key || bookmaker.title, name: outcome.name, price, originalPrice: normalizedPrice.originalPrice, originalFormat: normalizedPrice.originalFormat, rawImplied, lastUpdate: market.last_update || bookmaker.last_update || '', timestampSource: market.last_update ? 'provider_update' : 'bookmaker_update_unverified' };
    }
    if (!book.away || !book.home) continue;
    if (twoWay ? Boolean(book.draw) : !book.draw) continue;
    seenBooks.add(bookId);
    const total = book.away.rawImplied + book.home.rawImplied + (book.draw?.rawImplied || 0);
    if (total <= 0) continue;
    const fair = {};
    for (const side of ['away', 'home', 'draw']) {
      if (!book[side]) continue;
      const quote = { ...book[side], fairProbability: book[side].rawImplied / total };
      quoteGroups[side].push(quote);
      fair[side] = quote.fairProbability;
    }
    fairRows.push(fair);
  }
  if (!fairRows.length) return { away: null, home: null, draw: null, bookmakerCount: 0, dispersion: 1, lastUpdate: '' };
  const output = {};
  for (const side of ['away', 'home', 'draw']) {
    const quotes = quoteGroups[side];
    if (!quotes.length) { output[side] = null; continue; }
    const consensus = median(quotes.map((row) => row.fairProbability));
    const best = bestQuote(quotes);
    output[side] = { ...best, fairProbability: consensus, implied: consensus, quoteCount: quotes.length, quotes: quotes.slice(0, 30) };
  }
  // Coordinate-wise medians of three-way books need not sum to one.
  const consensusTotal = Object.values(output).reduce((sum, quote) => sum + (quote?.fairProbability || 0), 0);
  for (const quote of Object.values(output)) {
    if (quote) quote.implied = quote.fairProbability /= consensusTotal;
  }
  const dispersion = Math.max(...['away', 'home', 'draw'].map((side) => standardDeviation(quoteGroups[side].map((row) => row.fairProbability))));
  return {
    ...output,
    rules: !twoWay ? 'regulation_3way' : ['baseball', 'basketball', 'hockey'].includes(sportProfile(game).key) ? 'full_game_2way' : 'unverified_settlement',
    bookmakerCount: fairRows.length,
    dispersion,
    lastUpdate: [...Object.values(quoteGroups).flat()].map((row) => row.lastUpdate).every(Boolean)
      ? [...Object.values(quoteGroups).flat()].map((row) => row.lastUpdate).sort()[0] : ''
  };
}

export function bestSpreadTotalMarkets(bookmakers, game) {
  const aliases = {
    away: [normalizeName(game.away.name), normalizeName(game.away.abbr)],
    home: [normalizeName(game.home.name), normalizeName(game.home.abbr)]
  };
  const spreadRows = { away: [], home: [] };
  const totalRows = { over: [], under: [] };
  for (const bookmaker of bookmakers ?? []) {
    for (const market of bookmaker.markets ?? []) {
      if (market.key === 'spreads') {
        for (const outcome of market.outcomes ?? []) {
          const normalized = normalizeName(outcome.name);
          const side = aliases.away.includes(normalized) ? 'away' : aliases.home.includes(normalized) ? 'home' : '';
          const point = finiteNumber(outcome.point);
          if (!side || point === null || americanToProbability(outcome.price) === null) continue;
          spreadRows[side].push({ side, bookmaker: bookmaker.title || bookmaker.key || 'Book', price: Number(outcome.price), point, lastUpdate: market.last_update || bookmaker.last_update || '' });
        }
      }
      if (market.key === 'totals') {
        for (const outcome of market.outcomes ?? []) {
          const side = /over/i.test(outcome.name) ? 'over' : /under/i.test(outcome.name) ? 'under' : '';
          const point = finiteNumber(outcome.point);
          if (!side || point === null || americanToProbability(outcome.price) === null) continue;
          totalRows[side].push({ bookmaker: bookmaker.title || bookmaker.key || 'Book', price: Number(outcome.price), point, lastUpdate: market.last_update || bookmaker.last_update || '' });
        }
      }
    }
  }
  const spread = {};
  for (const side of ['away', 'home']) {
    const point = median(spreadRows[side].map((row) => row.point));
    spread[side] = point === null ? null : [...spreadRows[side]].sort((a, b) => Math.abs(a.point - point) - Math.abs(b.point - point))[0];
  }
  spread.favorite = [spread.away, spread.home].filter(Boolean).sort((a, b) => a.point - b.point)[0] || null;
  const total = {};
  for (const side of ['over', 'under']) {
    const point = median(totalRows[side].map((row) => row.point));
    total[side] = point === null ? null : [...totalRows[side]].sort((a, b) => Math.abs(a.point - point) - Math.abs(b.point - point))[0];
  }
  return { spread: spread.favorite ? spread : null, total: total.over || total.under ? total : null };
}

export function oddsEventMatches(game, event) {
  const teams = [normalizeName(event.home_team), normalizeName(event.away_team), ...(event.teams ?? []).map(normalizeName)];
  const start = Date.parse(game.startTime || '');
  const eventStart = Date.parse(event.commence_time || '');
  return Number.isFinite(start) && Number.isFinite(eventStart) && Math.abs(start - eventStart) <= 60 * 60_000 &&
    teams.includes(normalizeName(game.away.name)) && teams.includes(normalizeName(game.home.name));
}

export function matchingOddsEvent(game, events = []) {
  const matches = events.filter((event) => oddsEventMatches(game, event))
    .sort((a, b) => Math.abs(Date.parse(a.commence_time) - Date.parse(game.startTime)) - Math.abs(Date.parse(b.commence_time) - Date.parse(game.startTime)));
  if (matches.length > 1 && Math.abs(Date.parse(matches[0].commence_time) - Date.parse(game.startTime)) === Math.abs(Date.parse(matches[1].commence_time) - Date.parse(game.startTime))) return null;
  return matches[0] || null;
}

async function enrichWithOdds(games, options = {}) {
  const oddsApiKey = String(options.oddsApiKey ?? config.oddsApiKey ?? '');
  const oddsApiRegion = String(options.oddsApiRegion ?? config.oddsApiRegion ?? 'us');
  if (!oddsApiKey || config.localOnly) {
    return { games, diagnostics: [`Odds API: ${config.localOnly ? 'skipped in local-only mode' : 'no key configured'}; model remains independent.`], alerts: [], externalCalls: 0 };
  }
  const diagnostics = [];
  const alerts = [];
  const bySport = new Map();
  let externalCalls = 0;
  for (const game of games) {
    const sportKey = ODDS_SPORT_KEYS[game.leagueKey];
    if (!sportKey) continue;
    if (!bySport.has(sportKey)) bySport.set(sportKey, []);
    bySport.get(sportKey).push(game);
  }
  await Promise.all([...bySport.entries()].map(async ([sportKey, sportGames]) => {
    const url = new URL(`https://api.the-odds-api.com/v4/sports/${sportKey}/odds/`);
    url.searchParams.set('apiKey', oddsApiKey);
    url.searchParams.set('regions', oddsApiRegion);
    url.searchParams.set('markets', 'h2h,spreads,totals');
    url.searchParams.set('oddsFormat', 'american');
    url.searchParams.set('bookmakers', BOOKMAKERS);
    const result = await cachedFetchJson(url.toString(), {
      namespace: `odds-${sportKey}-${oddsApiRegion}`,
      ttlMs: config.oddsCacheHours * 60 * 60_000,
      staleMs: 30 * 60 * 60_000,
      timeoutMs: 15_000,
      secretParams: ['apiKey']
    });
    if (result.cacheState === 'network' || result.cacheState === 'revalidated') externalCalls += 1;
    if (!result.ok || !Array.isArray(result.json)) {
      const alert = oddsApiAlertForResult(sportKey, result);
      if (alert) alerts.push(alert);
      diagnostics.push(`${sportKey}: ${providerErrorMessage(result) || 'odds unavailable'}`);
      return;
    }
    if (result.upstreamStatus) {
      const alert = oddsApiAlertForResult(sportKey, { ...result, status: result.upstreamStatus });
      if (alert) alerts.push(alert);
      diagnostics.push(`${sportKey}: live provider returned ${result.upstreamStatus}; using stale cached odds.`);
    }
    let matched = 0;
    for (const game of sportGames) {
      const event = matchingOddsEvent(game, result.json);
      if (!event) continue;
      const h2h = bestH2HMarket(event.bookmakers, game);
      const extra = bestSpreadTotalMarkets(event.bookmakers, game);
      const paidOdds = {
        eventId: event.id,
        commenceTime: event.commence_time,
        h2h,
        spread: extra.spread,
        total: extra.total,
        matchStatus: h2h.away && h2h.home ? 'matched' : 'partial',
        bookmakerCount: h2h.bookmakerCount,
        lastUpdate: h2h.lastUpdate,
        cacheState: result.cacheState,
        fetchedAt: result.fetchedAt
      };
      const profile = sportProfile(game);
      const completeWinnerMarket = Boolean(h2h.away && h2h.home && (profile.twoWay || h2h.draw));
      if (completeWinnerMarket || !game.odds) {
        game.odds = paidOdds;
      } else {
        game.odds = {
          ...game.odds,
          spread: extra.spread || game.odds.spread,
          total: extra.total || game.odds.total,
          paidFallbackRejected: 'incomplete winner market'
        };
      }
      matched += 1;
    }
    const remaining = result.headers['x-requests-remaining'] ?? 'unknown';
    diagnostics.push(`${sportKey}: matched ${matched}/${sportGames.length}, source=${result.cacheState}, quota remaining ${remaining}`);
    if (Number.parseInt(String(remaining), 10) === 0) alerts.push({ type: 'odds_api_limit', provider: 'The Odds API', sportKey, status: result.status, message: 'The Odds API reported zero requests remaining.', remaining: 0 });
  }));
  return { games, diagnostics, alerts, externalCalls };
}

function carryForwardOdds(games, cachedSlate) {
  if (!cachedSlate?.games?.length) return games;
  for (const game of games) {
    const previous = cachedSlate.games.find((row) => gamesMatch(game, row));
    if (previous?.odds && !game.odds) game.odds = { ...previous.odds, cacheState: 'daily_snapshot' };
  }
  return games;
}

function mergeTargetedGames(freshGames, cachedSlate) {
  if (!cachedSlate?.games?.length) return freshGames;
  const merged = cachedSlate.games.map((cached) => {
    const fresh = freshGames.find((candidate) => gamesMatch(candidate, cached));
    if (!fresh) return structuredClone(cached);
    return {
      ...cached,
      ...fresh,
      away: { ...cached.away, ...fresh.away },
      home: { ...cached.home, ...fresh.home },
      odds: fresh.odds || cached.odds || null
    };
  });
  for (const fresh of freshGames) {
    if (!merged.some((cached) => gamesMatch(cached, fresh))) merged.push(fresh);
  }
  return merged;
}

function derivedAdvancedDataset(game, awayProfile, homeProfile) {
  const away = awayProfile?.advancedMetrics || {};
  const home = homeProfile?.advancedMetrics || {};
  const profile = sportProfile(game).key;
  const difference = (name) => Number(home[name] || 0) - Number(away[name] || 0);
  const play = { playValueDifference: difference('playValue'), playSuccessDifference: difference('playSuccessRate'), playTurnoverDifference: difference('playTurnoverRate'), playShotQualityDifference: difference('playShotQuality') };
  if (profile === 'baseball') return { awayExpectedRuns: away.expectedRunsProxy, homeExpectedRuns: home.expectedRunsProxy, bullpenDifference: -difference('bullpenRunsAllowedProxy'), ...play, provider: 'cached historical box-score/play model' };
  if (profile === 'basketball') return { pace: [away.possessions, home.possessions].filter(Number.isFinite).reduce((sum, value, _, rows) => sum + value / rows.length, 0) || null, efficiencyDifference: difference('offensiveEfficiency'), turnoverRateDifference: difference('turnoverRate'), ...play, provider: 'cached historical box-score/play model' };
  if (profile === 'football') return { epaDifference: difference('epaProxy'), driveEfficiencyDifference: difference('driveEfficiency'), yardsPerPlayDifference: difference('yardsPerPlay'), ...play, provider: 'cached historical box-score/play model' };
  if (profile === 'hockey') return { xgDifference: difference('expectedGoalsProxy'), gsaxDifference: difference('goalPreventionProxy'), shotVolumeDifference: difference('shotVolume'), ...play, provider: 'cached historical box-score/play model' };
  if (profile === 'soccer') return { awayXg: away.expectedGoals, homeXg: home.expectedGoals, shotQualityDifference: difference('shotQuality'), ...play, provider: 'cached historical box-score/play model' };
  return null;
}

export function attachFinalGrade(game, prediction) {
  if (game.statusKey !== 'final' || prediction.predictionMode === 'retrospective_ungraded') return prediction;
  const actualSide = finalOutcomeSide(game);
  if (!actualSide) return { ...prediction, actualSide: '', actualWinner: '', predictionCorrect: null };
  const actualWinner = actualSide === 'draw' ? 'Draw' : game[actualSide].name;
  return {
    ...prediction,
    actualSide,
    actualWinner,
    predictionCorrect: actualSide === prediction.predictedSide,
    finalScore: `${game.away.abbr} ${game.away.score} - ${game.home.abbr} ${game.home.score}`
  };
}

function frozenOrFreshPrediction(game, index, modelContext, cachedSlate, refreshGameIds = null) {
  const previousGame = (cachedSlate?.games || []).find((candidate) => gamesMatch(game, candidate));
  const previous = (cachedSlate?.predictions || []).find((prediction) =>
    String(prediction.gameId) === String(game.id) || (previousGame && String(prediction.gameId) === String(previousGame.id)));
  const start = new Date(game.startTime).getTime();
  const hasStarted = game.statusKey === 'live' || game.statusKey === 'final' || (Number.isFinite(start) && start <= Date.now());
  if (previous && !hasStarted && refreshGameIds && !refreshGameIds.has(String(game.id))) {
    return {
      ...previous,
      index: index + 1,
      statusKey: game.statusKey,
      statusLabel: game.statusLabel,
      startTime: game.startTime,
      startTimeLocal: game.startTimeLocal
    };
  }
  if (!previous || !hasStarted) {
    return attachFinalGrade(game, { ...predictGame(game, index, modelContext), predictionGeneratedAt: new Date().toISOString() });
  }
  const frozen = {
    ...previous,
    gameId: game.id,
    originalGameId: String(previous.gameId) === String(game.id) ? previous.originalGameId : previous.gameId,
    index: index + 1,
    league: game.league,
    leagueKey: game.leagueKey,
    sportGroup: game.sportGroup,
    matchup: game.matchup,
    startTime: game.startTime,
    startTimeLocal: game.startTimeLocal,
    statusKey: game.statusKey,
    statusLabel: game.statusLabel,
    predictionGeneratedAt: previous.predictionGeneratedAt || cachedSlate?.generatedAt || '',
    frozenAfterStart: true
  };
  return attachFinalGrade(game, frozen);
}

function applyManualResults(games, intelligence, dateKey) {
  for (const result of Object.values(intelligence?.results || {})) {
    if (String(result.dateKey) !== String(dateKey)) continue;
    const target = games.find((game) =>
      normalizeName(game.leagueKey || game.league) === normalizeName(result.leagueKey || result.league) &&
      normalizeName(game.away.name) === normalizeName(result.awayTeam) &&
      normalizeName(game.home.name) === normalizeName(result.homeTeam));
    if (!target || validScore(result.awayScore) === null || validScore(result.homeScore) === null) continue;
    target.away.score = Number(result.awayScore);
    target.home.score = Number(result.homeScore);
    target.away.winner = target.away.score > target.home.score;
    target.home.winner = target.home.score > target.away.score;
    target.statusKey = 'final';
    target.statusLabel = 'Final';
    target.detail = 'Final (local result)';
    target.source = `${target.source} + local result`;
  }
  return games;
}

function selectBalancedSlate(games, limit) {
  const max = Math.max(1, Number(limit) || 25);
  if (games.length <= max) return [...games].sort((a, b) => new Date(a.startTime) - new Date(b.startTime));
  const leaguePriority = new Map(ESPN_LEAGUES.map((league) => [league.key, league.priority]));
  const groups = new Map();
  for (const game of games) {
    const key = game.leagueKey || game.league;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(game);
  }
  for (const rows of groups.values()) rows.sort((a, b) => new Date(a.startTime) - new Date(b.startTime));
  const groupKeys = [...groups.keys()].sort((a, b) => (leaguePriority.get(b) || 50) - (leaguePriority.get(a) || 50));
  const minimumPerLeague = Math.max(1, Math.floor(max / Math.max(1, groupKeys.length)));
  const selected = [];
  const selectedIds = new Set();
  for (const key of groupKeys) {
    for (const game of groups.get(key).slice(0, minimumPerLeague)) {
      if (selected.length >= max) break;
      selected.push(game);
      selectedIds.add(game.id);
    }
  }
  const remaining = games
    .filter((game) => !selectedIds.has(game.id))
    .sort((a, b) =>
      (leaguePriority.get(b.leagueKey) || 50) - (leaguePriority.get(a.leagueKey) || 50) ||
      new Date(a.startTime) - new Date(b.startTime));
  selected.push(...remaining.slice(0, max - selected.length));
  return selected.sort((a, b) => new Date(a.startTime) - new Date(b.startTime) || a.league.localeCompare(b.league));
}

export async function buildDailySlate(date = new Date(), options = {}) {
  const dateKey = localDateKey(date);
  const localOnly = options.localOnly === true || config.localOnly;
  const [settings, intelligence, scoreboard] = await Promise.all([
    options.guildId ? getGuildSettings(options.guildId) : Promise.resolve(null),
    readIntelligenceStore(options.guildId || ''),
    fetchEspnGames(date, options)
  ]);
  let games = mergeLocalGames(scoreboard.games, intelligence, dateKey);
  if (options.targetedPregame) games = mergeTargetedGames(games, options.cachedSlate);
  games = applyManualResults(games, intelligence, dateKey);
  games = carryForwardOdds(games, options.cachedSlate);
  games = selectBalancedSlate(games, config.maxGamesPerPost);
  const automatic = await enrichGamesAutomatically(games, date, {
    leagues: ESPN_LEAGUES,
    localOnly,
    targetedPregame: options.targetedPregame === true,
    forceSummaryGameIds: options.forceSummaryGameIds || []
  });
  games = automatic.games;
  const advancedDatasets = await attachAdvancedDatasetContext(games, {
    localOnly: localOnly || options.targetedPregame === true
  });
  let replay = null;
  let modelRegistry = await readModelRegistry();
  let localMlModels = await readLocalMlModels();
  if (config.historicalReplayEnabled && config.featureWarehouseEnabled && !options.targetedPregame) {
    replay = await runHistoricalReplay({ asOfDateKey: dateKey, maxRows: config.historicalReplayMaxRows });
    const productionCandidates = await warehouseCandidateRowsBefore(dateKey);
    const candidateRows = [...(replay.predictions || []), ...productionCandidates];
    if (config.localMlEnabled) localMlModels = await trainAndPersistLocalMlModels(candidateRows, { minimum: config.localMlMinSamples });
    modelRegistry = await refreshModelRegistry([...candidateRows, ...(localMlModels.evaluationRows || [])]);
  }
  const modelContext = await loadModelContext(options.guildId || '', config.predictionHistoryDays, {
    intelligence,
    externalResults: automatic.historyResults,
    asOfDateKey: dateKey
  });
  modelContext.modelRegistry = modelRegistry;
  modelContext.localMlModels = localMlModels;
  modelContext.intelligence = {
    ...modelContext.intelligence,
    teams: { ...automatic.teamProfiles, ...(modelContext.intelligence.teams || {}) }
  };
  for (const game of games) {
    const awayAuto = Object.values(automatic.teamProfiles).find((row) => row.leagueKey === game.leagueKey && normalizeName(row.name) === normalizeName(game.away?.name));
    const homeAuto = Object.values(automatic.teamProfiles).find((row) => row.leagueKey === game.leagueKey && normalizeName(row.name) === normalizeName(game.home?.name));
    game.autoHistory = {
      awayGames: Number(awayAuto?.sampleSize || 0),
      homeGames: Number(homeAuto?.sampleSize || 0),
      fetchedAt: awayAuto?.sourceFetchedAt && homeAuto?.sourceFetchedAt
        ? [awayAuto.sourceFetchedAt, homeAuto.sourceFetchedAt].sort()[0] : '',
      fetchedAtBySide: { away: awayAuto?.sourceFetchedAt || '', home: homeAuto?.sourceFetchedAt || '' },
      cacheState: awayAuto?.sourceCacheState === 'stale' || homeAuto?.sourceCacheState === 'stale'
        ? 'stale'
        : awayAuto?.sourceCacheState || homeAuto?.sourceCacheState || 'unknown',
      truncated: Boolean(awayAuto?.sourceTruncated || homeAuto?.sourceTruncated)
    };
    game.autoTeamMetrics = { away: awayAuto || null, home: homeAuto || null };
    game.advancedDataset = {
      ...(derivedAdvancedDataset(game, awayAuto, homeAuto) || {}),
      ...(game.advancedDataset || {})
    };
  }
  const includeOdds = options.includeOdds !== false && !localOnly;
  const odds = includeOdds
    ? await enrichWithOdds(games, { oddsApiKey: options.oddsApiKey ?? settings?.oddsApiKey, oddsApiRegion: options.oddsApiRegion ?? settings?.oddsApiRegion })
    : { games, diagnostics: [localOnly ? 'Odds API: skipped because LOCAL_ONLY=true.' : 'Odds API: no new request; using any durable daily market snapshot.'], alerts: [], externalCalls: 0 };
  games = carryForwardOdds(odds.games, options.cachedSlate)
    .sort((a, b) => new Date(a.startTime) - new Date(b.startTime) || a.league.localeCompare(b.league));
  const marketSnapshotCount = config.featureWarehouseEnabled
    ? await captureMarketSnapshots(games, {
        guildId: options.guildId || '',
        dateKey,
        stage: options.marketStage || 'daily',
        stages: options.marketStages || {},
        gameIds: options.refreshGameIds || [],
        capturedAt: new Date().toISOString()
      })
    : 0;
  const refreshGameIds = options.refreshGameIds?.length ? new Set(options.refreshGameIds.map(String)) : null;
  const predictions = games.map((game, index) => frozenOrFreshPrediction(game, index, modelContext, options.cachedSlate, refreshGameIds));
  for (const prediction of predictions) {
    const refreshed = !options.cachedSlate || !refreshGameIds || refreshGameIds.has(String(prediction.gameId));
    if (refreshed) prediction.snapshotStage = options.marketStages?.[String(prediction.gameId)] || options.marketStage || 'daily';
  }
  const finalReplies = { ...(options.cachedSlate?.finalReplies || {}) };
  for (const prediction of predictions) {
    if (prediction.originalGameId && finalReplies[prediction.originalGameId] && !finalReplies[prediction.gameId]) {
      finalReplies[prediction.gameId] = finalReplies[prediction.originalGameId];
    }
  }
  const inventory = intelligence;
  const warehouse = config.featureWarehouseEnabled ? await warehouseInventory() : null;
  const warehouseData = config.featureWarehouseEnabled && config.horizonEvaluationEnabled ? await readFeatureWarehouse() : null;
  const horizonEvaluation = warehouseData ? evaluatePredictionHorizons(warehouseData.predictions, warehouseData.markets) : null;
  const slate = {
    schemaVersion: 6,
    guildId: options.guildId || '',
    dateKey,
    timezone: config.timezone,
    generatedAt: new Date().toISOString(),
    source: localOnly
      ? 'Local schedule, team/player/context database, and imported history'
      : includeOdds ? 'Cached schedules/history/box scores/lineups + official corroboration + local overrides + optional de-vigged market consensus' : 'Cached schedules/history/box scores/lineups + official corroboration + local overrides + durable market snapshot',
    disclaimer: 'Probabilistic research onlyâ€”not a guarantee or wagering advice. Confidence must be validated against the botâ€™s calibration report.',
    games,
    predictions,
    modelSummary: {
      version: MODEL_VERSION,
      frozenLegacyPredictions: predictions.filter((prediction) => !/^OmniMod Evidence Ensemble v(?:3|4|5|6)/.test(String(prediction.modelVersion || ''))).length,
      calibrationSamples: modelContext.history.overall.sampleSize,
      historicalAccuracy: modelContext.history.overall.accuracy,
      historicalBrierScore: modelContext.history.overall.brierScore,
      featureLearning: Object.fromEntries(Object.entries(modelContext.featureLearning || {}).map(([sport, row]) => [sport, {
        trained: row.trained,
        accepted: row.accepted,
        sampleSize: row.sampleSize,
        evaluationSampleSize: row.evaluationSampleSize,
        brierImprovement: row.brierImprovement
      }])),
      drift: Object.fromEntries(Object.entries(modelContext.drift || {}).map(([sport, row]) => [sport, { status: row.status, penalty: row.penalty }])),
      championModels: Object.fromEntries(Object.entries(modelRegistry.sports || {}).map(([sport, row]) => [sport, {
        champion: row.championModelId,
        challenger: row.challengerModelId,
        status: row.status,
        sampleSize: row.evaluation?.evidence?.sampleSize || 0,
        brierImprovement: row.evaluation?.brierImprovement ?? null
      }])),
      replay: replay ? {
        results: replay.resultCount,
        predictions: replay.predictionCount,
        asOfDateKey: replay.asOfDateKey,
        timeIntegrity: replay.timeIntegrity
      } : null,
      localMl: Object.fromEntries(Object.entries(localMlModels.sports || {}).map(([sport, row]) => [sport, {
        modelId: row.modelId,
        sampleSize: row.sampleSize,
        validationSampleSize: row.validationSampleSize,
        accepted: row.accepted,
        brierImprovement: row.evaluation?.brierImprovement ?? null,
        logLossImprovement: row.evaluation?.logLossImprovement ?? null
      }])),
      horizonEvaluation: horizonEvaluation ? {
        sampleSize: horizonEvaluation.overall.sampleSize,
        byHorizon: Object.fromEntries(Object.entries(horizonEvaluation.byHorizon).map(([horizon, row]) => [horizon, {
          sampleSize: row.sampleSize,
          accuracy: row.accuracy,
          brierScore: row.brierScore,
          meanModelVsCloseEdge: row.meanModelVsCloseEdge
        }]))
      } : null,
      warehouse,
      advancedDatasets: {
        updatedAt: advancedDatasets.snapshot?.updatedAt || '',
        matchedGames: advancedDatasets.matched || 0,
        sources: (advancedDatasets.snapshot?.sources || []).map((row) => ({ id: row.id, ok: row.ok, rows: row.rows || row.competitions || 0 })),
        sourceCorroborations: advancedDatasets.sourceCorroborations || 0
      },
      marketSnapshotsCaptured: marketSnapshotCount,
      localInventory: {
        teams: Object.keys(inventory.teams || {}).length,
        players: Object.keys(inventory.players || {}).length,
        contexts: Object.keys(inventory.contexts || {}).length,
        games: Object.keys(inventory.games || {}).length,
        results: Object.keys(inventory.results || {}).length
      },
      automatic: {
        historyFinals: automatic.historyResults.length,
        teamProfiles: Object.keys(automatic.teamProfiles).length,
        injuryRecords: games.reduce((total, game) => total + (game.autoPlayers?.filter((row) => /injury/i.test(row.source || '')).length || 0), 0),
        playerProfiles: Object.keys(automatic.playerProfiles || {}).length,
        historicalBoxscores: automatic.historicalBoxscores,
        learnedInjuries: automatic.learnedInjuries,
        confirmedLineups: automatic.confirmedLineups,
        officialProbableStarters: automatic.officialProbableStarters || 0,
        officialMatches: automatic.officialMatches,
        officialStarters: automatic.officialStarters,
        starterRestMatches: automatic.starterRestMatches,
        playByPlayGames: automatic.playByPlayGames || 0,
        officialProfileMatches: automatic.officialProfileMatches || 0,
        historyLeagues: automatic.historyLeagues,
        summaryGames: automatic.summaryGames
      },
      externalCalls: scoreboard.externalCalls + automatic.externalCalls + odds.externalCalls + advancedDatasets.externalCalls
    },
    diagnostics: [
      ...scoreboard.diagnostics,
      ...automatic.diagnostics,
      ...advancedDatasets.diagnostics,
      ...odds.diagnostics,
      `Local intelligence: ${Object.keys(inventory.teams || {}).length} teams, ${Object.keys(inventory.players || {}).length} players, ${Object.keys(inventory.contexts || {}).length} contexts, ${Object.keys(inventory.results || {}).length} results.`,
      `Automatic intelligence: ${automatic.historyResults.length} historical finals, ${Object.keys(automatic.teamProfiles).length} team profiles, ${Object.keys(automatic.playerProfiles || {}).length} learned player profiles, ${automatic.playByPlayGames || 0} play-by-play game(s), ${automatic.confirmedLineups} confirmed lineup side(s), ${automatic.officialMatches + (advancedDatasets.sourceCorroborations || 0)} corroborated source match(es).`,
      `Calibration history: ${modelContext.history.overall.sampleSize} eligible pregame prediction(s).`
    ],
    alerts: odds.alerts ?? [],
    messageId: options.cachedSlate?.messageId || '',
    channelId: options.cachedSlate?.channelId || '',
    finalReplies
  };
  await recordPredictionJournal(slate, { lifecycle: options.targetedPregame ? 'provisional' : 'issued' });
  // Targeted refreshes are not learner evidence until the caller validates completion.
  if (config.featureWarehouseEnabled && !options.targetedPregame) await recordSlateSnapshot(slate);
  return slate;
}

export async function refreshFinalGrades(cachedSlate, options = {}) {
  const date = cachedSlate?.dateKey ? new Date(`${cachedSlate.dateKey}T12:00:00`) : new Date();
  const modelContext = await loadModelContext(options.guildId || cachedSlate?.guildId || '', config.predictionHistoryDays);
  const leagueKeys = [...new Set((cachedSlate.games || []).map((game) => game.leagueKey).filter(Boolean))];
  const scoreboard = await fetchEspnGames(date, { ...options, leagueKeys });
  let freshGames = mergeLocalGames(scoreboard.games, modelContext.intelligence, cachedSlate.dateKey);
  freshGames = applyManualResults(freshGames, modelContext.intelligence, cachedSlate.dateKey);
  const freshById = new Map(freshGames.map((game) => [game.id, game]));
  const finals = [];
  const predictions = (cachedSlate.predictions ?? []).map((oldPrediction) => {
    const cachedGame = (cachedSlate.games ?? []).find((game) => game.id === oldPrediction.gameId);
    const freshGame = freshById.get(oldPrediction.gameId) || freshGames.find((game) => cachedGame && gamesMatch(game, cachedGame))
      || (cachedGame?.statusKey === 'final' ? cachedGame : null);
    if (!freshGame || freshGame.statusKey !== 'final') return oldPrediction;
    const graded = attachFinalGrade(freshGame, oldPrediction);
    const alreadyReplied = Boolean(cachedSlate.finalReplies?.[oldPrediction.gameId]);
    if (!alreadyReplied && typeof graded.predictionCorrect === 'boolean') finals.push({ game: freshGame, prediction: graded });
    return graded;
  });
  const games = (cachedSlate.games ?? []).map((cachedGame) => {
    const fresh = freshById.get(cachedGame.id) || freshGames.find((game) => gamesMatch(game, cachedGame));
    return !fresh ? cachedGame : String(fresh.id) === String(cachedGame.id) ? fresh
      : { ...fresh, id: cachedGame.id, upstreamEventId: fresh.id };
  });
  const refreshed = { ...cachedSlate, refreshedAt: new Date().toISOString(), games, predictions,
    diagnostics: [...scoreboard.diagnostics, 'Final-grade refresh used frozen predictions; Odds API was not requested.'],
    alerts: [], newFinals: finals };
  // Save outcomes before Discord delivery: a transport failure cannot erase the result observation.
  await recordPredictionJournal(refreshed, { lifecycle: 'results_only' });
  if (config.featureWarehouseEnabled) await recordSlateSnapshot(refreshed);
  return refreshed;
}
