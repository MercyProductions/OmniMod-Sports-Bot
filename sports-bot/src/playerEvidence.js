import { normalizeEntityName } from './intelligenceStore.js';
import { explicitlyUnavailable, finiteNumber } from './dataValidation.js';

export function isConfirmedStarter(player = {}) {
  if (typeof player.confirmedStarter === 'boolean') return player.confirmedStarter;
  if (player.confirmationStatus === 'projected' || /probable|projected/i.test(`${player.source || ''} ${player.status || ''}`)) return false;
  return player.starter === true;
}

export function samePlayerIdentity(left = {}, right = {}) {
  const leftId = String(left.athleteId || left.sourceAthleteId || '');
  const rightId = String(right.athleteId || right.sourceAthleteId || '');
  if (leftId && rightId) return leftId === rightId;
  const name = normalizeEntityName(left.name);
  return Boolean(name) && name === normalizeEntityName(right.name);
}

const sameTeamPlayer = (left, right) => Boolean(normalizeEntityName(left.team))
  && normalizeEntityName(left.team) === normalizeEntityName(right.team) && samePlayerIdentity(left, right);
const unavailable = row => row.active === false || explicitlyUnavailable(row)
  || (finiteNumber(row.availability) !== null && finiteNumber(row.availability) <= 0);

/** Retain observations separately; derive conservative, distinct-player evidence without mutating them. */
export function reconcilePlayerEvidence(rows = [], availabilityObservations = [], { retainAvailabilitySources = false } = {}) {
  const groups = new Map();
  for (const row of rows) {
    const team = normalizeEntityName(row.team), id = String(row.athleteId || row.sourceAthleteId || '');
    const name = normalizeEntityName(row.name);
    const localId = String(row.id || '');
    if (!team || (!id && !name && !localId)) continue;
    // An unidentified same-name assertion is not an additional confirmed person.
    if (!id && name && rows.some(other => String(other.athleteId || other.sourceAthleteId || '')
      && normalizeEntityName(other.team) === team && normalizeEntityName(other.name) === name)) continue;
    // A missing-ID name cannot bridge two conflicting known IDs into one player.
    const key = `${team}::${id ? `id:${id}` : name ? `name:${name}` : `local:${localId}`}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return [...groups.values()].map(group => {
    const merged = Object.assign({}, ...group);
    const confirmed = group.some(isConfirmedStarter);
    const denied = [...group, ...rows, ...availabilityObservations].filter(row => sameTeamPlayer(merged, row) || group.includes(row)).some(unavailable);
    const starterConflict = confirmed && group.some(row => row.confirmedStarter === false || row.starter === false
      || row.confirmationStatus === 'projected');
    return { ...merged, ...(denied ? { active: false } : {}),
      confirmedStarter: confirmed && !denied && !starterConflict,
      availabilityConflict: group.some(row => row.availabilityConflict) || (confirmed && denied),
      starterEvidenceConflict: group.some(row => row.starterEvidenceConflict) || starterConflict,
      ...(retainAvailabilitySources && group.some(row => row.availabilityProvider) ? { availabilitySourceRows: structuredClone(group) } : {}) };
  });
}
