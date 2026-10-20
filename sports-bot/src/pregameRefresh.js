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
export function completePregameRefreshAttempt(previous = {}, rebuilt = {}, due = [], attemptedAt, completedAt) {
  const began = finiteTime(attemptedAt), ended = finiteTime(completedAt);
  if (began === null || ended === null || ended < began) throw new Error('Invalid pregame refresh attempt timestamps.');
  const games = new Map((rebuilt.games || []).map(game => [String(game.id), game]));
  const predictions = new Map((rebuilt.predictions || []).map(row => [String(row.gameId), row]));
  const completed = [], rejected = [];
  for (const row of due) {
    const game = games.get(row.gameId), prediction = predictions.get(row.gameId);
    const fetched = finiteTime(game?.autoEnrichment?.fetchedAt), generated = finiteTime(prediction?.predictionGeneratedAt), start = finiteTime(game?.startTime);
    const valid = game?.statusKey === 'scheduled' && start !== null && ended < start
      && ['network', 'revalidated'].includes(game?.autoEnrichment?.cacheState)
      && fetched !== null && fetched >= began && fetched <= ended
      && prediction?.predictionMode === 'pregame' && generated !== null && generated >= fetched && generated <= ended;
    if (valid) completed.push(row);
    else rejected.push({ gameId: row.gameId, reason: 'fresh_summary_and_new_pregame_forecast_not_verified' });
  }
  const failed = new Set(rejected.map(row => row.gameId));
  const previousGames = new Map((previous.games || []).map(game => [String(game.id), game]));
  const previousPredictions = new Map((previous.predictions || []).map(row => [String(row.gameId), row]));
  const candidate = { ...rebuilt,
    games: (rebuilt.games || []).map(game => failed.has(String(game.id)) ? previousGames.get(String(game.id)) || game : game),
    predictions: (rebuilt.predictions || []).map(row => failed.has(String(row.gameId)) ? previousPredictions.get(String(row.gameId)) || row : row),
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
