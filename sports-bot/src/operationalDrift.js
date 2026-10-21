import { validCandidateVector } from './candidateCohorts.js';
import { eventObservationHash } from './journalEventMatch.js';
import { quoteTimeEpoch as instant } from './oddsPricing.js';

const sides = ['away', 'home', 'draw'];
const text = value => typeof value === 'string' && value.trim().length > 0;
const add = (groups, key, row) => { if (!groups.has(key)) groups.set(key, []); groups.get(key).push(row); };
function probabilities(row) {
  const raw = row.outcomePercentages, declared = row.modeledOutcomes;
  if (!raw || Array.isArray(raw) || Object.keys(raw).some(key => !sides.includes(key))) return null;
  if (declared !== undefined && (!Array.isArray(declared) || declared.length !== new Set(declared).size
    || !declared.includes('away') || !declared.includes('home') || declared.some(side => !sides.includes(side)))) return null;
  const binary = Array.isArray(declared) && declared.length === 2;
  const vector = Object.fromEntries(sides.map(side => [side, side === 'draw' && binary && raw.draw == null ? 0 : raw[side]]));
  if (binary && vector.draw !== 0) return null;
  if (Object.values(vector).some(value => typeof value !== 'number' || !Number.isFinite(value))) return null;
  for (const side of sides) vector[side] /= 100;
  return validCandidateVector(vector) ? vector : null;
}

/** Journal-only descriptive monitoring. No fitting, model selection or automatic action. */
export function operationalDrift(issued, results, conflicts, { asOf, windowDays, minDriftGames }) {
  const exclusions = {}, skip = reason => { exclusions[reason] = (exclusions[reason] ?? 0) + 1; };
  const identities = new Map();
  for (const event of issued) {
    const row = event.payload, generated = instant(row.predictionGeneratedAt), at = instant(event.recordedAt), start = instant(row.startTime);
    if (!text(row.forecastId) || !text(row.league) || !text(row.modelVersion) || !text(row.horizon)
      || !['string', 'number'].includes(typeof row.gameId) || (typeof row.gameId === 'number' && !Number.isFinite(row.gameId)) || !String(row.gameId).trim()) { skip('identity_or_horizon_missing'); continue; }
    if (![generated, at, start].every(Number.isFinite) || generated > at || at >= start) { skip('issuance_chronology_invalid'); continue; }
    const league = row.league.trim().toLowerCase(), horizon = row.horizon.trim().toLowerCase();
    const game = JSON.stringify([league, String(row.gameId), new Date(start).toISOString()]);
    const item = { event, row, generated, at, start, league, horizon, game };
    add(identities, row.forecastId, item);
  }
  const identityConflicts = new Set([...identities].filter(([, rows]) => new Set(rows.map(item => eventObservationHash(item.row))).size > 1).map(([id]) => id));
  const unique = [];
  for (const [id, rows] of identities) {
    if (identityConflicts.has(id)) { for (const row of rows) skip('forecast_identity_conflict'); continue; }
    rows.sort((a, b) => a.at - b.at); unique.push(rows[0]);
    for (let i = 1; i < rows.length; i++) skip('duplicate_forecast_record');
  }
  const resultSides = new Map(), disputed = new Set();
  for (const item of unique) {
    const result = results.get(item.row.forecastId), observed = instant(result?.observedAt), recorded = instant(result?.resultRecordedAt);
    if (conflicts.has(item.row.forecastId)) disputed.add(item.game);
    if (result && !result.scheduleChanged && sides.includes(result.actualSide) && Number.isFinite(observed) && Number.isFinite(recorded)
      && item.start <= observed && observed <= recorded && recorded <= asOf) {
      item.result = result; add(resultSides, item.game, result.actualSide);
    } else if (result) item.invalidResult = true;
  }
  const contradictory = new Set([...resultSides].filter(([, labels]) => new Set(labels).size > 1).map(([game]) => game));
  const firstGroups = new Map();
  for (const item of unique) add(firstGroups, JSON.stringify([item.game, item.row.modelVersion, item.horizon]), item);
  const cohorts = new Map(), width = windowDays * 86400000;
  for (const rows of firstGroups.values()) {
    rows.sort((a, b) => a.at - b.at || a.row.forecastId.localeCompare(b.row.forecastId));
    for (let i = 1; i < rows.length; i++) skip('later_same_horizon_record_not_selected');
    const item = rows[0], { row } = item;
    if (contradictory.has(item.game)) { skip('conflicting_game_results'); continue; }
    if (disputed.has(item.game)) { skip('unresolved_game_result_dispute'); continue; }
    const earliest = rows.filter(other => other.at === item.at);
    if (new Set(earliest.map(other => eventObservationHash({ vector: other.row.outcomePercentages, selectedSide: other.row.selectedSide,
      generatedAt: new Date(other.generated).toISOString() }))).size > 1) { skip('simultaneous_forecast_conflict'); continue; }
    const vector = probabilities(row);
    if (!vector) {
      const raw = row.outcomePercentages;
      skip(raw && Number.isFinite(raw.away) && Number.isFinite(raw.home) && raw.draw == null && row.modeledOutcomes === undefined
        ? 'modeled_outcome_space_unverified' : 'invalid_probabilities');
      continue;
    }
    if (!sides.includes(row.selectedSide) || vector[row.selectedSide] !== Math.max(...Object.values(vector))) { skip('frozen_selection_not_verified'); continue; }
    if (!item.result) { skip(item.invalidResult ? 'invalid_result_chronology_or_schedule' : 'unresolved'); continue; }
    const age = asOf - item.start, period = age >= 0 && age < width ? 'recent' : age >= width && age < 2 * width ? 'previous' : null;
    if (!period) { skip('outside_monitoring_windows'); continue; }
    const key = JSON.stringify([item.league, row.modelVersion, item.horizon]);
    if (!cohorts.has(key)) cohorts.set(key, { league: item.league, modelVersion: row.modelVersion, horizon: item.horizon, previous: [], recent: [] });
    const actual = item.result.actualSide;
    cohorts.get(key)[period].push({ brier: sides.reduce((sum, side) => sum + (vector[side] - Number(side === actual)) ** 2, 0),
      logLoss: -Math.log(Math.max(1e-12, vector[actual])), confidence: vector[row.selectedSide], correct: Number(row.selectedSide === actual) });
  }
  const metrics = rows => {
    if (!rows.length) return { games: 0, brier: null, logLoss: null, accuracy: null, calibrationGap: null };
    const mean = key => rows.reduce((sum, row) => sum + row[key], 0) / rows.length;
    return { games: rows.length, brier: mean('brier'), logLoss: mean('logLoss'), accuracy: mean('correct'), calibrationGap: mean('confidence') - mean('correct') };
  };
  return { windowDays, minDriftGames, exclusions, conflictingResultGames: contradictory.size, disputedResultGames: disputed.size,
    selectionRule: 'First eligible issued record per canonical event/model/horizon across guilds; no fallback to a later resolved forecast.',
    scoreDefinition: 'Brier is the sum across away/home/draw, including zero probabilities; log loss clipped at 1e-12; calibration gap uses the frozen selected maximum-probability outcome.',
    cohorts: [...cohorts.values()].map(row => {
      const previous = metrics(row.previous), recent = metrics(row.recent), supported = Math.min(previous.games, recent.games) >= minDriftGames;
      return { league: row.league, modelVersion: row.modelVersion, horizon: row.horizon, previous, recent,
        status: supported ? 'descriptive_comparison_only' : 'insufficient_games', brierChange: supported ? recent.brier - previous.brier : null,
        calibrationGapChange: supported ? recent.calibrationGap - previous.calibrationGap : null };
    }).sort((a, b) => JSON.stringify([a.league, a.modelVersion, a.horizon]).localeCompare(JSON.stringify([b.league, b.modelVersion, b.horizon]))),
    automaticAction: false };
}
