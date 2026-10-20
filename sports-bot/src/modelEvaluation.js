import { listDailyCaches } from './storage.js';
import { config } from './config.js';
import { normalizeEntityName, readIntelligenceStore } from './intelligenceStore.js';
import { sportProfile } from './sportProfiles.js';
import { readFeatureWarehouse } from './featureWarehouse.js';
import { evaluatePredictionHorizons, predictionHorizon } from './horizonEvaluation.js';
import { CURRENT_MODEL_VERSION, EVALUATION_VERSION } from './modelIdentity.js';
import { finiteNumber, finalOutcomeSide, scoreOutcome } from './dataValidation.js';

const EPSILON = 0.001;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function probabilityOf(prediction) {
  const value = finiteNumber(prediction?.predictionProbability ?? prediction?.confidenceValue);
  if (value === null) return null;
  return clamp(value > 1 ? value / 100 : value, EPSILON, 1 - EPSILON);
}

function profileKey(prediction = {}) {
  return String(prediction.sportProfile || prediction.sportGroup || prediction.leagueKey || prediction.league || 'all').toLowerCase();
}

function calibrationBin(probability) {
  return Math.min(9, Math.max(0, Math.floor(probability * 10)));
}

function eligibleModelVersion(value) {
  return /^OmniMod Evidence Ensemble v(?:3|4|5|6)/.test(String(value || ''));
}

function outcomeSide(game) {
  return finalOutcomeSide(game);
}

export function evaluatePredictionRows(rows = []) {
  const graded = rows.filter((row) => typeof row.correct === 'boolean' && probabilityOf(row.prediction) !== null);
  if (!graded.length) {
    return {
      sampleSize: 0,
      correct: 0,
      accuracy: null,
      averageConfidence: null,
      brierScore: null,
      logLoss: null,
      calibrationError: null,
      bins: []
    };
  }

  let correct = 0;
  let confidenceTotal = 0;
  let brierTotal = 0;
  let logLossTotal = 0;
  const bins = Array.from({ length: 10 }, (_, index) => ({
    index,
    min: index / 10,
    max: (index + 1) / 10,
    count: 0,
    correct: 0,
    probabilityTotal: 0
  }));

  for (const row of graded) {
    const probability = probabilityOf(row.prediction);
    const outcome = row.correct ? 1 : 0;
    if (row.correct) correct += 1;
    confidenceTotal += probability;
    brierTotal += (probability - outcome) ** 2;
    logLossTotal += -(outcome * Math.log(probability) + (1 - outcome) * Math.log(1 - probability));
    const bin = bins[calibrationBin(probability)];
    bin.count += 1;
    bin.correct += outcome;
    bin.probabilityTotal += probability;
  }

  const summarizedBins = bins.filter((bin) => bin.count).map((bin) => ({
    ...bin,
    accuracy: bin.correct / bin.count,
    averageConfidence: bin.probabilityTotal / bin.count
  }));
  const calibrationError = summarizedBins.reduce((total, bin) =>
    total + (bin.count / graded.length) * Math.abs(bin.accuracy - bin.averageConfidence), 0);

  return {
    sampleSize: graded.length,
    correct,
    accuracy: correct / graded.length,
    averageConfidence: confidenceTotal / graded.length,
    brierScore: brierTotal / graded.length,
    logLoss: logLossTotal / graded.length,
    calibrationError,
    bins: summarizedBins
  };
}

export function collectGradedRows(caches = [], options = {}) {
  const rows = new Map();
  for (const cache of caches) {
    for (const prediction of cache?.slate?.predictions ?? []) {
      if (prediction.quoteRefreshOnly) continue;
      if (prediction.predictionCorrect !== true && prediction.predictionCorrect !== false) continue;
      if (prediction.eligibleForCalibration === false || (prediction.predictionMode && prediction.predictionMode !== 'pregame')) continue;
      if (!eligibleModelVersion(prediction.modelVersion)) continue;
      const game = (cache?.slate?.games || []).find((row) => String(row.id) === String(prediction.gameId));
      const generated = Date.parse(prediction.predictionGeneratedAt || cache?.slate?.generatedAt || '');
      const start = Date.parse(prediction.startTime || game?.startTime || '');
      if (!Number.isFinite(generated) || !Number.isFinite(start) || generated >= start) continue;
      if (game && !outcomeSide(game)) continue;
      const horizon = predictionHorizon({ ...prediction, minutesToStart: (start - generated) / 60_000 });
      if (options.modelVersion && prediction.modelVersion !== options.modelVersion) continue;
      if (options.horizon && horizon !== options.horizon) continue;
      const key = [cache.slate?.guildId || '', prediction.leagueKey || prediction.league || '', cache.dateKey,
        prediction.gameId, prediction.modelVersion, horizon].join(':');
      const prior = rows.get(key);
      if (prior && Date.parse(prior.prediction.predictionGeneratedAt || '') >= generated) continue;
      rows.set(key, {
        dateKey: cache.dateKey,
        modelVersion: prediction.modelVersion,
        horizon,
        correct: prediction.predictionCorrect,
        prediction,
        game,
        actualSide: outcomeSide(game)
      });
    }
  }
  return [...rows.values()];
}

export function collectFeatureRows(caches = [], options = {}) {
  return collectGradedRows(caches, options)
    .filter((row) => ['away', 'home', 'draw'].includes(row.actualSide) && Array.isArray(row.prediction?.factors) && row.prediction.factors.length)
    .map((row) => ({
      dateKey: row.dateKey,
      sport: profileKey(row.prediction),
      // The learned feature layer models the home-vs-away logit before the
      // sport-specific draw allocation. A draw is neutral evidence here,
      // not an away win.
      outcome: row.actualSide === 'home' ? 1 : row.actualSide === 'away' ? 0 : 0.5,
      factors: Object.fromEntries(row.prediction.factors
        .filter((factor) => factor.present !== false && Number.isFinite(Number(factor.baseValue ?? factor.value)))
        .map((factor) => [String(factor.label), Number(factor.baseValue ?? factor.value)]))
    }));
}

function logistic(value) {
  return 1 / (1 + Math.exp(-clamp(value, -12, 12)));
}

function scoringSummary(rows) {
  if (!rows.length) return { sampleSize: 0, brierScore: null, logLoss: null };
  let brier = 0;
  let logLoss = 0;
  for (const row of rows) {
    const probability = clamp(row.probability, EPSILON, 1 - EPSILON);
    brier += (probability - row.outcome) ** 2;
    logLoss += -(row.outcome * Math.log(probability) + (1 - row.outcome) * Math.log(1 - probability));
  }
  return { sampleSize: rows.length, brierScore: brier / rows.length, logLoss: logLoss / rows.length };
}

export function buildWalkForwardFeatureModels(featureRows = [], options = {}) {
  const minSamples = Math.max(20, Number(options.minSamples ?? config.autoLearningMinSamples) || 30);
  const groups = new Map();
  for (const row of featureRows) {
    if (!groups.has(row.sport)) groups.set(row.sport, []);
    groups.get(row.sport).push(row);
  }
  const output = {};
  for (const [sport, rows] of groups) {
    rows.sort((a, b) => String(a.dateKey).localeCompare(String(b.dateKey)));
    const weights = {};
    const baselineScores = [];
    const learnedScores = [];
    let seen = 0;
    for (const row of rows) {
      for (const label of Object.keys(row.factors)) weights[label] ??= 1;
      const baselineLogit = Object.values(row.factors).reduce((total, value) => total + clamp(value, -3, 3), 0);
      const learnedLogit = Object.entries(row.factors).reduce((total, [label, value]) => total + clamp(value, -3, 3) * weights[label], 0);
      if (seen >= minSamples) {
        baselineScores.push({ probability: logistic(baselineLogit), outcome: row.outcome });
        learnedScores.push({ probability: logistic(learnedLogit), outcome: row.outcome });
      }
      const error = logistic(learnedLogit) - row.outcome;
      const learningRate = 0.055 / Math.sqrt(1 + seen / 80);
      for (const [label, rawValue] of Object.entries(row.factors)) {
        const value = clamp(rawValue, -3, 3);
        const regularization = 0.018 * (weights[label] - 1);
        weights[label] = clamp(weights[label] - learningRate * (error * value + regularization), 0.35, 1.65);
      }
      seen += 1;
    }
    const baseline = scoringSummary(baselineScores);
    const learned = scoringSummary(learnedScores);
    const brierImprovement = baseline.brierScore === null || learned.brierScore === null ? null : baseline.brierScore - learned.brierScore;
    const accepted = seen >= minSamples && learned.sampleSize >= 20 && brierImprovement > 0.001;
    const reliability = accepted ? clamp((seen - minSamples + 1) / 220, 0, 0.78) : 0;
    const shrunkWeights = Object.fromEntries(Object.entries(weights).map(([label, value]) => [label, 1 + (value - 1) * reliability]));
    output[sport] = {
      trained: seen >= minSamples,
      accepted,
      sampleSize: seen,
      evaluationSampleSize: learned.sampleSize,
      weights: shrunkWeights,
      baselineBrier: baseline.brierScore,
      learnedBrier: learned.brierScore,
      baselineLogLoss: baseline.logLoss,
      learnedLogLoss: learned.logLoss,
      brierImprovement,
      walkForward: true
    };
  }
  return output;
}

export function buildDriftReport(rows = [], options = {}) {
  const recentSize = Math.max(15, Number(options.recentSize ?? config.driftRecentSamples) || 30);
  const groups = new Map([['all', rows]]);
  for (const sport of new Set(rows.map((row) => profileKey(row.prediction)))) groups.set(sport, rows.filter((row) => profileKey(row.prediction) === sport));
  const output = {};
  for (const [sport, sportRows] of groups) {
    const sorted = [...sportRows].sort((a, b) => String(a.dateKey).localeCompare(String(b.dateKey)));
    const recentRows = sorted.slice(-recentSize);
    const baselineRows = sorted.slice(0, Math.max(0, sorted.length - recentRows.length));
    const recent = evaluatePredictionRows(recentRows);
    const baseline = evaluatePredictionRows(baselineRows);
    if (recent.sampleSize < recentSize || baseline.sampleSize < Math.max(30, recentSize)) {
      output[sport] = { status: 'insufficient', penalty: 0, recent, baseline };
      continue;
    }
    const brierDelta = recent.brierScore - baseline.brierScore;
    const calibrationDelta = recent.calibrationError - baseline.calibrationError;
    const accuracyDelta = recent.accuracy - baseline.accuracy;
    const penalty = clamp(
      Math.max(0, brierDelta - 0.01) * 2.2 +
      Math.max(0, calibrationDelta - 0.025) * 0.9 +
      Math.max(0, -accuracyDelta - 0.04) * 0.65,
      0, 0.35
    );
    output[sport] = {
      status: penalty >= 0.18 ? 'degraded' : penalty >= 0.07 ? 'watch' : 'stable',
      penalty,
      recent,
      baseline,
      brierDelta,
      calibrationDelta,
      accuracyDelta
    };
  }
  return output;
}

export function buildCalibrationModel(rows = []) {
  const groups = new Map();
  for (const row of rows) {
    if (row.prediction?.quoteRefreshOnly) continue;
    const probability = probabilityOf(row.prediction);
    if (probability === null || typeof row.correct !== 'boolean') continue;
    for (const key of new Set(['all', profileKey(row.prediction)])) {
      if (!groups.has(key)) groups.set(key, Array.from({ length: 10 }, () => ({ count: 0, correct: 0, probabilityTotal: 0 })));
      const bin = groups.get(key)[calibrationBin(probability)];
      bin.count += 1;
      bin.correct += row.correct ? 1 : 0;
      bin.probabilityTotal += probability;
    }
  }
  return Object.fromEntries([...groups.entries()].map(([key, bins]) => [key, bins]));
}

// Every archived outcome is observed after the event, including non-selected
// outcomes. Keep their validation counts separate from selected-pick calibration.
export function buildOutcomeValidation(rows = []) {
  const groups = {};
  for (const row of rows) {
    if (row.prediction?.quoteRefreshOnly) continue;
    if (!['away', 'home', 'draw'].includes(row.actualSide)) continue;
    const generated = Date.parse(row.prediction?.predictionGeneratedAt || '');
    const start = Date.parse(row.prediction?.startTime || row.game?.startTime || '');
    if (!Number.isFinite(generated) || !Number.isFinite(start) || generated >= start) continue;
    const sport = profileKey(row.prediction);
    for (const [side, percent] of Object.entries(row.prediction?.outcomeProbabilities || {})) {
      if (!['away', 'home', 'draw'].includes(side)) continue;
      const probability = finiteNumber(percent);
      if (probability === null || probability <= 0 || probability >= 100) continue;
      groups[sport] ??= {};
      groups[sport][side] ??= Array.from({ length: 10 }, () => ({ count: 0, correct: 0, probabilityTotal: 0 }));
      const bin = groups[sport][side][calibrationBin(probability / 100)];
      bin.count += 1;
      bin.correct += Number(side === row.actualSide);
      bin.probabilityTotal += probability / 100;
    }
  }
  return groups;
}

export function calibrateSelectedProbability(probability, key, model = {}) {
  const raw = clamp(Number(probability) || 0.5, EPSILON, 1 - EPSILON);
  const profileBins = model[String(key || '').toLowerCase()] || model.all || [];
  const bin = profileBins[calibrationBin(raw)];
  if (!bin || bin.count < 8) return { probability: raw, sampleSize: bin?.count || 0, adjustment: 0 };

  // A Bayesian reliability adjustment prevents a tiny Discord sample from
  // overpowering the sport model. More evidence gradually earns more weight.
  const priorStrength = 24;
  const posterior = (bin.correct + priorStrength * raw) / (bin.count + priorStrength);
  const reliability = clamp((bin.count - 7) / 80, 0, 0.72);
  const calibrated = clamp(raw * (1 - reliability) + posterior * reliability, 0.02, 0.98);
  return {
    probability: calibrated,
    sampleSize: bin.count,
    adjustment: calibrated - raw,
    observedAccuracy: bin.correct / bin.count
  };
}

function eloKey(league, team) {
  return `${normalizeEntityName(league)}__${normalizeEntityName(team)}`;
}

function resultRowsFromCaches(caches) {
  const rows = [];
  for (const cache of caches) {
    for (const game of cache?.slate?.games ?? []) {
      if (game.statusKey !== 'final') continue;
      if (!finalOutcomeSide(game)) continue;
      const awayScore = finiteNumber(game.away?.score);
      const homeScore = finiteNumber(game.home?.score);
      if (awayScore === null || homeScore === null) continue;
      rows.push({
        id: `cache:${cache.dateKey}:${game.id}`,
        dateKey: cache.dateKey,
        league: game.leagueKey || game.league,
        leagueKey: game.leagueKey,
        sportGroup: game.sportGroup,
        awayTeam: game.away?.name,
        homeTeam: game.home?.name,
        awayScore,
        homeScore,
        neutralSite: Boolean(game.neutralSite),
        seasonYear: game.seasonYear,
        seasonType: game.seasonType
      });
    }
  }
  return rows;
}

function inferredSeasonYear(row) {
  const explicit = Number(row.seasonYear);
  if (Number.isFinite(explicit) && explicit > 1900) return explicit;
  const date = new Date(`${row.dateKey || String(row.startTime || '').slice(0, 10)}T12:00:00Z`);
  if (!Number.isFinite(date.getTime())) return 0;
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  const profile = sportProfile({ leagueKey: row.leagueKey, sportGroup: row.sportGroup });
  return ['basketball', 'football', 'hockey', 'soccer'].includes(profile.key) && month >= 7 ? year + 1 : year;
}

function regressLeagueRatings(ratings, league, amount) {
  const prefix = `${normalizeEntityName(league)}__`;
  for (const [key, value] of ratings) {
    if (key.startsWith(prefix)) ratings.set(key, 1500 + (value - 1500) * (1 - amount));
  }
}

export function buildEloRatings(intelligence = {}, caches = [], externalResults = []) {
  const ratings = new Map();
  for (const team of Object.values(intelligence.teams || {})) {
    const elo = finiteNumber(team.elo);
    if (elo !== null && elo >= 800 && elo <= 2400) ratings.set(eloKey(team.league, team.name), elo);
  }

  const rows = [
    ...Object.values(intelligence.results || {}),
    ...externalResults,
    ...resultRowsFromCaches(caches)
  ];
  const deduped = new Map();
  for (const row of rows) {
    if (!scoreOutcome(row.awayScore, row.homeScore) || !row.awayTeam || !row.homeTeam) continue;
    const key = `${row.dateKey}:${eloKey(row.leagueKey || row.league, row.awayTeam)}:${eloKey(row.leagueKey || row.league, row.homeTeam)}:${row.awayScore}:${row.homeScore}`;
    if (!deduped.has(key)) deduped.set(key, row);
  }

  const seasonByLeague = new Map();
  for (const row of [...deduped.values()].sort((a, b) => String(a.dateKey).localeCompare(String(b.dateKey)))) {
    const league = row.leagueKey || row.league;
    const seasonYear = inferredSeasonYear(row);
    const priorSeason = seasonByLeague.get(normalizeEntityName(league));
    if (priorSeason && seasonYear && seasonYear !== priorSeason) {
      const profile = sportProfile({ leagueKey: row.leagueKey, sportGroup: row.sportGroup });
      regressLeagueRatings(ratings, league, profile.seasonRegression);
    }
    if (seasonYear) seasonByLeague.set(normalizeEntityName(league), seasonYear);
    const awayKey = eloKey(row.leagueKey || row.league, row.awayTeam);
    const homeKey = eloKey(row.leagueKey || row.league, row.homeTeam);
    const awayRating = ratings.get(awayKey) ?? 1500;
    const homeRating = ratings.get(homeKey) ?? 1500;
    const profile = sportProfile({ leagueKey: row.leagueKey, sportGroup: row.sportGroup });
    const homeAdvantage = row.neutralSite ? 0 : profile.homeAdvantageElo;
    const expectedHome = 1 / (1 + 10 ** ((awayRating - homeRating - homeAdvantage) / 400));
    const homeScore = Number(row.homeScore);
    const awayScore = Number(row.awayScore);
    const actualHome = homeScore === awayScore ? 0.5 : homeScore > awayScore ? 1 : 0;
    const margin = Math.abs(homeScore - awayScore);
    const marginMultiplier = clamp(Math.log(margin + 1) * (2.2 / (Math.abs(homeRating - awayRating) * 0.001 + 2.2)), 0.75, 2.5);
    const k = 16 + profile.volatility * 35;
    const change = k * marginMultiplier * (actualHome - expectedHome);
    ratings.set(homeKey, clamp(homeRating + change, 800, 2400));
    ratings.set(awayKey, clamp(awayRating - change, 800, 2400));
  }

  return Object.fromEntries([...ratings.entries()].map(([key, value]) => [key, Math.round(value * 10) / 10]));
}

export function lookupElo(ratings, league, team) {
  return Number(ratings?.[eloKey(league, team)] ?? 1500);
}

export async function loadModelContext(guildId = '', days = 365, options = {}) {
  const [intelligence, loadedCaches] = await Promise.all([
    options.intelligence ? Promise.resolve(options.intelligence) : readIntelligenceStore(guildId),
    listDailyCaches(days, guildId)
  ]);
  // A historical rebuild may only learn from caches that existed before the
  // prediction date. This makes calibration and feature training walk-forward.
  const caches = options.asOfDateKey
    ? loadedCaches.filter((cache) => String(cache.dateKey) < String(options.asOfDateKey))
    : loadedCaches;
  const cohort = { modelVersion: options.modelVersion || CURRENT_MODEL_VERSION, horizon: options.horizon || 'Daily' };
  const rows = collectGradedRows(caches, cohort);
  const beforeCutoff = (row) => !options.asOfDateKey || (row.dateKey && String(row.dateKey).slice(0, 10) < String(options.asOfDateKey));
  const historicalIntelligence = { ...intelligence, results: Object.fromEntries(Object.entries(intelligence.results || {}).filter(([, row]) => beforeCutoff(row))) };
  const externalResults = (options.externalResults || []).filter(beforeCutoff);
  const featureRows = collectFeatureRows(caches, cohort);
  const overall = evaluatePredictionRows(rows);
  const bySport = {};
  for (const key of [...new Set(rows.map((row) => profileKey(row.prediction)))]) {
    bySport[key] = evaluatePredictionRows(rows.filter((row) => profileKey(row.prediction) === key));
  }
  return {
    intelligence,
    history: { overall, bySport, rows: rows.length, cohort, evaluationVersion: EVALUATION_VERSION },
    calibration: buildCalibrationModel(rows),
    outcomeValidation: buildOutcomeValidation(rows),
    featureLearning: config.autoLearningEnabled ? buildWalkForwardFeatureModels(featureRows) : {},
    drift: buildDriftReport(rows),
    eloRatings: buildEloRatings(historicalIntelligence, caches, externalResults),
    externalResults,
    cacheCount: caches.length
  };
}

export async function evaluateGuildModel(guildId = '', days = 365) {
  const [caches, warehouse] = await Promise.all([listDailyCaches(days, guildId), readFeatureWarehouse()]);
  const allRows = collectGradedRows(caches);
  const cohort = { modelVersion: CURRENT_MODEL_VERSION, horizon: 'Daily' };
  const rows = collectGradedRows(caches, cohort);
  const featureRows = collectFeatureRows(caches, cohort);
  const overall = evaluatePredictionRows(rows);
  const bySport = {};
  for (const key of [...new Set(rows.map((row) => profileKey(row.prediction)))]) {
    bySport[key] = evaluatePredictionRows(rows.filter((row) => profileKey(row.prediction) === key));
  }
  return {
    days,
    cacheCount: caches.length,
    overall,
    cohort,
    evaluationVersion: EVALUATION_VERSION,
    scoreDefinition: 'Binary selected-outcome Brier/log loss; full-outcome horizon scores are separate.',
    byVersionAndHorizon: Object.fromEntries([...new Set(allRows.map(row => `${row.modelVersion}|${row.horizon}`))]
      .map(key => [key, evaluatePredictionRows(allRows.filter(row => `${row.modelVersion}|${row.horizon}` === key))])),
    bySport,
    featureLearning: buildWalkForwardFeatureModels(featureRows),
    drift: buildDriftReport(rows),
    horizons: evaluatePredictionHorizons(
      warehouse.predictions.filter((row) => String(row.guildId || '') === String(guildId || '')),
      warehouse.markets.filter((row) => String(row.guildId || '') === String(guildId || '')),
      { modelVersion: CURRENT_MODEL_VERSION }
    )
  };
}
