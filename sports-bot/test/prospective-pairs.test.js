import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateProspectiveCaptures,recordCaptureReceipt,readCaptureLedger} from '../src/prospectivePairs.js';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
const base=Date.parse('2026-10-20T18:00:00Z'),iso=delta=>new Date(base+delta).toISOString();
function entry(role,delta=0,{final=false,side='home',mode='live'}={}){
 const started=final?base+4*3600000:base+delta;
 const game={id:'g',leagueKey:'nba',sportGroup:'Basketball',startTime:iso(3600000),statusKey:final?'final':'scheduled',away:{name:'A',score:side==='home'?90:100},home:{name:'H',score:side==='home'?100:90}};
 const vector=role==='baseline'?{away:45,home:55,draw:0}:{away:30,home:70,draw:0};
 return {receipt:{eventHash:role+'-'+started,recordedAt:new Date(started+2000).toISOString(),payload:{sourceCommit:role}},
  capture:{schema:'sports-isolated-capture-v1',role,mode,startedAt:new Date(started).toISOString(),completedAt:new Date(started+1000).toISOString(),
   slate:{games:[game],predictions:final?[]:[{gameId:'g',modelVersion:role,predictionMode:'pregame',predictionGeneratedAt:new Date(started+500).toISOString(),predictedSide:'home',outcomeProbabilities:vector}]}}};
}
const options={asOf:base+5*3600000};

test('cross-version scores use original pregame vectors and later observed finals',()=>{
 const rows=[entry('baseline'),entry('challenger',3000),entry('baseline',0,{final:true}),entry('challenger',0,{final:true})];
 const result=evaluateProspectiveCaptures(rows,options),score=result.matched.byVersion.challenger.evidence;
 assert.equal(result.pairedForecasts,1);assert.equal(score.primary.games,1);assert.equal(score.primary.accuracy,1);
 assert.ok(score.primary.brier<score.reference.brier);assert.equal(result.promotionAllowed,false);assert.equal(result.performanceEstablished,false);
 const before=evaluateProspectiveCaptures(rows,{asOf:base+10000});
 assert.equal(before.matched.rejections.unresolved,1);
});

test('offline fixtures, late receipts and excessively separated forecasts cannot become matched market evidence',()=>{
 const fixture=evaluateProspectiveCaptures([entry('baseline',0,{mode:'offline'}),entry('challenger',1000)],options);
 assert.equal(fixture.pairedForecasts,0);assert.equal(fixture.rejections.not_live_market_capture,1);
 const late=entry('baseline');late.receipt.recordedAt=iso(3600000);
 assert.equal(evaluateProspectiveCaptures([late,entry('challenger',1000)],options).pairedForecasts,0);
 const gap=evaluateProspectiveCaptures([entry('baseline'),entry('challenger',180000)],options);
 assert.equal(gap.pairedForecasts,0);assert.equal(gap.rejections.counterpart_time_gap_exceeded,1);
});

test('conflicting final observations remain unresolved and later same-horizon forecasts cannot replace originals',()=>{
 const rows=[entry('baseline'),entry('challenger',1000),entry('challenger',5000),entry('baseline',0,{final:true}),entry('challenger',0,{final:true,side:'away'})];
 const result=evaluateProspectiveCaptures(rows,options);
 assert.equal(result.pairedForecasts,1);assert.equal(result.rejections.conflicting_final_observations,1);
 assert.equal(result.rejections.later_same_horizon_not_selected,1);assert.equal(result.matched.rejections.unresolved,1);
});

test('changed schedules cannot receive the original event outcome',()=>{
 const later=entry('challenger',0,{final:true});later.capture.slate.games[0].startTime=iso(7200000);
 const result=evaluateProspectiveCaptures([entry('baseline'),entry('challenger',1000),later],options);
 assert.equal(result.pairedForecasts,1);assert.equal(result.matched.rejections.unresolved,1);
});

test('capture receipts verify written bytes, preserve a chain and reject duplicate receipt imports',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'sports-capture-receipts-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 await mkdir(join(directory,'captures'));
 const now=new Date(Date.now()-1000).toISOString(),capture={role:'baseline',startedAt:now,completedAt:now},bytes=JSON.stringify(capture)+'\n';
 const summary={filename:'baseline-fixture.json',role:'baseline',startedAt:now,completedAt:now,captureHash:createHash('sha256').update(bytes).digest('hex'),sourceCommit:'a'.repeat(40)};
 await writeFile(join(directory,'captures',summary.filename),bytes);
 const receipt=await recordCaptureReceipt(directory,summary);assert.match(receipt.eventHash,/^[a-f0-9]{64}$/);
 assert.equal((await readCaptureLedger(directory)).length,1);
 await assert.rejects(recordCaptureReceipt(directory,summary),/already has/);
 const ledger=join(directory,'capture-ledger.jsonl');await writeFile(ledger,(await readFile(ledger,'utf8')).replace('baseline-fixture','altered-fixture'));
 await assert.rejects(readCaptureLedger(directory),/integrity/);
});


test('missing or boolean baseline probabilities cannot be coerced to zero in comparisons',()=>{
 for(const value of [null,false,'0']){
  const baseline=entry('baseline');baseline.capture.slate.predictions[0].outcomeProbabilities={home:100,away:value,draw:0};
  const result=evaluateProspectiveCaptures([baseline,entry('challenger',1000)],options);
  assert.equal(result.pairedForecasts,0);assert.equal(result.rejections.invalid_frozen_probability_vector,1);
 }
});
