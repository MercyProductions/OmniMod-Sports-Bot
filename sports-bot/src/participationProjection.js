import { isConfirmedStarter, reconcilePlayerEvidence, samePlayerIdentity } from './playerEvidence.js';
export { samePlayerIdentity } from './playerEvidence.js';
import { normalizeEntityName } from './intelligenceStore.js';
import { sportProfile } from './sportProfiles.js';
import { explicitlyUnavailable, finiteNumber, hasAvailabilityObservation } from './dataValidation.js';

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

const finite = finiteNumber;

function statusAvailability(player = {}) {
  const text = `${player.status || ''} ${player.notes || ''}`.toLowerCase();
  if (explicitlyUnavailable(player)) return 0;
  if (/doubtful/.test(text)) return 0.2;
  if (/questionable|game.?time|day.?to.?day/.test(text)) return 0.52;
  // A schedule's probable starter label describes role, not a medical 'probable' status.
  if (/limited/.test(text) || (player.availabilityEvidence !== 'role_prior_not_injury_clearance' && /probable/.test(text))) return 0.84;
  const availability = finite(player.availability, 100);
  return clamp(availability > 1 ? availability / 100 : availability, 0, 1);
}

export function roleParticipationPrior(profileKey, role = '') {
  const text = String(role).toLowerCase();
  if (profileKey === 'baseball' && /starting pitcher|\bsp\b/.test(text)) return 0.72;
  if (profileKey === 'baseball' && /relief|closer|bullpen|\brp\b/.test(text)) return 0.24;
  if (profileKey === 'football' && /quarterback|\bqb\b/.test(text)) return 0.96;
  if (profileKey === 'hockey' && /goalie|goaltender|\bg\b/.test(text)) return 0.98;
  return 0.82;
}

export function basketballWorkloadBasis(leagueKey = '') {
  const rawLeague = String(leagueKey || '').trim().toLowerCase();
  const league = { 'mens-college-basketball': 'ncaab', 'womens-college-basketball': 'ncaaw' }[rawLeague] || rawLeague;
  const known = ['nba','wnba','ncaab','ncaaw'].includes(league);
  const minutes = league === 'nba' ? 48 : 40;
  return { minutes, league: known ? league : null,
    basis: known ? 'league_regulation_minutes' : 'unverified_40_minute_proxy',
    contract: `basketball-regulation-v1:${known ? league : 'unknown'}:${minutes}`,
    includesOvertime: false };
}

function workloadLabel(profileKey, share, role = '', leagueKey = '') {
  const text = String(role).toLowerCase();
  if (profileKey === 'basketball') return { unit: 'minutes', value: share * basketballWorkloadBasis(leagueKey).minutes };
  if (profileKey === 'football') return { unit: 'snap share', value: share * 100 };
  if (profileKey === 'baseball' && /pitch/.test(text)) return { unit: 'pitches', value: share * 95 };
  if (profileKey === 'baseball') return { unit: 'plate appearances', value: share * 4.6 };
  if (profileKey === 'hockey' && /goalie/.test(text)) return { unit: 'minutes', value: share * 60 };
  if (profileKey === 'hockey') return { unit: 'minutes', value: share * 22 };
  if (profileKey === 'soccer') return { unit: 'minutes', value: share * 90 };
  return { unit: 'participation share', value: share * 100 };
}

export function projectPlayerParticipation(player = {}, learned = null, profileKey = 'default', lineup = {}) {
  const leagueKey = lineup.leagueKey || player.leagueKey || learned?.leagueKey || '';
  const workloadBasis = profileKey === 'basketball' ? basketballWorkloadBasis(leagueKey) : { basis: 'existing_role_workload_proxy', includesOvertime: false };
  const suppliedUnitContract = learned?.participationUnitContract || player.stats?.historicalParticipationUnitContract || null;
  const unitMismatch = profileKey === 'basketball' && suppliedUnitContract && suppliedUnitContract !== workloadBasis.contract;
  const candidateShare = unitMismatch ? null : finite(learned?.participation, finite(player.stats?.historicalParticipation));
  const measuredShare = candidateShare !== null && candidateShare >= 0 && candidateShare <= 1 ? candidateShare : null;
  const historicalShare = clamp(measuredShare ?? roleParticipationPrior(profileKey, player.role), 0, 1);
  const currentStarter = player.starter === true;
  const candidateStarterRate = finite(learned?.starterRate, finite(player.stats?.historicalStarterRate));
  const observedStarterRate = candidateStarterRate !== null && candidateStarterRate >= 0 && candidateStarterRate <= 1 ? candidateStarterRate : null;
  const starterRate = observedStarterRate ?? (currentStarter ? 0.82 : 0.22);
  const historicalStarterSamples = Math.max(0, finite(learned?.starterSamples, finite(player.stats?.historicalStarterSamples, 0)));
  const historicalStarterEvidence = observedStarterRate === null ? 'role_prior' : historicalStarterSamples > 0 ? 'observed_historical_flags' : 'legacy_rate_unknown_provenance';
  const confirmedStarter = Boolean(lineup.confirmedStarter ?? isConfirmedStarter(player));
  const confirmedActive = lineup.active !== false && player.active !== false;
  const availabilityProbability = confirmedActive ? statusAvailability(player) : 0;
  // Distinguish starting conditional on participation from unconditional start probability.
  // Availability belongs once in expected workload, not both inside and outside the mixture.
  const conditionalStartProbability = confirmedStarter
    ? 1 : clamp(starterRate * 0.76 + (currentStarter ? 0.2 : 0), 0.03, 0.9);
  const startProbability = conditionalStartProbability * availabilityProbability;
  const reserveShare = Math.min(historicalShare, profileKey === 'basketball' || profileKey === 'hockey' || profileKey === 'soccer' ? 0.34 : 0.2);
  const conditionalShare = clamp(conditionalStartProbability * historicalShare + (1 - conditionalStartProbability) * reserveShare, 0, 1);
  const expectedShare = clamp(availabilityProbability * conditionalShare, 0, 1);
  const verifiedSamples = finite(learned?.participationSamples, finite(player.stats?.historicalParticipationSamples));
  const declaredSamples = profileKey === 'basketball' && suppliedUnitContract !== workloadBasis.contract ? 0 : verifiedSamples ?? 0;
  const historySamples = measuredShare !== null && measuredShare >= 0 && measuredShare <= 1 ? Math.max(0, declaredSamples) : 0;
  const evidenceReliability = clamp(historySamples / (historySamples + 6), 0, 0.92);
  const availabilityObserved = hasAvailabilityObservation(player);
  const statusUncertainty = availabilityObserved ? 4 * availabilityProbability * (1 - availabilityProbability) : 1;
  const roleUncertainty = 4 * conditionalStartProbability * (1 - conditionalStartProbability);
  const uncertainty = clamp((1 - evidenceReliability) * 0.5 + statusUncertainty * 0.32 + roleUncertainty * 0.18, 0.04, 1);
  const workload = workloadLabel(profileKey, expectedShare, player.role, leagueKey);
  return {
    availabilityProbability, availabilityObserved,
    availabilityBasis: availabilityObserved?'explicit_status_or_numeric_assertion':'unobserved_role_prior_not_health_clearance',
    startProbability,
    conditionalStartProbability,
    historicalStarterSamples: observedStarterRate === null ? 0 : historicalStarterSamples, historicalStarterEvidence,
    expectedShare,
    historicalShare,
    historicalParticipationEvidence: measuredShare === null ? 'role_prior' : verifiedSamples === null || profileKey === 'basketball' && suppliedUnitContract !== workloadBasis.contract ? 'legacy_workload_unknown_provenance' : 'boxscore_workload_proxy',
    expectedWorkload: Number(workload.value.toFixed(1)),
    workloadUnit: workload.unit, workloadBasis, workloadUnitMismatch: Boolean(unitMismatch),
    uncertainty: Number(uncertainty.toFixed(3)),
    historySamples,
    source: measuredShare !== null ? 'historical workload proxy + current status/lineup' : 'role prior + current status/lineup'
  };
}

function playerIdentity(row = {}) {
  return String(row.athleteId || row.sourceAthleteId || normalizeEntityName(row.name));
}

const teamPlayerKey = row => `${normalizeEntityName(row.team)}::${playerIdentity(row)}`;

export function attachParticipationProjections(game, playerProfiles = {}, findLearned = null) {
  const lineupByPlayer = new Map(reconcilePlayerEvidence(game.autoLineups || [], game.autoPlayers || []).map(row => [teamPlayerKey(row), row]));
  const rows = new Map();
  for (const row of reconcilePlayerEvidence([...(game.autoLineups || []), ...(game.autoPlayers || [])])) {
    const key = teamPlayerKey(row);
    rows.set(key, { ...(rows.get(key) || {}), ...row });
  }
  const projections = [];
  for (const [key, row] of rows) {
    const learned = typeof findLearned === 'function' ? findLearned(row) : Object.values(playerProfiles).find((profile) =>
      normalizeEntityName(profile.team) === normalizeEntityName(row.team) &&
      samePlayerIdentity(row, profile)
    );
    const lineup = lineupByPlayer.get(key) || row;
    const projection = projectPlayerParticipation(row, learned, sportProfile(game).key, {
      confirmedStarter: isConfirmedStarter(lineup),
      active: lineup.active, leagueKey: game.leagueKey || game.league
    });
    const target = (game.autoPlayers || []).find((candidate) =>
      normalizeEntityName(candidate.team) === normalizeEntityName(row.team) && playerIdentity(candidate) === playerIdentity(row));
    if (target) target.participationProjection = projection;
    projections.push({ key, name: row.name, team: row.team, role: row.role, impact: finite(learned?.impact, finite(row.impact, 1)), ...projection });
  }
  game.participationProjections = projections;
  return projections;
}

export function summarizeTeamParticipation(projections = [], teamName = '') {
  const rows = projections.filter((row) => normalizeEntityName(row.team) === normalizeEntityName(teamName));
  if (!rows.length) return { players: 0, projectedActiveImpact: 0, projectedMissingImpact: 0, expectedStarterEquivalents: 0, uncertainty: 1, coverage: 0 };
  const projectedActiveImpact = rows.reduce((sum, row) => sum + Math.max(0, Number(row.impact || 0)) * row.expectedShare, 0);
  const projectedMissingImpact = rows.reduce((sum, row) => sum + Math.max(0, Number(row.impact || 0)) * Math.max(0, row.historicalShare - row.expectedShare), 0);
  const weightedUncertainty = rows.reduce((sum, row) => sum + row.uncertainty * Math.max(0.2, Number(row.impact || 0)), 0) /
    rows.reduce((sum, row) => sum + Math.max(0.2, Number(row.impact || 0)), 0);
  return {
    players: rows.length,
    projectedActiveImpact: Number(projectedActiveImpact.toFixed(2)),
    projectedMissingImpact: Number(projectedMissingImpact.toFixed(2)),
    expectedStarterEquivalents: Number(rows.reduce((sum, row) => sum + row.startProbability, 0).toFixed(2)),
    uncertainty: Number(weightedUncertainty.toFixed(3)),
    coverage: clamp(rows.filter((row) => row.historySamples > 0).length / Math.max(1, rows.length), 0, 1)
  };
}
