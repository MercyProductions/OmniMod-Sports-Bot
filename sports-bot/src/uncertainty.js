import { sportProfile } from './sportProfiles.js';

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function finite(value, fallback = 0) {
  if (value === null || value === undefined || value === '') return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function minutesUntil(value) {
  const time = new Date(value || '').getTime();
  return Number.isFinite(time) ? (time - Date.now()) / 60_000 : Infinity;
}

function vectorDisagreement(one = {}, two = {}) {
  if (!two || !Number.isFinite(Number(two.home))) return 0;
  return Math.max(...['away', 'home', 'draw'].map((side) => Math.abs(finite(one[side]) - finite(two[side]))));
}

export function estimatePredictionUncertainty(input = {}) {
  const profile = sportProfile(input.game || {});
  const probabilities = input.probabilities || {};
  const selectedSide = input.selectedSide || 'home';
  const selectedProbability = clamp(finite(probabilities[selectedSide], 0.5), 0.01, 0.99);
  const evidenceQuality = clamp(finite(input.evidenceQuality, 0), 0, 100);
  const apiConfidence = clamp(finite(input.apiConfidence, 0), 0, 100);
  const localConfidence = clamp(finite(input.localConfidence, 0), 0, 100);
  const specialistDisagreement = vectorDisagreement(probabilities, input.specialistProbabilities);
  const mlDisagreement = vectorDisagreement(probabilities, input.mlProbabilities);
  const disagreement = Math.max(specialistDisagreement, mlDisagreement);
  const marketDispersion = clamp(finite(input.marketDispersion, 0), 0, 0.3);
  const transitionRisk = clamp(finite(input.transitionRisk, 0), 0, 1);
  const driftPenalty = clamp(finite(input.driftPenalty, 0), 0, 0.35);
  const featureAgreement = clamp(finite(input.featureAgreement, 50) / 100, 0, 1);
  const historySamples = Math.max(0, finite(input.historySamples, 0));
  const calibrationSamples = Math.max(0, finite(input.calibrationSamples, 0));
  const participationUncertainty = clamp(finite(input.participationUncertainty, 0), 0, 1);
  const contextualRisk = clamp(finite(input.contextualVolatility, 0), 0, 0.3);

  const sampling = 1.28 * Math.sqrt(selectedProbability * (1 - selectedProbability) / Math.max(18, historySamples + calibrationSamples * 0.25));
  let halfWidth =
    0.026 +
    profile.volatility * 0.16 +
    (1 - evidenceQuality / 100) * 0.045 +
    (1 - Math.max(apiConfidence, localConfidence) / 100) * 0.018 +
    disagreement * 0.42 +
    marketDispersion * 0.25 +
    transitionRisk * 0.035 +
    driftPenalty * 0.08 +
    participationUncertainty * 0.028 +
    contextualRisk * 0.12 +
    (1 - featureAgreement) * 0.022 +
    sampling * 0.28;
  halfWidth = clamp(halfWidth, 0.035, 0.22);

  const sorted = Object.entries(probabilities)
    .filter(([side]) => side !== 'draw' || !profile.twoWay)
    .sort((a, b) => b[1] - a[1]);
  const runnerUp = finite(sorted[1]?.[1], 0);
  const margin = selectedProbability - runnerUp;
  const conflicts = input.game?.sourceCorroboration?.conflicts?.length || 0;
  const criticalStarters = finite(input.game?.autoLineup?.away?.criticalStarterCount, 0) + finite(input.game?.autoLineup?.home?.criticalStarterCount, 0);
  const confirmedSides = finite(input.game?.autoLineup?.confirmedSides, 0);
  const lateLineupGap = minutesUntil(input.game?.startTime) <= 30 && criticalStarters > 0 && confirmedSides < 2;

  const reasons = [];
  if (disagreement >= 0.10) reasons.push(`model disagreement ${(disagreement * 100).toFixed(1)} pts`);
  if (evidenceQuality < 45) reasons.push(`evidence quality ${Math.round(evidenceQuality)}%`);
  if (conflicts) reasons.push(`${conflicts} source conflict(s)`);
  if (transitionRisk >= 0.55) reasons.push('high season/roster transition risk');
  if (driftPenalty >= 0.12) reasons.push('recent calibration drift');
  if (lateLineupGap) reasons.push('critical lineup not fully confirmed inside 30 minutes');
  if (participationUncertainty >= 0.55) reasons.push('projected participation is uncertain');
  if (contextualRisk >= 0.12) reasons.push('elevated weather/travel/coaching volatility');
  if (historySamples < 8) reasons.push('thin matchup/team history');

  const interval = {
    lower: clamp(selectedProbability - halfWidth, 0.01, 0.99),
    upper: clamp(selectedProbability + halfWidth, 0.01, 0.99)
  };
  let recommendationStatus = 'prediction';
  let abstentionReason = '';
  const cannotSeparate = profile.twoWay
    ? interval.lower <= 0.5 && selectedProbability < 0.57
    : margin <= halfWidth * 0.9 && selectedProbability < 0.44;
  const severeDataRisk = conflicts >= 2 || (lateLineupGap && evidenceQuality < 58) || (apiConfidence < 15 && localConfidence < 25);
  if (severeDataRisk || (cannotSeparate && (evidenceQuality < 52 || halfWidth >= 0.11))) {
    recommendationStatus = 'withheld';
    abstentionReason = severeDataRisk
      ? 'Material data uncertainty prevents a defensible official pick.'
      : 'The uncertainty interval does not reliably separate the leading outcomes.';
  } else if (cannotSeparate || halfWidth >= 0.105 || disagreement >= 0.09) {
    recommendationStatus = 'lean_only';
    abstentionReason = 'A directional lean is shown, but uncertainty is too wide for a normal-strength prediction.';
  }

  return {
    interval,
    halfWidth,
    uncertaintyPoints: Number((halfWidth * 100).toFixed(1)),
    label: `±${(halfWidth * 100).toFixed(1)} pts (heuristic uncertainty band)`,
    modelDisagreementPoints: Number((disagreement * 100).toFixed(1)),
    outcomeMarginPoints: Number((margin * 100).toFixed(1)),
    recommendationStatus,
    isActionablePrediction: recommendationStatus === 'prediction',
    abstentionReason,
    reasons
  };
}
