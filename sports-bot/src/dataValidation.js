// Missing provider values are unknown, never numeric zero.
export function explicitlyUnavailable(player = {}) {
  return /ruled out|\bout\b|inactive|suspend|injured reserve|\bir\b/i.test(`${player.status || ''} ${player.notes || ''}`);
}

export function finiteNumber(value, fallback = null) {
  if (value === null || value === undefined || typeof value === 'boolean' ||
      (typeof value === 'string' && !value.trim())) return fallback;
  if (typeof value !== 'string' && typeof value !== 'number') return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

/** Presence of a count is not a claim that its sample is statistically adequate. */
export function gameCountEvidence(value) {
  const games = finiteNumber(value);
  return { games, positiveSample: Number.isSafeInteger(games) && games > 0 };
}

export function teamGameSampleEvidence(away, home) {
  return { away: gameCountEvidence(away?.games), home: gameCountEvidence(home?.games), sampleAdequacyValidated: false };
}

export function measuredPerGame(total, games) {
  return measuredCalculation([total, games], (value, count) => gameCountEvidence(count).positiveSample ? value / count : null);
}

/** A derived measurement exists only when every required input and the result are finite. */
export function measuredCalculation(values, calculate) {
  const observed = values.map(value => finiteNumber(value));
  const result = observed.some(value => value === null) ? null : finiteNumber(calculate(...observed));
  return result === 0 ? 0 : result;
}

export function validScore(value) {
  const score = finiteNumber(value);
  return score !== null && score >= 0 ? score : null;
}

export function scoreOutcome(awayValue, homeValue) {
  const away = validScore(awayValue);
  const home = validScore(homeValue);
  if (away === null || home === null) return '';
  return home === away ? 'draw' : home > away ? 'home' : 'away';
}

export function finalOutcomeSide(game = {}) {
  if (game.statusKey !== 'final'||game.manualResultConflict) return '';
  if(/soccer/i.test(game.sportGroup||'')&&game.manualResultEvidence&&game.manualResultEvidence.scoreBasis!=='regulation')return '';
  // Soccer h2h is a regulation-time market. A final after extra time/penalties
  // does not establish its result without a separate regulation score.
  if (/soccer/i.test(game.sportGroup || '') && /extra time|penalt|\baet\b|\bpen\b/i.test(game.detail || '')) return '';
  // Combat/tennis feeds can declare a winner without comparable team scores.
  if (/combat|tennis/i.test(game.sportGroup || '') && Boolean(game.away?.winner) !== Boolean(game.home?.winner)) {
    return game.home?.winner ? 'home' : 'away';
  }
  return scoreOutcome(game.away?.score, game.home?.score);
}

export function americanToProbability(price) {
  const value = finiteNumber(price);
  if (value === null || Math.abs(value) < 100) return null;
  return value > 0 ? 100 / (value + 100) : -value / (-value + 100);
}

/** An explicit availability assertion is separate from a role/workload prior or medical verification. */
export function hasAvailabilityObservation(player={}){
 if(player.active===false||explicitlyUnavailable(player))return true;
 const text=String(player.status||'');
 if(/doubtful|questionable|game.?time|day.?to.?day|limited|\bavailable\b|\bhealthy\b|\bactive\b/i.test(text))return true;
 const rolePrior=player.availabilityEvidence==='role_prior_not_injury_clearance';
 if(!rolePrior&&/probable/i.test(text)&&!/probable starter/i.test(text))return true;
 return !rolePrior&&finiteNumber(player.availability)!==null;
}
