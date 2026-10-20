/** Keep forecasts of different provenance, model versions and horizons separate. */
export function selectCandidateCohort(input = []) {
  const groups = new Map();
  for (const row of input) {
    const source = row.source === 'frozen-production' ? 'production'
      : row.source === 'historical-replay' ? 'replay' : 'unspecified';
    const key = [source, row.modelVersion || 'legacy-unversioned', row.horizon || row.snapshotStage || 'daily'].join('|');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  const ranked = [...groups].sort(([a], [b]) => {
    const priority = key => key.startsWith('production|') ? 2 : key.startsWith('replay|') ? 1 : 0;
    return priority(b) - priority(a) || b.localeCompare(a, undefined, { numeric: true });
  });
  const [key = null, selected = []] = ranked[0] || [];
  const unique = new Map(), conflicts = new Set();
  for (const [index, row] of selected.entries()) {
    const identity = row.gameId ? [row.leagueKey || row.sport || '', row.dateKey || '', row.gameId].join('|') : `unspecified-row-${index}`;
    const previous = unique.get(identity);
    if (previous && previous.actualSide !== row.actualSide) { conflicts.add(identity); continue; }
    if (!previous || Object.keys(row.candidateProbabilities || {}).length > Object.keys(previous.candidateProbabilities || {}).length)
      unique.set(identity, row);
  }
  const rows = [...unique].filter(([id]) => !conflicts.has(id)).map(([, row]) => row);
  const prospective = rows.length > 0 && rows.every(row => {
    const issued = Date.parse(row.recordedAt || ''), generated = Date.parse(row.predictionGeneratedAt || ''),
      start = Date.parse(row.startTime || ''), resolved = Date.parse(row.resolvedAt || '');
    return row.source === 'frozen-production' && row.modelVersion && row.snapshotPolicy === 'first_issue_immutable_v1'
      && [issued, generated, start, resolved].every(Number.isFinite)
      && generated <= issued && issued < start && resolved >= start;
  });
  return { rows,
    cohort: { key, available: ranked.map(([id, rows]) => ({ key: id, rows: rows.length })),
      excludedOtherCohorts: input.length - selected.length, duplicateRowsRemoved: selected.length - unique.size,
      conflictingGamesExcluded: conflicts.size,
      prospectiveRecordsVerified: prospective,
      scope: 'One game per selected provenance/model/horizon cohort; unversioned legacy evidence is explicitly labeled.' } };
}

export function validCandidateVector(vector) {
  if (!vector || typeof vector !== 'object') return false;
  const values = ['away', 'home', 'draw'].map(side => side === 'draw' && vector[side] === undefined ? 0 : vector[side]);
  if (values.some(value => value === null || typeof value === 'boolean' || String(value).trim() === ''
    || !Number.isFinite(Number(value)) || Number(value) < 0 || Number(value) > 1)) return false;
  return Math.abs(values.reduce((sum, value) => sum + Number(value), 0) - 1) <= 0.001;
}
