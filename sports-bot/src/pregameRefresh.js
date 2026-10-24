import {journalGameIndex} from './journalEventMatch.js';
import {eventReference,scopedEventKey,resolveSlateGame,scopedSlatePredictions,scopedRefreshState} from './slateEventIdentity.js';
import { forecastIssuanceEvidence, recordPredictionJournal } from './predictionJournal.js';
function finiteTime(value) {
  const time = new Date(value || '').getTime();
  return Number.isFinite(time) ? time : null;
}

export function parseRefreshWindows(value, fallback = [90, 30, 10]) {
  const source = Array.isArray(value) ? value : String(value || '').split(',');
  const parsed = [...new Set(source.map(Number).filter((row) => Number.isFinite(row) && row >= 1 && row <= 720).map(Math.round))]
    .sort((a, b) => b - a);
  return parsed.length ? parsed : [...fallback];
}

export function duePregameRefreshes(slate = {}, now = new Date(), options = {}) {
  const nowMs = finiteTime(now) ?? Date.now();
  const windows = parseRefreshWindows(options.windows);
  const graceMinutes = Math.max(1, Number(options.graceMinutes) || 240);
  const games = [];
  for (const game of slate.games || []) {
    if (game.statusKey !== 'scheduled') continue;
    const startMs = finiteTime(game.startTime);
    if (startMs === null) continue;
    const minutesToStart = (startMs - nowMs) / 60_000;
    if (minutesToStart <= 0 || minutesToStart > Math.max(...windows) + 5 || minutesToStart < -graceMinutes) continue;
    const completed = scopedRefreshState(slate,game).windows || {};
    const dueWindows = windows.filter((window) => minutesToStart <= window && !completed[String(window)]);
    if (!dueWindows.length) continue;
    games.push({
      ...eventReference(game),
      minutesToStart: Number(minutesToStart.toFixed(1)),
      dueWindows,
      stage: `t-${Math.min(...dueWindows)}`
    });
  }
  return games;
}

export function markPregameRefreshes(slate = {}, due = [], refreshedAt = new Date().toISOString()) {
  const pregameRefreshes = structuredClone(slate.pregameRefreshes || {}),index=journalGameIndex(slate.games||[]);
  for (const row of due) {
    const game=resolveSlateGame(index,row).game;if(!game)continue;
    const eventKey=scopedEventKey(eventReference(game)),key='event:'+eventKey;
    const current=structuredClone(pregameRefreshes[key]||scopedRefreshState(slate,game));current.windows ||= {};
    for (const window of row.dueWindows || []) current.windows[String(window)] = refreshedAt;
    Object.assign(current,eventReference(game),{eventKey,lastRefreshedAt:refreshedAt,lastMinutesToStart:row.minutesToStart});
    pregameRefreshes[key]=current;
    if((index.get(String(game.id))||[]).every(other=>scopedEventKey(eventReference(other))===eventKey))pregameRefreshes[String(game.id)]=structuredClone(current);
  }
  return { ...slate, pregameRefreshes, lastPregameRefreshAt: refreshedAt };
}

/** Mark only a freshly obtained summary plus a new pregame forecast as completed. */
export function completePregameRefreshAttempt(previous = {}, rebuilt = {}, due = [], attemptedAt, completedAt, { blockedGameIds = [], blockedEventKeys = [], cacheBlockedEventKeys = [] } = {}) {
  const began = finiteTime(attemptedAt), ended = finiteTime(completedAt);
  if (began === null || ended === null || ended < began) throw new Error('Invalid pregame refresh attempt timestamps.');
  const games=journalGameIndex(rebuilt.games||[]),previousIndex=journalGameIndex(previous.games||[]);
  const predictions=scopedSlatePredictions(rebuilt),acceptedRows=new Map();
  const completed = [], rejected = [];
  for (const row of due) {
    const old=resolveSlateGame(previousIndex,row).game,subject=old?{...row,...eventReference(old)}:row;
    const association=resolveSlateGame(games,subject),game=association.game,reference=game?eventReference(game):subject;
    const key=scopedEventKey(reference),prediction=predictions.get(key);
    const fetched = finiteTime(game?.autoEnrichment?.fetchedAt), generated = finiteTime(prediction?.predictionGeneratedAt), start = finiteTime(game?.startTime);
    const issuable = forecastIssuanceEvidence(prediction||{}, game||{}, rebuilt, ended).recordEligibility === 'observed_pregame';
    const journalBlocked = blockedGameIds.includes(String(row.gameId))||blockedEventKeys.includes(key);
    const cacheBlocked = cacheBlockedEventKeys.includes(key);
    const summaryConflict=game?.autoEnrichment?.sourceIdentity?.status==='conflict'||game?.summaryIdentity?.sourceIdentity?.status==='conflict';
    const valid = !summaryConflict&&!cacheBlocked && !journalBlocked && game?.statusKey === 'scheduled' && start !== null && ended < start
      && ['network', 'revalidated'].includes(game?.autoEnrichment?.cacheState)
      && fetched !== null && fetched >= began && fetched <= ended
      && prediction?.predictionMode === 'pregame' && generated !== null && generated >= fetched && generated <= ended && issuable;
    if (valid) {completed.push({...row,...reference});acceptedRows.set(key,{game,prediction});}
    else rejected.push({ ...row,...reference, reason: 'fresh_summary_and_new_pregame_forecast_not_verified', reasons: [
      ...(!game?[association.reason||'game_identity_not_verified']:[]),
      ...(!prediction?['unique_event_forecast_not_verified']:[]),
      ...(game?.statusKey !== 'scheduled' ? ['game_not_scheduled'] : []),
      ...(start === null || ended >= start ? ['start_or_completion_invalid'] : []),
      ...(!['network','revalidated'].includes(game?.autoEnrichment?.cacheState) ? ['summary_not_revalidated'] : []),
      ...(fetched === null || fetched < began || fetched > ended ? ['summary_receipt_outside_attempt'] : []),
      ...(prediction?.predictionMode !== 'pregame' || generated === null || fetched === null || generated < fetched || generated > ended ? ['pregame_forecast_not_verified'] : []),
      ...(!issuable ? ['forecast_issuance_not_verified'] : []),
      ...(journalBlocked ? ['journal_issuance_not_verified'] : []),
      ...(cacheBlocked ? ['cache_event_changed_during_refresh'] : []),
      ...(summaryConflict?['summary_source_identity_conflict']:[])
    ] });
  }
  const previousGameKeys=new Set((previous.games||[]).map(game=>scopedEventKey(eventReference(game))));
  const previousPredictionKeys=new Set();
  const oldPredictions=(previous.predictions||[]).map(row=>{
    const game=resolveSlateGame(previousIndex,row).game;if(!game)return row;
    const key=scopedEventKey(eventReference(game));previousPredictionKeys.add(key);return acceptedRows.get(key)?.prediction||row;
  });
  const candidate = { ...rebuilt,
    games:[...(previous.games||[]).map(game=>acceptedRows.get(scopedEventKey(eventReference(game)))?.game||game),
      ...(rebuilt.games||[]).filter(game=>!previousGameKeys.has(scopedEventKey(eventReference(game))))],
    predictions:[...oldPredictions,...[...acceptedRows].filter(([key])=>!previousPredictionKeys.has(key)).map(([,value])=>value.prediction)],
    pregameRefreshes: previous.pregameRefreshes || {},
    lastPregameRefreshAt: previous.lastPregameRefreshAt || '',
    lastPregameRefreshAttemptAt: completedAt,
    lastPregameRefreshAttempt: { attempted: due.length, completed: completed.length, rejected },
    pregameRefreshDeliveryPending: completed.length > 0 || previous.pregameRefreshDeliveryPending === true };
  return { slate: completed.length ? markPregameRefreshes(candidate, completed, completedAt) : candidate, completed, rejected };
}

export function nextPregameRefresh(slate = {}, now = new Date(), options = {}) {
  const nowMs = finiteTime(now) ?? Date.now();
  const windows = parseRefreshWindows(options.windows);
  let best = null;
  for (const game of slate.games || []) {
    if (game.statusKey !== 'scheduled') continue;
    const startMs = finiteTime(game.startTime);
    if (startMs === null || startMs <= nowMs) continue;
    const completed = scopedRefreshState(slate,game).windows || {};
    for (const window of windows) {
      if (completed[String(window)]) continue;
      const dueAt = startMs - window * 60_000;
      if (dueAt < nowMs) {
        const overdueWindows = windows.filter((value) => !completed[String(value)] && startMs - value * 60_000 < nowMs);
        if (!best || nowMs < best.dueAtMs) best = { ...eventReference(game), window: Math.min(...overdueWindows),
          dueAtMs: nowMs, dueAt: new Date(nowMs).toISOString(), overdue: true };
        continue;
      }
      if (!best || dueAt < best.dueAtMs) best = { ...eventReference(game), window, dueAtMs: dueAt, dueAt: new Date(dueAt).toISOString() };
    }
  }
  return best;
}

/** Commit eligible refreshed forecasts only after the same completion gate used by the scheduler. */
export async function completeAndJournalPregameRefresh(previous, rebuilt, due, attemptedAt, completedAt, { cacheBlockedEventKeys = [], ...journalOptions } = {}) {
  let attempt = completePregameRefreshAttempt(previous, rebuilt, due, attemptedAt, completedAt, { cacheBlockedEventKeys });
  const key=row=>scopedEventKey(row),index=journalGameIndex(rebuilt.games||[]);
  const predictionKey=row=>{const game=resolveSlateGame(index,row).game;return game?key(eventReference(game)):null;};
  let completed=new Set(attempt.completed.map(key));
  const rejected=new Set(attempt.rejected.map(key));
  const subset=keys=>({...rebuilt,predictions:(rebuilt.predictions||[]).filter(row=>keys.has(predictionKey(row)))});
  const now=Date.parse(completedAt);
  await recordPredictionJournal(subset(rejected),{...journalOptions,now,lifecycle:'rejected',reason:'fresh_summary_and_new_pregame_forecast_not_verified'});
  const issuance=await recordPredictionJournal(subset(completed),{...journalOptions,now,lifecycle:'issued'});
  const verified=new Set(issuance.verifiedIssuedForecasts.map(row=>key({...row,leagueKey:row.league})));
  const blockedEventKeys=[...completed].filter(value=>!verified.has(value));
  if(blockedEventKeys.length){
    attempt=completePregameRefreshAttempt(previous,rebuilt,due,attemptedAt,completedAt,{blockedEventKeys,cacheBlockedEventKeys});
    completed=new Set(attempt.completed.map(key));
  }
  await recordPredictionJournal(rebuilt,{...journalOptions,now,lifecycle:'refresh_attempt',refreshAttempt:{
    attemptedAt,completedAt,games:due.map(row=>{
      const match=attempt.completed.find(value=>String(value.gameId)===String(row.gameId)&&(!row.leagueKey||value.leagueKey===row.leagueKey)&&(!row.startTime||value.startTime===row.startTime));
      const rejection=attempt.rejected.find(value=>String(value.gameId)===String(row.gameId)&&(!row.leagueKey||value.leagueKey===row.leagueKey)&&(!row.startTime||value.startTime===row.startTime));
      return {...row,...(match?eventReference(match):{}),gameId:String(row.gameId),status:match?'completed':'rejected',reasons:rejection?.reasons||[]};
    })
  }});
  return attempt;
}

/** Capture build/provider exceptions even when no prediction exists. Exception text is never persisted. */
export async function buildJournaledPregameRefresh(slate, due, attemptedAt, build, { clock = Date.now, ...journalOptions } = {}) {
  try { return await build(); }
  catch (error) {
    const now = clock();
    await recordPredictionJournal(slate, { ...journalOptions, now, lifecycle: 'refresh_attempt', refreshAttempt: {
      attemptedAt, completedAt: new Date(now).toISOString(), games: due.map(row => ({
        ...row,gameId: String(row.gameId), dueWindows: row.dueWindows, status: 'build_failed', reasons: ['build_failed'] }))
    } });
    throw error;
  }
}
