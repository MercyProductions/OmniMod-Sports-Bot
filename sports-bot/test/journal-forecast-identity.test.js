import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizePredictionJournal} from '../src/journalEvaluation.js';
import {evaluateMatchedJournal} from '../src/matchedJournalEvaluation.js';
import {auditSportsOperations} from '../src/operationalAudit.js';
const issue='2026-10-20T18:00:00Z',start='2026-10-20T19:00:00Z',final='2026-10-20T22:00:00Z',asOf=Date.parse('2026-10-21T00:00:00Z');
function fixture(id='f',patch={}){
 const payload={forecastId:id,gameId:'g',guildId:'guild',league:'nba',modelVersion:'fixture',horizon:'Daily',lifecycleState:'ISSUED',recordEligibility:'observed_pregame',
 predictionGeneratedAt:issue,startTime:start,selectedSide:'home',outcomePercentages:{away:30,home:70,draw:0},candidateProbabilities:{hybrid:{away:.4,home:.6,draw:0}},odds:{status:'unavailable'},...patch};
 return [{type:'forecast',recordedAt:issue,payload},{type:'result',recordedAt:final,payload:{forecastId:id,actualSide:'home',observedAt:final,scheduleChanged:false}}];
}
const summary=(rows,cutoff=asOf)=>summarizePredictionJournal(rows,{asOf:cutoff});
const matched=(rows,cutoff=asOf)=>evaluateMatchedJournal(rows,{asOf:cutoff,repetitions:100});
const monitoring=(rows,cutoff=asOf)=>auditSportsOperations(rows,{asOf:cutoff,minDriftGames:2}).calibrationMonitoring;
function rejectedEverywhere(rows){
 const a=summary(rows),b=matched(rows),c=monitoring(rows);
 assert.equal(a.gradedForecasts,0);assert.equal(a.conflictingForecastIds,1);assert.deepEqual(Object.keys(b.byVersion),[]);
 assert.equal(b.conflictingForecastIds,1);assert.equal(c.cohorts.length,0);assert.equal(c.exclusions.forecast_identity_conflict,2);
}

test('same forecast ID with different original probabilities is quarantined in all journal reports',()=>{
 const rows=fixture(),copy=structuredClone(rows[0]);copy.payload.outcomePercentages={away:10,home:90,draw:0};
 rejectedEverywhere([rows[0],copy,rows[1]]);
});
test('a reused forecast ID cannot attach one final result to different events',()=>{
 const rows=fixture(),copy=structuredClone(rows[0]);copy.payload.gameId='other';
 rejectedEverywhere([rows[0],copy,rows[1]]);
});
test('candidate or coverage changes under an unchanged ID are still frozen-payload conflicts',()=>{
 for(const change of [row=>row.payload.candidateProbabilities.hybrid.home=.7,row=>row.payload.evidenceCoverage={missing:['unknown']}]){
  const rows=fixture(),copy=structuredClone(rows[0]);change(copy);rejectedEverywhere([rows[0],copy,rows[1]]);
 }
});
test('identical duplicate records retain one eligible issue while raw counts stay explicit',()=>{
 const rows=fixture(),input=[rows[0],structuredClone(rows[0]),rows[1]],a=summary(input),b=matched(input),c=monitoring(input);
 assert.equal(a.forecasts,2);assert.equal(a.eligibleIssuedForecasts,1);assert.equal(a.gradedForecasts,1);assert.equal(a.duplicateForecastRecords,1);
 assert.equal(b.byVersion.fixture.hybrid.primary.games,1);assert.equal(b.rejections.duplicate_forecast_record,1);
 assert.equal(c.cohorts[0].recent.games,1);assert.equal(c.exclusions.duplicate_forecast_record,1);
});
test('earliest duplicate receipt and first matched issue cannot be changed by array ordering or shared JS objects',()=>{
 const early=fixture(),later=fixture('later',{predictionGeneratedAt:'2026-10-20T18:05:00Z',outcomePercentages:{away:10,home:90,draw:0}});
 later[0].recordedAt='2026-10-20T18:06:00Z';
 const duplicate={...early[0],recordedAt:'2026-10-20T18:10:00Z'};
 const input=[later[0],duplicate,early[0],early[1],later[1]],before=JSON.stringify(input);
 assert.ok(Math.abs(summary(input).byVersion.fixture.selectedOutcomeBinary.averageConfidence-.7)<1e-12);
 assert.ok(Math.abs(matched(input).byVersion.fixture.hybrid.primary.brier-.09)<1e-12);
 assert.equal(JSON.stringify(input),before);
});
test('a future collision does not change an earlier cutoff but is excluded once visible',()=>{
 const rows=fixture(),copy=structuredClone(rows[0]);copy.recordedAt='2026-10-22T00:00:00Z';copy.payload.outcomePercentages={away:10,home:90,draw:0};
 assert.equal(summary([...rows,copy]).gradedForecasts,1);assert.equal(matched([...rows,copy]).byVersion.fixture.hybrid.primary.games,1);
 rejectedEverywhereAtLater();
 function rejectedEverywhereAtLater(){
  const cutoff=Date.parse('2026-10-23T00:00:00Z');
  assert.equal(summary([...rows,copy],cutoff).gradedForecasts,0);assert.deepEqual(Object.keys(matched([...rows,copy],cutoff).byVersion),[]);
  assert.equal(monitoring([...rows,copy],cutoff).cohorts.length,0);
 }
});
test('missing forecast IDs cannot associate an undefined-key final result with an issue',()=>{
 const rows=fixture();delete rows[0].payload.forecastId;delete rows[1].payload.forecastId;
 assert.equal(summary(rows).gradedForecasts,0);assert.equal(summary(rows).unverifiableForecastIds,1);
 assert.deepEqual(Object.keys(matched(rows).byVersion),[]);assert.equal(matched(rows).rejections.forecast_identity_missing,1);
});
test('direct matched reports require explicit-zone receipt, generated and start clocks',async()=>{
 const cases=[];
 for(const field of ['recordedAt','predictionGeneratedAt','startTime']){
  const rows=fixture();if(field==='recordedAt')rows[0][field]=issue.slice(0,-1);else rows[0].payload[field]=rows[0].payload[field].slice(0,-1);
  assert.deepEqual(Object.keys(matched(rows).byVersion),[]);cases.push(rows);
 }
 const code="import {evaluateMatchedJournal} from './src/matchedJournalEvaluation.js';const inputs="+JSON.stringify(cases)+";process.stdout.write(JSON.stringify(inputs.map(rows=>Object.keys(evaluateMatchedJournal(rows,{asOf:"+asOf+",repetitions:100}).byVersion).length)));";
 const output=await promisify(execFile)(process.execPath,['--input-type=module','-e',code],{env:{...process.env,TZ:'UTC'},windowsHide:true});
 assert.deepEqual(JSON.parse(output.stdout),[0,0,0]);
});
test('canonical event/horizon aliases cannot duplicate a matched game or first-issue cohort',()=>{
 const early=fixture(),later=fixture('alias',{league:' NBA ',horizon:'daily',startTime:'2026-10-20T15:00:00-04:00'});
 later[0].recordedAt='2026-10-20T18:01:00Z';
 const result=matched([...later,...early]);assert.equal(result.selectedForecasts,1);assert.equal(result.byVersion.fixture.hybrid.primary.games,1);
});
test('distinct scheduled starts sharing a native game ID remain separate matched events',()=>{
 const rows=fixture(),next=fixture('next',{startTime:'2026-10-21T19:00:00Z'});
 next[1].recordedAt='2026-10-21T22:00:00Z';next[1].payload.observedAt=next[1].recordedAt;
 assert.equal(matched([...rows,...next],Date.parse('2026-10-22T00:00:00Z')).byVersion.fixture.hybrid.primary.games,2);
});
