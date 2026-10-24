import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateProspectiveCaptures,pendingProspectiveFinalQueries} from '../src/prospectivePairs.js';
import {selectCaptureObservation} from '../src/captureObservationSelection.js';
const base=Date.parse('2026-10-20T18:00:00Z'),iso=offset=>new Date(base+offset).toISOString(),options={asOf:base+5*3600000};
function entry(role,{final=false,delta=0,startOffset=3600000,awayScore=90,homeScore=100}={}){
 const tick=(final?4*3600000:role==='challenger'?3000:0)+delta;
 return {receipt:{eventHash:role+'-'+tick+'-'+awayScore,recordedAt:iso(tick+2000),payload:{sourceCommit:role}},capture:{schema:'sports-isolated-capture-v1',role,mode:'live',purpose:final?'final_reconciliation':'market_scan',startedAt:iso(tick),completedAt:iso(tick+1000),
 slate:{games:[{id:'g',leagueKey:'nba',startTime:iso(startOffset),statusKey:final?'final':'scheduled',away:{name:'Away',score:awayScore},home:{name:'Home',score:homeScore}}],
 predictions:final?[]:[{gameId:'g',modelVersion:role,horizon:'Daily',predictionMode:'pregame',predictionGeneratedAt:iso(tick+500),predictedSide:'home',outcomeProbabilities:role==='baseline'?{away:45,home:55}:{away:30,home:70}}]}}};
}
const scheduled=()=>[entry('baseline'),entry('challenger')];
const report=(rows,cutoff=options.asOf)=>evaluateProspectiveCaptures(rows,{asOf:cutoff});
const score=result=>result.matched.byVersion.challenger.evidence;
function alternateFirst(){const row=entry('baseline');row.receipt.eventHash='alternate';row.capture.slate.predictions[0].outcomeProbabilities={away:30,home:70};return row;}

test('conflicting equal-time earliest forecasts cannot be selected by capture array order',()=>{
 const a=entry('baseline'),b=alternateFirst(),other=entry('challenger');
 for(const rows of [[a,b,other],[b,a,other]]){
  const result=report(rows);assert.equal(result.pairedForecasts,0);assert.equal(result.rejections.ambiguous_first_capture,1);
  const plan=pendingProspectiveFinalQueries(rows,options);assert.equal(plan.excluded.ambiguous_first_capture,1);assert.ok(plan.tasks.every(task=>task.role!=='baseline'));
 }
});
test('an equal-time clean duplicate cannot erase an already ambiguous first observation',()=>{
 const first=entry('baseline'),copy=structuredClone(first);copy.receipt.eventHash='another';
 const rows=[first,alternateFirst(),copy,entry('challenger')];
 assert.equal(report(rows).pairedForecasts,0);assert.equal(pendingProspectiveFinalQueries(rows,options).excluded.ambiguous_first_capture,1);
});
test('conflicting equal-time final winners remain unresolved and queryable in either order',()=>{
 const a=entry('baseline',{final:true}),b=entry('baseline',{final:true,awayScore:110}),other=entry('challenger',{final:true});
 for(const finals of [[a,b,other],[b,a,other]]){
  const rows=[...scheduled(),...finals],result=report(rows);
  assert.equal(result.rejections.ambiguous_final_source_observations,1);assert.equal(result.matched.rejections.unresolved,1);
  const plan=pendingProspectiveFinalQueries(rows,options);assert.equal(plan.conflictingFinalEvents,1);assert.equal(plan.tasks.length,2);
 }
});
test('same winner with different exact scores at one receipt still requires reconciliation',()=>{
 const rows=[...scheduled(),entry('baseline',{final:true,homeScore:101}),entry('baseline',{final:true}),entry('challenger',{final:true})];
 assert.equal(report(rows).rejections.ambiguous_final_source_observations,1);assert.equal(pendingProspectiveFinalQueries(rows,options).conflictingFinalEvents,1);
});
test('within-capture source conflict cannot be overwritten by a same-time clean capture',()=>{
 const conflict=entry('baseline',{final:true}),clean=entry('baseline',{final:true});clean.receipt.eventHash='clean-copy';
 conflict.capture.slate.games.push({...structuredClone(conflict.capture.slate.games[0]),away:{name:'Away',score:110}});
 for(const finals of [[conflict,clean],[clean,conflict]]){
  const rows=[...scheduled(),...finals,entry('challenger',{final:true})];
  assert.equal(report(rows).rejections.ambiguous_final_source_observations,1);assert.equal(pendingProspectiveFinalQueries(rows,options).tasks.length,2);
 }
});
test('a strictly newer agreeing final replaces older ambiguity without changing original forecasts',()=>{
 const rows=[...scheduled(),entry('baseline',{final:true,awayScore:110}),entry('baseline',{final:true}),entry('challenger',{final:true}),entry('baseline',{final:true,delta:5000})],before=JSON.stringify(rows);
 assert.equal(score(report(rows)).primary.games,1);assert.equal(pendingProspectiveFinalQueries(rows,options).tasks.length,0);assert.equal(JSON.stringify(rows),before);
});
test('future tied-final ambiguity cannot retroactively change an earlier cutoff',()=>{
 const future=[entry('baseline',{final:true,delta:30000,awayScore:110}),entry('baseline',{final:true,delta:30000})];
 const rows=[...scheduled(),entry('baseline',{final:true}),entry('challenger',{final:true}),...future];
 assert.equal(score(report(rows,base+4*3600000+10000)).primary.games,1);
 assert.equal(report(rows).rejections.ambiguous_final_source_observations,1);
});
test('a later valid capture cannot replace an ambiguous earliest forecast',()=>{
 const rows=[entry('baseline'),alternateFirst(),entry('baseline',{delta:10000}),entry('challenger')];
 assert.equal(report(rows).pairedForecasts,0);assert.equal(pendingProspectiveFinalQueries(rows,options).excluded.ambiguous_first_capture,1);
});
test('a final receipt conflict does not cross into another scheduled start sharing a native ID',()=>{
 const day=86400000,rows=[...scheduled(),entry('baseline',{final:true,awayScore:110}),entry('baseline',{final:true}),entry('challenger',{final:true}),
 entry('baseline',{startOffset:day+3600000}),entry('challenger',{startOffset:day+3600000}),
 entry('baseline',{final:true,delta:day,startOffset:day+3600000}),entry('challenger',{final:true,delta:day,startOffset:day+3600000})];
 const result=report(rows,base+2*day);assert.equal(result.pairedForecasts,2);assert.equal(score(result).primary.games,1);
});
test('equivalent tied observations use a stable receipt key and preserve caller objects',()=>{
 const a={issued:1,signature:'same',tieKey:'z',value:1},b={issued:1,signature:'same',tieKey:'a',value:1},before=JSON.stringify([a,b]);
 assert.equal(selectCaptureObservation(a,b).tieKey,'a');assert.equal(selectCaptureObservation(b,a).tieKey,'a');
 assert.equal(JSON.stringify([a,b]),before);assert.throws(()=>selectCaptureObservation(null,{issued:NaN,signature:'bad'}),/Valid capture observation/);
});
