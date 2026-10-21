import { isConfirmedStarter, reconcilePlayerEvidence, samePlayerIdentity } from './playerEvidence.js';
export { samePlayerIdentity } from './playerEvidence.js';
import { normalizeEntityName } from './intelligenceStore.js';
import { sportProfile } from './sportProfiles.js';
import { explicitlyUnavailable } from './dataValidation.js';

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function finite(value, fallback = null) {
  if (value === null || value === undefined || value === '') return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

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

function roleScale(profileKey, role = '') {
  const text = String(role).toLowerCase();
  if (profileKey === 'baseball' && /starting pitcher|\bsp\b/.test(text)) return 0.72;
  if (profileKey === 'baseball' && /relief|closer|bullpen|\brp\b/.test(text)) return 0.24;
  if (profileKey === 'football' && /quarterback|\bqb\b/.test(text)) return 0.96;
  if (profileKey === 'hockey' && /goalie|goaltender|\bg\b/.test(text)) return 0.98;
  return 0.82;
}

function workloadLabel(profileKey, share, role = '') {
  const text = String(role).toLowerCase();
  if (profileKey === 'basketball') return { unit: 'minutes', value: share * 40 };
  if (profileKey === 'football') return { unit: 'snap share', value: share * 100 };
  if (profileKey === 'baseball' && /pitch/.test(text)) return { unit: 'pitches', value: share * 95 };
  if (profileKey === 'baseball') return { unit: 'plate appearances', value: share * 4.6 };
  if (profileKey === 'hockey' && /goalie/.test(text)) return { unit: 'minutes', value: share * 60 };
  if (profileKey === 'hockey') return { unit: 'minutes', value: share * 22 };
  if (profileKey === 'soccer') return { unit: 'minutes', value: share * 90 };
  return { unit: 'participation share', value: share * 100 };
}

export function projectPlayerParticipation(player = {}, learned = null, profileKey = 'default', lineup = {}) {
  const historicalShare = clamp(finite(learned?.participation, finite(player.stats?.historicalParticipation, roleScale(profileKey, player.role))), 0.02, 1);
  const starterRate = clamp(finite(learned?.starterRate, player.starter ? 0.82 : 0.22), 0, 1);
  const confirmedStarter = Boolean(lineup.confirmedStarter ?? isConfirmedStarter(player));
  const confirmedActive = lineup.active !== false && player.active !== false;
  const availabilityProbability = confirmedActive ? statusAvailability(player) : 0;
  // Distinguish starting conditional on participation from unconditional start probability.
  // Availability belongs once in expected workload, not both inside and outside the mixture.
  const conditionalStartProbability = confirmedStarter
    ? 1 : clamp(starterRate * 0.76 + (player.starter ? 0.2 : 0), 0.03, 0.9);
  const startProbability = conditionalStartProbability * availabilityProbability;
  const reserveShare = Math.min(historicalShare, profileKey === 'basketball' || profileKey === 'hockey' || profileKey === 'soccer' ? 0.34 : 0.2);
  const conditionalShare = clamp(conditionalStartProbability * historicalShare + (1 - conditionalStartProbability) * reserveShare, 0, 1);
  const expectedShare = clamp(availabilityProbability * conditionalShare, 0, 1);
  const historySamples = finite(learned?.sampleSize, finite(player.stats?.historicalBoxscoreGames, 0));
  const evidenceReliability = clamp(historySamples / (historySamples + 6), 0, 0.92);
  const statusUncertainty = 4 * availabilityProbability * (1 - availabilityProbability);
  const roleUncertainty = 4 * conditionalStartProbability * (1 - conditionalStartProbability);
  const uncertainty = clamp((1 - evidenceReliability) * 0.5 + statusUncertainty * 0.32 + roleUncertainty * 0.18, 0.04, 1);
  const workload = workloadLabel(profileKey, expectedShare, player.role);
  return {
    availabilityProbability,
    startProbability,
    conditionalStartProbability,
    expectedShare,
    historicalShare,
    expectedWorkload: Number(workload.value.toFixed(1)),
    workloadUnit: workload.unit,
    uncertainty: Number(uncertainty.toFixed(3)),
    historySamples,
    source: learned ? 'historical participation + current status/lineup' : 'role prior + current status/lineup'
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
      active: lineup.active
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
