import { sportProfile } from './sportProfiles.js';

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function finite(value, fallback = null) {
  if (value === null || value === undefined || value === '') return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function logistic(value) {
  return 1 / (1 + Math.exp(-clamp(value, -10, 10)));
}

function erf(value) {
  const sign = value < 0 ? -1 : 1;
  const x = Math.abs(value);
  const t = 1 / (1 + 0.3275911 * x);
  const polynomial = (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t;
  return sign * (1 - polynomial * Math.exp(-x * x));
}

function normalCdf(value, mean = 0, standardDeviation = 1) {
  return 0.5 * (1 + erf((value - mean) / (Math.max(0.01, standardDeviation) * Math.SQRT2)));
}

function poissonPmf(lambda, value) {
  let factorial = 1;
  for (let index = 2; index <= value; index += 1) factorial *= index;
  return Math.exp(-lambda) * (lambda ** value) / factorial;
}

function poissonOutcomes(awayMean, homeMean, maxScore) {
  let away = 0;
  let home = 0;
  let draw = 0;
  let mass = 0;
  for (let a = 0; a <= maxScore; a += 1) {
    const awayP = poissonPmf(awayMean, a);
    for (let h = 0; h <= maxScore; h += 1) {
      const probability = awayP * poissonPmf(homeMean, h);
      mass += probability;
      if (a > h) away += probability;
      else if (h > a) home += probability;
      else draw += probability;
    }
  }
  const total = Math.max(0.0001, mass);
  return { away: away / total, home: home / total, draw: draw / total };
}

function normalize(vector, twoWay) {
  const safe = {
    away: clamp(finite(vector.away, 0), 0, 1),
    home: clamp(finite(vector.home, 0), 0, 1),
    draw: twoWay ? 0 : clamp(finite(vector.draw, 0), 0, 1)
  };
  if (twoWay && safe.draw > 0) {
    safe.away += safe.draw / 2;
    safe.home += safe.draw / 2;
    safe.draw = 0;
  }
  const total = safe.away + safe.home + safe.draw;
  if (total <= 0) return twoWay ? { away: 0.5, home: 0.5, draw: 0 } : { away: 0.37, home: 0.37, draw: 0.26 };
  return Object.fromEntries(Object.entries(safe).map(([key, value]) => [key, value / total]));
}

function stat(profile, name, fallback = null) {
  return finite(profile?.stats?.[name], fallback);
}

function scoringMeans(game, defaults) {
  const away = game.autoTeamMetrics?.away || {};
  const home = game.autoTeamMetrics?.home || {};
  const prior = defaults.average;
  const awayFor = stat(away, 'averageScored', prior);
  const homeFor = stat(home, 'averageScored', prior);
  const awayAgainst = stat(away, 'averageAllowed', prior);
  const homeAgainst = stat(home, 'averageAllowed', prior);
  const awaySamples = finite(away.sampleSize, 0);
  const homeSamples = finite(home.sampleSize, 0);
  const shrinkAway = awaySamples / (awaySamples + defaults.priorGames);
  const shrinkHome = homeSamples / (homeSamples + defaults.priorGames);
  const rawAway = (awayFor + homeAgainst) / 2;
  const rawHome = (homeFor + awayAgainst) / 2;
  return {
    away: prior + (rawAway - prior) * Math.min(shrinkAway, shrinkHome),
    home: prior + (rawHome - prior) * Math.min(shrinkAway, shrinkHome),
    sampleSize: Math.min(awaySamples, homeSamples)
  };
}

function contextFactor(game, ...keys) {
  const factors = game.autoContext?.factors || {};
  for (const key of keys) {
    const value = finite(factors[key]);
    if (value !== null) return value;
  }
  return 0;
}

function playerRows(game, side) {
  const team = String(game?.[side]?.name || '').toLowerCase();
  return (game.autoPlayers || []).filter((row) => String(row.team || '').toLowerCase() === team || String(row.side || '').toLowerCase() === side);
}

function roleAvailability(game, side, pattern) {
  const rows = playerRows(game, side).filter((row) => pattern.test(String(row.role || row.position || '')));
  if (!rows.length) return 0;
  return rows.reduce((sum, row) => {
    const projection = row.participationProjection;
    const participationAvailability = projection
      ? clamp(finite(projection.expectedShare, 0) / Math.max(0.1, finite(projection.historicalShare, 1)), 0, 1)
      : clamp(finite(row.availability, 55) / 100, 0, 1);
    return sum + participationAvailability;
  }, 0) / rows.length - 0.55;
}

function baseResult(profileKey, modelId, probabilities, expectedScores, sampleSize, features, notes = []) {
  const profile = sportProfile({ sportGroup: profileKey });
  return {
    available: true,
    modelId,
    sport: profileKey,
    probabilities: normalize(probabilities, profile.twoWay),
    expectedScores,
    sampleSize: Number(sampleSize || 0),
    features,
    notes
  };
}

function baseball(game, evidence) {
  const means = scoringMeans(game, { average: 4.45, priorGames: 12 });
  const park = clamp(1 + contextFactor(game, 'parkFactor', 'runEnvironment') * 0.08, 0.8, 1.22);
  const awayStarter = roleAvailability(game, 'away', /starting pitcher|\bsp\b/i);
  const homeStarter = roleAvailability(game, 'home', /starting pitcher|\bsp\b/i);
  const awayBullpen = roleAvailability(game, 'away', /relief|closer|bullpen|\brp\b/i);
  const homeBullpen = roleAvailability(game, 'home', /relief|closer|bullpen|\brp\b/i);
  const adjustment = clamp(evidence.modelLogit, -2, 2) * 0.10;
  const awayBase = finite(game.advancedDataset?.awayExpectedRuns, means.away);
  const homeBase = finite(game.advancedDataset?.homeExpectedRuns, means.home);
  const bullpenDifference = finite(game.advancedDataset?.bullpenDifference, 0);
  const lineupXwobaDifference = finite(game.advancedDataset?.lineupXwobaDifference, 0);
  const playDelta = clamp(finite(game.advancedDataset?.playValueDifference, 0), -0.3, 0.3);
  const awayRuns = clamp(awayBase * park * Math.exp(-adjustment - homeStarter * 0.18 - homeBullpen * 0.08 - bullpenDifference * 0.015 - lineupXwobaDifference * 1.6 - playDelta * 0.18), 1.8, 8.2);
  const homeRuns = clamp(homeBase * park * Math.exp(adjustment - awayStarter * 0.18 - awayBullpen * 0.08 + bullpenDifference * 0.015 + lineupXwobaDifference * 1.6 + playDelta * 0.18), 1.8, 8.2);
  const regulation = poissonOutcomes(awayRuns, homeRuns, 18);
  const tieSplit = regulation.draw / 2;
  return baseResult('baseball', 'mlb-expected-runs-sp-bullpen-park-v1', { away: regulation.away + tieSplit, home: regulation.home + tieSplit, draw: 0 }, { away: awayRuns, home: homeRuns }, means.sampleSize, ['expected runs', 'starting pitcher', 'bullpen availability', 'park/run environment']);
}

function basketball(game, evidence) {
  const means = scoringMeans(game, { average: /wnba/i.test(game.leagueKey) ? 81 : /ncaa/i.test(game.leagueKey) ? 73 : 112, priorGames: 10 });
  const baseTotal = means.away + means.home;
  const pace = clamp(finite(game.advancedDataset?.pace, baseTotal / 2), 65, 110);
  const lineup = clamp(finite(game.autoLineup?.ratingDifference, 0) / 10, -2, 2);
  const efficiency = finite(game.advancedDataset?.efficiencyDifference, 0);
  const turnover = finite(game.advancedDataset?.turnoverRateDifference, 0);
  const playDelta = finite(game.advancedDataset?.playValueDifference, 0) * 4 + finite(game.advancedDataset?.playSuccessDifference, 0) * 5 - finite(game.advancedDataset?.playTurnoverDifference, 0) * 8;
  const margin = clamp((means.home - means.away) + evidence.modelLogit * 5.2 + lineup * 1.6 + efficiency * 0.11 - turnover * 18 + playDelta, -28, 28);
  const standardDeviation = /wnba|ncaa/i.test(game.leagueKey) ? 11.5 : 12.8;
  const home = normalCdf(margin / standardDeviation);
  return baseResult('basketball', 'basketball-possessions-efficiency-lineup-v1', { away: 1 - home, home, draw: 0 }, { away: baseTotal / 2 - margin / 2, home: baseTotal / 2 + margin / 2, possessions: pace }, means.sampleSize, ['possessions/pace', 'offensive efficiency', 'defensive efficiency', 'lineup quality']);
}

function football(game, evidence) {
  const college = /ncaaf/i.test(game.leagueKey);
  const means = scoringMeans(game, { average: college ? 28 : 22.5, priorGames: 8 });
  const homeQb = roleAvailability(game, 'home', /quarterback|\bqb\b/i);
  const awayQb = roleAvailability(game, 'away', /quarterback|\bqb\b/i);
  const homeOl = roleAvailability(game, 'home', /tackle|guard|center|offensive line|\bol\b/i);
  const awayOl = roleAvailability(game, 'away', /tackle|guard|center|offensive line|\bol\b/i);
  const epaDelta = finite(game.advancedDataset?.epaDifference, 0);
  const driveDelta = finite(game.advancedDataset?.driveEfficiencyDifference, 0);
  const playDelta = finite(game.advancedDataset?.playValueDifference, 0) * 5 + finite(game.advancedDataset?.playSuccessDifference, 0) * 6 - finite(game.advancedDataset?.playTurnoverDifference, 0) * 8;
  const margin = clamp((means.home - means.away) + evidence.modelLogit * 4.6 + (homeQb - awayQb) * 6.5 + (homeOl - awayOl) * 2.4 + epaDelta * 6 + driveDelta * 3 + playDelta, -30, 30);
  const home = normalCdf(margin / (college ? 16.5 : 13.6));
  return baseResult('football', 'football-epa-drive-qb-ol-v1', { away: 1 - home, home, draw: 0 }, { away: means.away - margin / 2, home: means.home + margin / 2 }, means.sampleSize, ['EPA', 'drive efficiency', 'quarterback availability', 'offensive-line availability']);
}

function hockey(game, evidence) {
  const means = scoringMeans(game, { average: 3.05, priorGames: 12 });
  const awayGoalie = roleAvailability(game, 'away', /goalie|goaltender|\bg\b/i);
  const homeGoalie = roleAvailability(game, 'home', /goalie|goaltender|\bg\b/i);
  const xgDelta = finite(game.advancedDataset?.xgDifference, 0);
  const gsaxDelta = finite(game.advancedDataset?.gsaxDifference, 0);
  const playDelta = finite(game.advancedDataset?.playValueDifference, 0) * 0.08 + finite(game.advancedDataset?.playShotQualityDifference, 0) * 0.12;
  const adjustment = clamp(evidence.modelLogit * 0.10 + xgDelta * 0.04 + gsaxDelta * 0.025 + playDelta, -0.35, 0.35);
  const awayGoals = clamp(means.away * Math.exp(-adjustment - homeGoalie * 0.18), 1.3, 5.4);
  const homeGoals = clamp(means.home * Math.exp(adjustment - awayGoalie * 0.18), 1.3, 5.4);
  const regulation = poissonOutcomes(awayGoals, homeGoals, 11);
  const tieSplit = regulation.draw / 2;
  return baseResult('hockey', 'hockey-xg-shot-quality-gsax-v1', { away: regulation.away + tieSplit, home: regulation.home + tieSplit, draw: 0 }, { away: awayGoals, home: homeGoals }, means.sampleSize, ['expected goals', 'shot quality', 'goalie GSAx/availability']);
}

function soccer(game, evidence) {
  const means = scoringMeans(game, { average: 1.35, priorGames: 12 });
  const xgAway = finite(game.advancedDataset?.awayXg, means.away);
  const xgHome = finite(game.advancedDataset?.homeXg, means.home);
  const goalkeeperDelta = roleAvailability(game, 'home', /goalkeeper|\bgk\b/i) - roleAvailability(game, 'away', /goalkeeper|\bgk\b/i);
  const playDelta = finite(game.advancedDataset?.playValueDifference, 0) * 0.08 + finite(game.advancedDataset?.playShotQualityDifference, 0) * 0.1;
  const adjustment = clamp(evidence.modelLogit * 0.095 + goalkeeperDelta * 0.08 + playDelta, -0.32, 0.32);
  const awayGoals = clamp(xgAway * Math.exp(-adjustment), 0.35, 3.4);
  const homeGoals = clamp(xgHome * Math.exp(adjustment), 0.35, 3.4);
  return baseResult('soccer', 'soccer-xg-poisson-v1', poissonOutcomes(awayGoals, homeGoals, 9), { away: awayGoals, home: homeGoals }, means.sampleSize, ['non-penalty xG', 'opponent xG allowed', 'Poisson score distribution', 'goalkeeper availability']);
}

function tennis(game, evidence) {
  const surfaceElo = finite(game.advancedDataset?.surfaceEloDifference, 0);
  const serveReturn = finite(game.advancedDataset?.serveReturnDifference, 0);
  const fatigue = contextFactor(game, 'awayFatigue') - contextFactor(game, 'homeFatigue');
  const home = logistic(evidence.modelLogit * 0.86 + surfaceElo / 190 + serveReturn * 2.2 + fatigue * 0.25);
  return baseResult('tennis', 'tennis-surface-elo-serve-return-v1', { away: 1 - home, home, draw: 0 }, null, Math.min(finite(game.autoTeamMetrics?.away?.sampleSize, 0), finite(game.autoTeamMetrics?.home?.sampleSize, 0)), ['surface Elo', 'serve points won', 'return points won', 'fatigue/travel']);
}

function combat(game, evidence) {
  const striking = finite(game.advancedDataset?.strikingDifferential, 0);
  const grappling = finite(game.advancedDataset?.grapplingDifferential, 0);
  const opponentStrength = finite(game.advancedDataset?.opponentStrengthDifference, 0);
  const style = contextFactor(game, 'homeStyleMatchup') - contextFactor(game, 'awayStyleMatchup');
  const home = logistic(evidence.modelLogit * 0.78 + striking * 0.14 + grappling * 0.12 + opponentStrength / 180 + style * 0.3);
  return baseResult('combat', 'combat-opponent-adjusted-style-v1', { away: 1 - home, home, draw: 0 }, null, Math.min(finite(game.autoTeamMetrics?.away?.sampleSize, 0), finite(game.autoTeamMetrics?.home?.sampleSize, 0)), ['opponent-adjusted strength', 'striking differential', 'grappling differential', 'style matchup']);
}

const BUILDERS = { baseball, basketball, football, hockey, soccer, tennis, combat };

export function buildSportModelPrediction(game, evidence = {}) {
  const key = sportProfile(game).key;
  const builder = BUILDERS[key];
  if (!builder) return { available: false, modelId: 'no-specialist', sport: key, probabilities: null, expectedScores: null, sampleSize: 0, features: [] };
  return builder(game, { modelLogit: finite(evidence.modelLogit, 0), ...evidence });
}

export function blendProbabilityVectors(primary, specialist, weight = 0.35, twoWay = true) {
  const bounded = clamp(Number(weight) || 0, 0, 0.7);
  return normalize({
    away: primary.away * (1 - bounded) + specialist.away * bounded,
    home: primary.home * (1 - bounded) + specialist.home * bounded,
    draw: primary.draw * (1 - bounded) + specialist.draw * bounded
  }, twoWay);
}
