import {summarizeHorizonRows as summarize} from './horizonStatistics.js';
import { eventObservationHash } from './journalEventMatch.js';
import { quoteTimeEpoch as instant } from './oddsPricing.js';
import { validCandidateVector } from './candidateCohorts.js';
import { journalOutcomeVector } from './journalOutcomeSpace.js';
import { probabilityLogLoss, LOG_LOSS_PROTOCOL } from './probabilityLogLoss.js';
import { finiteNumber } from './dataValidation.js';

function normalizedPrediction(row = {}) {
  const model = row.candidateProbabilities?.[row.championModel] ? row.championModel : 'evidence';
  const primary = row.outcomeProbabilities;
  const source = primary || row.candidateProbabilities?.[model];
  if (!source || typeof source !== 'object' || Array.isArray(source)) return null;
  // Preserve scale per vector, including sub-1% values; never coerce numeric strings.
  const percentages = primary || Object.fromEntries(Object.entries(source).map(([side,p]) =>
    [side, typeof p === 'number' ? p * 100 : p]));
  const declared = primary ? row.modeledOutcomes : row.candidateModeledOutcomes?.[model];
  const full = journalOutcomeVector({outcomePercentages:percentages,modeledOutcomes:declared});
  if (!full) return null;
  const sides = full.draw > 0 || row.actualSide === 'draw' ? ['away','home','draw'] : ['away','home'];
  const total = sides.reduce((sum,side) => sum + full[side],0);
  return {sides,vector:Object.fromEntries(sides.map(side => [side,full[side]/total]))};
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

const leagueKey = row => String(row.leagueKey || row.league || '').trim().toLowerCase();
const eventKey = row => JSON.stringify([String(row.guildId || ''),leagueKey(row),String(row.gameId),
  Number.isFinite(instant(row.startTime)) ? new Date(instant(row.startTime)).toISOString() : null]);
const resultEventKey = row => JSON.stringify([leagueKey(row),String(row.gameId),
  Number.isFinite(instant(row.startTime)) ? new Date(instant(row.startTime)).toISOString() : null]);
const frozenForecastHash = row => eventObservationHash({
  generatedAt:new Date(instant(row.predictionGeneratedAt)).toISOString(),
  outcomeProbabilities:row.outcomeProbabilities,modeledOutcomes:row.modeledOutcomes,predictedSide:row.predictedSide,
  candidateProbabilities:row.candidateProbabilities,candidateModeledOutcomes:row.candidateModeledOutcomes,
  championModel:row.championModel,inputSnapshot:row.inputSnapshot
});

function closingMarket(markets = [], prediction = {}, probabilities) {
  const start = instant(prediction.startTime);
  if (!leagueKey(prediction) || prediction.gameId == null || !String(prediction.gameId).trim() || !Number.isFinite(start))
    return {row:null,status:'prediction_scope_unverified'};
  const scoped = markets.filter(row => eventKey(row) === eventKey(prediction)
    && ['closing','t-10'].includes(row.stage));
  const timed = scoped.filter(row => Number.isFinite(instant(row.capturedAt)) && instant(row.capturedAt) < start)
    .sort((a,b) => instant(b.capturedAt) - instant(a.capturedAt));
  if (!timed.length) return {row:null,status:scoped.length?'no_valid_prestart_receipt':'no_scoped_snapshot'};
  const latest = timed.filter(row => instant(row.capturedAt) === instant(timed[0].capturedAt));
  const vectors = latest.map(row => ({away:row.away,home:row.home,draw:row.draw}));
  if (vectors.some(vector => !validCandidateVector(vector))) return {row:null,status:'latest_vector_invalid'};
  const normalized = vectors.map(vector => {
    const total = vector.away + vector.home + vector.draw;
    return Object.fromEntries(Object.entries(vector).map(([side,p]) => [side,p/total]));
  });
  if (new Set(normalized.map(vector => JSON.stringify(vector))).size > 1) return {row:null,status:'latest_snapshot_conflict'};
  if ((normalized[0].draw > 0) !== (probabilities.vector.draw > 0)) return {row:null,status:'outcome_space_mismatch'};
  return {row:{...timed[0],...normalized[0]},status:'scoped_prestart_snapshot'};
}

function seasonPhase(row = {}) {
  if (Number(row.inputSnapshot?.seasonType) === 3 || /postseason|playoff/i.test(String(row.inputSnapshot?.seasonSlug || ''))) return 'postseason';
  return 'regular';
}

export function evaluatePredictionHorizons(predictions = [], markets = [], options = {}) {
  const deduped = new Map(), groups = new Map(), resultLabels = new Map(), disputed = new Set();
  const versions = [...new Set(predictions.map(row => row.modelVersion || 'legacy-unversioned'))]
    .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  const selectedVersion = options.modelVersion || versions.find(version => version !== 'legacy-unversioned') || 'legacy-unversioned';
  for (const row of predictions) {
    if (row.quoteRefreshOnly || row.predictionMode !== 'pregame') continue;
    const generatedAt = instant(row.predictionGeneratedAt), startTime = instant(row.startTime);
    if (!Number.isFinite(generatedAt) || !Number.isFinite(startTime) || generatedAt >= startTime) continue;
    const event = resultEventKey(row);
    if (row.resultEvidenceStatus === 'disputed') disputed.add(event);
    if (['away','home','draw'].includes(row.actualSide)) {
      if (!resultLabels.has(event)) resultLabels.set(event,new Set());
      resultLabels.get(event).add(row.actualSide);
    }
    if ((row.modelVersion || 'legacy-unversioned') !== selectedVersion || !['away','home','draw'].includes(row.actualSide)) continue;
    const key = JSON.stringify([eventKey(row),selectedVersion,predictionHorizon(row)]);
    if (!groups.has(key)) groups.set(key,[]);
    groups.get(key).push(row);
  }
  const conflicting = new Set([...resultLabels].filter(([,labels]) => labels.size > 1).map(([key]) => key));
  const scored = [], scoringExclusions = {}, closingSnapshotStatuses = {};
  const exclude = reason => { scoringExclusions[reason] = (scoringExclusions[reason] || 0) + 1; };
  for (const [key,rows] of groups) {
    rows.sort((a,b) => instant(b.predictionGeneratedAt) - instant(a.predictionGeneratedAt));
    const row = rows[0], event = resultEventKey(row);
    if (conflicting.has(event)) { exclude('conflicting_event_results'); continue; }
    if (disputed.has(event)) { exclude('disputed_event_result'); continue; }
    const latest = rows.filter(other => instant(other.predictionGeneratedAt) === instant(row.predictionGeneratedAt));
    if (new Set(latest.map(frozenForecastHash)).size > 1) { exclude('simultaneous_forecast_conflict'); continue; }
    deduped.set(key,row);
  }
  for (const row of deduped.values()) {
    const prediction = normalizedPrediction(row);
    if (!prediction) { exclude('invalid_or_unverified_outcome_vector'); continue; }
    const selectedSide = row.predictedSide || [...prediction.sides].sort((a, b) => prediction.vector[b] - prediction.vector[a])[0];
    if (!prediction.sides.includes(selectedSide) || prediction.vector[selectedSide] !== Math.max(...Object.values(prediction.vector))) {
      exclude('invalid_frozen_selection'); continue;
    }
    const selectedProbability = prediction.vector[selectedSide];
    const brier = prediction.sides.reduce((sum, side) => sum + (prediction.vector[side] - Number(side === row.actualSide)) ** 2, 0) / prediction.sides.length;
    const closingSelection = closingMarket(markets, row, prediction);
    closingSnapshotStatuses[closingSelection.status] = (closingSnapshotStatuses[closingSelection.status] || 0) + 1;
    const closing = closingSelection.row;
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
      logLoss: probabilityLogLoss(prediction.vector[row.actualSide] || 0),
      modelVsCloseEdge: Number.isFinite(closingProbability) ? selectedProbability - closingProbability : null
    });
  }
  const group = (key) => Object.fromEntries([...new Set(scored.map((row) => row[key]))].sort().map((value) => [value, summarize(scored.filter((row) => row[key] === value))]));
  const latestByGame = new Map(), overallConflicts = new Set(), overallGroups = new Map();
  let overallLatestForecastNotScorable = 0;
  const scoredByIssue = new Map(scored.map(item => [JSON.stringify([eventKey(item.row),instant(item.row.predictionGeneratedAt)]),item]));
  for (const rows of groups.values()) for (const row of rows) {
    const key = eventKey(row);
    if (!overallGroups.has(key)) overallGroups.set(key,[]);
    overallGroups.get(key).push(row);
  }
  for (const [key,rows] of overallGroups) {
    const latestAt = rows.reduce((at,row) => Math.max(at,instant(row.predictionGeneratedAt)),-Infinity);
    const latest = rows.filter(row => instant(row.predictionGeneratedAt) === latestAt);
    if (new Set(latest.map(frozenForecastHash)).size > 1) { overallConflicts.add(key); continue; }
    const match = scoredByIssue.get(JSON.stringify([key,latestAt]));
    if (match) latestByGame.set(key,match); else overallLatestForecastNotScorable++;
  }
  return {
    generatedAt: new Date().toISOString(),
    methodology: 'One declared model version; overall retains latest eligible issue per guild/event and weights canonical games equally across those records. Horizon/stratum populations overlap. Intervals resample whole games; day/team/league dependence is not resolved.',
    modelVersion: selectedVersion,
    versionsAvailable: versions,
    logLossProtocol: LOG_LOSS_PROTOCOL,
    scoringCandidates: groups.size, scoringExclusions, closingSnapshotStatuses,
    conflictingResultEvents: conflicting.size, disputedResultEvents: disputed.size,
    overallSimultaneousForecastConflicts: overallConflicts.size, overallLatestForecastNotScorable,
    closingComparisonPolicy: 'Latest scoped league/event/start/guild snapshot with an explicit-zone receipt before start; equal-time conflicts excluded. Receipt and stage do not prove an actual closing, fresh provider, executable or independent price. Status counts are per scored forecast/horizon.',
    scoreDefinition: 'Full-outcome Brier (mean over outcome coordinates) and multinomial log loss; distinct from selected-outcome binary scores.',
    overall: summarize([...latestByGame.values()]),
    byHorizon: group('horizon'),
    byLeague: group('league'),
    bySeasonPhase: group('seasonPhase'),
    byFavoriteClass: group('favoriteClass')
  };
}
