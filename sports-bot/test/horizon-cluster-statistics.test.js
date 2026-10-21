import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluatePredictionHorizons} from '../src/horizonEvaluation.js';
import {summarizeHorizonRows} from '../src/horizonStatistics.js';
const iso=value=>new Date(value).toISOString(),base=Date.parse('2026-10-01T19:00:00Z');
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-12,`${a} != ${b}`);
function forecast(i,guild='guild'){
 const home=55+(i%5)*4;
 return {guildId:guild,gameId:String(i),leagueKey:'nba',modelVersion:'fixture',horizon:'Daily',predictionMode:'pregame',
 predictionGeneratedAt:iso(base+i*86400000-3600000),startTime:iso(base+i*86400000),predictedSide:'home',actualSide:i%3?'home':'away',outcomeProbabilities:{away:100-home,home,draw:0}};
}
const report=rows=>evaluatePredictionHorizons(rows).overall;
const compare=(a,b)=>{
 for(const key of ['accuracy','brierScore','logLoss','calibrationError'])close(a[key],b[key]);
 for(const key of ['accuracy','brier','logLoss'])for(let i=0;i<2;i++)close(a.bootstrap95[key][i],b.bootstrap95[key][i]);
};

test('twelve guild copies of one game cannot create twelve samples or bootstrap support',()=>{
 const rows=Array.from({length:12},(_,i)=>forecast(0,'guild-'+i)),result=report(rows);
 assert.equal(result.sampleSize,1);assert.equal(result.gameClusters,1);assert.equal(result.forecastCount,12);
 assert.equal(result.bootstrap95.accuracy,null);assert.equal(result.bootstrap95.brier,null);
});
test('overrepresented copied game does not dominate point metrics or game-cluster intervals',()=>{
 const rows=Array.from({length:8},(_,i)=>forecast(i)),copies=[...rows,...Array.from({length:12},(_,i)=>forecast(0,'copy-'+i))];
 const a=report(rows),b=report(copies);assert.equal(a.sampleSize,8);assert.equal(b.sampleSize,8);assert.equal(b.forecastCount,20);
 compare(a,b);
});
test('uniform replication across guilds preserves all point metrics and interval bounds',()=>{
 const rows=Array.from({length:8},(_,i)=>forecast(i)),copies=rows.flatMap(row=>Array.from({length:4},(_,i)=>({...row,guildId:'guild-'+i})));
 compare(report(rows),report(copies));
});
test('seven games cannot gain interval support through thirty-five copied records',()=>{
 const rows=Array.from({length:7},(_,i)=>forecast(i)).flatMap(row=>Array.from({length:5},(_,i)=>({...row,guildId:'g'+i})));
 const result=report(rows);assert.equal(result.sampleSize,7);assert.equal(result.forecastCount,35);
 assert.equal(result.bootstrap95.accuracy,null);assert.equal(result.bootstrap95.logLoss,null);
});
test('canonical sorting makes game-cluster intervals invariant to input array order',()=>{
 const rows=Array.from({length:10},(_,i)=>forecast(i)),before=JSON.stringify(rows);
 compare(report(rows),report([...rows].reverse()));assert.equal(JSON.stringify(rows),before);
});
function scored(gameId,correct,p,edge=null){return {row:{gameId,leagueKey:'nba',startTime:'2026-10-20T19:00:00Z'},correct,
 selectedProbability:p,brier:(p-Number(correct))**2,logLoss:-Math.log(correct?p:1-p),modelVsCloseEdge:edge};}

test('analytic mixed-copy example has equal-game accuracy, loss and weighted calibration',()=>{
 const rows=[scored('a',true,.8,.1),scored('a',false,.6,.3),scored('a',true,.7),scored('b',false,.9,.5)];
 const result=summarizeHorizonRows(rows);assert.equal(result.sampleSize,2);assert.equal(result.forecastCount,4);
 close(result.accuracy,1/3);close(result.brierScore,((.04+.36+.09)/3+.81)/2);
 close(result.logLoss,((-Math.log(.8)-Math.log(.4)-Math.log(.7))/3-Math.log(.1))/2);
 close(result.calibrationError,(.2+.6+.3)/6+.9/2);
 close(result.calibration.reduce((sum,bin)=>sum+bin.gameWeight,0),1);
});
test('closing edge weights eligible games and exposes quote-record count separately',()=>{
 const result=summarizeHorizonRows([scored('a',true,.8,.1),scored('a',false,.6,.3),scored('a',true,.7),scored('b',false,.9,.5)]);
 close(result.meanModelVsCloseEdge,.35);assert.equal(result.closingSampleSize,2);assert.equal(result.closingForecastCount,3);
});
test('unscoped records remain visible as exclusions without invented game identities',()=>{
 const item=scored('a',true,.8);delete item.row.leagueKey;
 const result=summarizeHorizonRows([item]);assert.equal(result.sampleSize,0);assert.equal(result.forecastCount,1);
 assert.equal(result.unscopedForecastCount,1);assert.equal(result.accuracy,null);assert.equal(result.bootstrap95.accuracy,null);
});
test('league, native ID and explicit-zone aliases cannot multiply game clusters',()=>{
 const first=scored(1,true,.8),other={...scored('1',true,.8),row:{gameId:'1',leagueKey:' NBA ',startTime:'2026-10-21T05:00:00+10:00'}};
 const result=summarizeHorizonRows([first,other]);assert.equal(result.sampleSize,1);assert.equal(result.forecastCount,2);
});
test('same native ID in another league or scheduled start remains a distinct game cluster',()=>{
 const first=scored('a',true,.8),league={...scored('a',true,.8),row:{...first.row,leagueKey:'nhl'}},tomorrow={...scored('a',true,.8),row:{...first.row,startTime:'2026-10-21T19:00:00Z'}};
 assert.equal(summarizeHorizonRows([first,league,tomorrow]).sampleSize,3);
});
