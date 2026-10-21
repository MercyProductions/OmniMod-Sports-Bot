import {capturedEventTime} from '../src/capturedEventTime.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateProspectiveCaptures,pendingProspectiveFinalQueries} from '../src/prospectivePairs.js';
import {evaluateMatchedJournal} from '../src/matchedJournalEvaluation.js';
const base=Date.parse('2026-10-20T18:00:00Z'),iso=offset=>new Date(base+offset).toISOString(),options={asOf:base+5*3600000};
function entry(role,final=false){
 const t=final?4*3600000:role==='baseline'?0:3000;
 return {receipt:{eventHash:role+t,recordedAt:iso(t+2000),payload:{sourceCommit:role}},capture:{schema:'sports-isolated-capture-v1',role,mode:'live',purpose:final?'final_reconciliation':'market_scan',startedAt:iso(t),completedAt:iso(t+1000),
 slate:{games:[{id:'g',leagueKey:'nba',sportGroup:'Basketball',statusKey:final?'final':'scheduled',startTime:iso(3600000),away:{name:'Away',score:90},home:{name:'Home',score:100}}],
 predictions:final?[]:[{gameId:'g',modelVersion:role,predictionMode:'pregame',predictionGeneratedAt:iso(t+500),predictedSide:'home',outcomeProbabilities:role==='baseline'?{away:45,home:55}:{away:30,home:70}}]}}};
}
const inputs=()=>[entry('baseline'),entry('challenger'),entry('baseline',true),entry('challenger',true)];
const report=rows=>evaluateProspectiveCaptures(rows,options);
const score=result=>result.matched.byVersion.challenger.evidence;

test('receipt-linked emitted binary classes produce a scored paired forecast without rewriting captures',()=>{
 const rows=inputs(),before=JSON.stringify(rows),result=report(rows);
 assert.equal(result.pairedForecasts,1);assert.equal(score(result).primary.games,1);assert.equal(score(result).reference.games,1);
 assert.equal(result.schema,'sports-isolated-paired-report-v3');assert.equal(result.captureAdapter,'receipt-linked-raw-emitted-outcomes-v1');
 assert.ok(Math.abs(score(result).primary.brier-.09)<1e-12);assert.equal(JSON.stringify(rows),before);
});
test('a tied archived baseline uses its actual frozen home pick instead of an inferred away tie break',()=>{
 const rows=inputs();for(const row of rows.slice(0,2))row.capture.slate.predictions[0].outcomeProbabilities.draw=0;
 rows[0].capture.slate.predictions[0].outcomeProbabilities={away:50,home:50,draw:0};
 const result=score(report(rows));assert.equal(result.reference.accuracy,1);assert.equal(result.primary.accuracy,1);
});
test('invalid baseline or challenger frozen selections cannot enter pairs or final work plans',()=>{
 for(const index of [0,1]){
  const rows=inputs();rows[index].capture.slate.predictions[0].predictedSide='away';
  const result=report(rows);assert.equal(result.pairedForecasts,0);assert.equal(result.rejections.invalid_frozen_selection,1);
  assert.equal(pendingProspectiveFinalQueries([rows[index]],options).tasks.length,0);
 }
});
test('an explicitly invalid frozen reference side is rejected by the matched evaluator',()=>{
 const payload={forecastId:'f',guildId:'g',gameId:'g',league:'nba',modelVersion:'m',horizon:'Daily',lifecycleState:'ISSUED',recordEligibility:'observed_pregame',
 predictionGeneratedAt:iso(500),startTime:iso(3600000),selectedSide:'home',outcomePercentages:{away:30,home:70,draw:0},
 referenceBaselines:{evidence:{probabilities:{away:.4,home:.6,draw:0},selectedSide:'away'}}};
 const result=evaluateMatchedJournal([{type:'forecast',recordedAt:iso(2000),payload},{type:'result',recordedAt:iso(4*3600000),payload:{forecastId:'f',actualSide:'home',observedAt:iso(4*3600000)}}],options);
 assert.equal(result.byVersion.m.evidence.primary.games,0);assert.equal(result.byVersion.m.evidence.excluded.reference_frozen_selection_invalid,1);
});
test('unknown capture schemas cannot acquire raw-emission adapter authority',()=>{
 const rows=inputs();rows[0].capture.schema='unknown';
 assert.equal(report(rows).pairedForecasts,0);assert.equal(report(rows).rejections.capture_schema_unverified,1);
 assert.equal(pendingProspectiveFinalQueries([rows[0]],options).tasks.length,0);
});
test('null-padded unknown draws remain excluded rather than repaired through raw capture adaptation',()=>{
 const rows=inputs();rows[0].capture.slate.predictions[0].outcomeProbabilities.draw=null;const before=JSON.stringify(rows);
 assert.equal(report(rows).pairedForecasts,0);assert.equal(JSON.stringify(rows),before);
});
test('naive capture clocks cannot qualify forecasts or final-query tasks',()=>{
 for(const kind of ['receipt','began','completed','start','generated']){
  const rows=inputs(),row=rows[0];
  if(kind==='receipt')row.receipt.recordedAt=row.receipt.recordedAt.slice(0,-1);
  if(kind==='began')row.capture.startedAt=row.capture.startedAt.slice(0,-1);
  if(kind==='completed')row.capture.completedAt=row.capture.completedAt.slice(0,-1);
  if(kind==='start')row.capture.slate.games[0].startTime=row.capture.slate.games[0].startTime.slice(0,-1);
  if(kind==='generated')row.capture.slate.predictions[0].predictionGeneratedAt=row.capture.slate.predictions[0].predictionGeneratedAt.slice(0,-1);
  assert.equal(report(rows).pairedForecasts,0);assert.equal(pendingProspectiveFinalQueries([row],options).tasks.length,0);
 }
});
test('contradictory explicit outcome declarations cannot be replaced by inferred binary keys',()=>{
 const rows=inputs();rows[0].capture.slate.predictions[0].modeledOutcomes=['away','home','draw'];
 assert.equal(report(rows).pairedForecasts,0);assert.equal(report(rows).rejections.invalid_frozen_probability_vector,1);
});


test('explicit-minute source event starts remain eligible without relaxing receipt precision',()=>{
 const rows=inputs();for(const row of rows)row.capture.slate.games[0].startTime='2026-10-20T19:00Z';
 const before=JSON.stringify(rows),result=report(rows);assert.equal(result.pairedForecasts,1);assert.equal(score(result).primary.games,1);
 assert.equal(pendingProspectiveFinalQueries(rows.slice(0,2),options).tasks.length,2);assert.equal(JSON.stringify(rows),before);
 assert.equal(capturedEventTime('2026-10-20T15:00-04:00'),Date.parse('2026-10-20T19:00:00Z'));
 for(const value of ['2026-10-20T19:00','2026-02-30T19:00Z','2026-10-20T25:00Z',null])assert.ok(Number.isNaN(capturedEventTime(value)));
 const bad=inputs();bad[0].receipt.recordedAt='2026-10-20T18:00Z';assert.equal(report(bad).pairedForecasts,0);
});
