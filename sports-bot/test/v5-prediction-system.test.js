import assert from 'node:assert/strict';
import test from 'node:test';

import { buildTennisDataset, parseCsv } from '../src/advancedDatasets.js';
import { calculateMarketMovement } from '../src/featureWarehouse.js';
import { replayHistoricalResults } from '../src/historicalReplay.js';
import { applyCandidateDecision, evaluateCandidateModels } from '../src/modelRegistry.js';
import { duePregameRefreshes, markPregameRefreshes, nextPregameRefresh, parseRefreshWindows } from '../src/pregameRefresh.js';
import { blendProbabilityVectors, buildSportModelPrediction } from '../src/sportModels.js';
import { estimatePredictionUncertainty } from '../src/uncertainty.js';

function gameFor(leagueKey, sportGroup) {
  return {
    id: `${leagueKey}-game`, leagueKey, sportGroup,
    startTime: '2099-01-02T20:00:00Z', statusKey: 'scheduled',
    away: { name: 'Away' }, home: { name: 'Home' },
    autoTeamMetrics: {
      away: { sampleSize: 20, stats: { averageScored: 3, averageAllowed: 4 } },
      home: { sampleSize: 20, stats: { averageScored: 5, averageAllowed: 3 } }
    },
    autoPlayers: [], autoContext: null
  };
}

test('pregame refresh catches missed windows once and persists completion', () => {
  const now = new Date('2099-01-02T19:35:00Z');
  const slate = { games: [gameFor('nba', 'Basketball')], pregameRefreshes: {} };
  const due = duePregameRefreshes(slate, now, { windows: [90, 30, 10] });
  assert.deepEqual(due[0].dueWindows, [90, 30]);
  assert.equal(due[0].stage, 't-30');
  const marked = markPregameRefreshes(slate, due, now.toISOString());
  assert.equal(duePregameRefreshes(marked, now, { windows: [90, 30, 10] }).length, 0);
  assert.equal(nextPregameRefresh(marked, now, { windows: [90, 30, 10] }).window, 10);
  assert.deepEqual(parseRefreshWindows('10,90,30,30'), [90, 30, 10]);
});

test('market history retains opening, current, closing candidate, and movement', () => {
  const movement = calculateMarketMovement([
    { capturedAt: '2099-01-01T10:00:00Z', stage: 'daily', away: 0.52, home: 0.48, draw: 0 },
    { capturedAt: '2099-01-01T19:50:00Z', stage: 't-10', away: 0.46, home: 0.54, draw: 0 }
  ]);
  assert.deepEqual(movement.opening, { away: 0.52, home: 0.48, draw: 0 });
  assert.deepEqual(movement.closing, { away: 0.46, home: 0.54, draw: 0, capturedAt: '2099-01-01T19:50:00Z' });
  assert.equal(movement.movementPoints.home, 6);
  assert.equal(movement.movementPoints.away, -6);
});

test('all seven sport specialists return normalized probabilities from distinct models', () => {
  const sports = [
    ['mlb', 'Baseball'], ['nba', 'Basketball'], ['nfl', 'Football'], ['nhl', 'Hockey'],
    ['epl', 'Soccer'], ['atp', 'Tennis'], ['ufc', 'Combat']
  ];
  const ids = new Set();
  for (const [league, group] of sports) {
    const result = buildSportModelPrediction(gameFor(league, group), { modelLogit: 0.4 });
    assert.equal(result.available, true);
    const total = result.probabilities.away + result.probabilities.home + result.probabilities.draw;
    assert.ok(Math.abs(total - 1) < 1e-9);
    assert.ok(result.probabilities.home > 0 && result.probabilities.away > 0);
    ids.add(result.modelId);
  }
  assert.equal(ids.size, 7);
});

test('specialist blending stays bounded and normalized', () => {
  const result = blendProbabilityVectors(
    { away: 0.45, home: 0.55, draw: 0 },
    { away: 0.25, home: 0.75, draw: 0 },
    0.4,
    true
  );
  assert.ok(Math.abs(result.home - 0.63) < 1e-9);
  assert.ok(Math.abs(result.away - 0.37) < 1e-9);
});

test('uncertainty abstains for an inseparable low-evidence game', () => {
  const game = gameFor('nba', 'Basketball');
  const result = estimatePredictionUncertainty({
    game,
    probabilities: { away: 0.49, home: 0.51, draw: 0 }, selectedSide: 'home',
    specialistProbabilities: { away: 0.63, home: 0.37, draw: 0 },
    evidenceQuality: 20, apiConfidence: 10, localConfidence: 15,
    historySamples: 0, calibrationSamples: 0, featureAgreement: 35
  });
  assert.equal(result.recommendationStatus, 'withheld');
  assert.equal(result.isActionablePrediction, false);
  assert.ok(result.interval.lower < 0.5);
});

test('uncertainty retains a well-supported separated prediction', () => {
  const result = estimatePredictionUncertainty({
    game: gameFor('nfl', 'Football'),
    probabilities: { away: 0.24, home: 0.76, draw: 0 }, selectedSide: 'home',
    specialistProbabilities: { away: 0.27, home: 0.73, draw: 0 },
    evidenceQuality: 92, apiConfidence: 90, localConfidence: 75,
    historySamples: 80, calibrationSamples: 100, featureAgreement: 85
  });
  assert.equal(result.recommendationStatus, 'prediction');
  assert.equal(result.isActionablePrediction, true);
  assert.ok(result.interval.lower > 0.5);
});

function replayRows() {
  return Array.from({ length: 12 }, (_, index) => ({
    id: `g${index}`, dateKey: `2098-01-${String(index + 1).padStart(2, '0')}`,
    startTime: `2098-01-${String(index + 1).padStart(2, '0')}T20:00:00Z`,
    leagueKey: 'nba', sportGroup: 'Basketball',
    awayTeam: index % 2 ? 'B' : 'A', homeTeam: index % 2 ? 'A' : 'B',
    awayScore: 90 + index, homeScore: 100 + index
  }));
}

test('historical replay cannot leak a future score into an earlier prediction', () => {
  const rows = replayRows();
  const original = replayHistoricalResults(rows, { asOfDateKey: '2099-01-01' });
  const mutated = replayHistoricalResults(rows.map((row, index) => index === rows.length - 1 ? { ...row, awayScore: 200, homeScore: 1 } : row), { asOfDateKey: '2099-01-01' });
  const earlierId = original.predictions.at(-2).gameId;
  assert.deepEqual(
    original.predictions.find((row) => row.gameId === earlierId).candidateProbabilities,
    mutated.predictions.find((row) => row.gameId === earlierId).candidateProbabilities
  );
});

test('candidate scoring recognizes a materially better challenger', () => {
  const rows = Array.from({ length: 80 }, (_, index) => {
    const actualSide = index % 2 ? 'home' : 'away';
    return {
      actualSide,
      candidateProbabilities: {
        evidence: actualSide === 'home' ? { away: 0.45, home: 0.55, draw: 0 } : { away: 0.55, home: 0.45, draw: 0 },
        hybrid: actualSide === 'home' ? { away: 0.25, home: 0.75, draw: 0 } : { away: 0.75, home: 0.25, draw: 0 }
      }
    };
  });
  const evaluation = evaluateCandidateModels(rows);
  assert.ok(evaluation.brierImprovement > 0);
  assert.ok(evaluation.logLossImprovement > 0);
});

test('champion registry promotes only proven improvement and rolls back recent degradation', () => {
  const good = {
    evidence: { sampleSize: 100, brierScore: 0.2, logLoss: 0.65 },
    hybrid: { sampleSize: 100, brierScore: 0.19, logLoss: 0.64 },
    brierImprovement: 0.01,
    logLossImprovement: 0.01
  };
  const promoted = applyCandidateDecision({}, 'basketball', good, good, { minimum: 75, now: '2099-01-01T00:00:00Z' });
  assert.equal(promoted.entry.champion, 'hybrid');
  assert.equal(promoted.action, 'promoted_hybrid');
  const badRecent = {
    evidence: { sampleSize: 40, brierScore: 0.18, logLoss: 0.6 },
    hybrid: { sampleSize: 40, brierScore: 0.2, logLoss: 0.67 },
    brierImprovement: -0.02,
    logLossImprovement: -0.07
  };
  const rolledBack = applyCandidateDecision(promoted.entry, 'basketball', good, badRecent, { minimum: 75, now: '2099-02-01T00:00:00Z' });
  assert.equal(rolledBack.entry.champion, 'evidence');
  assert.equal(rolledBack.action, 'rolled_back_to_evidence');
});

test('tennis adapter parses quoted CSV and derives surface Elo and serve-return evidence', () => {
  const rows = parseCsv([
    'tourney_date,surface,winner_name,loser_name,w_svpt,w_1stWon,w_2ndWon,l_svpt,l_1stWon,l_2ndWon',
    '20980101,Hard,"Winner, One",Loser Two,60,30,15,58,20,10',
    '20980108,Clay,"Winner, One",Loser Two,62,31,16,60,22,11'
  ].join('\n'));
  const dataset = buildTennisDataset(rows, 'atp');
  const winner = dataset.winnerone;
  assert.equal(rows[0].winner_name, 'Winner, One');
  assert.equal(winner.matches, 2);
  assert.ok(winner.elo > 1500);
  assert.ok(winner.surfaces.hard > 1500);
  assert.ok(winner.serveWon > winner.returnWon);
});
