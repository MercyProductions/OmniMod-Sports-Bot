import { readDailyCache, writeDailyCache } from './storage.js';
import { journalGameIndex, eventObservationHash } from './journalEventMatch.js';
import { resolveSlateGame, eventReference, scopedEventKey } from './slateEventIdentity.js';
import { finalResultKey } from './finalResultIdentity.js';
import { frozenFinalForecast, mergeFinalReplies } from './finalResultRevision.js';

const omit = (row, fields) => Object.fromEntries(Object.entries(row).filter(([key]) => !fields.includes(key)));
const signature = (rows, fields = []) => rows.map(row => eventObservationHash(omit(row, fields))).sort().join('|');
const forecast = row => eventObservationHash(omit(frozenFinalForecast(row), ['valueAnalysis']));

function groups(rows, index) {
  const result = new Map();
  for (const row of rows ?? []) {
    const game = resolveSlateGame(index, row).game;
    if (!game) continue;
    const key = scopedEventKey(eventReference(game));
    if (!result.has(key)) result.set(key, []);
    result.get(key).push(row);
  }
  return result;
}

function replaceGroups(rows, index, replacements) {
  const used = new Set();
  return (rows ?? []).flatMap(row => {
    const game = resolveSlateGame(index, row).game;
    const key = game && scopedEventKey(eventReference(game));
    if (!replacements.has(key)) return [row];
    if (used.has(key)) return [];
    used.add(key);
    return replacements.get(key);
  });
}

/** Three-way merge against the exact input of the source request, never a new forecast. */
export function mergeFinalCache(current, base, refreshed, delivery) {
  for (const slate of [current, refreshed]) {
    if (slate.dateKey !== base.dateKey || String(slate.guildId || '') !== String(base.guildId || '')) throw new Error('Final cache scope mismatch.');
  }
  const index = journalGameIndex(base.games ?? []);
  const bg = groups(base.games, index), bp = groups(base.predictions, index);
  const cg = groups(current.games, index), cp = groups(current.predictions, index);
  const rg = groups(refreshed.games, index), rp = groups(refreshed.predictions, index);
  const games = new Map(), predictions = new Map(), acceptedReplies = new Set(), rejected = [];
  for (const [key, originals] of bp) {
    const before = bg.get(key) ?? [], latest = cg.get(key) ?? [], source = rg.get(key) ?? [];
    const latestPredictions = cp.get(key) ?? [], sourcePredictions = rp.get(key) ?? [];
    let replyKey;
    try { replyKey = finalResultKey(base, originals[0]); } catch {}
    const priorReply = current.finalReplies?.[replyKey], incomingReply = delivery.finalReplies?.[replyKey];
    const replyChanged = priorReply && eventObservationHash(priorReply) !== eventObservationHash(base.finalReplies?.[replyKey] ?? null);
    let reason;
    if (before.length !== 1 || latest.length !== 1 || !source.length) reason = 'event_missing_or_ambiguous';
    else if (signature(before, ['odds']) !== signature(latest, ['odds'])) reason = 'event_changed_during_refresh';
    else if (signature(originals, ['valueAnalysis']) !== signature(latestPredictions, ['valueAnalysis'])) reason = 'forecast_or_grade_changed_during_refresh';
    else if (!sourcePredictions.length || new Set(originals.map(forecast)).size !== 1 || signature(originals.map(row => ({ identity: forecast(row) }))) !== signature(sourcePredictions.map(row => ({ identity: forecast(row) })))) reason = 'refreshed_forecast_changed';
    else if (replyChanged && (!incomingReply || !Number.isSafeInteger(priorReply.claimGeneration) || !Number.isSafeInteger(incomingReply.claimGeneration)
      || priorReply.claimGeneration > incomingReply.claimGeneration || (priorReply.claimGeneration === incomingReply.claimGeneration && priorReply.resultDigest !== incomingReply.resultDigest))) reason = 'delivery_acknowledgement_changed_during_refresh';
    else if (incomingReply?.frozenForecast && forecast(incomingReply.frozenForecast) !== forecast(originals[0])) reason = 'delivery_forecast_mismatch';
    else if (source.some(game => game.away?.name !== before[0].away?.name || game.home?.name !== before[0].home?.name)) reason = 'source_participants_changed';
    if (reason) { rejected.push({ eventKey: key, reason }); continue; }
    games.set(key, source.map(game => ({ ...game, odds: latest[0].odds })));
    predictions.set(key, sourcePredictions.map(row => ({ ...row, valueAnalysis: latestPredictions[0]?.valueAnalysis })));
    try { acceptedReplies.add(finalResultKey(base, originals[0])); } catch {}
  }
  const replies = Object.fromEntries(Object.entries(delivery.finalReplies ?? {}).filter(([key]) => acceptedReplies.has(key)));
  const failures = [
    ...(current.finalDeliveryFailures ?? []).filter(row => !acceptedReplies.has(row.eventKey)),
    ...(delivery.failures ?? [])
  ];
  return {
    ...current,
    games: replaceGroups(current.games, index, games),
    predictions: replaceGroups(current.predictions, index, predictions),
    finalReplies: mergeFinalReplies(current.finalReplies, replies),
    finalDeliveryFailures: [...new Map(failures.map(row => [eventObservationHash(row), row])).values()],
    recoveredFinalAcknowledgements: delivery.recoveredCount,
    acknowledgedFinalCorrections: delivery.correctedCount,
    ...(rejected.length ? {} : { lastFinalCorrectionCheckAt: refreshed.refreshedAt }),
    finalCacheMergeAudit: { sourceRevision: base.cacheRevision ?? 0, targetRevision: current.cacheRevision ?? 0,
      observedAt: refreshed.refreshedAt, appliedEvents: games.size, rejected,
      associationRejections: refreshed.finalAssociationRejections ?? [], manualResultAudit: refreshed.manualResultAudit ?? [],
      diagnostics: refreshed.diagnostics ?? [] },
    newFinals: []
  };
}

export async function persistFinalRefresh(base, refreshed, delivery, { read = readDailyCache, write = writeDailyCache, attempts = 3 } = {}) {
  base = structuredClone(base); refreshed = structuredClone(refreshed); delivery = structuredClone(delivery);
  if (!Number.isSafeInteger(attempts) || attempts < 1 || attempts > 5) throw new Error('Invalid final cache retry bound.');
  for (let attempt = 0; attempt < attempts; attempt++) {
    const current = await read(base.dateKey, base.guildId);
    if (!current) throw new Error('Final cache disappeared; preserve evidence and reload.');
    const proposal = mergeFinalCache(current, base, refreshed, delivery);
    try { return await write(base.dateKey, proposal, base.guildId); }
    catch (error) { if (error.code !== 'DAILY_CACHE_CONFLICT' || attempt + 1 === attempts) throw error; }
  }
}
