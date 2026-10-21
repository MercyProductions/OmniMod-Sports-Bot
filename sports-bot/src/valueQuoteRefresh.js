import {matchOddsEventCohort} from './oddsEventIdentity.js';
import {hasQuoteScope,quotePredictions,uniqueQuoteRows} from './quoteRefreshIdentity.js';
import {scopedEventKey,eventReference,resolveSlateGame} from './slateEventIdentity.js';
import {journalGameIndex} from './journalEventMatch.js';
import {predictionHorizon} from './horizonEvaluation.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { config, dataDir } from './config.js';
import { cachedFetchJson } from './providerCache.js';
import { bestH2HMarket, supportedLeagues } from './sportsData.js';
import { refreshPredictionValue } from './oddsValue.js';
import { localDateKey } from './time.js';

const MAX_MODEL_AGE_MS = 6 * 60 * 60_000;

// Exclusive immutable slot files are shared by all guilds/processes on this
// data directory. A failed attempt still consumes its slot; no retry loophole.
export async function claimValueRefresh({ now = Date.now(), dailyCap = config.valueRefreshDailyCap, cooldownMinutes = config.valueRefreshCooldownMinutes, directory = dataDir } = {}) {
  const cap = Number(dailyCap);
  if (!Number.isSafeInteger(cap) || cap <= 0 || cap > 100) return { claimed: false, status: 'disabled', used: 0, cap: 0 };
  const cooldown = Number(cooldownMinutes);
  if (!Number.isFinite(cooldown) || cooldown < 1 || cooldown > 1440 || !Number.isFinite(now)) return { claimed: false, status: 'disabled', used: 0, cap };
  const day = localDateKey(new Date(now));
  const base = path.join(directory, 'value-refresh-claims');
  await fs.mkdir(base, { recursive: true });
  const lockFile = path.join(base, 'claim.lock');
  let lock;
  try { lock = await fs.open(lockFile, 'wx', 0o600); }
  catch (error) {
    if (error?.code === 'EEXIST') return { claimed: false, status: 'concurrent_claim', used: 0, cap };
    throw error;
  }
  try {
  const files = (await fs.readdir(base)).filter((name) => /^\d{4}-\d{2}-\d{2}-\d+\.json$/.test(name));
  const todays = files.filter((name) => name.startsWith(`${day}-`));
  if (todays.length >= cap) return { claimed: false, status: 'daily_cap', used: todays.length, cap };
  let latest = -Infinity;
  for (const file of files) {
    const row = JSON.parse(await fs.readFile(path.join(base, file), 'utf8'));
    const time = Date.parse(row.claimedAt || '');
    if (!Number.isFinite(time)) throw new Error('Invalid quote refresh claim; budget remains closed.');
    latest = Math.max(latest, time);
  }
  if (now - latest < cooldown * 60_000) return { claimed: false, status: 'cooldown', used: todays.length, cap, retryAt: new Date(latest + cooldown * 60_000).toISOString() };
  const slot = 1 + Math.max(0, ...todays.map((name) => Number(name.slice(11, -5))));
  const claim = { claimedAt: new Date(now).toISOString(), dateKey: day, slot, requests: 1 };
  const file = path.join(base, `${day}-${slot}.json`);
  let handle;
  try {
    handle = await fs.open(file, 'wx', 0o600);
    await handle.writeFile(JSON.stringify(claim), 'utf8');
  } catch (error) {
    if (error?.code === 'EEXIST') return { claimed: false, status: 'concurrent_claim', used: todays.length, cap };
    throw new Error('Could not reserve quote refresh budget; no provider call was made.');
  } finally {
    if (handle) await handle.close();
  }
  return { claimed: true, status: 'claimed', used: todays.length + 1, cap, ...claim };
  } finally {
    await lock.close();
    await fs.unlink(lockFile);
  }
}

function response(slate, status, message, extra = {}) {
  return { slate, status, message, externalCalls: 0, issuedSlate: null, ...extra };
}

/** This function never calls the provider unless explicitly requested by admin. */
export async function refreshValueQuotes(slate, options = {}) {
  slate=structuredClone(slate||{});options={...options};
  if (options.refresh !== true) return response(slate, 'cached', 'Cached quotes; no paid refresh requested.');
  if (options.admin !== true) return response(slate, 'forbidden', 'Quote refresh is admin-only; cached quotes retained.');
  const cap = options.dailyCap ?? config.valueRefreshDailyCap;
  if (!Number.isSafeInteger(Number(cap)) || Number(cap) <= 0) return response(slate, 'disabled', 'Paid quote refresh disabled (SPORTS_VALUE_REFRESH_DAILY_CAP=0); cached quotes retained.');
  if (options.localOnly ?? config.localOnly) return response(slate, 'disabled', 'Local-only mode: no paid quote refresh.');
  const apiKey = String(options.oddsApiKey ?? config.oddsApiKey ?? '');
  if (!apiKey) return response(slate, 'unconfigured', 'No configured Odds API credential; cached quotes retained.');
  const now = options.now ?? Date.now();
  const models = quotePredictions(slate),gameIndex=journalGameIndex(slate?.games||[]);
  const supported = new Map(supportedLeagues().filter((league) => league.oddsKey).map((league) => [league.key, league.oddsKey]));
  const selectedLeague = options.league ? String(options.league).trim().toLowerCase() : null;
  const eligible = (slate?.games || []).filter((game) => {
    const model = hasQuoteScope(game)&&resolveSlateGame(gameIndex,eventReference(game)).game?models.get(scopedEventKey(eventReference(game))):null;
    const modelAsOf = Date.parse(model?.modelAsOf || model?.predictionGeneratedAt || '');
    return game.statusKey === 'scheduled' && Date.parse(game.startTime) > now && supported.has(game.leagueKey) &&
      model?.predictionMode === 'pregame' && Number.isFinite(modelAsOf) && modelAsOf <= now && now - modelAsOf <= MAX_MODEL_AGE_MS &&
      (!selectedLeague || game.leagueKey === selectedLeague);
  }).sort((a, b) => Date.parse(a.startTime) - Date.parse(b.startTime));
  if (!eligible.length) return response(slate, 'no_eligible_games', 'No selected future games have a verified model snapshot from the past six hours. Refresh the model slate first; no paid call made.');
  const league = eligible[0].leagueKey;
  const games = [...new Map(eligible.filter((game) => game.leagueKey === league).map(game=>[scopedEventKey(eventReference(game)),game])).values()].slice(0, 25);
  let budget;
  try {
    budget = await claimValueRefresh({ now, dailyCap: cap, cooldownMinutes: options.cooldownMinutes ?? config.valueRefreshCooldownMinutes, directory: options.directory ?? dataDir });
  } catch {
    return response(slate, 'budget_error', 'Quote refresh budget could not be verified; no provider request made.');
  }
  if (!budget.claimed) return response(slate, budget.status, `Quote refresh ${budget.status}; ${budget.used}/${budget.cap} daily request slots used.${budget.retryAt ? ` Retry after ${budget.retryAt}.` : ''} Cached quotes retained.`, { budget });

  const url = new URL(`https://api.the-odds-api.com/v4/sports/${supported.get(league)}/odds/`);
  url.searchParams.set('apiKey', apiKey);
  url.searchParams.set('regions', String(options.oddsApiRegion || config.oddsApiRegion || 'us').split(',')[0].trim());
  url.searchParams.set('markets', 'h2h');
  url.searchParams.set('oddsFormat', 'american');
  // Use explicit known provider event IDs where all selected games have them.
  if (games.every((game) => game.odds?.eventId && !game.odds?.freeProvider)) url.searchParams.set('eventIds', games.map((game) => game.odds.eventId).join(','));
  const request = options.fetchJson || cachedFetchJson;
  let result;
  try {
    result = await request(url.toString(), { namespace: `value-h2h-${league}`, force: true, ttlMs: 0, staleMs: 0, timeoutMs: 15_000, secretParams: ['apiKey'] });
  } catch {
    return response(slate, 'provider_failure', `Quote provider request failed; reserved slot ${budget.used}/${budget.cap} remains consumed. Cached quotes retained.`, { budget, externalCalls: 1 });
  }
  if (!result?.ok || !Array.isArray(result.json) || !['network', 'revalidated'].includes(result.cacheState)) {
    return response(slate, 'provider_failure', `Quote provider did not return a new usable response (HTTP ${Number(result?.status) || 0}); slot ${budget.used}/${budget.cap} consumed. Cached quotes retained.`, { budget, externalCalls: 1 });
  }
  const issuedAt = new Date(options.now ?? Date.now()).toISOString();
  const updated = new Map();
  const matches=matchOddsEventCohort((slate.games||[]).filter(game=>game.leagueKey===league),result.json,supported.get(league));
  const oddsMatchAudit=[];
  for (const game of games) {
    if(Date.parse(game.startTime)<=Date.parse(issuedAt))continue;
    const match=matches.get(scopedEventKey(eventReference(game)));oddsMatchAudit.push({event:eventReference(game),...match.evidence});
    const event = match.event;
    if (!event) continue;
    const h2h = bestH2HMarket(event.bookmakers, game);
    if (!h2h.away || !h2h.home || !h2h.bookmakerCount) continue;
    updated.set(scopedEventKey(eventReference(game)), { ...game, oddsMatchEvidence:match.evidence, odds: { eventId: event.id,eventIdentity:match.evidence, commenceTime: event.commence_time, h2h, bookmakerCount: h2h.bookmakerCount, lastUpdate: h2h.lastUpdate, fetchedAt: result.fetchedAt || issuedAt, cacheState: result.cacheState, matchStatus: 'matched', provider: 'The Odds API', quoteRefreshOnly: true } });
  }
  if (!updated.size) return response(slate, 'unmatched', `New ${league} h2h response matched no complete future markets; cached quotes retained. Slot ${budget.used}/${budget.cap} used.`, { budget, externalCalls: 1,oddsMatchAudit });
  const nextGames = (slate.games || []).map((game) => updated.get(scopedEventKey(eventReference(game))) || game);
  const snapshots = [];
  const predictions = uniqueQuoteRows(slate.predictions || []).map((prediction) => {
    const game = hasQuoteScope(prediction)&&models.has(scopedEventKey(prediction))?updated.get(scopedEventKey(prediction)):null;
    if (!game) return prediction;
    const modelAsOf = prediction.modelAsOf || prediction.predictionGeneratedAt;
    const refreshed = refreshPredictionValue({ ...prediction, modelAsOf }, game, Date.parse(issuedAt));
    refreshed.modelAsOf = modelAsOf;
    refreshed.valueAnalysis.modelAsOf = modelAsOf;
    refreshed.valueAnalysis.issuedAt = issuedAt;
    refreshed.valueAnalysis.provenance = 'explicit_admin_h2h_refresh_with_frozen_model';
    snapshots.push({ ...refreshed, originalForecastHorizon: predictionHorizon({...prediction,minutesToStart:(Date.parse(prediction.startTime||game.startTime)-Date.parse(prediction.predictionGeneratedAt))/60000}), originalForecastGeneratedAt: prediction.predictionGeneratedAt, predictionGeneratedAt: issuedAt, quoteRefreshOnly: true, eligibleForCalibration: false, snapshotStage: 'quote-refresh' });
    return refreshed;
  });
  const fresh = predictions.filter((row) => hasQuoteScope(row)&&updated.has(scopedEventKey(row))).some((row) => row.valueAnalysis.outcomes.some((outcome) => outcome.quote?.fresh));
  const issuedSlate = { ...slate, generatedAt: issuedAt, games: nextGames, predictions: snapshots };
  const nextSlate = { ...slate, games: nextGames, predictions, lastValueQuoteRefreshAt: issuedAt };
  return response(nextSlate, fresh ? 'fresh' : 'provider_quotes_stale', `${fresh ? 'Fresh' : 'Provider returned stale/unknown-time'} ${league} h2h quotes for ${updated.size} game(s); slot ${budget.used}/${budget.cap} used. Model probabilities remain frozen (modelAsOf retained).`, { budget, externalCalls: 1, issuedSlate,oddsMatchAudit });
}
