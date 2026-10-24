import { validCandidateVector } from './candidateCohorts.js';

const sides = ['away', 'home', 'draw'];
/** Frozen primary forecasts only. Missing legacy classes are not evidence of structural zero. */
export function journalOutcomeVector(row) {
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

