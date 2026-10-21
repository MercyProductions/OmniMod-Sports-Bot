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
  if (game.statusKey !== 'final') return '';
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
