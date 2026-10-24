import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {collectForwardTrial,inspectForwardCollector,forwardWorkerEnvironment} from '../src/forwardTrialCollector.js';
const hash=value=>createHash('sha256').update(value).digest('hex');
const digest=value=>hash(JSON.stringify(value));
const now=Date.parse('2026-10-24T06:00:00Z');
async function fixture(t){
 const root=await mkdtemp(join(tmpdir(),'sports-forward-run-'));t.after(()=>rm(root,{recursive:true,force:true}));
 await mkdir(join(root,'frozen','sports-bot','node_modules'),{recursive:true});await mkdir(join(root,'selection'));
 const artifact='{}\n',plan={id:'fixture',artifactFile:'fixture-model.json',artifactFileHash:hash(artifact),artifactId:'a'.repeat(64),modelVersion:'fixture',league:'nhl',horizon:'Daily',candidate:'hybrid',start:new Date(now).toISOString(),end:new Date(now+14*86400000).toISOString()};plan.planHash=digest(plan);
 const state={plans:{fixture:plan}};state.stateHash=digest(state);
 const checkpoint={planId:plan.id,planHash:plan.planHash,artifactId:plan.artifactId,modelVersion:plan.modelVersion,sourceCommit:'b'.repeat(40),sourceArchive:'source.zip',sourceArchiveSHA256:hash('archive')};
 await writeFile(join(root,'CHECKPOINT.json'),JSON.stringify(checkpoint));await writeFile(join(root,'source.zip'),'archive');await writeFile(join(root,'selection','selection-state.json'),JSON.stringify(state));await writeFile(join(root,'selection',plan.artifactFile),artifact);await writeFile(join(root,'empty.env'),'');
 const manifest={schema:'sports-forward-collector-v1',planId:plan.id,planHash:plan.planHash,artifactId:plan.artifactId,sourceCommit:checkpoint.sourceCommit,files:{'empty.env':hash('')},dependencyDirectory:await realpath(join(root,'frozen','sports-bot','node_modules'))};manifest.manifestHash=digest(manifest);
 await writeFile(join(root,'collector-manifest.json'),JSON.stringify(manifest));return root;
}

test('pretrial and expired collectors make no worker or provider calls',async t=>{
 const root=await fixture(t),execute=()=>assert.fail('must not execute');
 assert.equal((await collectForwardTrial(root,{now:now-1,execute})).status,'awaiting_trial_start');
 assert.equal((await collectForwardTrial(root,{now:now+22*86400000,execute})).status,'collection_window_ended');
});

test('real exclusive owner lock prevents duplicate collector execution and is preserved',async t=>{
 const root=await fixture(t);await writeFile(join(root,'collector.lock'),'owner');
 assert.equal((await collectForwardTrial(root,{now,execute:()=>assert.fail('must not execute')})).status,'owner_lock_present');
 assert.equal(await readFile(join(root,'collector.lock'),'utf8'),'owner');
});

test('successful and failed workers release only their acquired run lock',async t=>{
 const root=await fixture(t);let count=0;
 assert.deepEqual(await collectForwardTrial(root,{now,execute:async()=>{count++;return {status:'fixture'};}}),{status:'fixture'});
 assert.equal(count,1);await assert.rejects(readFile(join(root,'collector.lock')),{code:'ENOENT'});
 await assert.rejects(collectForwardTrial(root,{now,execute:async()=>{throw new Error('fixture failure');}}),/fixture failure/);
 await assert.rejects(readFile(join(root,'collector.lock')),{code:'ENOENT'});
});

test('changed source archive, manifest files, artifact and trial plan stop collection',async t=>{
 for(const name of ['source.zip','empty.env','selection/fixture-model.json','selection/selection-state.json']){
  const root=await fixture(t);await writeFile(join(root,name),'changed');
  await assert.rejects(collectForwardTrial(root,{now,execute:()=>assert.fail('must not execute')}));
 }
});

test('credentials and trading configuration cannot be inherited by a worker',()=>{
 const env=forwardWorkerEnvironment('private',{PATH:'system',SystemRoot:'windows',DISCORD_TOKEN:'sensitive',ODDS_API_KEY:'sensitive',APCA_API_SECRET_KEY:'sensitive',OMNIMOD_LIVE_TRADING_ENABLED:'true'});
 assert.equal(env.DISCORD_TOKEN,undefined);assert.equal(env.ODDS_API_KEY,undefined);assert.equal(env.APCA_API_SECRET_KEY,undefined);
 assert.equal(env.OMNIMOD_LIVE_TRADING_ENABLED,'false');assert.equal(env.OMNIMOD_EMERGENCY_STOP,'true');assert.equal(env.AUTO_LEARNING_ENABLED,'false');assert.equal(env.LOCAL_ML_ENABLED,'false');
});

test('redirected dependencies and invalid run clocks fail closed',async t=>{
 const root=await fixture(t);await assert.rejects(collectForwardTrial(root,{now:NaN}),/clock/);
 const file=join(root,'collector-manifest.json'),m=JSON.parse(await readFile(file,'utf8'));m.dependencyDirectory=root;delete m.manifestHash;m.manifestHash=digest(m);await writeFile(file,JSON.stringify(m));
 await assert.rejects(inspectForwardCollector(root),/dependencies redirected/);
});


async function workerFixture(t,{blockedRequest=false}={}){
 const root=await mkdtemp(join(tmpdir(),'sports-forward-worker-fixture-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const source=join(root,'frozen','sports-bot','src');await mkdir(source,{recursive:true});await mkdir(join(root,'selection'));
 const support=join(root,'collector','src');await mkdir(support,{recursive:true});await writeFile(join(root,'collector','package.json'),'{"type":"module"}');
 for(const name of ['forwardEvidence','auditFileLock','oddsPricing','dataValidation'])await writeFile(join(support,name+'.js'),await readFile(new URL('../src/'+name+'.js',import.meta.url)));
 await writeFile(join(root,'frozen','sports-bot','package.json'),'{'+'"type":"module"}');await writeFile(join(root,'empty.env'),'');
 const plan={start:new Date(Date.now()-60000).toISOString(),end:new Date(Date.now()+86400000).toISOString(),id:'fixture'};
 await writeFile(join(root,'selection','selection-state.json'),JSON.stringify({plans:{fixture:plan}}));
 await writeFile(join(root,'CHECKPOINT.json'),JSON.stringify({planId:'fixture',artifactId:'fixture-artifact',sourceCommit:'fixture-source',modelVersion:'fixture-version'}));
 const modules={config:'export const config={};',hybridArtifact:"export const hybridArtifactId=()=> 'fixture-artifact';",
  sportsData:`export async function buildDailySlate(date,options){
    if(options.includeOdds!==false||options.refreshGameIds?.[0]!=='__freeze_existing_forward_issues__')throw new Error('fixture contract');
    ${blockedRequest?"await fetch('https://discord.com/api/fixture',{method:'POST'});":''}
    return options.cachedSlate||{dateKey:'2026-10-24',games:[],predictions:[],marker:'frozen-first-issue'};
   }export const refreshFinalGrades=async slate=>slate;`,
  predictionJournal:"export const readPredictionJournal=async()=>[];export const predictionJournalFile='fixture';",
  journalResults:'export const journalResultState=()=>({eligible:new Map()});',time:"export const localDateKey=()=> '2026-10-24';",
  selectionProtocol:"export const finalizeSelectionPlan=async()=>({status:'fixture'});"};
 for(const [name,code] of Object.entries(modules))await writeFile(join(source,name+'.js'),code);
 return root;
}
const worker=fileURLToPath(new URL('../scripts/forward-trial-worker.mjs',import.meta.url));
const runWorker=(root,args=[])=>promisify(execFile)(process.execPath,[worker,root,...args],{env:forwardWorkerEnvironment(root),windowsHide:true,timeout:10000});

test('actual worker preflight verifies identity without collecting or creating a journal',async t=>{
 const root=await workerFixture(t),result=JSON.parse((await runWorker(root,['--verify-only'])).stdout);
 assert.equal(result.status,'frozen_worker_verified');assert.equal(result.providerRequests,0);
 await assert.rejects(readFile(join(root,'runtime','runs.jsonl')),{code:'ENOENT'});
});

test('actual worker preserves cached first-issue slate and records bounded private runs',async t=>{
 const root=await workerFixture(t);await runWorker(root);const path=join(root,'runtime','forward-slates','2026-10-24.json'),first=await readFile(path);
 const result=JSON.parse((await runWorker(root)).stdout);assert.equal(result.liveOrders,false);assert.equal(result.discordPosts,0);assert.equal(result.providerRequests,0);
 assert.deepEqual(await readFile(path),first);assert.equal((await readFile(join(root,'runtime','runs.jsonl'),'utf8')).trim().split('\n').length,2);
});

test('actual worker denies a Discord order-like POST before any network call',async t=>{
 const root=await workerFixture(t,{blockedRequest:true});
 await assert.rejects(runWorker(root),error=>error.code===1&&error.stderr.includes('Research network policy rejected request'));
 await assert.rejects(readFile(join(root,'runtime','runs.jsonl')),{code:'ENOENT'});
});


test('final reconciliation rotates bounded dates so unresolved old games cannot starve newer ones',async t=>{
 const root=await workerFixture(t),slates=join(root,'runtime','forward-slates');await mkdir(slates,{recursive:true});
 const records=[];
 for(let i=0;i<4;i++){
  const date='2026-10-'+(20+i),game={id:'g'+i,startTime:new Date(Date.now()-86400000).toISOString()};
  await writeFile(join(slates,date+'.json'),JSON.stringify({dateKey:date,games:[game],predictions:[]}));
  records.push({type:'forecast',payload:{forecastId:'f'+i,gameId:game.id,startTime:game.startTime}});
 }
 await writeFile(join(root,'frozen','sports-bot','src','predictionJournal.js'),`export const readPredictionJournal=async()=>${JSON.stringify(records)};export const predictionJournalFile='fixture';`);
 const first=JSON.parse((await runWorker(root)).stdout);assert.equal(first.reconciledDates,3);assert.equal(first.deferredDates,1);
 let attempts=JSON.parse(await readFile(join(root,'runtime','final-attempts.json'),'utf8'));assert.equal(Object.keys(attempts).length,3);
 await runWorker(root);attempts=JSON.parse(await readFile(join(root,'runtime','final-attempts.json'),'utf8'));assert.equal(Object.keys(attempts).length,4);
});
