import {quoteTimeEpoch as instant} from './oddsPricing.js';
import {eventObservationHash} from './journalEventMatch.js';
import {journalOutcomeVector} from './journalOutcomeSpace.js';
import {journalResultState} from './journalResults.js';
import {evaluateMatchedJournal} from './matchedJournalEvaluation.js';
import {validCandidateVector} from './candidateCohorts.js';
import { evaluatePredictionHorizons } from './horizonEvaluation.js';
import { evaluatePredictionRows } from './modelEvaluation.js';

function selectedSide(vector) {
  return Object.entries(vector).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
}

const gameKey = row => JSON.stringify([String(row.league || row.leagueKey || '').trim().toLowerCase(),String(row.gameId),
  Number.isFinite(instant(row.startTime)) ? new Date(instant(row.startTime)).toISOString() : null]);
export function summarizePredictionJournal(input = [], {asOf=Date.now()} = {}) {
  if (!Number.isFinite(asOf) || !Number.isFinite(new Date(asOf).getTime())) throw new Error('A valid summary cutoff is required');
  const records = input.filter(row => Number.isFinite(instant(row.recordedAt)) && instant(row.recordedAt) <= asOf);
  const issueTimes = new Map(records.filter(row => row.type === 'forecast').map(event => [event.payload,instant(event.recordedAt)]));
  const eligibleIssue = row => row.recordEligibility === 'observed_pregame' && Number.isFinite(instant(row.predictionGeneratedAt))
    && Number.isFinite(instant(row.startTime)) && instant(row.predictionGeneratedAt) <= issueTimes.get(row)
    && issueTimes.get(row) < instant(row.startTime) && row.gameId != null && String(row.gameId).trim()
    && row.league && row.modelVersion && row.horizon;
  const undatedLegacy = input.filter(row => row.type === 'forecast' && row.payload.lifecycleState !== 'ISSUED' && !Number.isFinite(instant(row.recordedAt))).length;
  const forecasts = records.filter(row => row.type === 'forecast' && row.payload.lifecycleState === 'ISSUED').map(row => row.payload);
  const delivered = new Set(records.filter(row => row.type === 'forecast_lifecycle' && row.payload.state === 'DELIVERED').map(row => row.payload.forecastId));
  const resultState = journalResultState(records);
  const results = new Map([...resultState.eligible].map(([id,event])=>[id,event.payload]));
  const eligibleForecasts = forecasts.filter(eligibleIssue);
  const validResult = row => {
    const event = resultState.eligible.get(row.forecastId), result = event?.payload;
    return result && result.scheduleChanged !== true && Number.isFinite(instant(result.observedAt))
      && instant(row.startTime) <= instant(result.observedAt) && instant(result.observedAt) <= instant(event.recordedAt);
  };
  const labels = new Map(), disputedEvents = new Set();
  for (const row of eligibleForecasts) {
    const key = gameKey(row);
    if (resultState.conflicts.has(row.forecastId)) disputedEvents.add(key);
    if (!validResult(row)) continue;
    if (!labels.has(key)) labels.set(key,new Set());
    labels.get(key).add(results.get(row.forecastId).actualSide);
  }
  const conflictingEvents = new Set([...labels].filter(([,sides]) => sides.size > 1).map(([key]) => key));
  const allowedEvent = row => !conflictingEvents.has(gameKey(row)) && !disputedEvents.has(gameKey(row));
  const validSelection = row => {
    const vector = journalOutcomeVector(row);
    return vector && vector[row.selectedSide] === Math.max(...Object.values(vector));
  };
  const versions = [...new Set(forecasts.map(row => row.modelVersion))].sort();
  const byVersion = {};
  for (const version of versions) {
    const versionRows = forecasts.filter(row => row.modelVersion === version);
    const eligibleRows = versionRows.filter(eligibleIssue);
    const resolved = eligibleRows.filter(validResult);
    const outcomeValid = resolved.filter(row => journalOutcomeVector(row));
    const graded = outcomeValid.filter(row => allowedEvent(row) && validSelection(row));
    const convert = (row, probabilities = row.outcomePercentages, side = row.selectedSide, modeledOutcomes = row.modeledOutcomes) => ({
      ...row, actualSide: results.get(row.forecastId).actualSide, predictedSide: side,
      predictionMode: 'pregame', outcomeProbabilities: probabilities, modeledOutcomes
    });
    const modelRows = graded.map(row => convert(row));
    const firstPerGame = new Map(), firstConflicts = new Set();
    const original = row => eventObservationHash({probabilities:row.outcomePercentages,modeledOutcomes:row.modeledOutcomes,
      selectedSide:row.selectedSide,generatedAt:new Date(instant(row.predictionGeneratedAt)).toISOString()});
    for (const row of [...eligibleRows].sort((a,b) => issueTimes.get(a) - issueTimes.get(b))) {
      const key = gameKey(row), prior = firstPerGame.get(key);
      if (!prior) firstPerGame.set(key,row);
      else if (issueTimes.get(row) === issueTimes.get(prior) && original(row) !== original(prior)) firstConflicts.add(key);
    }
    const firstScorable = [...firstPerGame].filter(([key,row]) => !firstConflicts.has(key) && validResult(row) && allowedEvent(row)
      && validSelection(row)).map(([,row]) => row);
    const baselineComparisons = {};
    for (const baseline of ['elo', 'market']) {
      const matched = graded.filter(row => validCandidateVector(row.referenceBaselines?.[baseline]?.probabilities,row.referenceModeledOutcomes?.[baseline]));
      const referenceRows = matched.map(row => {
        const vector = row.referenceBaselines[baseline].probabilities;
        return convert(row, Object.fromEntries(Object.entries(vector).map(([side, p]) => [side, p * 100])), selectedSide(vector), row.referenceModeledOutcomes?.[baseline]);
      });
      baselineComparisons[baseline] = {
        primaryOnMatchedGames: evaluatePredictionHorizons(matched.map(row => convert(row)), [], { modelVersion: version }),
        referenceOnMatchedGames: evaluatePredictionHorizons(referenceRows, [], { modelVersion: version }),
        limitations: baseline === 'market' ? 'Available consensus can be stale or market-informed; this is not an independent betting edge or a closing-price benchmark.'
          : 'Fixed-draw-prior Elo reference captured with the forecast; not the complete untouched v6.0.0 pipeline.'
      };
    }
    byVersion[version] = {
      forecasts: versionRows.length, eligibleIssuedForecasts: eligibleRows.length, invalidIssuance: versionRows.length - eligibleRows.length,
      graded: resolved.length, unresolved: eligibleRows.length - resolved.length,
      scorableForecasts: graded.length, invalidOrUnverifiedOutcomeSpace: resolved.length - outcomeValid.length,
      invalidResultChronology: eligibleRows.filter(row => results.has(row.forecastId) && !validResult(row)).length,
      conflictingOrDisputedEventForecasts: outcomeValid.filter(row => !allowedEvent(row)).length,
      invalidFrozenSelection: outcomeValid.filter(row => !validSelection(row)).length, firstIssueConflictEvents:firstConflicts.size,
      outcomes: evaluatePredictionHorizons(modelRows, [], { modelVersion: version }),
      selectedOutcomeBinary: { ...evaluatePredictionRows(firstScorable.map(row => ({
        correct: row.selectedSide === results.get(row.forecastId).actualSide,
        prediction: { predictionProbability: row.outcomePercentages[row.selectedSide] / 100 }
      }))), selectionRule: 'Earliest eligible recorded issue per canonical event/model-version across guilds/horizons, selected before resolution/vector checks. Equal-time conflicts excluded; no later resolved fallback.' },
      referenceComparisons: baselineComparisons
    };
  }
  return { schema:'sports-journal-summary-v2',asOf:new Date(asOf).toISOString(),inputRecords:input.length,
    unverifiableRecordTimes: input.filter(row => !Number.isFinite(instant(row.recordedAt))).length,
    futureRecords:input.filter(row => Number.isFinite(instant(row.recordedAt)) && instant(row.recordedAt) > asOf).length,
    conflictingResultEvents:conflictingEvents.size, disputedResultEvents:disputedEvents.size,
    status: forecasts.length ? 'prospective_records_available' : 'no_prospective_forecasts',
    records: records.length, forecasts: forecasts.length,
    priceObservations: records.filter(row => row.type === 'price_observation').length,
    unlinkedPriceObservations: records.filter(row => row.type === 'unlinked_price_observation').length,
    deliveredForecasts: forecasts.filter(row => delivered.has(row.forecastId)).length,
    undeliveredForecasts: forecasts.filter(row => !delivered.has(row.forecastId)).length,
    legacyUnverifiedForecasts: records.filter(row => row.type === 'forecast' && row.payload.lifecycleState !== 'ISSUED').length + undatedLegacy,
    provisionalObservations: records.filter(row => row.type === 'provisional_forecast').length,
    rejectedObservations: records.filter(row => row.type === 'forecast_lifecycle' && row.payload.state === 'REJECTED').length,
    unverifiableObservations: records.filter(row => row.type === 'unverifiable_observation').length,
    forecastsWithOdds: forecasts.filter(row => row.odds?.status === 'available').length,
    disputedResults: resultState.conflicts.size,
    eventAssociationRejections: records.filter(row=>row.type==='event_association_rejected').length,
    gradedForecasts: eligibleForecasts.filter(validResult).length,
    byVersion,
    matchedForecastComparisons: evaluateMatchedJournal(records,{asOf}),
    limitations: [
      'Descriptive frozen-forecast scores; no improvement or profitability conclusion is inferred.',
      'Counts use explicit-zone visible records at the cutoff; undated legacy forecast count is separate untimed context. Raw input/future counts are audit context, not historical performance.',
      'The caller must verify the journal hash chain; result state follows canonical append order. Receipt chronology does not authenticate source truth.',
      'Models/versions/horizons and matched reference populations are explicit. Different horizon groups remain correlated.',
      'Delivery requires a successful payload-write acknowledgement; existing-message recovery alone does not attest new forecast delivery. Observed prices do not establish a wager, fill or settlement payout.',
      'Historical v6.0.0 comparison needs matching point-in-time datasets; missing archives are not reconstructed.'
    ] };
}
