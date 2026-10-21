import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateProspectiveCaptures,recordCaptureReceipt,readCaptureLedger,pendingProspectiveFinalQueries,loadProspectiveCaptures} from '../src/prospectivePairs.js';
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

test('capture receipt chronology rejects unknown completion and reports bounded timing diagnostics',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'sports-capture-time-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 await mkdir(join(directory,'captures'));
 const start=new Date(Date.now()-10000).toISOString();
 for(const [completedAt,reason] of [['not-a-time','invalid_timestamp'],[null,'invalid_timestamp'],
  [new Date(Date.now()+3600000).toISOString(),'completion_after_receipt'],
  [new Date(Date.parse(start)-1000).toISOString(),'completion_before_start']]){
  const capture={role:'baseline',startedAt:start,completedAt},bytes=JSON.stringify(capture)+'\n';
  const summary={filename:'baseline-timing.json',...capture,captureHash:createHash('sha256').update(bytes).digest('hex')};
  await writeFile(join(directory,'captures',summary.filename),bytes);
  await assert.rejects(recordCaptureReceipt(directory,summary),error=>error.message.startsWith('Invalid capture chronology')&&error.message.includes(reason));
  assert.equal((await readCaptureLedger(directory)).length,0);
 }
});

test('valid hashes do not make an older malformed capture timestamp eligible on reload',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'sports-legacy-capture-time-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 await mkdir(join(directory,'captures'));
 const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
 const manifest={sources:{baseline:{commit:'a'.repeat(40)}},profile:{dayOffset:0}};
 await writeFile(join(directory,'manifest.json'),JSON.stringify({...manifest,manifestHash:hash(JSON.stringify(manifest))}));
 const capture={schema:'sports-isolated-capture-v1',role:'baseline',startedAt:new Date(Date.now()-1000).toISOString(),completedAt:'unknown'};
 const bytes=JSON.stringify(capture)+'\n',filename='baseline-legacy.json';
 await writeFile(join(directory,'captures',filename),bytes);
 const receipt={schema:'sports-capture-receipt-v1',sequence:1,previousHash:null,recordedAt:new Date().toISOString(),
  payload:{filename,captureHash:hash(bytes),role:'baseline',sourceCommit:manifest.sources.baseline.commit}};
 await writeFile(join(directory,'capture-ledger.jsonl'),JSON.stringify({...receipt,eventHash:hash(JSON.stringify(receipt))})+'\n');
 assert.equal((await readCaptureLedger(directory)).length,1);
 await assert.rejects(loadProspectiveCaptures(directory),/Capture receipt mismatch/);
});


test('missing or boolean baseline probabilities cannot be coerced to zero in comparisons',()=>{
 for(const value of [null,false,'0']){
  const baseline=entry('baseline');baseline.capture.slate.predictions[0].outcomeProbabilities={home:100,away:value,draw:0};
  const result=evaluateProspectiveCaptures([baseline,entry('challenger',1000)],options);
  assert.equal(result.pairedForecasts,0);assert.equal(result.rejections.invalid_frozen_probability_vector,1);
 }
});


test('cross-midnight final work plans preserve original predictions and stop querying observed finals',()=>{
 const rows=[entry('baseline'),entry('challenger',1000)],asOf=Date.parse('2026-10-21T15:00:00Z');
 const plan=pendingProspectiveFinalQueries(rows,{asOf});
 assert.equal(plan.tasks.length,2);assert.equal(plan.tasks[0].dateKey,'2026-10-20');
 assert.equal(plan.tasks[0].predictions[0],rows[0].capture.slate.predictions[0]);
 assert.equal(plan.requestsPerformed,0);
 const resolved=pendingProspectiveFinalQueries([...rows,entry('baseline',0,{final:true})],{asOf});
 assert.equal(resolved.tasks.length,1);assert.equal(resolved.tasks[0].role,'challenger');
});

test('cross-date work plans exclude future and old games without inventing completion times',()=>{
 const future=pendingProspectiveFinalQueries([entry('baseline')],{asOf:base+10000});
 assert.equal(future.tasks.length,0);assert.equal(future.excluded.not_started,1);
 const old=pendingProspectiveFinalQueries([entry('baseline')],{asOf:base+10*86400000});
 assert.equal(old.tasks.length,0);assert.equal(old.excluded.outside_lookback,1);
 assert.throws(()=>pendingProspectiveFinalQueries([],{maximumDatesPerRole:100}),/Invalid final/);
});

test('final-query date limits defer excess dates explicitly and merge repeated horizons',()=>{
 const rows=Array.from({length:4},(_,i)=>{
  const row=entry('baseline');
  for(const key of ['startedAt','completedAt'])row.capture[key]=new Date(Date.parse(row.capture[key])-i*86400000).toISOString();
  row.receipt.recordedAt=new Date(Date.parse(row.receipt.recordedAt)-i*86400000).toISOString();
  const game=row.capture.slate.games[0];game.id='date-'+i;game.startTime=new Date(Date.parse(game.startTime)-i*86400000).toISOString();
  const prediction=row.capture.slate.predictions[0];prediction.gameId=game.id;prediction.predictionGeneratedAt=new Date(Date.parse(prediction.predictionGeneratedAt)-i*86400000).toISOString();
  return row;
 });
 const plan=pendingProspectiveFinalQueries([...rows,rows[0]],{asOf:base+2*86400000,maximumDatesPerRole:2});
 assert.equal(plan.tasks.length,2);assert.equal(plan.deferred.length,2);
 assert.equal(plan.tasks.every(row=>row.games.length===1),true);
});


test('conflicting per-role finals remain queryable and result-only captures cannot issue new forecasts',()=>{
 const rows=[entry('baseline'),entry('challenger',1000),entry('baseline',0,{final:true}),entry('challenger',0,{final:true,side:'away'})];
 const pending=pendingProspectiveFinalQueries(rows,{asOf:base+5*3600000});
 assert.equal(pending.conflictingFinalEvents,1);assert.equal(pending.tasks.length,2);
 const disguised=entry('baseline');disguised.capture.purpose='final_reconciliation';
 const result=evaluateProspectiveCaptures([disguised,entry('challenger',1000)],options);
 assert.equal(result.pairedForecasts,0);assert.equal(result.rejections.missing_counterpart,1);
});
