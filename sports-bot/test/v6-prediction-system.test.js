import { CURRENT_MODEL_VERSION } from '../src/modelIdentity.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluatePredictionHorizons, predictionHorizon } from '../src/horizonEvaluation.js';
import { FEATURE_NAMES, localMlArtifactId, normalizeMlFeatureVector, predictLocalMlCandidate, trainLocalMlModels } from '../src/localMl.js';
import { applyCandidateDecision, evaluateCandidateModels } from '../src/modelRegistry.js';
import { projectPlayerParticipation, summarizeTeamParticipation } from '../src/participationProjection.js';
import { buildPlayByPlayEvidence, compactEspnPlays } from '../src/playByPlay.js';
import { predictGame } from '../src/predictionEngine.js';
import { applyOfficialAndEnvironmentContext, buildOfficialProfiles, corroborateScheduleRows, extractEventEnvironment } from '../src/sourceIntelligence.js';
import { estimatePredictionUncertainty } from '../src/uncertainty.js';

test('projected participation converts status, starter history, and workload into expected usage', () => {
  const learned = { participation: 0.88, starterRate: 0.92, sampleSize: 24 };
  const healthy = projectPlayerParticipation({ role: 'Point Guard', starter: true, status: 'Available' }, learned, 'basketball', { confirmedStarter: true, active: true });
  const questionable = projectPlayerParticipation({ role: 'Point Guard', starter: true, status: 'Questionable' }, learned, 'basketball', { confirmedStarter: true, active: true });
  const out = projectPlayerParticipation({ role: 'Point Guard', starter: true, status: 'Out' }, learned, 'basketball', { confirmedStarter: true, active: true });
  assert.ok(healthy.expectedWorkload > questionable.expectedWorkload);
  assert.equal(out.expectedWorkload, 0);
  assert.ok(questionable.uncertainty > healthy.uncertainty);
  const summary = summarizeTeamParticipation([
    { team: 'Club', impact: 6, ...healthy },
    { team: 'Club', impact: 4, ...questionable }
  ], 'Club');
  assert.equal(summary.players, 2);
  assert.ok(summary.projectedActiveImpact > 0);
  assert.ok(summary.projectedMissingImpact > 0);
});

test('compact play-by-play derives sport-specific efficiency without retaining raw payloads', () => {
  const plays = compactEspnPlays([
    { id: '1', sequenceNumber: 1, text: 'Away pass complete for 28 yards and a first down', team: { id: 'A' }, start: { yardLine: 20 }, end: { yardLine: 48 } },
    { id: '2', sequenceNumber: 2, text: 'Away touchdown', team: { id: 'A' }, scoringPlay: true, scoreValue: 7 },
    { id: '3', sequenceNumber: 3, text: 'Home pass intercepted', team: { id: 'H' } },
    { id: '4', sequenceNumber: 4, text: 'Home quarterback sacked', team: { id: 'H' } }
  ]);
  const evidence = buildPlayByPlayEvidence(plays, { leagueKey: 'nfl', sportGroup: 'Football', awayTeamId: 'A', homeTeamId: 'H' });
  assert.equal(evidence.assignedPlays, 4);
  assert.ok(evidence.away.playValuePerEvent > evidence.home.playValuePerEvent);
  assert.equal(evidence.home.turnovers, 1);
  assert.equal(evidence.home.pressures, 1);
  assert.ok(plays.every((row) => !('participants' in row) && row.text.length <= 240));
});

function mlRows(count = 320) {
  return Array.from({ length: count }, (_, index) => {
    const home = index % 4 < 2;
    const signal = home ? 1 : -1;
    const evidence = home ? { away: 0.48, home: 0.52, draw: 0 } : { away: 0.52, home: 0.48, draw: 0 };
    const dateKey = `2099-${String(1 + Math.floor(index / 28)).padStart(2, '0')}-${String(1 + index % 28).padStart(2, '0')}`;
    return {
      dateKey,
      startTime: `${dateKey}T20:00:00Z`,
      predictionGeneratedAt: `${dateKey}T08:00:00Z`, recordedAt: `${dateKey}T08:01:00Z`, resolvedAt: `${dateKey}T23:00:00Z`,
      snapshotPolicy: 'first_issue_immutable_v1', modelVersion: 'OmniMod Evidence Ensemble v6.0.1', source: 'frozen-production',
      gameId: String(index),
      leagueKey: 'nba',
      sport: 'basketball',
      actualSide: home ? 'home' : 'away',
      candidateProbabilities: { evidence, hybrid: evidence },
      mlFeatureVector: normalizeMlFeatureVector({ elo: signal * 0.1, participation: signal * 0.7, playByPlay: signal })
    };
  });
}

test('local gradient-boosted challenger is trained and accepted only on chronological holdout improvement', () => {
  const trained = trainLocalMlModels(mlRows(), { minimum: 100, now: Date.parse('2100-01-01T00:00:00Z') });
  const model = trained.sports.basketball;
  assert.equal(model.accepted, true);
  assert.equal(model.trainingSampleSize, 224);
  assert.equal(model.validationSampleSize, 96);
  assert.ok(model.evaluation.brierImprovement > 0.1);
  assert.equal(trained.evaluationRows.length, 96);
  const candidate = predictLocalMlCandidate(model, { playByPlay: 1, participation: 0.7, elo: 0.1 }, { away: 0.48, home: 0.52, draw: 0 }, { twoWay: true, leagueKey: 'nba', now: Date.parse('2100-01-01T00:00:00Z') });
  assert.equal(candidate.available, true);
  assert.ok(candidate.probabilities.home > 0.52);
  assert.ok(Math.abs(candidate.probabilities.away + candidate.probabilities.home - 1) < 1e-10);

  const underMinimum = trainLocalMlModels(mlRows(90), { minimum: 150, now: Date.parse('2100-01-01T00:00:00Z') });
  assert.equal(underMinimum.sports.basketball.accepted, false);
  assert.equal(underMinimum.evaluationRows.length, 0);
});

test('registry keeps strong ML results as research without a preregistered approved review', () => {
  const rows = Array.from({ length: 100 }, (_, index) => {
    const actualSide = index % 2 ? 'home' : 'away';
    const vector = (probability) => actualSide === 'home' ? { away: 1 - probability, home: probability, draw: 0 } : { away: probability, home: 1 - probability, draw: 0 };
    return { actualSide, candidateProbabilities: { evidence: vector(0.55), hybrid: vector(0.56), ml: vector(0.8) } };
  });
  const evaluation = evaluateCandidateModels(rows);
  assert.equal(evaluation.bestChallenger, 'ml');
  const decision = applyCandidateDecision({}, 'basketball', evaluation, evaluation, { minimum: 75, now: '2099-01-01T00:00:00Z' });
  assert.equal(decision.entry.champion, 'evidence');
  assert.equal(decision.entry.status, 'awaiting_preregistered_review');
  assert.equal(decision.action, '');
});

test('horizon evaluation grades T-90, T-30, T-10 independently with closing-line context', () => {
  const stages = ['t-90', 't-30', 't-10'];
  const predictions = [];
  const markets = [];
  for (let index = 0; index < 30; index += 1) {
    const stage = stages[index % stages.length];
    const actualSide = index % 2 ? 'home' : 'away';
    predictions.push({
      guildId: '', gameId: String(index), leagueKey: 'nba', snapshotStage: stage,
      predictionGeneratedAt: new Date(Date.UTC(2099, 0, 1, index)).toISOString(),
      startTime: new Date(Date.UTC(2099, 0, 3, index)).toISOString(), predictionMode: 'pregame',
      predictedSide: actualSide, actualSide,
      outcomeProbabilities: actualSide === 'home' ? { away: 35, home: 65 } : { away: 65, home: 35 },
      inputSnapshot: { seasonType: index % 10 === 0 ? 3 : 2 }
    });
    markets.push({ guildId: '', gameId: String(index), stage: 't-10', capturedAt: '2099-01-01T00:00:00Z', away: 0.5, home: 0.5, draw: 0 });
  }
  const report = evaluatePredictionHorizons(predictions, markets);
  assert.equal(report.overall.sampleSize, 30);
  assert.equal(report.byHorizon['T-90'].sampleSize, 10);
  assert.equal(report.byHorizon['T-30'].sampleSize, 10);
  assert.equal(report.byHorizon['T-10'].sampleSize, 10);
  assert.deepEqual(predictionHorizon({ minutesToStart: 28 }), 'T-30');
  assert.ok(report.overall.bootstrap95.accuracy);
  assert.ok(report.overall.meanModelVsCloseEdge > 0);
  assert.equal(report.bySeasonPhase.postseason.sampleSize, 3);

  const soccer = evaluatePredictionHorizons([{
    guildId: '', gameId: 'soccer', leagueKey: 'epl', snapshotStage: 't-10',
    predictionGeneratedAt: '2099-01-01T00:00:00Z', startTime: '2099-01-01T01:00:00Z', predictionMode: 'pregame', predictedSide: 'home', actualSide: 'home',
    outcomeProbabilities: { away: 30, home: 44, draw: 26 }
  }], [{ guildId: '', gameId: 'soccer', stage: 't-10', capturedAt: '2099-01-01T00:00:00Z', away: 0.31, home: 0.43, draw: 0.26 }]);
  assert.equal(soccer.byFavoriteClass.favorite.sampleSize, 1);

  const excluded = evaluatePredictionHorizons([{ ...predictions[0], gameId: 'live', predictionMode: 'in_play' }], []);
  assert.equal(excluded.overall.sampleSize, 0);
});

test('official tendencies and independent schedules add bounded source and environment evidence', () => {
  const samples = Array.from({ length: 12 }, (_, index) => ({
    leagueKey: 'nfl', sportGroup: 'Football', awayScore: 17, homeScore: index < 10 ? 24 : 14,
    officials: [{ name: 'Ref Example', role: 'referee' }]
  }));
  const profiles = buildOfficialProfiles(samples);
  const environment = extractEventEnvironment({
    header: { competitions: [{ venue: { fullName: 'Dome', indoor: true, surface: 'turf' } }] },
    gameInfo: { officials: [{ displayName: 'Ref Example', position: { displayName: 'Referee' } }], weather: { temperature: 70, windSpeed: 4 } }
  });
  const game = { id: 'g1', dateKey: '2099-09-10', leagueKey: 'nfl', sportGroup: 'Football', away: { name: 'Road', abbr: 'RD' }, home: { name: 'Home', abbr: 'HM' }, eventEnvironment: environment };
  assert.equal(applyOfficialAndEnvironmentContext([game], profiles), 1);
  assert.equal(game.autoContext.factors.indoorVenue, 1);
  const matched = corroborateScheduleRows([game], [{ game_id: 'nfl1', gameday: '2099-09-10', away_team: 'RD', home_team: 'HM', roof: 'closed', surface: 'fieldturf', referee: 'Ref Example' }], { provider: 'independent fixture' });
  assert.equal(matched, 1);
  assert.ok(game.sourceCorroboration.providers.includes('independent fixture'));
  assert.equal(game.eventEnvironment.surface, 'fieldturf');
});

test('participation and contextual uncertainty widen an otherwise identical interval', () => {
  const game = { leagueKey: 'nba', sportGroup: 'Basketball', startTime: '2099-01-01T00:00:00Z', sourceCorroboration: { conflicts: [] }, autoLineup: { confirmedSides: 2, away: {}, home: {} } };
  const base = { game, probabilities: { away: 0.35, home: 0.65, draw: 0 }, selectedSide: 'home', specialistProbabilities: { away: 0.36, home: 0.64, draw: 0 }, evidenceQuality: 80, apiConfidence: 80, localConfidence: 70, historySamples: 50, featureAgreement: 80 };
  const stable = estimatePredictionUncertainty(base);
  const uncertain = estimatePredictionUncertainty({ ...base, participationUncertainty: 0.9, contextualVolatility: 0.2 });
  assert.ok(uncertain.halfWidth > stable.halfWidth);
  assert.ok(uncertain.reasons.some((reason) => /participation/.test(reason)));
});

test('prediction output carries v6 ML, projected participation, and play-by-play candidates', () => {
  const game = {
    id: 'future', league: 'NBA', leagueKey: 'nba', sportGroup: 'Basketball', matchup: 'AWY @ HOM',
    startTime: '2099-01-01T00:00:00Z', statusKey: 'scheduled', statusLabel: 'Upcoming',
    away: { name: 'Away', abbr: 'AWY', record: '10-10', score: 0 },
    home: { name: 'Home', abbr: 'HOM', record: '12-8', score: 0 },
    participationSummary: {
      away: { players: 5, projectedMissingImpact: 2, uncertainty: 0.2 },
      home: { players: 5, projectedMissingImpact: 0.5, uncertainty: 0.15 }
    },
    autoHistory: { awayGames: 20, homeGames: 20 },
    autoTeamMetrics: {
      away: { sampleSize: 20, powerRating: 50, offense: 50, defense: 50, form: 50, opponentAdjustedRating: 50, advancedRating: 50, advancedMetrics: { playValue: 0.1, playSuccessRate: 0.48, playTurnoverRate: 0.12 } },
      home: { sampleSize: 20, powerRating: 55, offense: 55, defense: 55, form: 55, opponentAdjustedRating: 55, advancedRating: 55, advancedMetrics: { playValue: 0.2, playSuccessRate: 0.54, playTurnoverRate: 0.09 } }
    }
  };
  const model = { artifactFormat: 'sports-local-ml-artifact-v2', sport: 'basketball', trainingHash: 'x', trainingCohort: 'fixture', featureNames: FEATURE_NAMES, fitRounds: 22, lastTrainingOutcomeAt: '2097-12-31T00:00:00Z', trainedAt: '2098-01-01T00:00:00Z', artifactId: 'a'.repeat(64), modelId: 'local-gbdt-hierarchical-basketball-v1', accepted: true, sampleSize: 200, stumps: [{ feature: 'playByPlay', threshold: 0, left: -0.1, right: 0.1 }], leagueAdjustments: {} };
  model.artifactId = localMlArtifactId(model);
  const prediction = predictGame(game, 0, {
    intelligence: { teams: {}, players: {}, contexts: {} }, eloRatings: {}, externalResults: [],
    history: { overall: { sampleSize: 0 } }, calibration: {}, featureLearning: {}, drift: {},
    modelRegistry: { sports: { basketball: { champion: 'ml', approvedArtifactId: model.artifactId,
      selectionReview: {status: 'review_ready', candidate: 'ml', sport: 'basketball', modelVersion: CURRENT_MODEL_VERSION, reportHash: 'b'.repeat(64), artifactId: model.artifactId}, championModelId: 'local-gbdt-hierarchical-v1', challenger: 'evidence', challengerModelId: 'evidence-ensemble-v6', status: 'champion_active',
      evaluation: { cohort: { prospectiveRecordsVerified: true, key: `production|${CURRENT_MODEL_VERSION}|Daily` } } } } },
    now: Date.parse('2100-01-01T00:00:00Z'),
    localMlModels: { sports: { basketball: model } }
  });
  assert.equal(prediction.modelVersion, CURRENT_MODEL_VERSION);
  assert.equal(prediction.localMlModel.active, true);
  assert.ok(prediction.candidateProbabilities.ml);
  assert.ok(prediction.factors.some((factor) => factor.label === 'Projected participation' && factor.present));
  assert.ok(prediction.factors.some((factor) => factor.label === 'Play-by-play efficiency' && factor.present));

  const rejectedPrediction = predictGame(game, 0, {
    intelligence: { teams: {}, players: {}, contexts: {} }, eloRatings: {}, externalResults: [],
    history: { overall: { sampleSize: 0 } }, calibration: {}, featureLearning: {}, drift: {},
    modelRegistry: { sports: { basketball: { champion: 'ml', approvedArtifactId: model.artifactId,
      selectionReview: {status: 'review_ready', candidate: 'ml', sport: 'basketball', modelVersion: CURRENT_MODEL_VERSION, reportHash: 'b'.repeat(64), artifactId: model.artifactId}, championModelId: 'local-gbdt-hierarchical-v1', challenger: 'evidence', challengerModelId: 'evidence-ensemble-v6', status: 'champion_active',
      evaluation: { cohort: { prospectiveRecordsVerified: true, key: `production|${CURRENT_MODEL_VERSION}|Daily` } } } } },
    now: Date.parse('2100-01-01T00:00:00Z'),
    localMlModels: { sports: { basketball: { ...model, accepted: false } } }
  });
  assert.equal(rejectedPrediction.localMlModel.active, false);
  assert.match(rejectedPrediction.championModel, /safety-fallback/);
});
