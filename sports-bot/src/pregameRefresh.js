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
  const state = slate.pregameRefreshes || {};
  const games = [];
  for (const game of slate.games || []) {
    if (game.statusKey !== 'scheduled') continue;
    const startMs = finiteTime(game.startTime);
    if (startMs === null) continue;
    const minutesToStart = (startMs - nowMs) / 60_000;
    if (minutesToStart <= 0 || minutesToStart > Math.max(...windows) + 5 || minutesToStart < -graceMinutes) continue;
    const completed = state[String(game.id)]?.windows || {};
    const dueWindows = windows.filter((window) => minutesToStart <= window && !completed[String(window)]);
    if (!dueWindows.length) continue;
    games.push({
      gameId: String(game.id),
      minutesToStart: Number(minutesToStart.toFixed(1)),
      dueWindows,
      stage: `t-${Math.min(...dueWindows)}`
    });
  }
  return games;
}

export function markPregameRefreshes(slate = {}, due = [], refreshedAt = new Date().toISOString()) {
  const pregameRefreshes = structuredClone(slate.pregameRefreshes || {});
  for (const row of due) {
    const key = String(row.gameId);
    const current = pregameRefreshes[key] || { windows: {} };
    current.windows ||= {};
    for (const window of row.dueWindows || []) current.windows[String(window)] = refreshedAt;
    current.lastRefreshedAt = refreshedAt;
    current.lastMinutesToStart = row.minutesToStart;
    pregameRefreshes[key] = current;
  }
  return { ...slate, pregameRefreshes, lastPregameRefreshAt: refreshedAt };
}

/** Mark only a freshly obtained summary plus a new pregame forecast as completed. */
export function completePregameRefreshAttempt(previous = {}, rebuilt = {}, due = [], attemptedAt, completedAt, { blockedGameIds = [] } = {}) {
  const began = finiteTime(attemptedAt), ended = finiteTime(completedAt);
  if (began === null || ended === null || ended < began) throw new Error('Invalid pregame refresh attempt timestamps.');
  const games = new Map((rebuilt.games || []).map(game => [String(game.id), game]));
  const predictions = new Map((rebuilt.predictions || []).map(row => [String(row.gameId), row]));
  const completed = [], rejected = [];
  for (const row of due) {
    const game = games.get(row.gameId), prediction = predictions.get(row.gameId);
    const fetched = finiteTime(game?.autoEnrichment?.fetchedAt), generated = finiteTime(prediction?.predictionGeneratedAt), start = finiteTime(game?.startTime);
    const issuable = forecastIssuanceEvidence(prediction, game, rebuilt, ended).recordEligibility === 'observed_pregame';
    const journalBlocked = blockedGameIds.includes(String(row.gameId));
    const valid = !journalBlocked && game?.statusKey === 'scheduled' && start !== null && ended < start
      && ['network', 'revalidated'].includes(game?.autoEnrichment?.cacheState)
      && fetched !== null && fetched >= began && fetched <= ended
      && prediction?.predictionMode === 'pregame' && generated !== null && generated >= fetched && generated <= ended && issuable;
    if (valid) completed.push(row);
    else rejected.push({ gameId: row.gameId, reason: 'fresh_summary_and_new_pregame_forecast_not_verified', reasons: [
      ...(game?.statusKey !== 'scheduled' ? ['game_not_scheduled'] : []),
      ...(start === null || ended >= start ? ['start_or_completion_invalid'] : []),
      ...(!['network','revalidated'].includes(game?.autoEnrichment?.cacheState) ? ['summary_not_revalidated'] : []),
      ...(fetched === null || fetched < began || fetched > ended ? ['summary_receipt_outside_attempt'] : []),
      ...(prediction?.predictionMode !== 'pregame' || generated === null || fetched === null || generated < fetched || generated > ended ? ['pregame_forecast_not_verified'] : []),
      ...(!issuable ? ['forecast_issuance_not_verified'] : []),
      ...(journalBlocked ? ['journal_issuance_not_verified'] : [])
    ] });
  }
  const accepted = new Set(completed.map(row => String(row.gameId)));
  const previousGames = new Map((previous.games || []).map(game => [String(game.id), game]));
  const previousPredictions = new Map((previous.predictions || []).map(row => [String(row.gameId), row]));
  const candidate = { ...rebuilt,
    games: [
      ...(previous.games || []).map(game => accepted.has(String(game.id)) ? games.get(String(game.id)) || game : game),
      ...(rebuilt.games || []).filter(game => !previousGames.has(String(game.id)))
    ],
    predictions: [
      ...(previous.predictions || []).map(row => accepted.has(String(row.gameId)) ? predictions.get(String(row.gameId)) || row : row),
      ...(rebuilt.predictions || []).filter(row => accepted.has(String(row.gameId)) && !previousPredictions.has(String(row.gameId)))
    ],
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
    const completed = slate.pregameRefreshes?.[String(game.id)]?.windows || {};
    for (const window of windows) {
      if (completed[String(window)]) continue;
      const dueAt = startMs - window * 60_000;
      if (dueAt < nowMs) {
        const overdueWindows = windows.filter((value) => !completed[String(value)] && startMs - value * 60_000 < nowMs);
        if (!best || nowMs < best.dueAtMs) best = { gameId: String(game.id), window: Math.min(...overdueWindows),
          dueAtMs: nowMs, dueAt: new Date(nowMs).toISOString(), overdue: true };
        continue;
      }
      if (!best || dueAt < best.dueAtMs) best = { gameId: String(game.id), window, dueAtMs: dueAt, dueAt: new Date(dueAt).toISOString() };
    }
  }
  return best;
}

/** Commit eligible refreshed forecasts only after the same completion gate used by the scheduler. */
export async function completeAndJournalPregameRefresh(previous, rebuilt, due, attemptedAt, completedAt, journalOptions = {}) {
  let attempt = completePregameRefreshAttempt(previous, rebuilt, due, attemptedAt, completedAt);
  let completed = new Set(attempt.completed.map(row => String(row.gameId)));
  const rejected = new Set(attempt.rejected.map(row => String(row.gameId)));
  const subset = ids => ({ ...rebuilt, predictions: (rebuilt.predictions || []).filter(row => ids.has(String(row.gameId))) });
  const now = Date.parse(completedAt);
  await recordPredictionJournal(subset(rejected), { ...journalOptions, now, lifecycle: 'rejected',
    reason: 'fresh_summary_and_new_pregame_forecast_not_verified' });
  const issuance = await recordPredictionJournal(subset(completed), { ...journalOptions, now, lifecycle: 'issued' });
  const verified = new Set(issuance.verifiedIssuedGameIds);
  const blockedGameIds = [...completed].filter(id => !verified.has(id));
  if (blockedGameIds.length) {
    attempt = completePregameRefreshAttempt(previous, rebuilt, due, attemptedAt, completedAt, { blockedGameIds });
    completed = new Set(attempt.completed.map(row => String(row.gameId)));
  }
  await recordPredictionJournal(rebuilt, { ...journalOptions, now, lifecycle: 'refresh_attempt', refreshAttempt: {
    attemptedAt, completedAt, games: due.map(row => ({ gameId: String(row.gameId), dueWindows: row.dueWindows,
      status: completed.has(String(row.gameId)) ? 'completed' : 'rejected',
      reasons: attempt.rejected.find(rejected => String(rejected.gameId) === String(row.gameId))?.reasons || [] }))
  } });
  return attempt;
}

/** Capture build/provider exceptions even when no prediction exists. Exception text is never persisted. */
export async function buildJournaledPregameRefresh(slate, due, attemptedAt, build, { clock = Date.now, ...journalOptions } = {}) {
  try { return await build(); }
  catch (error) {
    const now = clock();
    await recordPredictionJournal(slate, { ...journalOptions, now, lifecycle: 'refresh_attempt', refreshAttempt: {
      attemptedAt, completedAt: new Date(now).toISOString(), games: due.map(row => ({
        gameId: String(row.gameId), dueWindows: row.dueWindows, status: 'build_failed', reasons: ['build_failed'] }))
    } });
    throw error;
  }
}
