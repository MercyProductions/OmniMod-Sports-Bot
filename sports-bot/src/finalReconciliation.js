/** Revisit unresolved pregame events after local midnight, within a bounded public-data window. */
export function pendingFinalDateKeys(caches = [], { today, now = Date.now(), lookbackDays = 7 } = {}) {
  const todayMs = Date.parse(`${today}T00:00:00Z`);
  if (!Number.isFinite(todayMs) || !Number.isFinite(now)) throw new Error('Valid final-reconciliation dates are required.');
  const dates = new Set();
  for (const cache of caches) {
    const age = (todayMs - Date.parse(`${cache.dateKey}T00:00:00Z`)) / 86_400_000;
    if (!Number.isFinite(age) || age < 0 || age > lookbackDays) continue;
    const slate = cache.slate || {};
    if ((slate.predictions || []).some(row => row.predictionMode === 'pregame' && row.eligibleForCalibration !== false
      && Number.isFinite(Date.parse(row.startTime || '')) && Date.parse(row.startTime) <= now
      && (typeof row.predictionCorrect !== 'boolean' || !slate.finalReplies?.[row.gameId]))) dates.add(cache.dateKey);
  }
  return [...dates].sort().reverse();
}
