import {createHash} from 'node:crypto';
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
  const rows = new Map(), conflicts = new Set();
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
      if (options.availableBefore !== undefined) {
        const observed = Date.parse(prediction.resultObservedAt || '');
        if (!game || !outcomeSide(game) || !Number.isFinite(observed) || observed < start || observed >= options.availableBefore) continue;
      }
      const horizon = predictionHorizon({ ...prediction, minutesToStart: (start - generated) / 60_000 });
      if (options.modelVersion && prediction.modelVersion !== options.modelVersion) continue;
      if (options.horizon && horizon !== options.horizon) continue;
      const key = options.uniqueGames
        ? JSON.stringify([prediction.leagueKey || prediction.league || game?.leagueKey || '',prediction.gameId,start,prediction.modelVersion,horizon])
        : [cache.slate?.guildId || '', prediction.leagueKey || prediction.league || '', cache.dateKey,
          prediction.gameId, prediction.modelVersion, horizon].join(':');
      const prior = rows.get(key);
      if (options.uniqueGames && prior && (prior.actualSide !== outcomeSide(game) || prior.correct !== prediction.predictionCorrect)) conflicts.add(key);
      if (prior && (options.uniqueGames ? Date.parse(prior.prediction.predictionGeneratedAt || '') <= generated
        : Date.parse(prior.prediction.predictionGeneratedAt || '') >= generated)) continue;
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
  return [...rows].filter(([key]) => !conflicts.has(key)).map(([,row])=>row);
}

export function collectFeatureRows(caches = [], options = {}) {
  return collectGradedRows(caches, options)
    .filter((row) => ['away', 'home', 'draw'].includes(row.actualSide) && Array.isArray(row.prediction?.factors) && row.prediction.factors.length)
    .map((row) => ({
      dateKey: row.dateKey,
      gameId: String(row.prediction.gameId || ''), league: row.prediction.leagueKey || row.game?.leagueKey || '',
      modelVersion: row.modelVersion, horizon: row.horizon,
      predictionGeneratedAt: row.prediction.predictionGeneratedAt, startTime: row.prediction.startTime || row.game?.startTime,
      resolvedAt: row.prediction.resultObservedAt || null,
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
  const asOf = options.asOf === undefined ? Date.now() : Number(options.asOf);
  if (!Number.isFinite(asOf)) throw new Error('Feature learning requires a valid information cutoff');
  const groups = new Map();
  for (const row of featureRows) {
    if (!groups.has(row.sport)) groups.set(row.sport, []);
    groups.get(row.sport).push(row);
  }
  const output = {};
  for (const [sport, input] of groups) {
    const excluded = {}, unique = new Map();
    const reject = reason => { excluded[reason] = (excluded[reason] || 0) + 1; };
    for (const row of input) {
      const generated = Date.parse(row.predictionGeneratedAt || ''), start = Date.parse(row.startTime || ''), resolved = Date.parse(row.resolvedAt || '');
      if (![generated,start,resolved].every(Number.isFinite) || generated >= start || resolved < start || resolved > asOf) { reject('outcome_chronology_unverified'); continue; }
      if (!row.gameId || ![0,0.5,1].includes(row.outcome) || !row.factors || !Object.keys(row.factors).length
        || Object.values(row.factors).some(value => typeof value !== 'number' || !Number.isFinite(value))) { reject('invalid_training_input'); continue; }
      // Different guilds/horizons of one game are not independent training examples.
      const key = JSON.stringify([row.league || '',row.gameId,row.startTime]);
      const previous = unique.get(key);
      if (previous && previous.outcome !== row.outcome) { unique.set(key,{...previous,conflicting:true}); continue; }
      if (!previous || generated < Date.parse(previous.predictionGeneratedAt)) unique.set(key,{...row,conflicting:previous?.conflicting || false});
    }
    const rows = [...unique.values()].filter(row => { if(row.conflicting){reject('conflicting_game_outcome');return false;} return true; })
      .sort((a,b) => Date.parse(a.predictionGeneratedAt)-Date.parse(b.predictionGeneratedAt) || String(a.gameId).localeCompare(String(b.gameId)));
    const split = Math.max(minSamples,Math.floor(rows.length*0.7)), validation = rows.slice(split);
    const validationStart = validation.length ? Date.parse(validation[0].predictionGeneratedAt) : null;
    const training = rows.slice(0,split).filter(row => {
      if (validationStart !== null && Date.parse(row.resolvedAt) >= validationStart) { reject('training_label_overlaps_validation'); return false; }
      return true;
    });
    // Fit in outcome-availability order, with no validation labels or factors entering the fitted artifact.
    training.sort((a,b) => Date.parse(a.resolvedAt)-Date.parse(b.resolvedAt) || String(a.gameId).localeCompare(String(b.gameId)));
    const weights = {}; let seen = 0;
    for (const row of training) {
      for (const label of Object.keys(row.factors).sort()) weights[label] ??= 1;
      const logit = Object.entries(row.factors).reduce((sum,[label,value]) => sum+clamp(value,-3,3)*weights[label],0);
      const error = logistic(logit)-row.outcome, rate = 0.055/Math.sqrt(1+seen/80);
      for (const [label,raw] of Object.entries(row.factors)) weights[label] = clamp(weights[label]-rate*(error*clamp(raw,-3,3)+0.018*(weights[label]-1)),0.35,1.65);
      seen++;
    }
    const reliability = clamp((training.length-minSamples+1)/220,0,0.78);
    const fitted = Object.fromEntries(Object.entries(weights).sort(([a],[b])=>a.localeCompare(b)).map(([label,value])=>[label,clamp(1+(value-1)*reliability,0.6,1.4)]));
    const scores = (learned) => validation.map(row => ({outcome:row.outcome,probability:logistic(Object.entries(row.factors)
      .reduce((sum,[label,value])=>sum+clamp(value,-3,3)*(learned ? fitted[label] ?? 1 : 1),0))}));
    const baseline = scoringSummary(scores(false)), challenger = scoringSummary(scores(true));
    const improvement = baseline.brierScore === null ? null : baseline.brierScore-challenger.brierScore;
    const artifact = {schema:'sports-feature-fit-v2',sport,weights:fitted,
      trainingHash:createHash('sha256').update(JSON.stringify(training)).digest('hex'),
      trainingSamples:training.length,lastTrainingOutcomeAt:training.at(-1)?.resolvedAt || null};
    const artifactId = createHash('sha256').update(JSON.stringify(artifact)).digest('hex');
    output[sport] = {...artifact,artifactId,trained:training.length>=minSamples,accepted:false,productionEligible:false,
      researchAccepted:training.length>=minSamples && validation.length>=20 && improvement>0.001,
      activationReason:'Frozen feature candidate requires independent prospective artifact review; automatic activation disabled.',
      sampleSize:rows.length,trainingSampleSize:training.length,evaluationSampleSize:validation.length,excluded,
      baselineBrier:baseline.brierScore,learnedBrier:challenger.brierScore,baselineLogLoss:baseline.logLoss,
      learnedLogLoss:challenger.logLoss,brierImprovement:improvement,walkForward:true,
      validationProtocol:'Single terminal chronological split; training labels purged at first validation issuance; exact shrunk fit scored without validation updates.'};
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

/** Filter learning evidence by actual recorded availability, never by schedule date alone. */
export function learningInputsBefore(caches = [], intelligence = {}, externalResults = [], { cutoff, dateKey = null } = {}) {
  if (!Number.isFinite(cutoff)) throw new Error('Learning context requires a valid information cutoff');
  const excluded = {};
  const exclude = reason => { excluded[reason] = (excluded[reason] || 0) + 1; return false; };
  const priorDate = row => !dateKey || row.dateKey && String(row.dateKey).slice(0,10) < dateKey;
  const available = (row,kind) => {
    if (!priorDate(row)) return exclude(`${kind}:same_or_later_schedule_date`);
    const times = [row.observedAt,row.recordedAt,row.updatedAt,row.sourceMeta?.fetchedAt].filter(value => value !== undefined && value !== null && value !== '').map(value => Date.parse(value));
    const start = Date.parse(row.startTime || `${row.dateKey}T00:00:00Z`);
    if (!times.length || !times.every(Number.isFinite) || !Number.isFinite(start) || Math.min(...times) < start) return exclude(`${kind}:availability_unknown_or_invalid`);
    if (Math.max(...times) >= cutoff) return exclude(`${kind}:not_available_before_cutoff`);
    return true;
  };
  const selectedCaches = caches.filter(priorDate);
  const eloCaches = selectedCaches.map(cache => ({...cache,slate:{...cache.slate,games:(cache.slate?.games || []).filter(game => {
    const prediction = (cache.slate?.predictions || []).find(row => String(row.gameId) === String(game.id));
    return available({dateKey:cache.dateKey,startTime:game.startTime,
      observedAt:prediction?.resultObservedAt},'cached_result');
  })}}));
  const teams = Object.fromEntries(Object.entries(intelligence.teams || {}).filter(([,row]) => {
    const updated = Date.parse(row.updatedAt || '');
    return Number.isFinite(updated) && updated < cutoff || exclude('team_seed:availability_unknown_or_after_cutoff');
  }));
  const results = Object.fromEntries(Object.entries(intelligence.results || {}).filter(([,row]) => available(row,'manual_result')));
  return { caches:selectedCaches,eloCaches,intelligence:{...intelligence,teams,results},
    externalResults:externalResults.filter(row => available(row,'external_result')),
    audit:{schema:'sports-learning-cutoff-v1',cutoffAt:new Date(cutoff).toISOString(),scheduleDateExclusive:dateKey,
      excluded,pointInTimeComplete:false,
      limitations:['Latest mutable records are excluded when newer than the cutoff; earlier revisions are not reconstructed.',
        'Receipt/record time establishes observed availability only, not exact source publication or official completion time.',
        'This gate covers learning/calibration/Elo inputs; other current manual profiles and automatic features require separate provenance review.']}};
}

export async function loadModelContext(guildId = '', days = 365, options = {}) {
  const [intelligence, loadedCaches] = await Promise.all([
    options.intelligence ? Promise.resolve(options.intelligence) : readIntelligenceStore(guildId),
    listDailyCaches(days, guildId)
  ]);
  const cutoff = options.asOf === undefined
    ? options.asOfDateKey ? Date.parse(`${options.asOfDateKey}T00:00:00Z`) : Date.now()
    : Number(options.asOf);
  const inputs = learningInputsBefore(loadedCaches,intelligence,options.externalResults || [],{cutoff,dateKey:options.asOfDateKey || null});
  const caches = inputs.caches;
  const cohort = { modelVersion: options.modelVersion || CURRENT_MODEL_VERSION, horizon: options.horizon || 'Daily', availableBefore:cutoff,uniqueGames:true };
  const rows = collectGradedRows(caches,cohort);
  const featureRows = collectFeatureRows(caches,cohort);
  const overall = evaluatePredictionRows(rows);
  const bySport = {};
  for (const key of [...new Set(rows.map((row) => profileKey(row.prediction)))]) {
    bySport[key] = evaluatePredictionRows(rows.filter((row) => profileKey(row.prediction) === key));
  }
  return {
    intelligence:inputs.intelligence,
    learningInputAudit:{...inputs.audit,eligibleCalibrationRows:rows.length,
      calibrationRowsExcludedForAvailabilityOrDuplicateConflict:collectGradedRows(caches,{modelVersion:cohort.modelVersion,horizon:cohort.horizon}).length-rows.length},
    history: { overall, bySport, rows: rows.length, cohort, evaluationVersion: EVALUATION_VERSION },
    calibration: buildCalibrationModel(rows),
    outcomeValidation: buildOutcomeValidation(rows),
    featureLearning: config.autoLearningEnabled ? buildWalkForwardFeatureModels(featureRows, { asOf:cutoff }) : {},
    drift: buildDriftReport(rows),
    eloRatings: buildEloRatings(inputs.intelligence,inputs.eloCaches,inputs.externalResults),
    externalResults:inputs.externalResults,
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
