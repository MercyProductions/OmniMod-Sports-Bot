import { finiteNumber } from './dataValidation.js';
import { normalizeEntityName } from './intelligenceStore.js';

// Provider IDs remain in the Baseball Savant namespace, never ESPN's namespace.
export function replaceBaseballRole(snapshot, role, rows) {
  const roles = { ...(snapshot.baseballPlayersByRole || {}) };
  for (const legacyRole of ['batter', 'pitcher']) {
    if (Object.hasOwn(roles, legacyRole)) continue;
    const index = Object.create(null);
    for (const [legacyName, row] of Object.entries(snapshot.baseballPlayers || {})) {
      if (row?.role !== legacyRole) continue;
      const key = normalizeEntityName(row.name || legacyName);
      (index[key] ||= []).push(row);
    }
    roles[legacyRole] = index;
  }
  const index = Object.create(null);
  for (const row of rows) (index[normalizeEntityName(row.name)] ||= []).push(row);
  roles[role] = index;
  snapshot.baseballPlayersByRole = roles;
  // Compatibility projection: unambiguous batters take priority over pitchers.
  const legacy = Object.create(null);
  for (const currentRole of ['pitcher', 'batter']) {
    for (const [name, matches] of Object.entries(roles[currentRole] || {})) {
      if (matches.length === 1) legacy[name] = matches[0];
      else if (currentRole === 'batter') delete legacy[name];
    }
  }
  snapshot.baseballPlayers = legacy;
  return { ambiguousNames: Object.values(index).filter(matches => matches.length > 1).length };
}

export function lookupBaseballStat(snapshot, name, role) {
  const key = normalizeEntityName(name);
  if (Object.hasOwn(snapshot.baseballPlayersByRole || {}, role)) {
    const matches = snapshot.baseballPlayersByRole[role]?.[key];
    if (!Array.isArray(matches) || !matches.length) return { row: null, reason: 'missing_stat_identity' };
    if (matches.length !== 1) return { row: null, reason: 'ambiguous_stat_identity' };
    return matches[0]?.role === role ? { row: matches[0], reason: null } : { row: null, reason: 'stat_role_mismatch' };
  }
  const row = snapshot.baseballPlayers?.[key];
  return row?.role === role ? { row, reason: null } : { row: null, reason: row ? 'stat_role_mismatch' : 'missing_stat_identity' };
}


export function baseballSampleMeasurement(row={}) {
 const plateAppearances=finiteNumber(row.plateAppearances),battedBallEvents=finiteNumber(row.battedBallEvents);
 const known=[plateAppearances,battedBallEvents].filter(value=>value!==null);
 const invalid=known.some(value=>!Number.isInteger(value)||value<0)
  ||plateAppearances!==null&&battedBallEvents!==null&&battedBallEvents>plateAppearances;
 return {playerId:row.playerId??null,name:row.name??null,plateAppearances,battedBallEvents,
  legacySampleSize:finiteNumber(row.sampleSize),sampleSizeKind:row.sampleSizeKind||'unknown',
  positiveSample:!invalid&&known.some(value=>value>0),invalid};
}
