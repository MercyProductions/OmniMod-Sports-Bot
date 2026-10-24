import { sportProfile } from './sportProfiles.js';
import {availabilityFraction,finiteNumber,gameCountEvidence} from './dataValidation.js';
import {normalizeEntityName} from './intelligenceStore.js';
import {reconcilePlayerEvidence} from './playerEvidence.js';
import {observedInputState} from './inputChronology.js';
import {quoteTimeEpoch} from './oddsPricing.js';

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function finite(value, fallback = null) {
  return finiteNumber(value,fallback);
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

function scoringMeans(game, defaults) {
  const away = game.autoTeamMetrics?.away || {};
  const home = game.autoTeamMetrics?.home || {};
  const prior = defaults.average;
  const evidence={schema:'sports-scoring-inputs-v1',priorPerTeam:prior,priorGames:defaults.priorGames,teams:{},samplePeriodVerified:false,publicationVerified:false,
    scope:'Declared team-game counts and scoring-rate inputs; neither statistical adequacy nor source period is independently verified.'};
  const rates={};
  for(const [side,row] of [['away',away],['home',home]]){
    const count=gameCountEvidence(row.sampleSize),measurements={};
    for(const key of ['averageScored','averageAllowed']){const value=finite(row.stats?.[key]),observed=value!==null&&value>=0;measurements[key]={observed,value:observed?value:null,usedValue:observed?value:prior};}
    evidence.teams[side]={declaredCount:count.games,positiveCount:count.positiveSample,effectiveCount:count.positiveSample?count.games:0,measurements};
    rates[side]=measurements;
  }
  const awayFor = rates.away.averageScored.usedValue;
  const homeFor = rates.home.averageScored.usedValue;
  const awayAgainst = rates.away.averageAllowed.usedValue;
  const homeAgainst = rates.home.averageAllowed.usedValue;
  const awaySamples = evidence.teams.away.effectiveCount;
  const homeSamples = evidence.teams.home.effectiveCount;
  const shrinkAway = awaySamples / (awaySamples + defaults.priorGames);
  const shrinkHome = homeSamples / (homeSamples + defaults.priorGames);
  const rawAway = awayFor / 2 + homeAgainst / 2;
  const rawHome = homeFor / 2 + awayAgainst / 2;
  return {
    away: prior + (rawAway - prior) * Math.min(shrinkAway, shrinkHome),
    home: prior + (rawHome - prior) * Math.min(shrinkAway, shrinkHome),
    sampleSize: Math.min(awaySamples, homeSamples),evidence
  };
}

/** Approximate margin law, not a joint score distribution or a calibrated probability. */
function normalPointForecast(means,requestedMargin,cap,standardDeviation){
 const total=means.away+means.home,bounded=clamp(requestedMargin,-cap,cap);
 const distribution={schema:'sports-normal-margin-v1',family:'normal_margin_approximation',standardDeviation,expectedTotalMean:Number.isFinite(total)?total:null,calibrated:false,
  scope:'Normal approximation for margin only; nonnegative expected score means do not imply nonnegative joint-score support.'};
 if(!Number.isFinite(total)||total<0||!Number.isFinite(requestedMargin)||!Number.isFinite(bounded))return {valid:false,distribution:{...distribution,status:'invalid_total_or_composite_margin',meanMargin:null},expectedScores:null};
 const margin=clamp(bounded,-total,total);
 return {valid:true,home:normalCdf(margin/standardDeviation),expectedScores:{away:(total-margin)/2,home:(total+margin)/2},
  distribution:{...distribution,status:'heuristic',meanMargin:margin,existingCappedMargin:bounded,nonnegativeMeanConstraintApplied:margin!==bounded}};
}
function normalPointResult(sport,modelId,forecast,means,features,extraScores={}){
 if(!forecast.valid)return {available:false,modelId,sport,probabilities:null,expectedScores:null,sampleSize:means.sampleSize,features,
  notes:['Specialist abstained: nonfinite score total or composite margin. Evidence model fallback remains separate.'],scoreDistribution:forecast.distribution,scoringEvidence:means.evidence};
 return {...baseResult(sport,modelId,{away:1-forecast.home,home:forecast.home,draw:0},{...forecast.expectedScores,...extraScores},means.sampleSize,features),scoreDistribution:forecast.distribution,scoringEvidence:means.evidence};
}

function contextFactor(game, ...keys) {
  const factors = game.autoContext?.factors || {};
  for (const key of keys) {
    const value = finite(factors[key]);
    if (value !== null) return value;
  }
  return 0;
}

function roleAvailability(game,side,role,pattern,evidence){
  const report={side,role,observedPlayers:0,unknownPlayers:0,unknownClockPlayers:0,invalidWorkloadPlayers:0,exclusions:{},value:0};
  const exclude=reason=>{report.exclusions[reason]=(report.exclusions[reason]||0)+1;evidence.availabilityEvidence.exclusions[reason]=(evidence.availabilityEvidence.exclusions[reason]||0)+1;};
  const names=key=>new Set([game[key]?.name,game[key]?.abbr,...(game[key]?.aliases||[])].map(normalizeEntityName).filter(Boolean));
  const sides={away:names('away'),home:names('home')},rows=[];
  for(const row of game.autoPlayers||[]){
    if(!pattern.test(String(row.role||row.position||'')))continue;
    const team=normalizeEntityName(row.team),matching=['away','home'].filter(key=>sides[key].has(team));
    if(matching.length!==1){exclude('unbound_or_ambiguous_player_team');continue;}
    if(matching[0]!==side)continue;
    if(row.side&&String(row.side).toLowerCase()!==side){exclude('team_side_conflict');continue;}
    const league=normalizeEntityName(row.leagueKey||row.league);
    if(league&&![game.leagueKey,game.league].map(normalizeEntityName).includes(league)){exclude('player_league_mismatch');continue;}
    const clock=observedInputState(row,evidence.now);
    if(['invalid_observation_time','after_information_cutoff'].includes(clock)){exclude(clock);continue;}
    if([row.availabilityExpiresAt,row.expiresAt].filter(value=>value!==undefined).some(value=>!Number.isFinite(quoteTimeEpoch(value))||quoteTimeEpoch(value)<=evidence.now)){exclude('player_assertion_expired_or_invalid');continue;}
    rows.push({...row,team:game[side].name||game[side].abbr});
  }
  let total=0;
  for(const row of reconcilePlayerEvidence(rows)){
    const health=availabilityFraction(row);
    if(health===null){report.unknownPlayers++;continue;}
    report.observedPlayers++;if(observedInputState(row,evidence.now)==='unknown')report.unknownClockPlayers++;
    let value=health;const projection=row.participationProjection;
    const projectionClock=projection?observedInputState(projection,evidence.now):null;
    if(projection&&['invalid_observation_time','after_information_cutoff'].includes(projectionClock))exclude('projection_'+projectionClock);
    else if(projection){
      const expected=finiteNumber(projection.expectedShare),historical=finiteNumber(projection.historicalShare);
      if(expected!==null&&historical!==null&&historical>0&&historical<=1&&expected>=0&&expected<=historical)value=Math.min(health,expected/historical);
      else report.invalidWorkloadPlayers++;
    }
    total+=value;
  }
  report.value=report.observedPlayers?total/report.observedPlayers-.55:0;
  evidence.availabilityEvidence.roles.push(report);
  if(!report.observedPlayers)evidence.availabilityEvidence.missingRoles.push(side+':'+role);
  return report.value;
}

function baseResult(profileKey, modelId, probabilities, expectedScores, sampleSize, features, notes = []) {
  const profile = sportProfile({ sportGroup: profileKey });
  return {
    available: true,
    modelId,
    sport: profileKey,
    probabilities: normalize(probabilities, profile.twoWay),
    expectedScores,
    sampleSize: gameCountEvidence(sampleSize).positiveSample ? Number(sampleSize) : 0,
    features,
    notes
  };
}

function baseball(game, evidence) {
  const means = scoringMeans(game, { average: 4.45, priorGames: 12 });
  const park = clamp(1 + contextFactor(game, 'parkFactor', 'runEnvironment') * 0.08, 0.8, 1.22);
  const awayStarter = roleAvailability(game, 'away', 'starter', /starting pitcher|\bsp\b/i,evidence);
  const homeStarter = roleAvailability(game, 'home', 'starter', /starting pitcher|\bsp\b/i,evidence);
  const awayBullpen = roleAvailability(game, 'away', 'bullpen', /relief|closer|bullpen|\brp\b/i,evidence);
  const homeBullpen = roleAvailability(game, 'home', 'bullpen', /relief|closer|bullpen|\brp\b/i,evidence);
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
  return {...baseResult('baseball', 'mlb-expected-runs-sp-bullpen-park-v1', { away: regulation.away + tieSplit, home: regulation.home + tieSplit, draw: 0 }, { away: awayRuns, home: homeRuns }, means.sampleSize, ['expected runs', 'starting pitcher', 'bullpen availability', 'park/run environment']),scoringEvidence:means.evidence};
}

function basketball(game, evidence) {
  const means = scoringMeans(game, { average: /wnba/i.test(game.leagueKey) ? 81 : /ncaa/i.test(game.leagueKey) ? 73 : 112, priorGames: 10 });
  const baseTotal = means.away + means.home;
  const pace = clamp(finite(game.advancedDataset?.pace, baseTotal / 2), 65, 110);
  const lineup = clamp(finite(game.autoLineup?.ratingDifference, 0) / 10, -2, 2);
  const efficiency = finite(game.advancedDataset?.efficiencyDifference, 0);
  const turnover = finite(game.advancedDataset?.turnoverRateDifference, 0);
  const playDelta = finite(game.advancedDataset?.playValueDifference, 0) * 4 + finite(game.advancedDataset?.playSuccessDifference, 0) * 5 - finite(game.advancedDataset?.playTurnoverDifference, 0) * 8;
  const margin = (means.home - means.away) + evidence.modelLogit * 5.2 + lineup * 1.6 + efficiency * 0.11 - turnover * 18 + playDelta;
  const standardDeviation = /wnba|ncaa/i.test(game.leagueKey) ? 11.5 : 12.8;
  return normalPointResult('basketball','basketball-possessions-efficiency-lineup-v2',normalPointForecast(means,margin,28,standardDeviation),means,['possessions/pace','offensive efficiency','defensive efficiency','lineup quality'],{possessions:pace});
}

function football(game, evidence) {
  const college = /ncaaf/i.test(game.leagueKey);
  const means = scoringMeans(game, { average: college ? 28 : 22.5, priorGames: 8 });
  const homeQb = roleAvailability(game, 'home', 'quarterback', /quarterback|\bqb\b/i,evidence);
  const awayQb = roleAvailability(game, 'away', 'quarterback', /quarterback|\bqb\b/i,evidence);
  const homeOl = roleAvailability(game, 'home', 'offensive_line', /tackle|guard|center|offensive line|\bol\b/i,evidence);
  const awayOl = roleAvailability(game, 'away', 'offensive_line', /tackle|guard|center|offensive line|\bol\b/i,evidence);
  const epaDelta = finite(game.advancedDataset?.epaDifference, 0);
  const driveDelta = finite(game.advancedDataset?.driveEfficiencyDifference, 0);
  const playDelta = finite(game.advancedDataset?.playValueDifference, 0) * 5 + finite(game.advancedDataset?.playSuccessDifference, 0) * 6 - finite(game.advancedDataset?.playTurnoverDifference, 0) * 8;
  const margin = (means.home - means.away) + evidence.modelLogit * 4.6 + (homeQb - awayQb) * 6.5 + (homeOl - awayOl) * 2.4 + epaDelta * 6 + driveDelta * 3 + playDelta;
  return normalPointResult('football','football-epa-drive-qb-ol-v2',normalPointForecast(means,margin,30,college?16.5:13.6),means,['EPA','drive efficiency','quarterback availability','offensive-line availability']);
}

function hockey(game, evidence) {
  const means = scoringMeans(game, { average: 3.05, priorGames: 12 });
  const awayGoalie = roleAvailability(game, 'away', 'goalie', /goalie|goaltender|\bg\b/i,evidence);
  const homeGoalie = roleAvailability(game, 'home', 'goalie', /goalie|goaltender|\bg\b/i,evidence);
  const xgDelta = finite(game.advancedDataset?.xgDifference, 0);
  const gsaxDelta = finite(game.advancedDataset?.gsaxDifference, 0);
  const playDelta = finite(game.advancedDataset?.playValueDifference, 0) * 0.08 + finite(game.advancedDataset?.playShotQualityDifference, 0) * 0.12;
  const adjustment = clamp(evidence.modelLogit * 0.10 + xgDelta * 0.04 + gsaxDelta * 0.025 + playDelta, -0.35, 0.35);
  const awayGoals = clamp(means.away * Math.exp(-adjustment - homeGoalie * 0.18), 1.3, 5.4);
  const homeGoals = clamp(means.home * Math.exp(adjustment - awayGoalie * 0.18), 1.3, 5.4);
  const regulation = poissonOutcomes(awayGoals, homeGoals, 11);
  const tieSplit = regulation.draw / 2;
  return {...baseResult('hockey', 'hockey-xg-shot-quality-gsax-v1', { away: regulation.away + tieSplit, home: regulation.home + tieSplit, draw: 0 }, { away: awayGoals, home: homeGoals }, means.sampleSize, ['expected goals', 'shot quality', 'goalie GSAx/availability']),scoringEvidence:means.evidence};
}

function soccer(game, evidence) {
  const means = scoringMeans(game, { average: 1.35, priorGames: 12 });
  const xgAway = finite(game.advancedDataset?.awayXg, means.away);
  const xgHome = finite(game.advancedDataset?.homeXg, means.home);
  const goalkeeperDelta = roleAvailability(game, 'home', 'goalkeeper', /goalkeeper|\bgk\b/i,evidence) - roleAvailability(game, 'away', 'goalkeeper', /goalkeeper|\bgk\b/i,evidence);
  const playDelta = finite(game.advancedDataset?.playValueDifference, 0) * 0.08 + finite(game.advancedDataset?.playShotQualityDifference, 0) * 0.1;
  const adjustment = clamp(evidence.modelLogit * 0.095 + goalkeeperDelta * 0.08 + playDelta, -0.32, 0.32);
  const awayGoals = clamp(xgAway * Math.exp(-adjustment), 0.35, 3.4);
  const homeGoals = clamp(xgHome * Math.exp(adjustment), 0.35, 3.4);
  return {...baseResult('soccer', 'soccer-xg-poisson-v1', poissonOutcomes(awayGoals, homeGoals, 9), { away: awayGoals, home: homeGoals }, means.sampleSize, ['non-penalty xG','opponent xG allowed','Poisson score distribution','goalkeeper availability']),scoringEvidence:means.evidence};
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
  const now=evidence.now??Date.now();if(!Number.isFinite(now))throw Error('Valid specialist information cutoff required');
  const availabilityEvidence={schema:'sports-specialist-availability-v1',cutoffAt:new Date(now).toISOString(),roles:[],missingRoles:[],exclusions:{},
    scope:'Selected role-player assertions only; not team injury completeness or event starter verification. Counts of exclusions are role checks, not distinct people.',
    scale:'Existing centered heuristic health/workload adjustment, not a calibrated medical or winner probability.'};
  const result=builder(game,{...evidence,modelLogit:finite(evidence.modelLogit,0),now,availabilityEvidence});
  if(availabilityEvidence.missingRoles.length)result.notes.push('Missing or unobserved role availability: '+availabilityEvidence.missingRoles.join(', ')+'. No health adjustment was inferred for these roles.');
  return {...result,availabilityEvidence};
}

export function blendProbabilityVectors(primary, specialist, weight = 0.35, twoWay = true) {
  const bounded = clamp(Number(weight) || 0, 0, 0.7);
  return normalize({
    away: primary.away * (1 - bounded) + specialist.away * bounded,
    home: primary.home * (1 - bounded) + specialist.home * bounded,
    draw: primary.draw * (1 - bounded) + specialist.draw * bounded
  }, twoWay);
}
