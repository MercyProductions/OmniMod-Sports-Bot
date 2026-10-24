import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,symlink} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {forwardWorkerEnvironment,collectForwardTrial} from '../src/forwardTrialCollector.js';
import {supersedeUnstartedSelectionPlan,registerSelectionPlan,finalizeSelectionPlan,verifySelectionReviewEvidence} from '../src/selectionProtocol.js';
import {supersededSelectionPlans} from '../src/selectionSupersession.js';
import {inspectForwardFamily,collectForwardFamily} from '../scripts/family-forward-trial.mjs';
import {fixture,saveState,install,pinBinding,digest,now} from '../test-support/selection-supersession-fixture.mjs';

const state=f=>readFile(join(f.selection,'selection-state.json'),'utf8').then(JSON.parse);
const replace=f=>supersedeUnstartedSelectionPlan('prior',f.spec,f.options);
const execute=promisify(execFile);
async function unchangedAfterRejection(f,operation){const before=await readFile(join(f.selection,'selection-state.json'));await assert.rejects(operation);assert.deepEqual(await readFile(join(f.selection,'selection-state.json')),before);}

test('atomic pre-start replacement preserves original plans, source archive, artifacts and baseline',async t=>{
 const f=await fixture(t),before=await state(f),archive=await readFile(join(f.prior,'source.zip')),artifact=await readFile(join(f.selection,'prior-model.json'));
 const result=await replace(f),after=await state(f);
 assert.equal(result.status,'pretrial_plan_superseded');assert.equal(result.promotionAllowed,false);
 assert.deepEqual(after.plans.prior,before.plans.prior);assert.deepEqual(after.plans.baseline,before.plans.baseline);
 assert.deepEqual(await readFile(join(f.prior,'source.zip')),archive);assert.deepEqual(await readFile(join(f.selection,'prior-model.json')),artifact);
 assert.equal(after.supersessions.length,1);assert.equal(after.supersessions[0].emptyCollectorProof.captureReceipts,0);
 assert.deepEqual([...supersededSelectionPlans(after)],['prior']);assert.deepEqual(after.consumedGames,[]);assert.deepEqual(after.reports,{});
 await assert.rejects(readFile(join(f.prior,'collector.lock')),{code:'ENOENT'});
});

test('an already started collector cannot be retired even if its runtime is empty',async t=>{
 const f=await fixture(t);await unchangedAfterRejection(f,()=>supersedeUnstartedSelectionPlan('prior',f.spec,{...f.options,now:Date.parse(f.spec.start)}));
 await unchangedAfterRejection(f,()=>supersedeUnstartedSelectionPlan('baseline',f.spec,{...f.options,priorTrialDirectory:f.baseline}));
});

test('capture or runtime evidence prevents replacement rather than trusting zero checkpoint counters',async t=>{
 for(const name of ['prediction-journal.jsonl','runs.jsonl','provider-cache/partial.json','evidence.lock']){
  const f=await fixture(t),path=join(f.prior,'runtime',name);await mkdir(join(path,'..'),{recursive:true});await writeFile(path,name.endsWith('lock')?'':'private-observation-marker');
  await unchangedAfterRejection(f,()=>replace(f));
 }
});

test('an unreceipted capture or abandoned provider blob is preserved and prevents replacement',async t=>{
 for(const folder of ['captures','evidence-blobs']){const f=await fixture(t);await mkdir(join(f.prior,folder));const file=join(f.prior,folder,'partial.json');await writeFile(file,'private-partial-evidence');await unchangedAfterRejection(f,()=>replace(f));assert.equal(await readFile(file,'utf8'),'private-partial-evidence');}
});

test('existing collector and selection owner locks are never stolen',async t=>{
 for(const where of ['collector','selection']){
  const f=await fixture(t),file=where==='collector'?join(f.prior,'collector.lock'):join(f.selection,'selection-state.json.lock');await writeFile(file,'private-owner-marker');await unchangedAfterRejection(f,()=>replace(f));assert.equal(await readFile(file,'utf8'),'private-owner-marker');
 }
});

test('source, plan, artifact and canonical directory binding are checked before mutation',async t=>{
 const a=await fixture(t);await writeFile(join(a.prior,'source.zip'),'changed');await unchangedAfterRejection(a,()=>replace(a));
 const b=await fixture(t);await writeFile(join(b.selection,'prior-model.json'),'changed');await unchangedAfterRejection(b,()=>replace(b));
 const c=await fixture(t);await unchangedAfterRejection(c,()=>supersedeUnstartedSelectionPlan('baseline',c.spec,c.options));
 const d=await fixture(t),redirect=join(d.root,'alias');await symlink(d.prior,redirect,'junction');await unchangedAfterRejection(d,()=>supersedeUnstartedSelectionPlan('prior',d.spec,{...d.options,priorTrialDirectory:redirect}));
});

test('replacement cannot reduce minimums, alter scope or move the registered period',async t=>{
 for(const change of [{minimumGames:74},{minimumDates:7},{horizon:'T-30'},{league:'nba'},{start:'2101-01-02T00:00:00Z',end:'2101-01-16T00:00:00Z'},{id:'prior'}]){
  const f=await fixture(t);await unchangedAfterRejection(f,()=>supersedeUnstartedSelectionPlan('prior',{...f.spec,...change},f.options));
 }
 const f=await fixture(t);await saveState(f,s=>{s.reports.prior={status:'anything'};});await unchangedAfterRejection(f,()=>replace(f));
});

test('a second transition or reused plan ID cannot overwrite the first decision',async t=>{
 const f=await fixture(t);await replace(f);await unchangedAfterRejection(f,()=>replace(f));
 await unchangedAfterRejection(f,()=>registerSelectionPlan(f.spec,{directory:f.selection,model:f.model,now}));
});

test('superseded plans cannot finalize or acquire approval evidence',async t=>{
 const f=await fixture(t);await replace(f);
 await unchangedAfterRejection(f,()=>finalizeSelectionPlan('prior',{directory:f.selection,records:[],now:Date.parse(f.spec.end)+1}));
 const stored=await state(f);assert.throws(()=>verifySelectionReviewEvidence({state:stored,artifactBytes:'{}',records:[],review:{planId:'prior'},now}),/superseded/);
});

test('rehashed malformed supersession metadata cannot waive active-period or evidence requirements',async t=>{
 for(const change of [s=>s.supersessions[0].emptyCollectorProof.captureReceipts=1,s=>s.supersessions[0].recordedAt=s.plans.prior.start,s=>s.supersessions[0].priorPlanHash='0'.repeat(64),s=>s.supersessions[0].replacementPlanId='prior']){
  const f=await fixture(t);await replace(f);const s=await state(f);change(s);const record=s.supersessions[0];delete record.recordHash;record.recordHash=digest(record);assert.throws(()=>supersededSelectionPlans(s));
 }
 const f=await fixture(t);await replace(f);const s=await state(f);delete s.supersessions;assert.throws(()=>supersededSelectionPlans(s),/overlap/);
});

test('prior-period consumed games cannot be hidden by a before-start status declaration',async t=>{
 const f=await fixture(t);await saveState(f,s=>s.consumedGames.push(JSON.stringify(['nhl','observed',f.spec.start])));await unchangedAfterRejection(f,()=>replace(f));
});

test('new family validates the retired member and never invokes its worker',async t=>{
 const f=await fixture(t);const result=await replace(f),next=join(f.root,'next');
 const member=await install(next,f.selection,result.replacementPlan,3);await pinBinding(next,f.selection,[...f.members,member]);
 const inspected=await inspectForwardFamily(next);assert.equal(inspected.family.activePlans,2);assert.equal(inspected.family.supersededPlans,1);
 assert.equal((await collectForwardFamily(f.prior,{now,execute:()=>assert.fail('retired worker')})).status,'superseded_before_trial_start');
 assert.equal((await collectForwardTrial(f.prior,{now,execute:()=>assert.fail('retired direct worker')})).status,'superseded_before_trial_start');
 assert.equal((await collectForwardFamily(next,{now,execute:()=>assert.fail('too early')})).status,'awaiting_trial_start');
});

test('later data in a retired collector cannot pass as its originally empty evidence',async t=>{
 const f=await fixture(t),result=await replace(f),next=join(f.root,'next');const member=await install(next,f.selection,result.replacementPlan,3);await pinBinding(next,f.selection,[...f.members,member]);
 await mkdir(join(f.prior,'runtime'));await writeFile(join(f.prior,'runtime','prediction-journal.jsonl'),'unexpected-later-evidence\n');
 await assert.rejects(inspectForwardFamily(next),/later evidence/);
});

test('two actual child processes produce one durable transition rather than two replacement plans',async t=>{
 const f=await fixture(t),file=join(f.root,'child-fixture.json');await writeFile(file,JSON.stringify({spec:f.spec,options:{directory:f.selection,priorTrialDirectory:f.prior,now}}));
 const worker=fileURLToPath(new URL('../test-support/selection-supersession-worker.mjs',import.meta.url));
 const results=await Promise.allSettled([1,2].map(()=>execute(process.execPath,[worker,file],{env:forwardWorkerEnvironment(f.prior),windowsHide:true})));
 assert.equal(results.filter(row=>row.status==='fulfilled').length,1);
 const stored=await state(f);assert.equal(stored.supersessions.length,1);assert.equal(Object.keys(stored.plans).length,3);
 assert.deepEqual(stored.consumedGames,[]);assert.deepEqual(stored.reports,{});
});

test('artifact conflicts and interrupted state commits preserve the old ledger and incomplete evidence',async t=>{
 const a=await fixture(t),conflict=join(a.selection,'replacement-model.json');await writeFile(conflict,'private-artifact-conflict');
 await unchangedAfterRejection(a,()=>replace(a));assert.equal(await readFile(conflict,'utf8'),'private-artifact-conflict');
 const b=await fixture(t),pending=join(b.selection,'selection-state.json.pending');await writeFile(pending,'private-interrupted-commit');
 await unchangedAfterRejection(b,()=>replace(b));assert.equal(await readFile(pending,'utf8'),'private-interrupted-commit');
 assert.equal(JSON.parse(await readFile(join(b.selection,'replacement-model.json'),'utf8')).artifactId,b.model.artifactId);
 await assert.rejects(readFile(join(b.prior,'collector.lock')),{code:'ENOENT'});
});

test('real CLI performs the guarded research transition and sanitizes invalid requests without providers',async t=>{
 const f=await fixture(t),file=join(f.root,'spec.json');await writeFile(file,JSON.stringify(f.spec));
 const script=fileURLToPath(new URL('../scripts/selection-research.js',import.meta.url)),args=[script,'--action=supersede-unstarted','--directory='+f.selection,'--prior-collector='+f.prior,'--prior-plan=prior','--spec='+file];
 const result=JSON.parse((await execute(process.execPath,args,{env:forwardWorkerEnvironment(f.prior),windowsHide:true})).stdout);
 assert.equal(result.status,'pretrial_plan_superseded');assert.equal(result.promotionAllowed,false);
 const before=await readFile(join(f.selection,'selection-state.json'));
 await assert.rejects(execute(process.execPath,args.map(value=>value==='--prior-plan=prior'?'--prior-plan=private-invalid/request-marker':value),{env:forwardWorkerEnvironment(f.prior),windowsHide:true}),error=>error.code===1&&!error.stderr.includes('private-invalid'));
 assert.deepEqual(await readFile(join(f.selection,'selection-state.json')),before);
});

test('a stricter old minimum and an actual clock at trial start cannot be waived by a caller clock',async t=>{
 const f=await fixture(t);await replace(f);const s=await state(f),old=s.plans.prior;
 old.minimumGames=100;delete old.planHash;old.planHash=digest(old);const record=s.supersessions[0];record.priorPlanHash=old.planHash;delete record.recordHash;record.recordHash=digest(record);
 assert.throws(()=>supersededSelectionPlans(s));
 const g=await fixture(t);t.mock.method(Date,'now',()=>Date.parse(g.spec.start));await unchangedAfterRejection(g,()=>replace(g));
});

test('a replacement can later consume its own outcomes without reviving the retired plan',async t=>{
 const f=await fixture(t),result=await replace(f),plan=result.replacementPlan,base=Date.parse(plan.start),iso=value=>new Date(value).toISOString();
 const records=Array.from({length:75},(_,i)=>{
  const issue=base+(i%14)*86400000+12*3600000,payload={forecastId:'f'+i,gameId:'g'+i,guildId:'fixture',league:'nhl',horizon:'Daily',modelVersion:plan.modelVersion,lifecycleState:'ISSUED',recordEligibility:'observed_pregame',predictionGeneratedAt:iso(issue),startTime:iso(issue+3600000),eventContext:{sport:'hockey'},selectedSide:'home',outcomePercentages:{home:55,away:45,draw:0},modeledOutcomes:['away','home'],candidateArtifactIds:{hybrid:plan.artifactId},candidateProbabilities:{hybrid:{home:.8,away:.2,draw:0}},candidateModeledOutcomes:{hybrid:['away','home']}};
  return [{type:'forecast',recordedAt:iso(issue),payload},{type:'result',recordedAt:iso(issue+4*3600000),payload:{forecastId:payload.forecastId,actualSide:'home',observedAt:iso(issue+4*3600000)}}];
 }).flat();
 const review=await finalizeSelectionPlan(plan.id,{directory:f.selection,records,now:Date.parse(plan.end)+1});
 assert.equal(review.status,'review_ready');assert.equal(review.promotionAllowed,false);assert.equal(review.approvalRequired,true);
 const stored=await state(f);assert.equal(stored.consumedGames.length,75);assert.deepEqual([...supersededSelectionPlans(stored)],['prior']);
 const verified=verifySelectionReviewEvidence({state:stored,artifactBytes:await readFile(join(f.selection,plan.artifactFile),'utf8'),records,review,now:Date.parse(plan.end)+2});
 assert.equal(verified.planId,plan.id);
});

test('checkpoint evidence of previous activity cannot be erased by empty runtime directories',async t=>{
 for(const change of [{currentObservedGames:1},{firstActualRun:{providerRequests:0}},{latestActualRun:{collectedGames:0}},{totalProviderRequests:1}]){
  const f=await fixture(t),file=join(f.prior,'CHECKPOINT.json'),checkpoint=JSON.parse(await readFile(file,'utf8'));await writeFile(file,JSON.stringify({...checkpoint,...change}));await unchangedAfterRejection(f,()=>replace(f));
 }
});

test('rehashed outer records cannot hide altered original plan bytes or invalid clocks',async t=>{
 for(const change of [s=>s.plans.prior.minimumGames=100,s=>s.plans.prior.start='private-invalid-clock']){
  const f=await fixture(t);await replace(f);const stored=await state(f);change(stored);const record=stored.supersessions[0];delete record.recordHash;record.recordHash=digest(record);assert.throws(()=>supersededSelectionPlans(stored));
 }
});
