import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const testDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'omnimod-sports-accuracy-'));
process.env.OMNIMOD_SPORTS_DATA_DIR = testDataDir;
const { americanToProbability, finalOutcomeSide } = await import('../src/dataValidation.js');
const { attachFinalGrade, bestH2HMarket, bestSpreadTotalMarkets, matchingOddsEvent, parseEspnEvent, parseStatus, scoreboardEventsFromCdn } = await import('../src/sportsData.js');

test('multi-league soccer CDN events cannot be mislabeled as another league', () => {
  const payload = { content: { sbData: { scores: [
    { events: [{ id: 'epl', leagueId: 'eng.1' }, { id: 'a-league', leagueId: 'aus.1' }] },
    { events: [{ id: 'unknown' }] }
  ] } } };
  assert.deepEqual(scoreboardEventsFromCdn(payload, { sport: 'soccer', league: 'eng.1' }).map((event) => event.id), ['epl']);
  assert.deepEqual(scoreboardEventsFromCdn(payload, { sport: 'soccer', league: 'esp.1' }), []);
});
const { buildCalibrationModel, buildEloRatings, collectGradedRows, loadModelContext, lookupElo } = await import('../src/modelEvaluation.js');
const { evaluatePredictionHorizons, predictionHorizon } = await import('../src/horizonEvaluation.js');
const { predictGame } = await import('../src/predictionEngine.js');
const { readFeatureWarehouse, recordSlateSnapshot, warehouseFile } = await import('../src/featureWarehouse.js');
const { dailyCachePath, readDailyCache } = await import('../src/storage.js');
const { addWatch } = await import('../src/watchStore.js');

function game(overrides = {}) {
  return {
    id: 'game', league: 'NBA', leagueKey: 'nba', sportGroup: 'Basketball',
    startTime: '2099-01-02T19:00:00Z', statusKey: 'scheduled',
    away: { name: 'Away Team', abbr: 'AWY', score: null },
    home: { name: 'Home Team', abbr: 'HOM', score: null },
    ...overrides
  };
}

function book(key, prices, lastUpdate = new Date().toISOString()) {
  return { key, title: key, last_update: lastUpdate, markets: [{ key: 'h2h', outcomes: prices.map(([name, price]) => ({ name, price })) }] };
}

test('American odds reject missing, malformed and decimal-format prices', () => {
  for (const invalid of [null, undefined, '', ' ', false, 0, 1.91, -90, '110oops']) assert.equal(americanToProbability(invalid), null);
  assert.equal(americanToProbability('+100'), 0.5);
  assert.equal(americanToProbability(-200), 2 / 3);
});

test('unknown final scores never settle as zero or a draw; true zero remains valid', () => {
  const prediction = { predictedSide: 'draw', predictionMode: 'pregame', predictionCorrect: null };
  for (const missing of [null, undefined, '', ' ', 'bad', false, -1]) {
    const invalid = game({ statusKey: 'final', away: { score: missing }, home: { score: 0 } });
    assert.equal(attachFinalGrade(invalid, prediction).predictionCorrect, null);
    assert.equal(finalOutcomeSide(invalid), '');
  }
  assert.equal(attachFinalGrade(game({ statusKey: 'final', away: { score: 0 }, home: { score: 0 } }), prediction).predictionCorrect, true);
});

test('cancelled or suspended completed statuses cannot masquerade as finals', () => {
  for (const name of ['STATUS_CANCELED', 'STATUS_POSTPONED', 'STATUS_SUSPENDED']) {
    assert.equal(parseStatus({ type: { name, completed: true, state: 'post' } }).key, 'alert');
  }
  const parsed = parseEspnEvent({ id: 'missing', date: '2099-01-02T19:00:00Z', status: { type: { completed: true } }, competitions: [{ competitors: [{ homeAway: 'away', team: { displayName: 'A' } }, { homeAway: 'home', team: { displayName: 'B' } }] }] }, { key: 'nba', label: 'NBA', group: 'Basketball' });
  assert.equal(parsed.away.score, null);
  assert.equal(finalOutcomeSide(parsed), '');
});

test('combat uses explicit winner flags and soccer extra-time finals remain ungraded', () => {
  assert.equal(finalOutcomeSide(game({ statusKey: 'final', sportGroup: 'Combat', away: { score: null, winner: true }, home: { score: null, winner: false } })), 'away');
  assert.equal(finalOutcomeSide(game({ statusKey: 'final', sportGroup: 'Soccer', detail: 'Final/PEN', away: { score: 1 }, home: { score: 2 } })), '');
});

test('odds matching respects event time and refuses ambiguous duplicate games', () => {
  const event = (id, commence_time) => ({ id, commence_time, away_team: 'Away Team', home_team: 'Home Team' });
  const right = event('right', '2099-01-02T19:05:00Z');
  assert.equal(matchingOddsEvent(game(), [event('tomorrow', '2099-01-03T19:00:00Z'), event('early', '2099-01-02T14:00:00Z'), right]).id, 'right');
  assert.equal(matchingOddsEvent(game(), [event('one', game().startTime), event('two', game().startTime)]), null);
  assert.equal(matchingOddsEvent(game({ startTime: '' }), [right]), null);
});

test('soccer consensus excludes incomplete books, duplicates and normalizes median probabilities', () => {
  const complete = book('complete', [['Away Team', 200], ['Home Team', 100], ['Draw', 300]]);
  const incomplete = book('incomplete', [['Away Team', -900], ['Home Team', 600]]);
  const soccer = game({ sportGroup: 'Soccer', leagueKey: 'epl' });
  const actual = bestH2HMarket([incomplete, complete, complete], soccer);
  const expected = bestH2HMarket([complete], soccer);
  assert.equal(actual.bookmakerCount, 1);
  assert.equal(actual.home.fairProbability, expected.home.fairProbability);
  const varied = bestH2HMarket([complete, book('second', [['Away Team', 130], ['Home Team', 160], ['Draw', 230]]), book('third', [['Away Team', 160], ['Home Team', 220], ['Draw', 140]])], soccer);
  assert.ok(Math.abs(varied.away.fairProbability + varied.home.fairProbability + varied.draw.fairProbability - 1) < 1e-12);
  assert.equal(bestH2HMarket([complete], game()).bookmakerCount, 0);
});

test('spread lines retain an actual offered price and point combination', () => {
  const books = [{ key: 'a', title: 'A', markets: [{ key: 'spreads', outcomes: [{ name: 'Home Team', point: -3, price: -110 }] }] }, { key: 'b', title: 'B', markets: [{ key: 'spreads', outcomes: [{ name: 'Home Team', point: -5, price: -120 }] }] }];
  const quote = bestSpreadTotalMarkets(books, game()).spread.home;
  assert.equal(quote.point, -3);
  assert.equal(quote.price, -110);
  assert.equal(quote.bookmaker, 'A');
});

test('missing Elo and malformed results cannot corrupt learned ratings', () => {
  const ratings = buildEloRatings({ teams: { home: { league: 'NBA', name: 'Home Team', elo: null } }, results: { invalid: { league: 'NBA', awayTeam: 'Away Team', homeTeam: 'Home Team', awayScore: null, homeScore: 50 } } });
  assert.equal(lookupElo(ratings, 'NBA', 'Home Team'), 1500);
  assert.equal(lookupElo(ratings, 'NBA', 'Away Team'), 1500);
});

test('historical model context excludes same-day and future imported results', async () => {
  const row = { league: 'NBA', leagueKey: 'nba', sportGroup: 'Basketball', awayTeam: 'Away Team', homeTeam: 'Home Team', awayScore: 1, homeScore: 100 };
  const context = await loadModelContext('cutoff', 365, { asOfDateKey: '2099-01-02', intelligence: { teams: {}, results: { current: { ...row, dateKey: '2099-01-02' }, future: { ...row, dateKey: '2099-01-03' } } }, externalResults: [{ ...row, dateKey: '2099-01-03' }] });
  assert.equal(lookupElo(context.eloRatings, 'NBA', 'Home Team'), 1500);
  assert.equal(context.externalResults.length, 0);
});

test('unknown-sport calibration rows count once and post-start predictions are excluded', () => {
  const prediction = { predictionProbability: 0.6, modelVersion: 'OmniMod Evidence Ensemble v6.0.0', predictionMode: 'pregame', predictionCorrect: true };
  assert.equal(buildCalibrationModel([{ prediction, correct: true }]).all[6].count, 1);
  assert.equal(collectGradedRows([{ dateKey: '2099-01-02', slate: { predictions: [{ ...prediction, predictionGeneratedAt: '2099-01-02T20:00:00Z', startTime: game().startTime }] } }]).length, 0);
});

test('horizon scoring preserves probabilities below one percent and excludes post-start closing quotes', () => {
  const row = { gameId: 'game', predictionGeneratedAt: '2099-01-02T18:00:00Z', startTime: game().startTime, predictionMode: 'pregame', predictedSide: 'home', actualSide: 'home', modeledOutcomes: ['away','home'], outcomeProbabilities: { away: 0.8, home: 99.2 } };
  const report = evaluatePredictionHorizons([row], [{ gameId: 'game', stage: 'closing', capturedAt: '2099-01-02T19:10:00Z', away: 0.01, home: 0.99 }]);
  assert.ok(Math.abs(report.overall.brierScore - 0.008 ** 2) < 1e-10);
  assert.equal(report.overall.closingSampleSize, 0);
  assert.equal(evaluatePredictionHorizons([{ ...row, predictionGeneratedAt: '' }]).overall.sampleSize, 0);
  assert.equal(predictionHorizon({ minutesToStart: null }), 'Daily');
});

test('warehouse does not fabricate grades from missing final scores', async () => {
  const slate = { guildId: 'missing-final', dateKey: '2099-01-02', generatedAt: '2099-01-02T18:00:00Z', games: [game({ statusKey: 'final' })], predictions: [{ gameId: 'game', predictedSide: 'draw', predictionMode: 'pregame', startTime: game().startTime }] };
  const warehouse = await recordSlateSnapshot(slate);
  assert.equal(warehouse.predictions[0].predictionCorrect, null);
  assert.equal(warehouse.predictions[0].actualSide, '');
});

test('stale market prices cannot steer the ensemble and uncertainty has no fabricated coverage', () => {
  const odds = { h2h: bestH2HMarket([book('a', [['Away Team', 200], ['Home Team', -240]], '2020-01-01T00:00:00Z')], game()) };
  const baseline = predictGame(game(), 0);
  const stale = predictGame(game({ odds }), 0);
  assert.deepEqual(stale.outcomeProbabilities, baseline.outcomeProbabilities);
  assert.equal(stale.edgeValue, null);
  assert.equal(stale.probabilityInterval.coverageValidated, false);
  assert.equal(stale.probabilityInterval.level, null);
  assert.doesNotMatch(stale.predictionUncertainty, /80%/);
});

test('corrupt tracking stores fail closed and preserve their original bytes', async () => {
  const cases = [
    [warehouseFile, () => readFeatureWarehouse()],
    [dailyCachePath('2099-01-02', 'corrupt'), () => readDailyCache('2099-01-02', 'corrupt')],
    [path.join(testDataDir, 'watchlist.json'), () => addWatch('user', 'Team')]
  ];
  for (const [file, operation] of cases) {
    const original = await fs.readFile(file).catch(() => null);
    try {
      await fs.writeFile(file, '{broken');
      await assert.rejects(operation);
      assert.equal(await fs.readFile(file, 'utf8'), '{broken');
    } finally {
      if (original) await fs.writeFile(file, original);
      else await fs.unlink(file);
    }
  }
});

test.after(async () => { await fs.rm(testDataDir, { recursive: true, force: true }); });
