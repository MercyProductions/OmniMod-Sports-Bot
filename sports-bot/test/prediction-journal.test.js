import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { recordPredictionJournal, readPredictionJournal } from '../src/predictionJournal.js';
import { completePregameRefreshAttempt, duePregameRefreshes } from '../src/pregameRefresh.js';
import { selectCandidateCohort } from '../src/candidateCohorts.js';
import { evaluateCandidateModels, applyCandidateDecision } from '../src/modelRegistry.js';
import { summarizePredictionJournal } from '../src/journalEvaluation.js';

const now = Date.parse('2026-10-20T18:00:00Z');
const time = offset => new Date(now + offset).toISOString();
function slate() {
  return { guildId: 'fixture', dateKey: '2026-10-20', generatedAt: time(-1000),
    games: [{ id: 'game', leagueKey: 'nba', statusKey: 'scheduled', startTime: time(3_600_000),
      away: { name: 'Away', score: 0 }, home: { name: 'Home', score: 0 },
      sourceMeta: { fetchedAt: time(-2000), cacheState: 'network' },
      autoEnrichment: { fetchedAt: time(-1000), cacheState: 'network' },
      odds: { provider: 'fixture', h2h: { rules: 'full_game_including_overtime', home: { price: -110, bookmaker: 'Example', lastUpdate: time(-2000), timestampSource: 'provider_update' } } } }],
    predictions: [{ gameId: 'game', modelVersion: 'OmniMod Evidence Ensemble v6.0.1', startTime: time(3_600_000),
      predictionGeneratedAt: time(-1000), predictionMode: 'pregame', predictedSide: 'home', predictionProbability: 0.65,
      outcomeProbabilities: { home: 65, away: 35, draw: 0 }, snapshotStage: 'daily', recommendationStatus: 'withheld' }] };
}
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'sports-journal-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return join(directory, 'predictions.jsonl');
}

test('journal freezes every pregame forecast including withheld rows, odds and original source timestamps', async t => {
  const file = await fixture(t), first = slate();
  await recordPredictionJournal(first, { file, now });
  const changed = structuredClone(first);
  changed.predictions[0].outcomeProbabilities.home = 90;
  changed.predictions[0].outcomeProbabilities.away = 10;
  changed.games[0].odds.h2h.home.price = -500;
  await recordPredictionJournal(changed, { file, now: now + 1000 });
  const rows = await readPredictionJournal(file);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].type, 'forecast');
  assert.equal(rows[0].payload.outcomePercentages.home, 65);
  assert.equal(rows[0].payload.recommendationStatus, 'withheld');
  assert.equal(rows[0].payload.odds.outcomes.home.offeredQuotes[0].priceAmerican, -110);
  assert.equal(rows[0].payload.dataTimestamps.schedule.fetchedAt, time(-2000));
});

test('results and later score corrections append without changing the forecast', async t => {
  const file = await fixture(t), value = slate();
  await recordPredictionJournal(value, { file, now });
  const final = structuredClone(value);
  final.games[0].statusKey = 'final'; final.games[0].home.score = 110; final.games[0].away.score = 100;
  await recordPredictionJournal(final, { file, now: now + 4 * 3_600_000 });
  await recordPredictionJournal(final, { file, now: now + 4 * 3_600_000 + 1000 });
  final.games[0].away.score = 120;
  await recordPredictionJournal(final, { file, now: now + 5 * 3_600_000 });
  const rows = await readPredictionJournal(file);
  assert.deepEqual(rows.map(row => row.type), ['forecast', 'result', 'result']);
  assert.equal(rows[1].payload.correct, true);
  assert.equal(rows[2].payload.correct, false);
  assert.equal(rows[2].payload.revision, 2);
  assert.equal(rows[0].payload.outcomePercentages.home, 65);
});

test('a final resolves all previously journaled horizons even when the slate only retains its newest forecast', async t => {
  const file = await fixture(t), first = slate();
  first.predictions[0].snapshotStage = 't-90';
  await recordPredictionJournal(first, { file, now });
  const later = slate(); later.predictions[0].snapshotStage = 't-10';
  later.predictions[0].predictionGeneratedAt = time(2_000_000);
  await recordPredictionJournal(later, { file, now: now + 2_000_000 });
  later.games[0].statusKey = 'final'; later.games[0].home.score = 100; later.games[0].away.score = 90;
  await recordPredictionJournal(later, { file, now: now + 4 * 3_600_000 });
  const rows = await readPredictionJournal(file);
  assert.equal(rows.filter(row => row.type === 'forecast').length, 2);
  assert.equal(rows.filter(row => row.type === 'result').length, 2);
});

test('unavailable odds remain unavailable and late imports never become prospective forecasts', async t => {
  const file = await fixture(t), value = slate(); delete value.games[0].odds;
  await recordPredictionJournal(value, { file, now });
  value.predictions[0].gameId = 'late'; value.games[0].id = 'late';
  await recordPredictionJournal(value, { file, now: now + 4 * 3_600_000 });
  const rows = await readPredictionJournal(file);
  assert.equal(rows[0].payload.odds.status, 'unavailable');
  assert.equal(rows[1].type, 'unverifiable_observation');
  assert.equal(rows[1].payload.recordEligibility, 'unverifiable_or_late_observation');
});

test('journal rejects edited or torn records without overwriting them', async t => {
  const file = await fixture(t);
  await recordPredictionJournal(slate(), { file, now });
  const text = await readFile(file, 'utf8');
  await writeFile(file, text.replace('"home":65', '"home":66'));
  await assert.rejects(recordPredictionJournal(slate(), { file, now }), /integrity/);
  assert.equal(await readFile(file, 'utf8'), text.replace('"home":65', '"home":66'));
  await writeFile(file, text.trimEnd());
  await assert.rejects(recordPredictionJournal(slate(), { file, now }), /incomplete final line/);
});

test('existing owner lock is preserved and concurrent calls do not duplicate a forecast', async t => {
  const file = await fixture(t);
  await writeFile(`${file}.lock`, 'active-owner');
  await assert.rejects(recordPredictionJournal(slate(), { file, now }), /locked/);
  assert.equal(await readFile(`${file}.lock`, 'utf8'), 'active-owner');
  await rm(`${file}.lock`);
  await Promise.all([recordPredictionJournal(slate(), { file, now }), recordPredictionJournal(slate(), { file, now })]);
  assert.equal((await readPredictionJournal(file)).length, 1);
});

test('pregame completion preserves earlier windows and retries stale or failed evidence', () => {
  const previous = slate();
  previous.pregameRefreshes = { game: { windows: { 90: time(-100_000) } } };
  const due = [{ gameId: 'game', dueWindows: [30], stage: 't-30' }];
  const rebuilt = slate();
  rebuilt.games[0].autoEnrichment.fetchedAt = time(500);
  rebuilt.predictions[0].predictionGeneratedAt = time(700);
  const success = completePregameRefreshAttempt(previous, rebuilt, due, time(0), time(1000));
  assert.equal(success.completed.length, 1);
  assert.ok(success.slate.pregameRefreshes.game.windows[90]);
  assert.ok(success.slate.pregameRefreshes.game.windows[30]);
  assert.equal(success.slate.pregameRefreshDeliveryPending, true);
  rebuilt.games[0].autoEnrichment.cacheState = 'stale';
  const failed = completePregameRefreshAttempt(previous, rebuilt, due, time(0), time(1000));
  assert.equal(failed.completed.length, 0);
  assert.equal(failed.slate.pregameRefreshes.game.windows[30], undefined);
  assert.deepEqual(failed.slate.predictions, previous.predictions);
  assert.equal(failed.slate.pregameRefreshDeliveryPending, false);
});

test('new model and horizon cohorts are not pooled with older or replay forecasts', () => {
  const base = { gameId: 'g', dateKey: '2026-10-01', sport: 'basketball', actualSide: 'home',
    source: 'frozen-production', modelVersion: 'v6.0.1', snapshotStage: 't-30',
    candidateProbabilities: { evidence: { home: 0.6, away: 0.4 }, hybrid: { home: 0.7, away: 0.3 } } };
  const selected = selectCandidateCohort([base, { ...base, modelVersion: 'v5' }, { ...base, source: 'historical-replay' }]);
  assert.equal(selected.rows.length, 1);
  assert.equal(selected.cohort.excludedOtherCohorts, 2);
  assert.equal(selected.cohort.prospectiveRecordsVerified, false);
});

test('production promotion cannot rely on unverified historical provenance', () => {
  const evaluation = { bestChallenger: 'hybrid', comparisons: { hybrid: { sampleSize: 100, brierImprovement: 0.04, logLossImprovement: 0.03 } },
    cohort: { prospectiveRecordsVerified: false } };
  const result = applyCandidateDecision({}, 'basketball', evaluation, evaluation, { minimum: 75, requireProspectiveRecords: true });
  assert.equal(result.entry.champion, 'evidence');
  assert.equal(result.entry.status, 'research_only_provenance_unverified');
});

test('audit summary separates unresolved rows and scores each version on matched reference populations', async t => {
  const file = await fixture(t), value = slate();
  value.predictions[0].referenceBaselines = { elo: { probabilities: { away: 0.5, home: 0.5, draw: 0 } } };
  await recordPredictionJournal(value, { file, now });
  let summary = summarizePredictionJournal(await readPredictionJournal(file));
  assert.equal(summary.gradedForecasts, 0);
  value.games[0].statusKey = 'final'; value.games[0].home.score = 100; value.games[0].away.score = 90;
  await recordPredictionJournal(value, { file, now: now + 4 * 3_600_000 });
  summary = summarizePredictionJournal(await readPredictionJournal(file));
  const version = summary.byVersion['OmniMod Evidence Ensemble v6.0.1'];
  assert.equal(version.graded, 1);
  assert.equal(version.outcomes.overall.accuracy, 1);
  assert.equal(version.outcomes.byHorizon['T-90'].sampleSize, 1);
  assert.equal(version.outcomes.byHorizon.Daily, undefined);
  assert.equal(version.referenceComparisons.elo.primaryOnMatchedGames.overall.sampleSize, 1);
  assert.equal(version.referenceComparisons.elo.referenceOnMatchedGames.overall.sampleSize, 1);
  assert.equal(version.referenceComparisons.market.referenceOnMatchedGames.overall.sampleSize, 0);
});
