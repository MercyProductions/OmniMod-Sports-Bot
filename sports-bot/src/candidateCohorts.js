import { eventObservationHash } from './journalEventMatch.js';
import { quoteTimeEpoch as instant } from './oddsPricing.js';

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
  const events = new Map(), conflicts = new Set();
  for (const [index, row] of selected.entries()) {
    const start = instant(row.startTime);
    const identity = row.gameId !== undefined && row.gameId !== null && String(row.gameId).trim()
      ? JSON.stringify([String(row.leagueKey || row.sport || '').trim().toLowerCase(),
        Number.isFinite(start) ? new Date(start).toISOString() : row.dateKey || '', String(row.gameId)])
      : `unspecified-row-${index}`;
    if (!events.has(identity)) events.set(identity, []);
    events.get(identity).push(row);
  }
  const rows = [];
  let ambiguousFirstForecastGamesExcluded = 0, duplicateChronologyGamesExcluded = 0;
  for (const [identity, copies] of events) {
    if (new Set(copies.map(row => row.actualSide)).size > 1) { conflicts.add(identity); continue; }
    const observed = row => instant(row.source === 'historical-replay' ? row.predictionGeneratedAt : row.recordedAt);
    // Without order evidence, do not choose among duplicate copies by input order or model completeness.
    if (copies.length > 1 && copies.some(row => !Number.isFinite(observed(row)))) { duplicateChronologyGamesExcluded++; continue; }
    const ordered = [...copies].sort((a,b) => observed(a) - observed(b) || (instant(b.resolvedAt) - instant(a.resolvedAt)));
    const first = ordered[0], earliest = ordered.filter(row => observed(row) === observed(first));
    const frozenInputs = row => eventObservationHash({ generatedAt: Number.isFinite(instant(row.predictionGeneratedAt))
      ? new Date(instant(row.predictionGeneratedAt)).toISOString() : row.predictionGeneratedAt,
      candidateProbabilities: row.candidateProbabilities, candidateModeledOutcomes: row.candidateModeledOutcomes, candidateArtifactIds: row.candidateArtifactIds,
      mlFeatureVector: row.mlFeatureVector, featureVector: row.featureVector,
      outcomeProbabilities: row.outcomeProbabilities, modeledOutcomes: row.modeledOutcomes, predictedSide: row.predictedSide });
    if (new Set(earliest.map(frozenInputs)).size > 1) { ambiguousFirstForecastGamesExcluded++; continue; }
    rows.push(first);
  }
  const prospective = rows.length > 0 && rows.every(row => {
    const issued = instant(row.recordedAt), generated = instant(row.predictionGeneratedAt),
      start = instant(row.startTime), resolved = instant(row.resolvedAt);
    return row.source === 'frozen-production' && row.modelVersion && row.leagueKey && row.gameId !== undefined && row.gameId !== null && String(row.gameId).trim() && row.snapshotPolicy === 'first_issue_immutable_v1'
      && [issued, generated, start, resolved].every(Number.isFinite)
      && generated <= issued && issued < start && resolved >= start;
  });
  return { rows,
    cohort: { key, available: ranked.map(([id, rows]) => ({ key: id, rows: rows.length })),
      excludedOtherCohorts: input.length - selected.length, duplicateRowsRemoved: selected.length - events.size,
      ambiguousFirstForecastGamesExcluded, duplicateChronologyGamesExcluded,
      conflictingGamesExcluded: conflicts.size,
      prospectiveRecordsVerified: prospective,
      scope: 'First recorded forecast per canonical league/event/start within the selected provenance/model/horizon cohort; replay order uses generated time. Conflicting labels, ambiguous earliest inputs and unordered duplicate copies are excluded. Unversioned legacy evidence is explicitly labeled.' } };
}

export function validCandidateVector(vector, declared) {
  const sides = ['away','home','draw'];
  if (!vector || typeof vector !== 'object' || Array.isArray(vector) || Object.keys(vector).some(side => !sides.includes(side))) return false;
  if (declared !== undefined && (!Array.isArray(declared) || declared.length !== new Set(declared).size
    || !declared.includes('away') || !declared.includes('home') || declared.some(side => !sides.includes(side)))) return false;
  const binary = Array.isArray(declared) && declared.length === 2;
  const values = sides.map(side => side === 'draw' && binary && vector.draw == null ? 0 : vector[side]);
  if (binary && values[2] !== 0) return false;
  if (values.some(value => typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1)) return false;
  return Math.abs(values.reduce((sum,value) => sum + value,0) - 1) <= 0.001;
}
