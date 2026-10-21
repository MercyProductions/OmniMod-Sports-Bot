import { updateDailyCache } from './storage.js';
import { journalGameIndex, eventObservationHash } from './journalEventMatch.js';
import { resolveSlateGame, eventReference, scopedEventKey, scopedSlatePredictions, scopedRefreshState } from './slateEventIdentity.js';
import { completeAndJournalPregameRefresh } from './pregameRefresh.js';
import { refreshScopedPredictionValues } from './quoteRefreshIdentity.js';

const eventIdentity = game => { const copy = structuredClone(game); delete copy.odds; return eventObservationHash(copy); };
const forecastIdentity = row => {
  if (!row) return null;
  const copy = structuredClone(row); delete copy.valueAnalysis;
  copy.modelAsOf ||= copy.predictionGeneratedAt;
  return eventObservationHash(copy);
};

/** Provider/build work is finished before entering this local cache/journal critical section. */
export async function persistPregameRefresh(base, rebuilt, due, attemptedAt, sourceCompletedAt, { clock = Date.now, update = updateDailyCache, ...journalOptions } = {}) {
  base = structuredClone(base); rebuilt = structuredClone(rebuilt); due = structuredClone(due); journalOptions = structuredClone(journalOptions);
  let attempt;
  const saved = await update(base.dateKey, base.guildId, async current => {
    for (const slate of [current, rebuilt]) {
      if (slate.dateKey !== base.dateKey || String(slate.guildId || '') !== String(base.guildId || '')) throw new Error('Pregame cache scope mismatch.');
    }
    const now = clock(), began = Date.parse(attemptedAt), ended = Date.parse(sourceCompletedAt);
    if (!Number.isFinite(now) || !Number.isFinite(began) || !Number.isFinite(ended) || ended < began || ended > now) throw new Error('Invalid pregame cache chronology.');
    const before = journalGameIndex(base.games ?? []), latest = journalGameIndex(current.games ?? []);
    const previousPredictions = scopedSlatePredictions(base), currentPredictions = scopedSlatePredictions(current);
    const rejected = [], cacheBlockedEventKeys = [];
    for (const row of due) {
      const old = resolveSlateGame(before, row).game, game = resolveSlateGame(latest, row).game;
      const key = scopedEventKey(old ? eventReference(old) : row);
      let reason;
      if (!old || !game) reason = 'cache_event_missing_or_ambiguous';
      else if (eventIdentity(old) !== eventIdentity(game)) reason = 'cache_event_changed';
      else if (!previousPredictions.has(key) || !currentPredictions.has(key)) reason = 'cache_forecast_missing_or_ambiguous';
      else if (forecastIdentity(previousPredictions.get(key)) !== forecastIdentity(currentPredictions.get(key))) reason = 'cache_forecast_changed';
      else if (eventObservationHash(scopedRefreshState(base, old)) !== eventObservationHash(scopedRefreshState(current, game))) reason = 'cache_refresh_window_changed';
      if (reason) { cacheBlockedEventKeys.push(key); rejected.push({ eventKey: key, reason }); }
    }
    const completedAt = new Date(now).toISOString();
    attempt = await completeAndJournalPregameRefresh(current, rebuilt, due, attemptedAt, completedAt, { ...journalOptions, cacheBlockedEventKeys });
    const accepted = new Set(attempt.completed.map(scopedEventKey));
    const refreshedGames = journalGameIndex(attempt.slate.games ?? []);
    const proposal = {
      ...current,
      games: (current.games ?? []).map(game => {
        if (!accepted.has(scopedEventKey(eventReference(game)))) return game;
        const fresh = resolveSlateGame(refreshedGames, eventReference(game)).game;
        return fresh ? { ...fresh, odds: game.odds } : game;
      }),
      predictions: attempt.slate.predictions,
      pregameRefreshes: attempt.slate.pregameRefreshes,
      lastPregameRefreshAt: attempt.slate.lastPregameRefreshAt,
      lastPregameRefreshAttemptAt: attempt.slate.lastPregameRefreshAttemptAt,
      lastPregameRefreshAttempt: attempt.slate.lastPregameRefreshAttempt,
      pregameRefreshDeliveryPending: attempt.slate.pregameRefreshDeliveryPending,
      pregameCacheMergeAudit: { sourceRevision: base.cacheRevision ?? 0, targetRevision: current.cacheRevision ?? 0,
        sourceCompletedAt, validatedAt: completedAt, appliedEvents: accepted.size, rejected,
        diagnostics: rebuilt.diagnostics ?? [] }
    };
    return refreshScopedPredictionValues(proposal, now);
  });
  return { ...attempt, slate: saved };
}
