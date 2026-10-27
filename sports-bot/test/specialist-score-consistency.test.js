import test from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {buildSportModelPrediction} from '../src/sportModels.js';
import {predictGame} from '../src/predictionEngine.js';
import {recordPredictionJournal,readPredictionJournal} from '../src/predictionJournal.js';
const now=Date.parse('2099-08-01T17:00:00Z');
const game=(league='nfl')=>({id:'score-'+league,league:league.toUpperCase(),leagueKey:league,sportGroup:/nba|wnba|ncaab/.test(league)?'Basketball':league==='nhl'?'Hockey':league==='mlb'?'Baseball':league==='epl'?'Soccer':'Football',
 statusKey:'scheduled',startTime:'2099-08-01T18:00:00Z',neutralSite:false,sourceMeta:{provider:'ESPN',fetchedAt:new Date(now-1000).toISOString()},away:{name:'Away',abbr:'AWY'},home:{name:'Home',abbr:'HOM'},
 autoTeamMetrics:{away:{sampleSize:8,stats:{averageScored:10,averageAllowed:30}},home:{sampleSize:8,stats:{averageScored:30,averageAllowed:10}}}});
const predict=(g,evidence={})=>buildSportModelPrediction(g,{modelLogit:0,now,...evidence});
const close=(a,b,eps=1e-9)=>assert.ok(Math.abs(a-b)<=eps,`${a} differs from ${b}`);

test('NFL expected scores include the base home-away scoring difference exactly once',()=>{
 const result=predict(game());assert.equal(result.expectedScores.away,16.25);assert.equal(result.expectedScores.home,26.25);assert.equal(result.scoreDistribution.meanMargin,10);assert.equal(result.scoreDistribution.expectedTotalMean,42.5);assert.equal(result.modelId,'football-epa-drive-qb-ol-v2');
});
test('college football uses the same consistent means with its existing scoring prior and deviation',()=>{
 const result=predict(game('ncaaf'));assert.equal(result.expectedScores.away,19);assert.equal(result.expectedScores.home,29);assert.equal(result.scoreDistribution.meanMargin,10);assert.equal(result.scoreDistribution.standardDeviation,16.5);
});
test('a model-logit change shifts the point means symmetrically while preserving their total',()=>{
 const a=predict(game()),b=predict(game(),{modelLogit:1});close(b.expectedScores.home-a.expectedScores.home,2.3);close(a.expectedScores.away-b.expectedScores.away,2.3);close(b.expectedScores.home+b.expectedScores.away,42.5);close(b.scoreDistribution.meanMargin,b.expectedScores.home-b.expectedScores.away);
});
test('the existing standard-normal probability is reproduced at a one-deviation mean margin',()=>{
 const g=game();delete g.autoTeamMetrics;const result=predict(g,{modelLogit:13.6/4.6});close(result.probabilities.home,.841344746,1e-6);close(result.scoreDistribution.meanMargin,13.6);assert.equal(result.scoreDistribution.calibrated,false);
});
test('swapping opponents and signal direction swaps Gaussian probabilities and expected scores',()=>{
 for(const league of ['nfl','ncaaf','nba','wnba','ncaab']){const a=game(league),b=game(league);[b.autoTeamMetrics.away,b.autoTeamMetrics.home]=[b.autoTeamMetrics.home,b.autoTeamMetrics.away];const p=predict(a,{modelLogit:.7}),q=predict(b,{modelLogit:-.7});close(p.expectedScores.home,q.expectedScores.away);close(p.expectedScores.away,q.expectedScores.home);close(p.probabilities.home,q.probabilities.away,1e-8);}
});
test('low genuine score means cannot generate negative expected point scores',()=>{
 for(const league of ['nfl','ncaaf','nba','wnba','ncaab']){const g=game(league);for(const side of ['away','home'])g.autoTeamMetrics[side]={sampleSize:10000,stats:{averageScored:0,averageAllowed:0}};const result=predict(g,{modelLogit:2});assert.ok(result.expectedScores.away>=0);assert.ok(result.expectedScores.home>=0);assert.equal(result.scoreDistribution.nonnegativeMeanConstraintApplied,true);close(result.expectedScores.home-result.expectedScores.away,result.scoreDistribution.meanMargin);}
});
test('finite large signals retain the existing NFL and basketball margin caps',()=>{
 for(const [league,cap] of [['nfl',30],['nba',28]]){const g=game(league);delete g.autoTeamMetrics;const result=predict(g,{modelLogit:100});assert.equal(result.scoreDistribution.meanMargin,cap);assert.equal(result.scoreDistribution.nonnegativeMeanConstraintApplied,false);}
});
test('negative, fractional, boolean, missing and nonfinite counts contribute no observed game weight',()=>{
 for(const value of [-8,-1,.5,false,true,null,undefined,Infinity,NaN,' ']){const g=game();for(const side of ['away','home'])g.autoTeamMetrics[side].sampleSize=value;const result=predict(g);assert.equal(result.sampleSize,0);assert.equal(result.expectedScores.away,22.5);assert.equal(result.expectedScores.home,22.5);assert.equal(result.scoringEvidence.teams.away.effectiveCount,0);assert.ok(Number.isFinite(result.probabilities.home));}
});
test('zero count stays distinct from missing while both receive zero shrinkage weight',()=>{
 const g=game();for(const side of ['away','home'])g.autoTeamMetrics[side].sampleSize=0;const zero=predict(g);g.autoTeamMetrics.away.sampleSize=null;const missing=predict(g);assert.equal(zero.scoringEvidence.teams.away.declaredCount,0);assert.equal(missing.scoringEvidence.teams.away.declaredCount,null);assert.equal(zero.scoringEvidence.teams.away.positiveCount,false);assert.deepEqual(zero.expectedScores,missing.expectedScores);
});
test('numeric strings retain the same measured rates and count as numeric provider values',()=>{
 const a=game(),b=game();for(const side of ['away','home']){b.autoTeamMetrics[side].sampleSize='8';for(const key of ['averageScored','averageAllowed'])b.autoTeamMetrics[side].stats[key]=String(b.autoTeamMetrics[side].stats[key]);}assert.deepEqual(predict(a).expectedScores,predict(b).expectedScores);assert.deepEqual(predict(a).probabilities,predict(b).probabilities);
});
test('booleans, blanks, objects, negative and nonfinite scoring rates are unknown, not measured zero',()=>{
 for(const value of [false,true,' ',[],{},-1,Infinity,NaN]){const g=game(),control=game();for(const side of ['away','home']){g.autoTeamMetrics[side].stats={averageScored:value,averageAllowed:value};control.autoTeamMetrics[side].stats={};}const result=predict(g);assert.deepEqual(result.expectedScores,predict(control).expectedScores);assert.equal(result.scoringEvidence.teams.away.measurements.averageScored.observed,false);assert.equal(result.scoringEvidence.teams.away.measurements.averageScored.value,null);}
});
test('genuine zero scoring rates remain observed and affect the means without becoming missing',()=>{
 const g=game();for(const side of ['away','home'])g.autoTeamMetrics[side].stats={averageScored:0,averageAllowed:'0'};const result=predict(g);assert.equal(result.scoringEvidence.teams.away.measurements.averageScored.value,0);assert.equal(result.scoringEvidence.teams.away.measurements.averageAllowed.observed,true);assert.ok(result.expectedScores.home<22.5);assert.equal(result.scoringEvidence.samplePeriodVerified,false);
});
test('source counts do not claim independently verified scoring samples or publication periods',()=>{
 const result=predict(game());assert.equal(result.scoringEvidence.teams.away.declaredCount,8);assert.equal(result.scoringEvidence.teams.away.measurements.averageScored.observed,true);assert.equal(result.scoringEvidence.samplePeriodVerified,false);assert.equal(result.scoringEvidence.publicationVerified,false);
});
test('strict numeric missingness is shared by Poisson specialist features',()=>{
 const a=game('epl'),b=game('epl');delete a.autoTeamMetrics;delete b.autoTeamMetrics;a.advancedDataset={awayXg:false,homeXg:true};const p=predict(a),q=predict(b);assert.deepEqual(p.expectedScores,q.expectedScores);assert.deepEqual(p.probabilities,q.probabilities);
});
test('invalid team counts also remain zero-weight evidence in baseball, hockey and soccer',()=>{
 for(const league of ['mlb','nhl','epl']){const g=game(league);g.autoTeamMetrics.away.sampleSize=-12;const result=predict(g);assert.equal(result.sampleSize,0);assert.ok(Number.isFinite(result.expectedScores.away));assert.equal(result.scoringEvidence.teams.away.effectiveCount,0);}
});
test('nonfinite composite feature arithmetic makes the Gaussian specialist abstain',()=>{
 const g=game();g.advancedDataset={epaDifference:1e308,driveEfficiencyDifference:-1e308};const result=predict(g);assert.equal(result.available,false);assert.equal(result.probabilities,null);assert.equal(result.expectedScores,null);assert.equal(result.scoreDistribution.status,'invalid_total_or_composite_margin');
});
test('unrepresentable aggregate score totals do not produce a probability with invalid means',()=>{
 const g=game();for(const side of ['away','home'])g.autoTeamMetrics[side]={sampleSize:1000000,stats:{averageScored:Number.MAX_VALUE,averageAllowed:Number.MAX_VALUE}};const result=predict(g);assert.equal(result.available,false);assert.equal(result.scoreDistribution.expectedTotalMean,null);
});
test('actual prediction falls back to evidence when the specialist inputs are unsupported',()=>{
 const g=game();g.advancedDataset={epaDifference:1e308,driveEfficiencyDifference:-1e308,fetchedAt:new Date(now-1000).toISOString()};const result=predictGame(g,1,{now});assert.equal(result.sportModel.available,false);assert.equal(result.sportModel.active,false);assert.deepEqual(result.candidateProbabilities.hybrid,result.candidateProbabilities.evidence);assert.equal(result.sportModel.probabilities,null);
});
test('neutral designation does not inject an additional venue term into the specialist at a fixed primary logit',()=>{
 const a=game(),b=game();b.neutralSite=true;assert.deepEqual(predict(a).probabilities,predict(b).probabilities);assert.deepEqual(predict(a).expectedScores,predict(b).expectedScores);
});
test('issued specialist score inputs and distribution freeze with the first forecast',async()=>{
 const g=game(),prediction=predictGame(g,1,{now}),file=join(process.env.OMNIMOD_SPORTS_DATA_DIR,'specialist-score-issuance.jsonl'),slate={guildId:'score-fixture',generatedAt:new Date(now).toISOString(),games:[g],predictions:[{...prediction,predictionGeneratedAt:new Date(now).toISOString()}]};
 await recordPredictionJournal(slate,{file,now});const first=(await readPredictionJournal(file)).find(row=>row.type==='forecast'),frozen=structuredClone(first.payload.specialistForecast);assert.equal(frozen.id,'football-epa-drive-qb-ol-v2');assert.equal(frozen.scoreDistribution.calibrated,false);assert.equal(frozen.scoringEvidence.samplePeriodVerified,false);close(frozen.expectedScores.home-frozen.expectedScores.away,frozen.scoreDistribution.meanMargin);
 slate.predictions[0].sportModel.expectedScores.home=999;await recordPredictionJournal(slate,{file,now});assert.deepEqual((await readPredictionJournal(file)).find(row=>row.type==='forecast').payload.specialistForecast,frozen);
});
