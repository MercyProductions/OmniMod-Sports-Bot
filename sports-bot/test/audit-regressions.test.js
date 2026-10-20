import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cachedFetchJson } from '../src/providerCache.js';
import { collectGradedRows } from '../src/modelEvaluation.js';
import { recordSlateSnapshot, warehouseFile } from '../src/featureWarehouse.js';
import { nextPregameRefresh } from '../src/pregameRefresh.js';
import { evaluateCandidateModels } from '../src/modelRegistry.js';

test('future-dated provider cache is neither fresh nor usable as stale fallback', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'sports-future-cache-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const options = { namespace: 'audit', cacheDir: directory, ttlMs: 60_000, staleMs: 120_000,
    fetch: async () => new Response(JSON.stringify({ source: 'first' })) };
  await cachedFetchJson('https://provider.example/games', options);
  const file = join(directory, 'provider-cache', (await readdir(join(directory, 'provider-cache')))[0]);
  const entry = JSON.parse(await readFile(file, 'utf8'));
  entry.fetchedAt = new Date(Date.now() + 3_600_000).toISOString();
  await writeFile(file, JSON.stringify(entry));
  const result = await cachedFetchJson('https://provider.example/games', { ...options, offline: true });
  assert.equal(result.ok, false);
  assert.equal(result.cacheState, 'miss');
});

test('graded rows reject unknown prediction/start timestamps', () => {
  const prediction = { gameId: 'unknown-time', modelVersion: 'OmniMod Evidence Ensemble v6.0.0',
    predictionMode: 'pregame', predictionCorrect: true, predictionProbability: 0.65 };
  assert.equal(collectGradedRows([{ dateKey: '2026-10-01', slate: { predictions: [prediction] } }]).length, 0);
});

test('overdue pregame windows remain schedulable after restart', () => {
  const now = new Date('2026-10-20T18:40:00Z');
  const slate = { games: [{ id: 'retry', statusKey: 'scheduled', startTime: '2026-10-20T19:00:00Z' }] };
  const next = nextPregameRefresh(slate, now);
  assert.equal(next?.dueAtMs, now.getTime());
  assert.equal(next?.overdue, true);
});

test('candidate evaluation counts one game once even when replay and production rows overlap', () => {
  const base = { gameId: 'same-game', dateKey: '2026-10-01', sport: 'basketball', actualSide: 'home',
    candidateProbabilities: { evidence: { away: 0.4, home: 0.6, draw: 0 }, hybrid: { away: 0.3, home: 0.7, draw: 0 } } };
  const result = evaluateCandidateModels([{ ...base, source: 'historical-replay' }, { ...base, source: 'frozen-production' }]);
  assert.equal(result.comparisons.hybrid.sampleSize, 1);
});

test('candidate evaluation rejects malformed probabilities rather than scoring zero-filled vectors', () => {
  const result = evaluateCandidateModels([{ actualSide: 'home', candidateProbabilities: {
    evidence: { home: 0.6, away: 0.4 }, hybrid: { home: true, away: 0.4 } } }]);
  assert.equal(result.comparisons.hybrid.sampleSize, 0);
});

test('warehouse retains model identity and does not overwrite issued probabilities or input evidence', async () => {
  const now = Date.now(), generatedAt = new Date(now - 1000).toISOString();
  const game = { id: 'immutable-audit', leagueKey: 'nba', startTime: new Date(now + 3_600_000).toISOString(), statusKey: 'scheduled',
    away: { name: 'Away', score: 0 }, home: { name: 'Home', score: 0 }, autoEnrichment: { fetchedAt: generatedAt, cacheState: 'network' } };
  const prediction = { gameId: game.id, modelVersion: 'OmniMod Evidence Ensemble v6.0.0', startTime: game.startTime,
    predictionGeneratedAt: generatedAt, predictionMode: 'pregame', predictedSide: 'home', predictionProbability: 0.65,
    outcomeProbabilities: { home: 65, away: 35, draw: 0 }, factors: [{ label: 'Elo', present: true, value: 0.4 }] };
  const slate = { guildId: 'audit', dateKey: '2026-10-20', generatedAt, games: [game], predictions: [prediction] };
  await recordSlateSnapshot(slate);
  await recordSlateSnapshot({ ...slate, predictions: [{ ...prediction, outcomeProbabilities: { home: 90, away: 10, draw: 0 },
    factors: [{ label: 'Elo', present: true, value: 2 }] }], games: [{ ...game, autoEnrichment: { fetchedAt: new Date(now).toISOString() } }] });
  const warehouse = JSON.parse(await readFile(warehouseFile, 'utf8'));
  const issued = warehouse.predictions.find(row => row.gameId === game.id);
  assert.equal(issued.modelVersion, prediction.modelVersion);
  assert.equal(issued.outcomeProbabilities.home, 65);
  assert.equal(issued.featureContributions[0].value, 0.4);
});
