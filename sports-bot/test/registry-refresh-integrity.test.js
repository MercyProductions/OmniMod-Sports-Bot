import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {dirname,join} from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFile,readFile,open,unlink} from 'node:fs/promises';
import {refreshModelRegistry,modelRegistryFile} from '../src/modelRegistry.js';
import {CURRENT_MODEL_VERSION} from '../src/modelIdentity.js';
const iso=ms=>new Date(ms).toISOString();
function row(i=0,patch={}){
 const base=Date.parse('2026-01-01T00:00:00Z')+i*86400000;
 return {source:'frozen-production',modelVersion:CURRENT_MODEL_VERSION,horizon:'Daily',snapshotStage:'daily',dateKey:iso(base).slice(0,10),
  leagueKey:'nba',sport:'basketball',gameId:'g'+i,startTime:iso(base+20*3600000),predictionGeneratedAt:iso(base+8*3600000),recordedAt:iso(base+9*3600000),resolvedAt:iso(base+23*3600000),
  snapshotPolicy:'first_issue_immutable_v1',actualSide:'home',candidateProbabilities:{evidence:{home:.6,away:.4,draw:0}},...patch};
}
async function reset(){await writeFile(modelRegistryFile,JSON.stringify({version:1,updatedAt:'2026-10-24T00:00:00Z',sports:{},audit:[]}));}
async function evaluate(rows){await reset();const result=await refreshModelRegistry(rows);const stored=JSON.parse(await readFile(modelRegistryFile,'utf8'));assert.deepEqual(stored.sports.basketball,result.sports.basketball);return result.sports.basketball;}

test('persisted refresh cannot acquire challenger evidence from a later richer revision',async()=>{
 const first=row(),later={...row(),recordedAt:'2026-01-01T09:30:00Z',predictionGeneratedAt:'2026-01-01T09:29:00Z',candidateProbabilities:{evidence:{home:.6,away:.4,draw:0},hybrid:{home:.99,away:.01,draw:0}}};
 for(const rows of [[first,later],[later,first]]){
  const stored=await evaluate(rows);assert.equal(stored.evaluation.comparisons.hybrid.sampleSize,0);assert.equal(stored.evaluation.cohort.duplicateRowsRemoved,1);
 }
});

test('persisted refresh preserves contradictory results for quarantine',async()=>{
 const stored=await evaluate([row(),row(0,{actualSide:'away'})]);
 assert.equal(stored.evaluation.evidence.sampleSize,0);assert.equal(stored.evaluation.cohort.conflictingGamesExcluded,1);
});

test('persisted refresh cannot choose between ambiguous simultaneous candidate inputs',async()=>{
 const changed=row(0,{candidateProbabilities:{evidence:{home:.9,away:.1,draw:0}}}),stored=await evaluate([row(),changed]);
 assert.equal(stored.evaluation.evidence.sampleSize,0);assert.equal(stored.evaluation.cohort.ambiguousFirstForecastGamesExcluded,1);
});

test('same sport and provider ID cannot erase an event from a different league',async()=>{
 const stored=await evaluate([row(),row(0,{leagueKey:'wnba'})]);assert.equal(stored.evaluation.evidence.sampleSize,2);
});

test('horizon selection is invariant to input order and retains all available cohorts',async()=>{
 const a=row(),b=row(0,{horizon:'T-90'}),forward=await evaluate([a,b]),reverse=await evaluate([b,a]);
 assert.equal(forward.evaluation.cohort.key,reverse.evaluation.cohort.key);assert.equal(forward.evaluation.cohort.available.length,2);assert.equal(reverse.evaluation.cohort.available.length,2);
});

test('recent evaluation stays in the selected production cohort despite newer replay rows',async()=>{
 const production=Array.from({length:5},(_,i)=>row(i)),replay=Array.from({length:60},(_,i)=>row(100+i,{source:'historical-replay'}));
 const stored=await evaluate([...production,...replay]);assert.ok(stored.evaluation.cohort.key.startsWith('production|'));assert.equal(stored.recentEvaluation.cohort.key,stored.evaluation.cohort.key);assert.equal(stored.recentEvaluation.evidence.sampleSize,5);
});

test('queued registry refresh freezes nested caller inputs before asynchronous IO',async()=>{
 await reset();const input=row(),pending=refreshModelRegistry([input]);input.candidateProbabilities.evidence={home:.99,away:.01,draw:0};
 const stored=(await pending).sports.basketball;assert.ok(Math.abs(stored.evaluation.evidence.brierScore-.16)<1e-12);
});

test('recent window uses recorded instants rather than same-day array order',async()=>{
 const rows=Array.from({length:40},(_,i)=>row(0,{gameId:'timed'+i,recordedAt:iso(Date.parse('2026-01-01T09:00:00Z')+i*60000),candidateProbabilities:{evidence:{home:i<10?.2:.8,away:i<10?.8:.2,draw:0}}})).reverse();
 const stored=await evaluate(rows);assert.equal(stored.recentEvaluation.evidence.sampleSize,30);assert.ok(Math.abs(stored.recentEvaluation.evidence.brierScore-.04)<1e-12);
});


test('an existing registry owner prevents refresh and its bytes are preserved',async()=>{
 await reset();const before=await readFile(modelRegistryFile),handle=await open(modelRegistryFile+'.lock','wx');
 try{await assert.rejects(refreshModelRegistry([row()]),/locked/);assert.deepEqual(await readFile(modelRegistryFile),before);}
 finally{await handle.close();await unlink(modelRegistryFile+'.lock');}
});

test('real competing processes cannot overwrite another accepted sport update',async t=>{
 await reset();const directory=dirname(modelRegistryFile);await writeFile(join(directory,'empty.env'),'');
 const worker=fileURLToPath(new URL('../test-support/registry-worker.mjs',import.meta.url)),env={};
 for(const key of ['PATH','Path','SystemRoot','WINDIR','TEMP','TMP'])if(process.env[key])env[key]=process.env[key];
 const owner=spawn(process.execPath,[worker,directory,'hold','basketball'],{env,windowsHide:true,stdio:['pipe','pipe','pipe']});t.after(()=>{if(owner.exitCode===null)owner.kill();});
 let output='',errors='';owner.stdout.on('data',chunk=>output+=chunk);owner.stderr.on('data',chunk=>errors+=chunk);
 const finished=new Promise((resolve,reject)=>{owner.on('error',reject);owner.on('exit',code=>code===0?resolve():reject(new Error('Owner fixture failed: '+code+' '+errors)));});
 await new Promise((resolve,reject)=>{owner.stdout.on('data',()=>{if(output.includes('snapshot_read'))resolve();});owner.on('error',reject);owner.on('exit',()=>{if(!output.includes('snapshot_read'))reject(new Error('Owner fixture did not reach snapshot'));});});
 const run=promisify(execFile);let accepted;
 try{const result=await run(process.execPath,[worker,directory,'write','football'],{env,windowsHide:true,timeout:10000});accepted=JSON.parse(result.stdout.trim()).status==='accepted';}
 catch(error){assert.equal(error.code,31);assert.equal(JSON.parse(error.stdout.trim()).status,'owner_locked');accepted=false;}
 owner.stdin.end('release');await finished;
 const afterOwner=JSON.parse(await readFile(modelRegistryFile,'utf8'));assert.ok(afterOwner.sports.basketball);
 if(accepted)assert.ok(afterOwner.sports.football,'accepted concurrent update was lost');
 else{await run(process.execPath,[worker,directory,'write','football'],{env,windowsHide:true,timeout:10000});const final=JSON.parse(await readFile(modelRegistryFile,'utf8'));assert.ok(final.sports.basketball);assert.ok(final.sports.football);}
});
