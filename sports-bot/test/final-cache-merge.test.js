import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mergeFinalCache, persistFinalRefresh } from '../src/finalCacheMerge.js';
import { readDailyCache, writeDailyCache, dailyCachePath } from '../src/storage.js';
import { finalResultKey } from '../src/finalResultIdentity.js';
import { deliverFinalBatch } from '../src/finalDelivery.js';
import { postFinalResult } from '../src/discordPublisher.js';
import { fakeDiscord } from '../test-support/discord-transport.mjs';

const date = '2026-10-20', guild = 'transport';
test.beforeEach(async () => { await unlink(dailyCachePath(date, guild)).catch(error => { if (error.code !== 'ENOENT') throw error; }); });
function fixture() {
  const id = randomUUID(), startTime = '2026-10-20T19:00:00Z', observed = new Date(Date.now() - 2000).toISOString();
  const game = { id, leagueKey: 'nba', league: 'NBA', startTime, statusKey: 'scheduled', away: { name: 'Away', abbr: 'AW' }, home: { name: 'Home', abbr: 'HM' }, odds: { fetchedAt: 'old' } };
  const prediction = { gameId: id, index: 1, leagueKey: 'nba', league: 'NBA', startTime, startTimeLocal: '2:00 PM', matchup: 'Away @ Home',
    predictionMode: 'pregame', modelVersion: 'fixture', evidenceQuality: '60%', predictionConfidence: '65%', predictionGeneratedAt: '2026-10-20T18:00:00Z', predictedSide: 'home', predictedWinner: 'Home',
    outcomeProbabilities: { away: 35, home: 65, draw: 0 }, valueAnalysis: { quote: 'old' } };
  const base = { guildId: guild, dateKey: date, games: [game], predictions: [prediction], finalReplies: {}, cacheRevision: 1 };
  const refreshed = structuredClone(base);
  Object.assign(refreshed.games[0], { statusKey: 'final', sourceMeta: { cacheState: 'network', fetchedAt: observed } });
  refreshed.games[0].away.score = 1; refreshed.games[0].home.score = 2;
  Object.assign(refreshed.predictions[0], { actualSide: 'home', actualWinner: 'Home', predictionCorrect: true, finalScore: 'AW 1 - HM 2', resultObservedAt: observed });
  refreshed.refreshedAt = observed; refreshed.newFinals = [{ game: refreshed.games[0], prediction: refreshed.predictions[0] }];
  return { base, refreshed, delivery: { finalReplies: {}, failures: [], recoveredCount: 0, correctedCount: 0 } };
}

test('a quote-only revision no longer prevents completed results from reaching the cache', async () => {
  const { base, refreshed, delivery } = fixture();
  await writeDailyCache(date, base, guild, { expectedRevision: 0 });
  const latest = structuredClone(base); latest.games[0].odds = { fetchedAt: 'new', price: 2.1 }; latest.predictions[0].valueAnalysis = { quote: 'new' };
  await writeDailyCache(date, latest, guild);
  // The preceding scheduler rejected this entire result after a harmless quote update.
  await assert.rejects(writeDailyCache(date, refreshed, guild, { expectedRevision: base.cacheRevision }), { code: 'DAILY_CACHE_CONFLICT' });
  const saved = await persistFinalRefresh(base, refreshed, delivery);
  assert.equal(saved.predictions[0].predictionCorrect, true);
  assert.deepEqual(saved.predictions[0].outcomeProbabilities, base.predictions[0].outcomeProbabilities);
  assert.deepEqual(saved.games[0].odds, latest.games[0].odds);
  assert.deepEqual(saved.predictions[0].valueAnalysis, latest.predictions[0].valueAnalysis);
  assert.equal(saved.finalCacheMergeAudit.appliedEvents, 1);
});

test('a changed frozen forecast remains untouched and is explicitly rejected', () => {
  const { base, refreshed, delivery } = fixture(), latest = structuredClone(base);
  latest.predictions[0].outcomeProbabilities.home = 80;
  const saved = mergeFinalCache(latest, base, refreshed, delivery);
  assert.deepEqual(saved.predictions, latest.predictions); assert.deepEqual(saved.games, latest.games);
  assert.equal(saved.finalCacheMergeAudit.rejected[0].reason, 'forecast_or_grade_changed_during_refresh');
  assert.equal(saved.lastFinalCorrectionCheckAt, undefined);
});

test('a newer final or a newer acknowledgement cannot be replaced by an older result', () => {
  const { base, refreshed, delivery } = fixture(), latest = structuredClone(base);
  latest.games[0].statusKey = 'final'; latest.games[0].away.score = 4;
  assert.equal(mergeFinalCache(latest, base, refreshed, delivery).finalCacheMergeAudit.rejected[0].reason, 'event_changed_during_refresh');
  const next = structuredClone(base), key = finalResultKey(base, base.predictions[0]);
  next.finalReplies[key] = { claimGeneration: 5, resultDigest: 'new' };
  delivery.finalReplies[key] = { claimGeneration: 3, resultDigest: 'old' };
  const saved = mergeFinalCache(next, base, refreshed, delivery);
  assert.deepEqual(saved.games, next.games); assert.deepEqual(saved.finalReplies, next.finalReplies);
  assert.equal(saved.finalCacheMergeAudit.rejected[0].reason, 'delivery_acknowledgement_changed_during_refresh');
});

test('unrelated added events and another league sharing the native ID survive reconciliation', () => {
  const { base, refreshed, delivery } = fixture(), latest = structuredClone(base);
  latest.games.push({ ...structuredClone(base.games[0]), leagueKey: 'nhl' });
  latest.predictions.push({ ...structuredClone(base.predictions[0]), leagueKey: 'nhl', predictedWinner: 'Other league' });
  latest.pregameRefreshDeliveryPending = true; latest.messageId = 'new-message';
  const saved = mergeFinalCache(latest, base, refreshed, delivery);
  assert.deepEqual(saved.games[1], latest.games[1]); assert.deepEqual(saved.predictions[1], latest.predictions[1]);
  assert.equal(saved.predictions[0].predictionCorrect, true); assert.equal(saved.messageId, 'new-message');
  assert.equal(saved.pregameRefreshDeliveryPending, true);
});

test('conflicting source finals remain conflicting and clear the grade rather than picking a score', () => {
  const { base, refreshed, delivery } = fixture();
  refreshed.games.push({ ...structuredClone(refreshed.games[0]), home: { name: 'Home', abbr: 'HM', score: 8 } });
  Object.assign(refreshed.predictions[0], { predictionCorrect: null, actualSide: '', actualWinner: '', finalScore: '' });
  refreshed.finalAssociationRejections = [{ reason: 'ambiguous_game_observations' }];
  const saved = mergeFinalCache(base, base, refreshed, delivery);
  assert.equal(saved.games.length, 2); assert.equal(saved.predictions[0].predictionCorrect, null);
  assert.equal(saved.finalCacheMergeAudit.associationRejections[0].reason, 'ambiguous_game_observations');
});

test('a race during persistence retries the merge with the original frozen inputs', async () => {
  const { base, refreshed, delivery } = fixture(); await writeDailyCache(date, base, guild, { expectedRevision: 0 });
  let writes = 0;
  const saved = await persistFinalRefresh(base, refreshed, delivery, { write: async (...args) => {
    if (++writes === 1) {
      const current = await readDailyCache(date, guild); current.messageId = 'concurrent-message';
      await writeDailyCache(date, current, guild);
    }
    return writeDailyCache(...args);
  } });
  assert.equal(writes, 2); assert.equal(saved.messageId, 'concurrent-message');
  assert.equal(saved.predictions[0].predictionCorrect, true);
});

test('retries are bounded and other storage failures are never retried', async () => {
  const { base, refreshed, delivery } = fixture(); let writes = 0;
  const options = { read: async () => base, write: async () => { writes++; throw Object.assign(new Error('race'), { code: 'DAILY_CACHE_CONFLICT' }); } };
  await assert.rejects(persistFinalRefresh(base, refreshed, delivery, options), { code: 'DAILY_CACHE_CONFLICT' }); assert.equal(writes, 3);
  writes = 0; options.write = async () => { writes++; throw new Error('disk unavailable'); };
  await assert.rejects(persistFinalRefresh(base, refreshed, delivery, options), /disk unavailable/); assert.equal(writes, 1);
});

test('caller mutation during a read cannot change frozen source grades', async () => {
  const { base, refreshed, delivery } = fixture(); let release;
  const gate = new Promise(resolve => { release = resolve; });
  const pending = persistFinalRefresh(base, refreshed, delivery, { read: async () => { await gate; return structuredClone(base); }, write: async (date, value) => value });
  refreshed.predictions[0].outcomeProbabilities.home = 99; refreshed.games[0].home.score = 99; release();
  const saved = await pending; assert.equal(saved.games[0].home.score, 2); assert.equal(saved.predictions[0].outcomeProbabilities.home, 65);
});

test('foreign scopes and changed source forecasts cannot be merged', () => {
  const { base, refreshed, delivery } = fixture();
  assert.throws(() => mergeFinalCache({ ...base, guildId: 'other' }, base, refreshed, delivery), /scope/);
  assert.throws(() => mergeFinalCache(base, base, { ...refreshed, dateKey: '2026-10-21' }, delivery), /scope/);
  refreshed.predictions[0].predictedSide = 'away';
  assert.equal(mergeFinalCache(base, base, refreshed, delivery).finalCacheMergeAudit.rejected[0].reason, 'refreshed_forecast_changed');
});

test('one changed event cannot prevent an independent unchanged event from being graded', () => {
  const { base, refreshed, delivery } = fixture(), second = randomUUID();
  base.games.push({ ...structuredClone(base.games[0]), id: second });
  base.predictions.push({ ...structuredClone(base.predictions[0]), gameId: second });
  refreshed.games.push({ ...structuredClone(refreshed.games[0]), id: second });
  refreshed.predictions.push({ ...structuredClone(refreshed.predictions[0]), gameId: second });
  const latest = structuredClone(base); latest.predictions[0].modelVersion = 'new-forecast';
  const saved = mergeFinalCache(latest, base, refreshed, delivery);
  assert.equal(saved.predictions[0].predictionCorrect, undefined);
  assert.equal(saved.predictions[0].modelVersion, 'new-forecast');
  assert.equal(saved.predictions[1].predictionCorrect, true);
  assert.equal(saved.finalCacheMergeAudit.appliedEvents, 1);
  assert.equal(saved.finalCacheMergeAudit.rejected.length, 1);
  assert.equal(saved.lastFinalCorrectionCheckAt, undefined);
});

test('actual final delivery and claim acknowledgement persist across a concurrent quote update', async t => {
  const { base, refreshed } = fixture(); await writeDailyCache(date, base, guild, { expectedRevision: 0 });
  const directory = await mkdtemp(join(tmpdir(), 'sports-final-cache-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const remote = await fakeDiscord(directory); let postError;
  const delivery = await deliverFinalBatch(remote.client, refreshed, { post: async (...args) => {
    let message; try { message = await postFinalResult(...args); } catch (error) { postError = error; throw error; }
    const latest = await readDailyCache(date, guild);
    latest.games[0].odds = { quote: 'concurrent' }; await writeDailyCache(date, latest, guild);
    return message;
  } });
  assert.ifError(postError); assert.equal(delivery.postedCount, 1); assert.equal(delivery.failures.length, 0);
  const saved = await persistFinalRefresh(base, refreshed, delivery), key = finalResultKey(base, base.predictions[0]);
  assert.equal(saved.finalReplies[key].messageId, remote.rows[0].id);
  assert.equal(saved.predictions[0].predictionCorrect, true); assert.equal(saved.games[0].odds.quote, 'concurrent');
  assert.deepEqual(saved.finalReplies[key].frozenForecast.outcomeProbabilities, base.predictions[0].outcomeProbabilities);
});
