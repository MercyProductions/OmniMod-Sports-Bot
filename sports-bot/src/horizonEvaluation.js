import { finiteNumber } from './dataValidation.js';

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizedPrediction(row = {}) {
  const source = row.outcomeProbabilities || row.candidateProbabilities?.[row.championModel] || row.candidateProbabilities?.evidence || {};
  // Public outcomes are percentages; candidate model vectors are fractions.
  // Scaling each coordinate independently misreads outcomes below 1%.
  const scale = row.outcomeProbabilities ? 100 : 1;
  const probability = (side) => finiteNumber(source[side], side === 'draw' ? 0 : NaN) / scale;
  const draw = probability('draw');
  const sides = draw > 0 || row.actualSide === 'draw' ? ['away', 'home', 'draw'] : ['away', 'home'];
  if (sides.some((side) => !Number.isFinite(probability(side)) || probability(side) < 0 || probability(side) > 1)) return null;
  const total = sides.reduce((sum, side) => sum + probability(side), 0);
  if (total <= 0) return null;
  return { sides, vector: Object.fromEntries(sides.map((side) => [side, probability(side) / total])) };
}

export function predictionHorizon(row = {}) {
  if (['Daily', 'T-90', 'T-30', 'T-10'].includes(row.horizon)) return row.horizon;
  const stage = String(row.snapshotStage || row.stage || '').toLowerCase();
  if (/t-?10\b/.test(stage)) return 'T-10';
  if (/t-?30\b/.test(stage)) return 'T-30';
  if (/t-?90\b/.test(stage)) return 'T-90';
  const minutes = finiteNumber(row.minutesToStart);
  if (minutes !== null && minutes >= 0) {
    if (minutes <= 15) return 'T-10';
    if (minutes <= 45) return 'T-30';
    if (minutes <= 120) return 'T-90';
  }
  return 'Daily';
}

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function percentile(values, fraction) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction)))];
}

function bootstrapIntervals(rows, repetitions = 300) {
  if (rows.length < 8) return { accuracy: null, brier: null };
  const random = seededRandom(rows.length * 7919 + 17);
  const accuracy = [];
  const brier = [];
  for (let iteration = 0; iteration < repetitions; iteration += 1) {
    let correct = 0;
    let brierTotal = 0;
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[Math.floor(random() * rows.length)];
      correct += Number(row.correct);
      brierTotal += row.brier;
    }
    accuracy.push(correct / rows.length);
    brier.push(brierTotal / rows.length);
  }
  return {
    accuracy: [percentile(accuracy, 0.025), percentile(accuracy, 0.975)],
    brier: [percentile(brier, 0.025), percentile(brier, 0.975)]
  };
}

function summarize(rows = []) {
  if (!rows.length) return { sampleSize: 0, accuracy: null, brierScore: null, logLoss: null, calibrationError: null, meanModelVsCloseEdge: null, bootstrap95: { accuracy: null, brier: null } };
  const bins = Array.from({ length: 10 }, () => ({ count: 0, probability: 0, correct: 0 }));
  let accuracy = 0;
  let brier = 0;
  let logLoss = 0;
  let closingEdge = 0;
  let closingCount = 0;
  for (const row of rows) {
    accuracy += Number(row.correct);
    brier += row.brier;
    logLoss += row.logLoss;
    const bin = bins[Math.min(9, Math.floor(row.selectedProbability * 10))];
    bin.count += 1;
    bin.probability += row.selectedProbability;
    bin.correct += Number(row.correct);
    if (Number.isFinite(row.modelVsCloseEdge)) { closingEdge += row.modelVsCloseEdge; closingCount += 1; }
  }
  const calibrationError = bins.filter((bin) => bin.count).reduce((sum, bin) =>
    sum + (bin.count / rows.length) * Math.abs(bin.correct / bin.count - bin.probability / bin.count), 0);
  return {
    sampleSize: rows.length,
    accuracy: accuracy / rows.length,
    brierScore: brier / rows.length,
    logLoss: logLoss / rows.length,
    calibrationError,
    meanModelVsCloseEdge: closingCount ? closingEdge / closingCount : null,
    closingSampleSize: closingCount,
    bootstrap95: bootstrapIntervals(rows)
  };
}

function closingMarket(markets = [], prediction = {}) {
  const start = Date.parse(prediction.startTime || '');
  return [...markets]
    .filter((row) => String(row.gameId) === String(prediction.gameId) && String(row.guildId || '') === String(prediction.guildId || ''))
    .filter((row) => Number.isFinite(start) && Number.isFinite(Date.parse(row.capturedAt || '')) && Date.parse(row.capturedAt) < start)
    .sort((a, b) => String(b.capturedAt || '').localeCompare(String(a.capturedAt || '')))
    .find((row) => row.stage === 'closing' || row.stage === 't-10') || null;
}

function seasonPhase(row = {}) {
  if (Number(row.inputSnapshot?.seasonType) === 3 || /postseason|playoff/i.test(String(row.inputSnapshot?.seasonSlug || ''))) return 'postseason';
  return 'regular';
}

export function evaluatePredictionHorizons(predictions = [], markets = [], options = {}) {
  const deduped = new Map();
  const versions = [...new Set(predictions.map(row => row.modelVersion || 'legacy-unversioned'))]
    .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  const selectedVersion = options.modelVersion || versions.find(version => version !== 'legacy-unversioned') || 'legacy-unversioned';
  for (const row of predictions) {
    if ((row.modelVersion || 'legacy-unversioned') !== selectedVersion) continue;
    if (row.quoteRefreshOnly) continue;
    if (!['away', 'home', 'draw'].includes(row.actualSide)) continue;
    if (row.predictionMode !== 'pregame') continue;
    const generatedAt = new Date(row.predictionGeneratedAt || '').getTime();
    const startTime = new Date(row.startTime || '').getTime();
    if (!Number.isFinite(generatedAt) || !Number.isFinite(startTime) || generatedAt >= startTime) continue;
    const horizon = predictionHorizon(row);
    const key = `${row.guildId || ''}:${row.leagueKey || row.league || ''}:${row.gameId}:${selectedVersion}:${horizon}`;
    const prior = deduped.get(key);
    if (!prior || String(row.predictionGeneratedAt || '') > String(prior.predictionGeneratedAt || '')) deduped.set(key, row);
  }
  const scored = [];
  for (const row of deduped.values()) {
    const prediction = normalizedPrediction(row);
    if (!prediction) continue;
    const selectedSide = row.predictedSide || [...prediction.sides].sort((a, b) => prediction.vector[b] - prediction.vector[a])[0];
    const selectedProbability = prediction.vector[selectedSide] || 0;
    const brier = prediction.sides.reduce((sum, side) => sum + (prediction.vector[side] - Number(side === row.actualSide)) ** 2, 0) / prediction.sides.length;
    const closing = closingMarket(markets, row);
    const closingProbability = closing ? finiteNumber(closing[selectedSide]) : null;
    const closingSides = closing
      ? ['away', 'home', 'draw'].filter((side) => Number.isFinite(Number(closing[side])) && Number(closing[side]) > 0)
      : [];
    const closingMaximum = closingSides.length ? Math.max(...closingSides.map((side) => Number(closing[side]))) : null;
    const favoriteSides = closingMaximum === null ? [] : closingSides.filter((side) => Math.abs(Number(closing[side]) - closingMaximum) < 0.000001);
    const favorite = favoriteSides.length === 1 ? favoriteSides[0] : favoriteSides.length > 1 ? 'balanced' : 'unknown';
    scored.push({
      row,
      horizon: predictionHorizon(row),
      league: row.leagueKey || row.league || 'unknown',
      seasonPhase: seasonPhase(row),
      favoriteClass: favorite === 'unknown' ? 'unknown' : favorite === 'balanced' ? 'balanced' : selectedSide === favorite ? 'favorite' : 'underdog',
      selectedProbability,
      correct: selectedSide === row.actualSide,
      brier,
      logLoss: -Math.log(clamp(prediction.vector[row.actualSide] || 0, 0.001, 0.999)),
      modelVsCloseEdge: Number.isFinite(closingProbability) ? selectedProbability - closingProbability : null
    });
  }
  const group = (key) => Object.fromEntries([...new Set(scored.map((row) => row[key]))].sort().map((value) => [value, summarize(scored.filter((row) => row[key] === value))]));
  const latestByGame = new Map();
  for (const scoredRow of scored) {
    const row = scoredRow.row, key = [row.guildId || '', row.leagueKey || row.league || '', row.gameId].join(':');
    const prior = latestByGame.get(key);
    if (!prior || Date.parse(row.predictionGeneratedAt) > Date.parse(prior.row.predictionGeneratedAt)) latestByGame.set(key, scoredRow);
  }
  return {
    generatedAt: new Date().toISOString(),
    methodology: 'One declared model version; overall uses latest frozen pregame forecast per game. Horizon groups are separate correlated populations. Intervals use game-IID bootstrap, not day/league-cluster validation.',
    modelVersion: selectedVersion,
    versionsAvailable: versions,
    scoreDefinition: 'Full-outcome Brier (mean over outcome coordinates) and multinomial log loss; distinct from selected-outcome binary scores.',
    overall: summarize([...latestByGame.values()]),
    byHorizon: group('horizon'),
    byLeague: group('league'),
    bySeasonPhase: group('seasonPhase'),
    byFavoriteClass: group('favoriteClass')
  };
}
