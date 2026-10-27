import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {summarizePredictionJournal} from '../src/journalEvaluation.js';
import {recordPredictionJournal} from '../src/predictionJournal.js';
const issue='2026-10-20T18:00:00Z',start='2026-10-20T19:00:00Z',final='2026-10-20T22:00:00Z',cutoff=Date.parse('2026-10-21T00:00:00Z');
function fixture(id='f',patch={}){
 const payload={forecastId:id,gameId:'g',guildId:'guild',league:'nba',modelVersion:'fixture',horizon:'Daily',lifecycleState:'ISSUED',recordEligibility:'observed_pregame',
 predictionGeneratedAt:issue,startTime:start,selectedSide:'home',outcomePercentages:{away:30,home:70,draw:0},odds:{status:'unavailable'},...patch};
 return [{type:'forecast',recordedAt:issue,payload},{type:'result',recordedAt:final,payload:{forecastId:id,actualSide:'home',observedAt:final,scheduleChanged:false}}];
}
const report=(rows,asOf=cutoff)=>summarizePredictionJournal(rows,{asOf});
const binary=result=>result.byVersion.fixture.selectedOutcomeBinary;

test('historical cutoff excludes later final labels and delivery acknowledgements everywhere',()=>{
 const rows=fixture();rows.push({type:'forecast_lifecycle',recordedAt:final,payload:{forecastId:'f',state:'DELIVERED'}});
 const result=report(rows,Date.parse('2026-10-20T20:00:00Z'));
 assert.equal(result.gradedForecasts,0);assert.equal(result.deliveredForecasts,0);assert.equal(binary(result).sampleSize,0);
 assert.equal(result.futureRecords,2);assert.equal(result.matchedForecastComparisons.asOf,result.asOf);
});
test('future correction cannot rewrite an earlier cutoff summary',()=>{
 const rows=fixture();rows.push({type:'result',recordedAt:'2026-10-22T00:00:00Z',payload:{forecastId:'f',actualSide:'away',observedAt:'2026-10-22T00:00:00Z'}});
 assert.equal(binary(report(rows)).accuracy,1);
 assert.equal(binary(report(rows,Date.parse('2026-10-23T00:00:00Z'))).accuracy,0);
});
test('earliest issue is selected by recorded time rather than shuffled array order',()=>{
 const early=fixture(),later=fixture('later',{predictionGeneratedAt:'2026-10-20T18:10:00Z',outcomePercentages:{away:10,home:90,draw:0}});
 later[0].recordedAt='2026-10-20T18:11:00Z';
 const result=binary(report([...later,...early]));assert.equal(result.sampleSize,1);assert.ok(Math.abs(result.averageConfidence-.7)<1e-12);
});
test('unresolved earliest issue cannot be replaced with a later resolved successful-looking issue',()=>{
 const early=fixture().slice(0,1),later=fixture('later',{predictionGeneratedAt:'2026-10-20T18:10:00Z'});later[0].recordedAt='2026-10-20T18:11:00Z';
 assert.equal(binary(report([...early,...later])).sampleSize,0);
});
test('canonical offset and league copies retain one binary event weight and immutable inputs',()=>{
 const rows=[...fixture(),...fixture('copy',{league:' NBA ',startTime:'2026-10-20T15:00:00-04:00'})],before=JSON.stringify(rows);
 assert.equal(binary(report(rows)).sampleSize,1);assert.equal(JSON.stringify(rows),before);
});
test('different simultaneous first vectors are quarantined rather than selected by array order',()=>{
 const rows=[...fixture(),...fixture('other',{outcomePercentages:{away:10,home:90,draw:0}})];
 const result=report(rows);assert.equal(binary(result).sampleSize,0);assert.equal(result.byVersion.fixture.firstIssueConflictEvents,1);
});
test('invalid result chronology or changed schedule cannot enter scored summary populations',()=>{
 for(const patch of [{observedAt:'2026-10-20T18:30:00Z'},{observedAt:'2026-10-20T23:00:00Z'},{observedAt:'2026-10-20T22:00:00'},{scheduleChanged:true}]){
  const rows=fixture();Object.assign(rows[1].payload,patch);
  const result=report(rows);assert.equal(result.gradedForecasts,0);assert.equal(binary(result).sampleSize,0);assert.equal(result.byVersion.fixture.invalidResultChronology,1);
 }
});
test('unverified issuance cannot contribute scores merely because it has an ISSUED label',()=>{
 const rows=fixture('bad',{recordEligibility:'legacy_unverified'}),result=report(rows);
 assert.equal(result.forecasts,1);assert.equal(result.gradedForecasts,0);assert.equal(result.byVersion.fixture.invalidIssuance,1);
 assert.equal(binary(result).sampleSize,0);assert.throws(()=>report(rows,NaN),/valid summary cutoff/);
});
test('contradictory result copies across guilds block all summary performance for their event',()=>{
 const other=fixture('other',{guildId:'other'});other[1].payload.actualSide='away';
 const result=report([...fixture(),...other]);assert.equal(result.conflictingResultEvents,1);assert.equal(binary(result).sampleSize,0);
 assert.equal(result.byVersion.fixture.outcomes.overall.sampleSize,0);assert.equal(result.byVersion.fixture.conflictingOrDisputedEventForecasts,2);
});
test('actual journal and read-only CLI honor cutoff, reject malformed arguments and preserve bytes',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'sports-summary-cutoff-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const file=join(directory,'journal.jsonl'),game={id:'g',leagueKey:'nba',statusKey:'scheduled',startTime:start,away:{name:'Away'},home:{name:'Home'}};
 const slate={guildId:'guild',dateKey:'2026-10-20',generatedAt:issue,games:[game],predictions:[{gameId:'g',leagueKey:'nba',modelVersion:'fixture',horizon:'Daily',predictionGeneratedAt:issue,startTime:start,predictionMode:'pregame',predictedSide:'home',outcomeProbabilities:{away:30,home:70,draw:0}}]};
 await recordPredictionJournal(slate,{file,now:Date.parse(issue)+1000});
 await recordPredictionJournal({...slate,games:[{...game,statusKey:'final',away:{name:'Away',score:90},home:{name:'Home',score:100},sourceMeta:{fetchedAt:final}}]}, {file,now:Date.parse(final)+1000,lifecycle:'results_only'});
 const before=await readFile(file,'utf8'),run=promisify(execFile),script='scripts/audit-predictions.js';
 const output=await run(process.execPath,[script,'--journal='+file,'--as-of=2026-10-20T20:00:00Z'],{windowsHide:true});
 const result=JSON.parse(output.stdout);assert.equal(result.forecasts,1);assert.equal(result.gradedForecasts,0);assert.equal(result.asOf,'2026-10-20T20:00:00.000Z');
 for(const flags of [['--as-of'],['--as-of=secret-value'],['--as-of='],['--as-of=2026-10-20T20:00:00Z','--as-of=2026-10-20T21:00:00Z']]){
  await assert.rejects(run(process.execPath,[script,'--journal='+file,...flags],{windowsHide:true}),error=>{assert.ok(!error.stderr.includes('secret-value'));return error.code===1;});
 }
 assert.equal(await readFile(file,'utf8'),before);
});


test('scorable counts exclude a frozen nonmaximum pick without relabeling it as a class failure',()=>{
 const result=report(fixture('bad-pick',{selectedSide:'away'}));
 assert.equal(result.byVersion.fixture.graded,1);assert.equal(result.byVersion.fixture.scorableForecasts,0);
 assert.equal(result.byVersion.fixture.invalidFrozenSelection,1);assert.equal(result.byVersion.fixture.invalidOrUnverifiedOutcomeSpace,0);
 assert.equal(binary(result).sampleSize,0);
});
