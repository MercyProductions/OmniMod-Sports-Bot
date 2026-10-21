import { probabilityLogLoss } from './probabilityLogLoss.js';
import { quoteTimeEpoch as instant } from './oddsPricing.js';
import {createHash} from 'node:crypto';
import path from 'node:path';
import { config, dataDir } from './config.js';
import { readJson, writeJson } from './storage.js';
import { selectCandidateCohort, validCandidateVector } from './candidateCohorts.js';

const modelFile = path.join(dataDir, 'local-ml-models.json');
const MODEL_VERSION = 2;
const FEATURE_NAMES = [
  'elo', 'record', 'power', 'offenseDefense', 'form', 'headToHead', 'opponentAdjusted',
  'advanced', 'players', 'participation', 'lineup', 'playByPlay', 'situation', 'marketMovement',
  'evidenceHome', 'evidenceDraw', 'specialistHome', 'specialistDraw', 'sampleReliability', 'sourceQuality'
];
let writeChain = Promise.resolve();

export function localMlArtifactId(model) {
  return createHash('sha256').update(JSON.stringify({ version: MODEL_VERSION, sport: model.sport,
    trainingHash: model.trainingHash, trainingCohort: model.trainingCohort, featureNames: model.featureNames,
    rounds: model.fitRounds, stumps: model.stumps, leagueAdjustments: model.leagueAdjustments })).digest('hex');
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function logistic(value) {
  return 1 / (1 + Math.exp(-clamp(value, -12, 12)));
}

function logit(probability) {
  const p = clamp(finite(probability, 0.5), 0.01, 0.99);
  return Math.log(p / (1 - p));
}

function vectorProbability(vector, side) {
  const value = finite(vector?.[side], 0);
  return value > 1 ? value / 100 : value;
}

function normalizeVector(vector = {}, twoWay = true) {
  const safe = {
    away: clamp(vectorProbability(vector, 'away'), 0, 1),
    home: clamp(vectorProbability(vector, 'home'), 0, 1),
    draw: twoWay ? 0 : clamp(vectorProbability(vector, 'draw'), 0, 1)
  };
  const total = safe.away + safe.home + safe.draw;
  if (total <= 0) return twoWay ? { away: 0.5, home: 0.5, draw: 0 } : { away: 0.37, home: 0.37, draw: 0.26 };
  return Object.fromEntries(Object.entries(safe).map(([side, value]) => [side, value / total]));
}

export function normalizeMlFeatureVector(raw = {}) {
  return Object.fromEntries(FEATURE_NAMES.map((name) => [name, Number(clamp(finite(raw[name], 0), -4, 4).toFixed(6))]));
}

function evidenceBinaryHome(vector = {}) {
  const normalized = normalizeVector(vector, vectorProbability(vector, 'draw') <= 0);
  return clamp(normalized.home + normalized.draw * 0.5, 0.01, 0.99);
}

function actualHome(row) {
  return row.actualSide === 'home' ? 1 : row.actualSide === 'away' ? 0 : row.actualSide === 'draw' ? 0.5 : null;
}

function rowFeatures(row) {
  return normalizeMlFeatureVector(row.mlFeatureVector || row.featureVector || {});
}

function predictionFromBinary(homeBinary, evidence, twoWay) {
  const base = normalizeVector(evidence, twoWay);
  if (twoWay) return { away: 1 - homeBinary, home: homeBinary, draw: 0 };
  const draw = clamp(base.draw, 0.12, 0.38);
  return { away: (1 - homeBinary) * (1 - draw), home: homeBinary * (1 - draw), draw };
}

function stumpValue(stump, features) {
  return finite(features[stump.feature], 0) <= stump.threshold ? stump.left : stump.right;
}

function predictBinary(model, features, evidence, leagueKey = '') {
  let value = logit(evidenceBinaryHome(evidence));
  for (const stump of model.stumps || []) value += stumpValue(stump, features);
  value += finite(model.leagueAdjustments?.[String(leagueKey || '').toLowerCase()], 0);
  return logistic(value);
}

function quantile(values, fraction) {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * fraction)))];
}

function fitStumps(rows, iterations = 24) {
  if (!rows.length) return { stumps: [], leagueAdjustments: {} };
  const logits = rows.map((row) => logit(evidenceBinaryHome(row.candidateProbabilities?.evidence)));
  const stumps = [];
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const residuals = rows.map((row, index) => actualHome(row) - logistic(logits[index]));
    let best = null;
    for (const feature of FEATURE_NAMES) {
      const values = rows.map((row) => rowFeatures(row)[feature]);
      const thresholds = [...new Set([0.2, 0.35, 0.5, 0.65, 0.8].map((fraction) => quantile(values, fraction)))];
      for (const threshold of thresholds) {
        const left = [];
        const right = [];
        for (let index = 0; index < rows.length; index += 1) (values[index] <= threshold ? left : right).push(residuals[index]);
        if (left.length < 8 || right.length < 8) continue;
        const leftMean = left.reduce((sum, value) => sum + value, 0) / left.length;
        const rightMean = right.reduce((sum, value) => sum + value, 0) / right.length;
        const gain = left.length * leftMean ** 2 + right.length * rightMean ** 2;
        if (!best || gain > best.gain) best = { feature, threshold, leftMean, rightMean, gain };
      }
    }
    if (!best || best.gain < 0.00005) break;
    const learningRate = 0.32 / Math.sqrt(1 + iteration / 8);
    const stump = {
      feature: best.feature,
      threshold: Number(best.threshold.toFixed(6)),
      left: Number(clamp(best.leftMean * learningRate * 3.2, -0.24, 0.24).toFixed(6)),
      right: Number(clamp(best.rightMean * learningRate * 3.2, -0.24, 0.24).toFixed(6))
    };
    stumps.push(stump);
    for (let index = 0; index < rows.length; index += 1) logits[index] += stumpValue(stump, rowFeatures(rows[index]));
  }
  const leagueGroups = new Map();
  for (let index = 0; index < rows.length; index += 1) {
    const league = String(rows[index].leagueKey || '').toLowerCase();
    if (!league) continue;
    if (!leagueGroups.has(league)) leagueGroups.set(league, []);
    leagueGroups.get(league).push(actualHome(rows[index]) - logistic(logits[index]));
  }
  const leagueAdjustments = Object.fromEntries([...leagueGroups].map(([league, residuals]) => {
    const average = residuals.reduce((sum, value) => sum + value, 0) / residuals.length;
    const reliability = residuals.length / (residuals.length + 30);
    return [league, Number(clamp(average * 3.2 * reliability, -0.22, 0.22).toFixed(6))];
  }));
  return { stumps, leagueAdjustments };
}

function scoreRows(rows, model = null) {
  if (!rows.length) return { sampleSize: 0, baselineBrier: null, modelBrier: null, baselineLogLoss: null, modelLogLoss: null, brierImprovement: null, logLossImprovement: null };
  let baselineBrier = 0;
  let modelBrier = 0;
  let baselineLogLoss = 0;
  let modelLogLoss = 0;
  for (const row of rows) {
    const twoWay = vectorProbability(row.candidateProbabilities?.evidence, 'draw') <= 0;
    const baseline = normalizeVector(row.candidateProbabilities.evidence, twoWay);
    const binary = model ? predictBinary(model, rowFeatures(row), baseline, row.leagueKey) : evidenceBinaryHome(baseline);
    const predicted = predictionFromBinary(binary, baseline, twoWay);
    const sides = twoWay && row.actualSide !== 'draw' ? ['away', 'home'] : ['away', 'home', 'draw'];
    baselineBrier += sides.reduce((sum, side) => sum + (baseline[side] - Number(side === row.actualSide)) ** 2, 0) / sides.length;
    modelBrier += sides.reduce((sum, side) => sum + (predicted[side] - Number(side === row.actualSide)) ** 2, 0) / sides.length;
    baselineLogLoss += probabilityLogLoss(baseline[row.actualSide]);
    modelLogLoss += probabilityLogLoss(predicted[row.actualSide]);
  }
  const count = rows.length;
  return {
    sampleSize: count,
    baselineBrier: baselineBrier / count,
    modelBrier: modelBrier / count,
    baselineLogLoss: baselineLogLoss / count,
    modelLogLoss: modelLogLoss / count,
    brierImprovement: (baselineBrier - modelBrier) / count,
    logLossImprovement: (baselineLogLoss - modelLogLoss) / count
  };
}

function emptyStore() {
  return { version: MODEL_VERSION, updatedAt: '', sports: {}, evaluationRows: [] };
}

export async function readLocalMlModels() {
  const stored = await readJson(modelFile, null, { throwOnError: true });
  return stored?.version === MODEL_VERSION ? { ...emptyStore(), ...stored } : emptyStore();
}

export function trainLocalMlModels(rows = [], options = {}) {
  const asOf = options.now ?? Date.now();
  if (!Number.isFinite(asOf)) throw new Error('Training requires a valid information cutoff');
  const selected = selectCandidateCohort(rows);
  const beforeCutoff = selected.rows.filter(row => Number.isFinite(Date.parse(row.resolvedAt || '')) && Date.parse(row.resolvedAt) <= asOf);
  rows = beforeCutoff.filter(row => validCandidateVector(row.candidateProbabilities?.evidence, row.candidateModeledOutcomes?.evidence));
  const minimum = Math.max(60, Number(options.minimum ?? config.localMlMinSamples) || 150);
  const groups = new Map();
  for (const row of rows) {
    if (!['away', 'home', 'draw'].includes(row.actualSide) || !row.candidateProbabilities?.evidence || !(row.mlFeatureVector || row.featureVector)) continue;
    const sport = String(row.sport || row.sportProfile || 'default').toLowerCase();
    if (!groups.has(sport)) groups.set(sport, []);
    groups.get(sport).push(row);
  }
  const sports = {};
  const evaluationRows = [];
  for (const [sport, sportRows] of groups) {
    const orderTime = row => Number.isFinite(instant(row.startTime)) ? instant(row.startTime) : Infinity;
    const sorted = [...sportRows].sort((a, b) => orderTime(a) - orderTime(b) || String(a.gameId).localeCompare(String(b.gameId)));
    const split = Math.max(30, Math.min(sorted.length - 30, Math.floor(sorted.length * 0.7)));
    const validation = sorted.slice(split);
    const firstValidationForecast = Math.min(...validation.map(row => Date.parse(row.predictionGeneratedAt || '')));
    const training = sorted.slice(0, split).filter(row => Date.parse(row.resolvedAt || '') < firstValidationForecast);
    const validationModel = fitStumps(training, 22);
    const evaluation = scoreRows(validation, validationModel);
    const labelsAvailableBeforeHoldout = Number.isFinite(firstValidationForecast) && training.every(row =>
      Number.isFinite(Date.parse(row.resolvedAt || '')) && Date.parse(row.resolvedAt) < firstValidationForecast);
    const chronologyVerified = selected.cohort.prospectiveRecordsVerified && labelsAvailableBeforeHoldout;
    const accepted = chronologyVerified && sorted.length >= minimum && training.length >= 30 && validation.length >= 30
      && evaluation.brierImprovement > 0.0015 && evaluation.logLossImprovement >= -0.003;
    // Retain the exact evaluated fit; a refit on validation labels is a new, unvalidated artifact.
    const finalModel = validationModel;
    const trainingHash = createHash('sha256').update(JSON.stringify(training.map(row => ({
      gameId: row.gameId, league: row.leagueKey, generatedAt: row.predictionGeneratedAt, resolvedAt: row.resolvedAt,
      actualSide: row.actualSide, features: rowFeatures(row), evidence: row.candidateProbabilities.evidence
    })))).digest('hex');
    const artifactSpec = { sport, trainingHash, trainingCohort: selected.cohort.key, featureNames: FEATURE_NAMES, fitRounds: 22, ...finalModel };
    const artifactId = localMlArtifactId(artifactSpec);
    sports[sport] = {
      ...artifactSpec,
      artifactFormat: 'sports-local-ml-artifact-v2',
      modelId: `local-gbdt-hierarchical-${sport}-v2-${artifactId.slice(0, 16)}`,
      artifactId, trainingHash, validationProtocol: 'fixed-22-round-fit-before-chronological-validation-v3',
      evaluationProtocol: 'mean-coordinate-brier-observed-outcomes-log-floor-1e-12-v2',
      promotionAllowed: false, researchOnly: true,
      lastTrainingOutcomeAt: training.length ? new Date(Math.max(...training.map(row => Date.parse(row.resolvedAt)))).toISOString() : null,
      purgedTrainingRows: split - training.length,
      algorithm: 'gradient-boosted decision stumps with reliability-shrunk league intercepts',
      trainedAt: new Date(asOf).toISOString(),
      sampleSize: sorted.length,
      trainingSampleSize: training.length,
      validationSampleSize: validation.length,
      accepted,
      chronologyVerified,
      labelsAvailableBeforeHoldout,
      evaluation,
      featureNames: FEATURE_NAMES,
      stumps: finalModel.stumps,
      leagueAdjustments: finalModel.leagueAdjustments
    };
    if (accepted) {
      for (const row of validation) {
        const twoWay = vectorProbability(row.candidateProbabilities.evidence, 'draw') <= 0;
        const ml = predictionFromBinary(predictBinary(validationModel, rowFeatures(row), row.candidateProbabilities.evidence, row.leagueKey), row.candidateProbabilities.evidence, twoWay);
        evaluationRows.push({
          ...row,
          source: 'retrospective-ml-validation',
          originSource: row.source || 'unknown',
          snapshotPolicy: 'retrospective_model_validation_v1',
          reconstructedAt: new Date(asOf).toISOString(),
          candidateArtifactIds: { ...(row.candidateArtifactIds || {}), ml: artifactId },
          candidateProbabilities: { ...row.candidateProbabilities, ml }
        });
      }
    }
  }
  return { version: MODEL_VERSION, updatedAt: new Date().toISOString(), sports, evaluationRows, cohort: selected.cohort, temporalRowsExcluded: selected.rows.length - beforeCutoff.length, invalidEvidenceVectorsExcluded: beforeCutoff.filter(row => !validCandidateVector(row.candidateProbabilities?.evidence, row.candidateModeledOutcomes?.evidence)).length };
}

export async function trainAndPersistLocalMlModels(rows = [], options = {}) {
  const store = trainLocalMlModels(rows, options);
  const operation = writeChain.then(async () => {
    await writeJson(modelFile, store, { compact: true, backup: true, mode: 0o600 });
    return store;
  });
  writeChain = operation.catch(() => {});
  return operation;
}

export function predictLocalMlCandidate(model = null, featureVector = {}, evidence = {}, options = {}) {
  const asOf = options.now ?? Date.now();
  if (!Number.isFinite(asOf) || model && (!Number.isFinite(Date.parse(model.trainedAt || '')) || Date.parse(model.trainedAt) > asOf
    || !Number.isFinite(Date.parse(model.lastTrainingOutcomeAt || '')) || Date.parse(model.lastTrainingOutcomeAt) > Date.parse(model.trainedAt)))
    return { available: false, modelId: model?.modelId || 'local-ml-collecting', probabilities: null, accepted: false, reason: 'model_not_available_at_forecast_cutoff' };
  if (!Array.isArray(model?.stumps) || !model.stumps.length) return { available: false, modelId: model?.modelId || 'local-ml-collecting', probabilities: null, accepted: false, sampleSize: model?.sampleSize || 0 };
  if (model.artifactFormat !== 'sports-local-ml-artifact-v2' || model.artifactId !== localMlArtifactId(model)
    || JSON.stringify(model.featureNames) !== JSON.stringify(FEATURE_NAMES) || model.fitRounds !== 22
    || model.stumps.some(stump => !FEATURE_NAMES.includes(stump.feature) || ![stump.threshold, stump.left, stump.right].every(Number.isFinite)))
    return { available: false, modelId: model.modelId, probabilities: null, accepted: false, reason: 'model_artifact_integrity_unverified' };
  const twoWay = options.twoWay !== false;
  const probabilities = predictionFromBinary(
    predictBinary(model, normalizeMlFeatureVector(featureVector), evidence, options.leagueKey),
    evidence,
    twoWay
  );
  return { available: true, modelId: model.modelId, artifactId: model.artifactId || null, researchOnly: model.researchOnly !== false, probabilities, accepted: model.accepted === true, sampleSize: model.sampleSize || 0, evaluation: model.evaluation || null };
}

export { FEATURE_NAMES, modelFile as localMlModelFile };
