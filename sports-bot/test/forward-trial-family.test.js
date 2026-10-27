import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm,symlink,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {inspectForwardFamily,collectForwardFamily} from '../scripts/family-forward-trial.mjs';

const sha=value=>createHash('sha256').update(value).digest('hex');
const digest=value=>sha(JSON.stringify(value));
const now=Date.parse('2026-11-08T12:00:00Z');
async function saveState(f,mutate){
 const state=JSON.parse(await readFile(join(f.selection,'selection-state.json'),'utf8'));
 mutate(state);delete state.stateHash;state.stateHash=digest(state);
 await writeFile(join(f.selection,'selection-state.json'),JSON.stringify(state));
}
async function saveBinding(f,mutate){
 const path=join(f.current,'family-binding.json'),binding=JSON.parse(await readFile(path,'utf8'));
 mutate(binding);delete binding.bindingHash;binding.bindingHash=digest(binding);
 const bytes=JSON.stringify(binding);await writeFile(path,bytes);
 const file=join(f.current,'collector-manifest.json'),manifest=JSON.parse(await readFile(file,'utf8'));
 manifest.files['family-binding.json']=sha(bytes);delete manifest.manifestHash;manifest.manifestHash=digest(manifest);
 await writeFile(file,JSON.stringify(manifest));
}
async function fixture(t){
 const temporary=await mkdtemp(join(tmpdir(),'sports-forward-family-'));
 t.after(()=>rm(temporary,{recursive:true,force:true}));
 const prior=join(temporary,'prior'),current=join(temporary,'current'),selection=join(prior,'selection');
 await mkdir(selection,{recursive:true});await mkdir(current);
 await symlink(selection,join(current,'selection'),'junction');
 const state={schema:'sports-selection-state-v1',plans:{},reports:{},consumedGames:[]},members=[];
 for(const [i,root] of [prior,current].entries()){
  const id=i?'current':'prior',artifact='{}\n',start=now-(i?0:16*86400000);
  const plan={schema:'sports-selection-plan-v1',id,sport:'hockey',league:'nhl',horizon:'Daily',candidate:'hybrid',
   modelVersion:'fixture-'+id,artifactId:String(i+1).repeat(64),artifactFile:id+'-model.json',artifactFileHash:sha(artifact),
   start:new Date(start).toISOString(),end:new Date(start+14*86400000).toISOString(),
   registeredAt:new Date(now-20*86400000).toISOString(),minimumGames:75,minimumDates:8};
  plan.planHash=digest(plan);state.plans[id]=plan;
  await writeFile(join(selection,plan.artifactFile),artifact);
  const checkpoint={planId:id,planHash:plan.planHash,artifactId:plan.artifactId,modelVersion:plan.modelVersion,
   sourceCommit:String(i+3).repeat(40),sourceArchive:'source.zip',sourceArchiveSHA256:sha('archive')};
  await writeFile(join(root,'CHECKPOINT.json'),JSON.stringify(checkpoint));await writeFile(join(root,'source.zip'),'archive');
  await writeFile(join(root,'empty.env'),'');await mkdir(join(root,'frozen','sports-bot','node_modules'),{recursive:true});
  const manifest={schema:'sports-forward-collector-v1',planId:id,planHash:plan.planHash,artifactId:plan.artifactId,
   sourceCommit:checkpoint.sourceCommit,files:{'empty.env':sha('')},dependencyDirectory:await realpath(join(root,'frozen','sports-bot','node_modules'))};
  manifest.manifestHash=digest(manifest);await writeFile(join(root,'collector-manifest.json'),JSON.stringify(manifest));
  members.push({directory:await realpath(root),planId:id,planHash:plan.planHash});
 }
 state.stateHash=digest(state);await writeFile(join(selection,'selection-state.json'),JSON.stringify(state));
 const binding={schema:'sports-forward-family-v1',selectionDirectory:await realpath(selection),members};
 binding.bindingHash=digest(binding);await writeFile(join(current,'family-binding.json'),JSON.stringify(binding));
 const f={temporary,prior,current,selection};await saveBinding(f,()=>{});return f;
}

test('separate trials share a verified ledger without altering original plans, artifacts or evidence',async t=>{
 const f=await fixture(t),before=await readFile(join(f.selection,'selection-state.json'));
 const result=await inspectForwardFamily(f.current);
 assert.equal(result.family.members,2);assert.equal(result.family.plans,2);assert.equal(result.family.consumedGames,0);
 assert.deepEqual(await readFile(join(f.selection,'selection-state.json')),before);
});

test('before-start and after-grace invocations never execute a worker',async t=>{
 const f=await fixture(t),execute=()=>assert.fail('no worker permitted');
 assert.equal((await collectForwardFamily(f.current,{now:now-1,execute})).status,'awaiting_trial_start');
 assert.equal((await collectForwardFamily(f.current,{now:now+22*86400000,execute})).status,'collection_window_ended');
});

test('existing owner and nested attempts cannot overlap; successful collection releases its owner',async t=>{
 const f=await fixture(t);let runs=0;
 assert.deepEqual(await collectForwardFamily(f.current,{now,execute:async()=>{
  runs++;assert.equal((await collectForwardFamily(f.current,{now,execute:()=>assert.fail('duplicate')})).status,'owner_lock_present');
  return {status:'fixture-only'};
 }}),{status:'fixture-only'});
 assert.equal(runs,1);await assert.rejects(readFile(join(f.current,'collector.lock')),{code:'ENOENT'});
});

test('failed family worker retains evidence and releases only its own run lock',async t=>{
 const f=await fixture(t),before=await readFile(join(f.selection,'selection-state.json'));
 await assert.rejects(collectForwardFamily(f.current,{now,execute:async()=>{throw new Error('fixture failure');}}),/fixture failure/);
 assert.deepEqual(await readFile(join(f.selection,'selection-state.json')),before);
 await assert.rejects(readFile(join(f.current,'collector.lock')),{code:'ENOENT'});
});

test('a fresh copied selection directory cannot bypass the family ledger',async t=>{
 const f=await fixture(t),copy=join(f.temporary,'copy');await mkdir(copy);
 for(const name of ['selection-state.json','prior-model.json','current-model.json'])await writeFile(join(copy,name),await readFile(join(f.selection,name)));
 await rm(join(f.current,'selection'));await symlink(copy,join(f.current,'selection'),'junction');
 await assert.rejects(collectForwardFamily(f.current,{now,execute:()=>assert.fail('redirected')}),/selection directory redirected/);
});

test('changed member archive or original plan blocks the newer collector',async t=>{
 for(const file of ['source.zip','selection/prior-model.json']){
  const f=await fixture(t);await writeFile(join(f.prior,file),'changed');
  await assert.rejects(collectForwardFamily(f.current,{now,execute:()=>assert.fail('changed evidence')}));
 }
});

test('binding must be manifest-pinned and must include the current and unique participants',async t=>{
 for(const mutation of [b=>b.members.pop(),b=>b.members.push(b.members[0]),b=>b.members[1].planHash='changed']){
  const f=await fixture(t);await saveBinding(f,mutation);
  await assert.rejects(inspectForwardFamily(f.current));
 }
 const f=await fixture(t);await writeFile(join(f.current,'family-binding.json'),'changed');
 await assert.rejects(inspectForwardFamily(f.current));
});

test('a separately added same-league overlapping plan is rejected even with valid hashes',async t=>{
 const f=await fixture(t);
 await saveState(f,state=>{
  const plan={...state.plans.current,id:'third',artifactFile:'third-model.json'};
  delete plan.planHash;plan.planHash=digest(plan);state.plans.third=plan;
 });
 await writeFile(join(f.selection,'third-model.json'),'{}\n');
 await assert.rejects(inspectForwardFamily(f.current),/windows overlap/);
});

test('underpowered or backdated added plans cannot silently weaken the registered minimums',async t=>{
 for(const field of ['minimumGames','minimumDates','registeredAt']){
  const f=await fixture(t);await saveState(f,state=>{
   const plan={...state.plans.current,id:'future',artifactFile:'future-model.json',
    start:'2026-12-08T12:00:00Z',end:'2026-12-22T12:00:00Z'};
   plan[field]=field==='minimumGames'?74:field==='minimumDates'?7:plan.start;
   delete plan.planHash;plan.planHash=digest(plan);state.plans.future=plan;
  });await writeFile(join(f.selection,'future-model.json'),'{}\n');
  await assert.rejects(inspectForwardFamily(f.current),/plan or artifact integrity/);
 }
});

function review(plan,keys){
 const report={schema:'sports-selection-review-v2',planId:plan.id,planHash:plan.planHash,artifactId:plan.artifactId,
  consumedGameKeys:keys,promotionAllowed:false,approvalRequired:true};report.reportHash=digest(report);return report;
}
test('complete consumption accounting is accepted without interpreting it as model approval',async t=>{
 const f=await fixture(t),key=JSON.stringify(['nhl','one','2026-10-25T12:00:00Z']);
 await saveState(f,s=>{s.reports.prior=review(s.plans.prior,[key]);s.consumedGames=[key];});
 assert.equal((await inspectForwardFamily(f.current)).family.consumedGames,1);
});

test('duplicate game consumption and detached or incomplete report ledgers fail closed',async t=>{
 for(const mode of ['duplicate','missing','detached','malformed']){
  const f=await fixture(t),key=JSON.stringify(['nhl','one','2026-10-25T12:00:00Z']);
  await saveState(f,s=>{
   s.reports.prior=review(s.plans.prior,[mode==='malformed'?'bad':key]);s.consumedGames=[key];
   if(mode==='duplicate')s.reports.current=review(s.plans.current,[key]);
   if(mode==='missing')s.consumedGames=[];
   if(mode==='detached'){s.reports.prior.planHash='changed';delete s.reports.prior.reportHash;s.reports.prior.reportHash=digest(s.reports.prior);}
  });
  await assert.rejects(inspectForwardFamily(f.current));
 }
});

test('CLI inspection makes zero worker/provider calls and malformed private evidence is not echoed',async t=>{
 const f=await fixture(t),cli=fileURLToPath(new URL('../scripts/family-forward-trial.mjs',import.meta.url));
 const result=JSON.parse((await promisify(execFile)(process.execPath,[cli,'--directory='+f.current,'--inspect-only'])).stdout);
 assert.equal(result.status,'forward_family_verified');assert.equal(result.providerRequests,0);assert.equal(result.liveOrders,false);
 await writeFile(join(f.current,'family-binding.json'),'fixture-sensitive-content');
 await assert.rejects(promisify(execFile)(process.execPath,[cli,'--directory='+f.current]),e=>e.code===1&&!e.stderr.includes('fixture-sensitive-content'));
 await assert.rejects(collectForwardFamily(f.current,{now:NaN}),/clock/);
});
