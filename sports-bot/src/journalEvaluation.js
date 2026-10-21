import {evaluateMatchedJournal} from './matchedJournalEvaluation.js';
import {validCandidateVector} from './candidateCohorts.js';
import { evaluatePredictionHorizons } from './horizonEvaluation.js';
import { evaluatePredictionRows } from './modelEvaluation.js';

function selectedSide(vector) {
  return Object.entries(vector).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
}

export function summarizePredictionJournal(records = []) {
  const forecasts = records.filter(row => row.type === 'forecast' && row.payload.lifecycleState === 'ISSUED').map(row => row.payload);
  const delivered = new Set(records.filter(row => row.type === 'forecast_lifecycle' && row.payload.state === 'DELIVERED').map(row => row.payload.forecastId));
  const results = new Map(records.filter(row => row.type === 'result').map(row => [row.payload.forecastId, row.payload]));
  const versions = [...new Set(forecasts.map(row => row.modelVersion))].sort();
  const byVersion = {};
  for (const version of versions) {
    const versionRows = forecasts.filter(row => row.modelVersion === version);
    const graded = versionRows.filter(row => results.has(row.forecastId));
    const convert = (row, probabilities = row.outcomePercentages, side = row.selectedSide) => ({
      ...row, actualSide: results.get(row.forecastId).actualSide, predictedSide: side,
      predictionMode: 'pregame', outcomeProbabilities: probabilities
    });
    const modelRows = graded.map(row => convert(row));
    const firstPerGame = new Map();
    for (const row of graded) {
      const key = JSON.stringify([row.league, row.gameId, row.startTime]);
      if (!firstPerGame.has(key)) firstPerGame.set(key, row);
    }
    const baselineComparisons = {};
    for (const baseline of ['elo', 'market']) {
      const matched = graded.filter(row => validCandidateVector(row.referenceBaselines?.[baseline]?.probabilities));
      const referenceRows = matched.map(row => {
        const vector = row.referenceBaselines[baseline].probabilities;
        return convert(row, Object.fromEntries(Object.entries(vector).map(([side, p]) => [side, p * 100])), selectedSide(vector));
      });
      baselineComparisons[baseline] = {
        primaryOnMatchedGames: evaluatePredictionHorizons(matched.map(row => convert(row)), [], { modelVersion: version }),
        referenceOnMatchedGames: evaluatePredictionHorizons(referenceRows, [], { modelVersion: version }),
        limitations: baseline === 'market' ? 'Available consensus can be stale or market-informed; this is not an independent betting edge or a closing-price benchmark.'
          : 'Fixed-draw-prior Elo reference captured with the forecast; not the complete untouched v6.0.0 pipeline.'
      };
    }
    byVersion[version] = {
      forecasts: versionRows.length, graded: graded.length, unresolved: versionRows.length - graded.length,
      outcomes: evaluatePredictionHorizons(modelRows, [], { modelVersion: version }),
      selectedOutcomeBinary: { ...evaluatePredictionRows([...firstPerGame.values()].map(row => ({
        correct: row.selectedSide === results.get(row.forecastId).actualSide,
        prediction: { predictionProbability: row.outcomePercentages[row.selectedSide] / 100 }
      }))), selectionRule: 'First issued record per event/model-version across guilds and horizons; no duplicated game counts.' },
      referenceComparisons: baselineComparisons
    };
  }
  return { status: forecasts.length ? 'prospective_records_available' : 'no_prospective_forecasts',
    records: records.length, forecasts: forecasts.length,
    priceObservations: records.filter(row => row.type === 'price_observation').length,
    unlinkedPriceObservations: records.filter(row => row.type === 'unlinked_price_observation').length,
    deliveredForecasts: forecasts.filter(row => delivered.has(row.forecastId)).length,
    undeliveredForecasts: forecasts.filter(row => !delivered.has(row.forecastId)).length,
    legacyUnverifiedForecasts: records.filter(row => row.type === 'forecast' && row.payload.lifecycleState !== 'ISSUED').length,
    provisionalObservations: records.filter(row => row.type === 'provisional_forecast').length,
    rejectedObservations: records.filter(row => row.type === 'forecast_lifecycle' && row.payload.state === 'REJECTED').length,
    unverifiableObservations: records.filter(row => row.type === 'unverifiable_observation').length,
    forecastsWithOdds: forecasts.filter(row => row.odds.status === 'available').length,
    gradedForecasts: forecasts.filter(row => results.has(row.forecastId)).length,
    byVersion,
    matchedForecastComparisons: evaluateMatchedJournal(records),
    limitations: [
      'Descriptive frozen-forecast scores; no improvement or profitability conclusion is inferred.',
      'Models/versions/horizons and matched reference populations are explicit. Different horizon groups remain correlated.',
      'Delivery requires a successful payload-write acknowledgement; existing-message recovery alone does not attest new forecast delivery. Observed prices do not establish a wager, fill or settlement payout.',
      'Historical v6.0.0 comparison needs matching point-in-time datasets; missing archives are not reconstructed.'
    ] };
}
