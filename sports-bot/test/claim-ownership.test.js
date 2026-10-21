import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {tmpdir,hostname} from 'node:os';
import {join} from 'node:path';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
const directory=await mkdtemp(join(tmpdir(),'sports-owner-'));process.env.OMNIMOD_SPORTS_DATA_DIR=directory;
const {claimFinalResult,finishFinalResult,releaseFinalResultClaim}=await import('../src/storage.js');
const args=id=>['2026-10-21','fixture',id],file=id=>join(directory,`final-result-fixture-2026-10-21-${id}.json`);
const nodeFile=(id,claim)=>claim.schemaVersion===2?join(file(id)+'.claims',`claim-${claim.generation}.json`):file(id);
test.after(()=>rm(directory,{recursive:true,force:true}));

test('a live owner cannot be displaced solely because its receipt is old',async()=>{
 const first=await claimFinalResult(...args('live-age')),target=nodeFile('live-age',first.claim),record=JSON.parse(await readFile(target,'utf8'));
 record.claimedAt='2000-01-01T00:00:00Z';await writeFile(target,JSON.stringify(record));
 assert.equal((await claimFinalResult(...args('live-age'),{}, {staleMs:60000})).claimed,false);
});

test('missing or wrong ownership proof cannot finish a claim',async()=>{
 const first=await claimFinalResult(...args('wrong-finish')),patch={messageId:'m',channelId:'c'};
 await assert.rejects(finishFinalResult(...args('wrong-finish'),patch));
 await assert.rejects(finishFinalResult(...args('wrong-finish'),patch,{...first.lease,claimId:'wrong'}));
 assert.equal((await claimFinalResult(...args('wrong-finish'))).claim.state,'claimed');
});

test('wrong release proof cannot delete or relinquish an active claim',async()=>{
 const first=await claimFinalResult(...args('wrong-release'));
 await assert.rejects(releaseFinalResultClaim(...args('wrong-release'),{...first.lease,claimId:'wrong'}));
 assert.equal((await claimFinalResult(...args('wrong-release'))).claimed,false);
});

test('an earlier owner cannot finish or release its successor',async()=>{
 const a=await claimFinalResult(...args('successor'));await releaseFinalResultClaim(...args('successor'),a.lease);
 const b=await claimFinalResult(...args('successor'));assert.equal(b.claimed,true);
 await assert.rejects(finishFinalResult(...args('successor'),{messageId:'old',channelId:'c'},a.lease));
 assert.equal(await releaseFinalResultClaim(...args('successor'),a.lease),false);
 await finishFinalResult(...args('successor'),{messageId:'new',channelId:'c'},b.lease);
 assert.equal((await claimFinalResult(...args('successor'))).claim.messageId,'new');
});

test('metadata cannot overwrite reserved claim identity, owner or state',async()=>{
 const details={state:'posted',gameId:'wrong',guildId:'other',owner:{pid:0,host:'wrong'},claimId:'wrong',eventScope:{leagueKey:'nba'}};
 const pending=claimFinalResult(...args('reserved'),details);details.eventScope.leagueKey='nhl';const first=await pending;assert.equal(first.claim.eventScope.leagueKey,'nba');
 assert.equal(first.claim.state,'claimed');assert.equal(first.claim.gameId,'reserved');assert.equal(first.claim.guildId,'fixture');assert.equal(first.claim.owner.pid,process.pid);assert.equal(first.claim.owner.host,hostname());assert.notEqual(first.claim.claimId,'wrong');
 const patch={messageId:'frozen',channelId:'channel'};const finishing=finishFinalResult(...args('reserved'),patch,first.lease);patch.messageId='mutated';await finishing;assert.equal((await claimFinalResult(...args('reserved'))).claim.messageId,'frozen');
});

test('legacy and foreign-host owners are not stolen using timeouts',async()=>{
 const legacy={dateKey:'2026-10-21',guildId:'fixture',gameId:'legacy',state:'claimed',processId:99999999,claimedAt:'2000-01-01T00:00:00Z'};
 await writeFile(file('legacy'),JSON.stringify(legacy));assert.equal((await claimFinalResult(...args('legacy'))).claimed,false);assert.equal(await readFile(file('legacy'),'utf8'),JSON.stringify(legacy));
 const first=await claimFinalResult(...args('foreign')),target=nodeFile('foreign',first.claim),record=JSON.parse(await readFile(target,'utf8'));record.owner={...record.owner,host:hostname()+'-foreign',pid:99999999};await writeFile(target,JSON.stringify(record));
 assert.equal((await claimFinalResult(...args('foreign'))).claimed,false);
});

test('identity collisions and malformed records fail closed without echoing their contents',async()=>{
 await claimFinalResult(...args('a:b'));await assert.rejects(claimFinalResult(...args('ab')),/another identity/);
 await writeFile(file('malformed'),'sensitive-fixture-do-not-echo');await assert.rejects(claimFinalResult(...args('malformed')),error=>!error.message.includes('sensitive-fixture'));
});

const worker=fileURLToPath(new URL('../test-support/final-claim-worker.mjs',import.meta.url));
async function workerDirectory(t){const dir=await mkdtemp(join(tmpdir(),'sports-owner-worker-'));await writeFile(join(dir,'empty.env'),'');t.after(()=>rm(dir,{recursive:true,force:true}));return dir;}
function env(){const result={};for(const key of ['PATH','Path','SystemRoot','WINDIR','TEMP','TMP'])if(process.env[key])result[key]=process.env[key];return result;}
const run=(dir,mode,id)=>promisify(execFile)(process.execPath,[worker,dir,mode,id||'fixture'],{env:env(),timeout:30000,windowsHide:true});
async function hold(t,dir,id){
 const child=spawn(process.execPath,[worker,dir,'hold',id],{env:env(),windowsHide:true,stdio:['pipe','pipe','pipe']});t.after(()=>{if(child.exitCode===null)child.kill();});
 const result=await new Promise((resolve,reject)=>{let text='';child.stdout.on('data',chunk=>{text+=chunk;if(text.includes('\n'))resolve(JSON.parse(text.trim()));});child.on('error',reject);child.on('exit',code=>{if(!text.includes('\n'))reject(new Error('Owner fixture exited before readiness: '+code));});});
 return {child,result,close:()=>new Promise(resolve=>{child.once('exit',resolve);child.stdin.write('release');})};
}

test('real child owners remain exclusive and foreign processes cannot finish their claims',async t=>{
 const dir=await workerDirectory(t),owner=await hold(t,dir,'held');assert.equal(owner.result.claimed,true);
 await writeFile(join(dir,'borrowed-lease.json'),JSON.stringify(owner.result.lease));assert.equal(JSON.parse((await run(dir,'finish-foreign','held')).stdout.trim()).rejected,true);
 const other=await hold(t,dir,'held');assert.equal(other.result.claimed,false);await other.close();await owner.close();
 const next=await hold(t,dir,'held');assert.equal(next.result.claimed,true);await next.close();
});

test('concurrent new processes recover a dead owner through one fenced successor',async t=>{
 const dir=await workerDirectory(t);await assert.rejects(run(dir,'claim-exit','dead'),error=>error.code===23);
 const contenders=await Promise.all(Array.from({length:4},()=>hold(t,dir,'dead')));assert.equal(contenders.filter(row=>row.result.claimed).length,1);
 for(const row of contenders)await row.close();
 const guard=JSON.parse(await readFile(join(dir,'final-result-fixture-2026-10-21-dead.json'),'utf8'));assert.equal(guard.state,'protocol_v2');
});

function batchSlate(id){
 const startTime='2026-10-20T19:00:00Z',game={id,league:'NBA',leagueKey:'nba',startTime,statusKey:'final',away:{name:'Away',abbr:'AW',score:1},home:{name:'Home',abbr:'HM',score:2}};
 const prediction={gameId:id,leagueKey:'nba',league:'NBA',startTime,startTimeLocal:'2:00 PM',index:1,matchup:'Away @ Home',predictionMode:'pregame',predictedSide:'home',predictedWinner:'Home',predictionConfidence:'65%',outcomeProbabilities:{away:35,home:65,draw:0},predictionCorrect:true,finalScore:'AW 1 - HM 2',actualWinner:'Home',evidenceQuality:'60%'};
 return {guildId:'transport',dateKey:'2026-10-20',games:[game],predictions:[prediction],newFinals:[{game,prediction}],finalReplies:{}};
}
for(const [mode,exit,sends,recovered] of [['batch-before-send',74,1,0],['batch-after-send',73,0,0],['batch-after-ack',75,0,1]]){
 test(`final batch recovers after ${mode} using claims, publisher and cache persistence`,async t=>{
  const dir=await workerDirectory(t);await writeFile(join(dir,'slate.json'),JSON.stringify(batchSlate(mode)));
  await assert.rejects(run(dir,mode),error=>error.code===exit);
  const result=JSON.parse((await run(dir,'batch-retry')).stdout.trim());assert.equal(result.failed,0);assert.equal(result.sends,sends);assert.equal(result.recovered,recovered);assert.equal(result.acknowledgements,1);
  assert.equal(JSON.parse(await readFile(join(dir,'fake-discord.json'),'utf8')).length,1);
  const repeat=JSON.parse((await run(dir,'batch-retry')).stdout.trim());assert.equal(repeat.sends,0);assert.equal(repeat.recovered,1);
 });
}


test('concurrent conflicting completions publish one immutable terminal acknowledgement',async()=>{
 const first=await claimFinalResult(...args('terminal-race'));
 const outcomes=await Promise.allSettled(['one','two'].map(messageId=>finishFinalResult(...args('terminal-race'),{messageId,channelId:'channel',owner:{pid:0},claimId:'wrong'},first.lease)));
 assert.equal(outcomes.filter(row=>row.status==='fulfilled').length,1);const result=(await claimFinalResult(...args('terminal-race'))).claim;
 assert.ok(['one','two'].includes(result.messageId));assert.equal(result.owner.pid,process.pid);assert.equal(result.claimId,first.claim.claimId);
 await assert.rejects(finishFinalResult(...args('terminal-race'),{messageId:'replacement',channelId:'channel'},first.lease));
 assert.equal((await claimFinalResult(...args('terminal-race'))).claim.messageId,result.messageId);
});
