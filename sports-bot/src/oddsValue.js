import {quoteTimestampVerified} from './oddsPricing.js';
import { americanToProbability, finiteNumber } from './dataValidation.js';
import { sportProfile } from './sportProfiles.js';

export const VALUE_POLICY = Object.freeze({ version: 2, maxQuoteAgeMinutes: 15, minEvidenceQuality: 65, minCalibrationSamples: 40, minBookmakers: 2, minExpectedReturn: 0.02 });
const round = (value, digits = 5) => Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
const signed = (value) => `${value >= 0 ? '+' : ''}${(value * 100).toFixed(1)}%`;

export function payoutAtAmericanOdds(price) {
  return americanToProbability(price) === null ? null : Number(price) > 0 ? Number(price) / 100 : 100 / -Number(price);
}

// All fields describe a quoted research opportunity, never a placed wager.
export function analyzeOddsValue(game = {}, model = {}, options = {}) {
  const now = options.now ?? Date.now();
  if (!Number.isFinite(now)) throw new Error('A valid quote-evaluation time is required');
  const profile = sportProfile(game);
  const market = game.odds?.h2h || {};
  const sides = profile.twoWay ? ['away', 'home'] : ['away', 'home', 'draw'];
  const start = Date.parse(game.startTime || '');
  const sharedRisks = [];
  const probabilities = sides.map(side => finiteNumber(model.probabilities?.[side]));
  if (probabilities.some(p => p === null || p < 0 || p > 1) || Math.abs(probabilities.reduce((sum, p) => sum + (p || 0), 0) - 1) > 0.0011)
    sharedRisks.push('outcome probability vector is missing or does not sum to one');
  const providerStart = Date.parse(game.odds?.commenceTime || '');
  if (Number.isFinite(providerStart) && providerStart <= now) sharedRisks.push('provider event has already reached its start time');
  const rules = market.rules || '';
  const comparableRules = profile.key === 'soccer' ? rules === 'regulation_3way' :
    ['baseball', 'basketball', 'hockey'].includes(profile.key) && rules === 'full_game_2way';
  if (!comparableRules) sharedRisks.push('market settlement scope is unverified or not modeled');
  if (sides.some((side) => !market[side]) || (profile.twoWay && market.draw)) sharedRisks.push('market outcome set does not match the model');
  if (game.statusKey !== 'scheduled' || model.mode !== 'pregame' || !Number.isFinite(start) || start <= now) sharedRisks.push('event is not a verified future pregame market');
  if (finiteNumber(model.evidenceQuality, 0) < VALUE_POLICY.minEvidenceQuality) sharedRisks.push(`evidence quality below ${VALUE_POLICY.minEvidenceQuality}%`);
  if (finiteNumber(model.calibrationSamples, 0) < VALUE_POLICY.minCalibrationSamples) sharedRisks.push(`fewer than ${VALUE_POLICY.minCalibrationSamples} comparable calibration samples`);
  if (model.recommendationStatus !== 'prediction') sharedRisks.push('prediction evidence or uncertainty did not clear the normal-strength gate');
  if ((game.sourceCorroboration?.conflicts || []).length) sharedRisks.push('provider sources conflict');
  if (game.odds?.cacheState === 'stale') sharedRisks.push('provider explicitly marked cached odds stale');
  const width = finiteNumber(model.halfWidth);
  if (width === null || width <= 0 || width >= 1) sharedRisks.push('uncertainty stress width is unavailable');

  const outcomes = sides.map((side) => {
    const probability = finiteNumber(model.probabilities?.[side]);
    const quotes = (market[side]?.quotes?.length ? market[side].quotes : market[side] ? [market[side]] : [])
      .filter((quote) => payoutAtAmericanOdds(quote.price) !== null && quote.bookmaker)
      .map((quote) => {
        const quoteTime = Date.parse(quote.lastUpdate || '');
        const ageMinutes = Number.isFinite(quoteTime) ? (now - quoteTime) / 60_000 : null;
        const fresh = ageMinutes !== null && ageMinutes >= 0 && ageMinutes <= VALUE_POLICY.maxQuoteAgeMinutes && quoteTimestampVerified(quote);
        return { bookmaker: String(quote.bookmaker), bookmakerKey: String(quote.bookmakerKey || quote.bookmaker), price: Number(quote.price), quotedAt: quote.lastUpdate || '', timestampSource: quote.timestampSource || 'unknown', ageMinutes: round(ageMinutes, 2), fresh, decimalOdds: 1 + payoutAtAmericanOdds(quote.price) };
      });
    const freshQuotes = quotes.filter((quote) => quote.fresh);
    // Prefer a current offered quote even if an old cached quote has a larger payout.
    const best = [...(freshQuotes.length ? freshQuotes : quotes)].sort((a, b) => b.decimalOdds - a.decimalOdds)[0] || null;
    const reasons = [...sharedRisks];
    const outcomeSamples = finiteNumber(model.outcomeValidationSamples?.[side], 0);
    if (outcomeSamples < VALUE_POLICY.minCalibrationSamples) reasons.push(`fewer than ${VALUE_POLICY.minCalibrationSamples} archived outcomes in this side/probability bin`);
    const calibrationError = finiteNumber(model.outcomeCalibrationError?.[side]);
    if (calibrationError === null || calibrationError > 0.10) reasons.push('outcome calibration error is unknown or exceeds 10 probability points');
    if (!best) reasons.push('no valid bookmaker price');
    else if (!best.fresh) reasons.push('quote timestamp unknown, future, fetched-only, or older than 15 minutes');
    const freshBookmakers = new Set(freshQuotes.map((quote) => quote.bookmakerKey)).size;
    if (freshBookmakers < VALUE_POLICY.minBookmakers) reasons.push('fewer than two fresh comparable bookmaker quotes');
    const validProbability = probability !== null && probability > 0 && probability < 1;
    if (!validProbability) reasons.push('outcome probability unavailable');
    const breakEvenProbability = best ? 1 / best.decimalOdds : null;
    const expectedReturn = best && validProbability ? probability * best.decimalOdds - 1 : null;
    const stressProbability = validProbability && width !== null ? Math.max(0, probability - width) : null;
    const stressedReturn = best && stressProbability !== null ? stressProbability * best.decimalOdds - 1 : null;
    if (expectedReturn === null || expectedReturn < VALUE_POLICY.minExpectedReturn) reasons.push('quoted expected return below +2%');
    if (stressedReturn === null || stressedReturn <= 0) reasons.push('expected return does not survive the uncertainty stress');
    // A surprisingly large gap is usually a mapping/settlement/outlier issue.
    if (expectedReturn > 0.5) reasons.push('extreme price-model gap requires manual verification');
    const consensus = finiteNumber(market[side]?.fairProbability ?? market[side]?.implied);
    return {
      side, outcome: side === 'draw' ? 'Draw' : game[side]?.name || side,
      probability: round(probability), stressedProbability: round(stressProbability),
      consensusProbability: round(consensus), modelMarketDisagreement: consensus !== null && validProbability ? round(probability - consensus) : null,
      quote: best, quotesExamined: quotes.length, freshBookmakers, outcomeValidationSamples: outcomeSamples, outcomeCalibrationError: round(calibrationError),
      breakEvenProbability: round(breakEvenProbability), expectedReturn: round(expectedReturn), stressedReturn: round(stressedReturn),
      status: reasons.length ? 'withheld' : 'research_opportunity', actionable: reasons.length === 0, reasons
    };
  });
  const ranked = [...outcomes].filter((row) => row.expectedReturn !== null).sort((a, b) => b.stressedReturn - a.stressedReturn || b.expectedReturn - a.expectedReturn);
  return {
    version: 2, issuedAt: new Date(now).toISOString(), evaluatedAt: new Date(now).toISOString(), rules: rules || 'unknown', policy: VALUE_POLICY,
    marketInformed: Boolean(model.marketInformed), independence: model.marketInformed ? 'Model includes bookmaker information; this is not an independent market edge.' : 'No market blend used in this prediction; profitability is unproven.',
    uncertaintyMethod: 'heuristic probability stress, not a validated confidence bound',
    outcomes, bestOpportunity: ranked.find((row) => row.actionable) || null, bestObserved: ranked[0] || null,
    disclaimer: 'Hypothetical net return per unit at an observed quote, before fees, taxes, voids, limits and price changes. No wager or available stake is confirmed.'
  };
}

export function refreshPredictionValue(prediction, game, now = Date.now()) {
  if (!game) return { ...prediction, valueAnalysis: null };
  const valueAnalysis = analyzeOddsValue(game, {
    probabilities: Object.fromEntries(Object.entries(prediction.outcomeProbabilities || {}).map(([side, value]) => [side, Number(value) / 100])),
    halfWidth: finiteNumber(prediction.predictionUncertaintyPoints) === null ? null : Number(prediction.predictionUncertaintyPoints) / 100,
    evidenceQuality: prediction.evidenceQualityValue, calibrationSamples: prediction.calibrationSampleSize,
    outcomeValidationSamples: prediction.outcomeValidationSamples || {},
    outcomeCalibrationError: prediction.outcomeCalibrationError || {},
    recommendationStatus: prediction.recommendationStatus, mode: prediction.predictionMode,
    marketInformed: prediction.marketBlendWeight > 0 || prediction.valueAnalysis?.marketInformed
  }, { now });
  valueAnalysis.modelAsOf = prediction.modelAsOf || prediction.predictionGeneratedAt || prediction.valueAnalysis?.modelAsOf || '';
  valueAnalysis.provenance = prediction.valueAnalysis?.provenance || 'cached_model_and_quote';
  valueAnalysis.issuedAt = prediction.valueAnalysis?.issuedAt || prediction.predictionGeneratedAt || valueAnalysis.issuedAt;
  if (prediction.modelAsOf && (!Number.isFinite(Date.parse(prediction.modelAsOf)) || Date.parse(prediction.modelAsOf) > now || now - Date.parse(prediction.modelAsOf) > 6 * 60 * 60_000)) {
    for (const outcome of valueAnalysis.outcomes) {
      outcome.actionable = false;
      outcome.status = 'withheld';
      outcome.reasons.unshift('reused model is older than six hours or has unknown age');
    }
    valueAnalysis.bestOpportunity = null;
  }
  return { ...prediction, valueAnalysis };
}

export function valueOpportunityLine(prediction) {
  const row = prediction.valueAnalysis?.bestOpportunity;
  if (!row) return 'No qualifying price opportunity (use /sports game for quote checks).';
  return `#${prediction.index} ${row.outcome} @ ${row.quote.price > 0 ? '+' : ''}${row.quote.price} (${row.quote.bookmaker}) | model EV ${signed(row.expectedReturn)}; stressed ${signed(row.stressedReturn)} | quoted ${row.quote.quotedAt}`;
}

export function formatValueDetails(analysis) {
  if (!analysis) return 'Quote-value analysis unavailable; refresh the slate.';
  const detail = analysis.outcomes.map((row) => {
    if (!row.quote) return `${row.outcome}: no valid offered price.`;
    const ev = row.expectedReturn === null ? 'unknown' : signed(row.expectedReturn);
    const stress = row.stressedReturn === null ? 'unknown' : signed(row.stressedReturn);
    return `${row.outcome}: ${row.quote.price > 0 ? '+' : ''}${row.quote.price} ${row.quote.bookmaker}; break-even ${(row.breakEvenProbability * 100).toFixed(1)}%, model ${row.probability === null ? 'unknown' : `${(row.probability * 100).toFixed(1)}%`}, EV ${ev}, stressed ${stress}. Quote ${row.quote.quotedAt || 'time unknown'}. ${row.actionable ? 'Research opportunity.' : `WITHHELD: ${row.reasons.slice(0, 2).join('; ')}.`}`;
  }).join('\n');
  return `${analysis.modelAsOf ? `Model as of ${analysis.modelAsOf}; ${analysis.provenance || 'cached forecast'}.\n` : ''}${detail}`.slice(0, 1000);
}
