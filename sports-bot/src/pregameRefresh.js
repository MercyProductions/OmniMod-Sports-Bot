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
      if (dueAt < nowMs) continue;
      if (!best || dueAt < best.dueAtMs) best = { gameId: String(game.id), window, dueAtMs: dueAt, dueAt: new Date(dueAt).toISOString() };
    }
  }
  return best;
}
