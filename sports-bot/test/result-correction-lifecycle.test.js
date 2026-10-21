import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {fakeDiscord} from '../test-support/discord-transport.mjs';
const directory=await mkdtemp(join(tmpdir(),'sports-correction-'));process.env.OMNIMOD_SPORTS_DATA_DIR=directory;
const {deliverFinalBatch}=await import('../src/finalDelivery.js');
const {postFinalResult,LOG_COLORS}=await import('../src/discordPublisher.js');
const {readFinalResultClaim}=await import('../src/storage.js');
const {finalResultKey}=await import('../src/finalResultIdentity.js');
const {pendingFinalDateKeys}=await import('../src/finalReconciliation.js');
const {mergeFinalReplies}=await import('../src/finalResultRevision.js');
test.after(()=>rm(directory,{recursive:true,force:true}));
const iso=value=>new Date(value).toISOString();
function slate(){
 const id=randomUUID(),observed=Date.now()-300000,startTime='2026-10-20T19:00:00Z';
 const game={id,leagueKey:'nba',league:'NBA',sportGroup:'Basketball',startTime,statusKey:'final',away:{name:'Away',abbr:'AW',score:1},home:{name:'Home',abbr:'HM',score:2},sourceMeta:{fetchedAt:iso(observed-1000),cacheState:'network'}};
 const prediction={gameId:id,index:1,leagueKey:'nba',league:'NBA',startTime,startTimeLocal:'2:00 PM',matchup:'Away @ Home',modelVersion:'correction-fixture',predictionGeneratedAt:'2026-10-20T18:00:00Z',predictionMode:'pregame',predictedSide:'home',predictedWinner:'Home',predictionConfidence:'65%',outcomeProbabilities:{away:35,home:65,draw:0},predictionCorrect:true,actualWinner:'Home',actualSide:'home',finalScore:'AW 1 - HM 2',resultObservedAt:iso(observed),evidenceQuality:'60%'};
 return {guildId:'transport',dateKey:'2026-10-20',generatedAt:prediction.predictionGeneratedAt,games:[game],predictions:[prediction],newFinals:[{game,prediction}],finalReplies:{}};
}
function changed(value,away=4,home=1,delta=60000){
 const copy=structuredClone(value),at=Date.parse(value.predictions[0].resultObservedAt)+delta;
 copy.games[0].away.score=away;copy.games[0].home.score=home;copy.games[0].sourceMeta={cacheState:'network',fetchedAt:iso(at-1000)};
 Object.assign(copy.predictions[0],{predictionCorrect:home>away,actualSide:home>away?'home':'away',actualWinner:home>away?'Home':'Away',finalScore:`AW ${away} - HM ${home}`,resultObservedAt:iso(at)});
 copy.newFinals=[{game:copy.games[0],prediction:copy.predictions[0]}];return copy;
}
async function service(t){const path=await mkdtemp(join(tmpdir(),'sports-correction-remote-'));t.after(()=>rm(path,{recursive:true,force:true}));return {...await fakeDiscord(path),path};}
const withReplies=(value,result)=>({...value,finalReplies:result.finalReplies});

test('score corrections edit the existing message and preserve its original pregame forecast',async t=>{
 const value=slate(),remote=await service(t),first=await deliverFinalBatch(remote.client,value);assert.equal(first.postedCount,1);
 const original=structuredClone(value.predictions[0]),next=changed(withReplies(value,first));next.predictions[0].predictedSide='away';next.predictions[0].predictedWinner='CHANGED PICK';next.predictions[0].predictionConfidence='99%';next.predictions[0].outcomeProbabilities={away:99,home:1,draw:0};
 const result=await deliverFinalBatch(remote.client,next);assert.equal(result.failures.length,0);assert.equal(result.correctedCount,1);assert.equal(remote.rows.length,1);assert.equal(remote.counters.edits,1);
 assert.equal(remote.rows[0].embeds[0].color,LOG_COLORS.danger);assert.match(remote.rows[0].embeds[0].description,/AW 4 - HM 1/);assert.match(remote.rows[0].embeds[0].description,/Home.*65%/);assert.doesNotMatch(remote.rows[0].embeds[0].description,/CHANGED PICK|99%/);
 const stored=await readFinalResultClaim(value.dateKey,value.guildId,finalResultKey(value,original));assert.equal(stored.generation,1);assert.equal(stored.frozenForecast.predictedSide,'home');assert.deepEqual(stored.frozenForecast.outcomeProbabilities,original.outcomeProbabilities);
 assert.equal(stored.messageId,remote.rows[0].id);assert.equal((await deliverFinalBatch(remote.client,withReplies(next,result))).recoveredCount,0);assert.equal(remote.counters.edits,1);
});

test('same-winner score changes still update the final result',async t=>{
 const value=slate(),remote=await service(t),first=await deliverFinalBatch(remote.client,value),next=changed(withReplies(value,first),1,3);
 assert.equal((await deliverFinalBatch(remote.client,next)).correctedCount,1);assert.equal(remote.rows[0].embeds[0].color,LOG_COLORS.success);assert.match(remote.rows[0].embeds[0].description,/AW 1 - HM 3/);
});

test('a newer reversion to an earlier score is a new revision, while an older correction cannot roll it back',async t=>{
 const value=slate(),remote=await service(t),first=await deliverFinalBatch(remote.client,value),b=changed(withReplies(value,first)),second=await deliverFinalBatch(remote.client,b),c=changed(withReplies(b,second),1,2),third=await deliverFinalBatch(remote.client,c);
 assert.equal(third.correctedCount,1);assert.equal(remote.counters.edits,2);assert.equal(remote.rows.length,1);assert.match(remote.rows[0].embeds[0].description,/AW 1 - HM 2/);
 assert.equal((await readFinalResultClaim(value.dateKey,value.guildId,finalResultKey(value,value.predictions[0]))).generation,2);
 const stale=await deliverFinalBatch(remote.client,{...b,finalReplies:third.finalReplies});assert.equal(stale.failures.length,1);assert.equal(remote.counters.edits,2);
});

test('stale, pre-baseline and future correction evidence cannot edit a posted result',async t=>{
 const value=slate(),remote=await service(t),first=await deliverFinalBatch(remote.client,value);
 for(const patch of [row=>row.games[0].manualResultEvidence={kind:'manual_result',eventIdentityVerified:false},row=>row.games[0].sourceMeta.cacheState='stale',row=>row.games[0].sourceMeta.fetchedAt=value.predictions[0].resultObservedAt,row=>row.predictions[0].resultObservedAt=iso(Date.now()+60000)]){
  const next=changed(withReplies(value,first));patch(next);const result=await deliverFinalBatch(remote.client,next);assert.equal(result.failures.length,1);
 }
 assert.equal(remote.counters.edits,0);assert.equal(remote.rows.length,1);
});

test('a missing original message cannot turn a correction into a new send',async t=>{
 const value=slate(),remote=await service(t),first=await deliverFinalBatch(remote.client,value);remote.rows.splice(0);
 const result=await deliverFinalBatch(remote.client,changed(withReplies(value,first)));assert.equal(result.failures.length,1);assert.equal(remote.counters.sends,1);assert.equal(remote.rows.length,0);
});

test('a denied edit remains pending and preserves the previously acknowledged result',async t=>{
 const value=slate(),remote=await service(t),first=await deliverFinalBatch(remote.client,value),key=finalResultKey(value,value.predictions[0]);
 const before=await readFinalResultClaim(value.dateKey,value.guildId,key),failing=await fakeDiscord(remote.path,{editFails:true});
 const result=await deliverFinalBatch(failing.client,changed(withReplies(value,first)));assert.equal(result.failures.length,1);assert.equal(failing.counters.sends,0);
 assert.equal((await readFinalResultClaim(value.dateKey,value.guildId,key)).resultDigest,before.resultDigest);
});

test('an edit timeout after acceptance is reconciled without another edit or send',async t=>{
 const value=slate(),remote=await service(t),first=await deliverFinalBatch(remote.client,value),next=changed(withReplies(value,first));
 const failing=await fakeDiscord(remote.path,{ambiguousEdit:true});assert.equal((await deliverFinalBatch(failing.client,next)).failures.length,1);assert.equal(failing.counters.edits,1);
 const retry=await fakeDiscord(remote.path),result=await deliverFinalBatch(retry.client,next);assert.equal(result.failures.length,0);assert.equal(retry.counters.edits,0);assert.equal(retry.counters.sends,0);assert.equal(retry.rows.length,1);
});

test('concurrent corrections share one event claim chain and an older cached reply cannot change the forecast',async t=>{
 const value=slate(),remote=await service(t),first=await deliverFinalBatch(remote.client,value),b=changed(withReplies(value,first)),c=changed(b,1,5);
 let ready,release;const reached=new Promise(resolve=>ready=resolve),pause=new Promise(resolve=>release=resolve);
 const running=deliverFinalBatch(remote.client,b,{post:async(...args)=>{ready();await pause;return postFinalResult(...args);}});await reached;
 assert.equal((await deliverFinalBatch(remote.client,c)).failures.length,1);release();const second=await running;assert.equal(second.failures.length,0);
 const third=await deliverFinalBatch(remote.client,c);assert.equal(third.correctedCount,1);assert.equal(remote.counters.edits,2);assert.match(remote.rows[0].embeds[0].description,/AW 1 - HM 5/);
});

test('acknowledged finals receive bounded hourly correction rechecks',()=>{
 const value=slate(),now=Date.parse('2026-10-21T06:00:00Z'),key=finalResultKey(value,value.predictions[0]);value.predictions[0].startTime='2026-10-20T23:00:00Z';value.games[0].startTime=value.predictions[0].startTime;
 const actualKey=finalResultKey(value,value.predictions[0]);value.finalReplies[actualKey]={eventKey:actualKey,messageId:'m',channelId:'c'};const caches=[{dateKey:value.dateKey,slate:value}];
 assert.deepEqual(pendingFinalDateKeys(caches,{today:'2026-10-21',now}),['2026-10-20']);value.lastFinalCorrectionCheckAt=iso(now);
 assert.deepEqual(pendingFinalDateKeys(caches,{today:'2026-10-21',now}),[]);assert.deepEqual(pendingFinalDateKeys(caches,{today:'2026-10-21',now:now+3600000}),['2026-10-20']);
 assert.deepEqual(pendingFinalDateKeys(caches,{today:'2026-10-22',now:Date.parse('2026-10-22T01:00:00Z')}),[]);assert.deepEqual(pendingFinalDateKeys(caches,{today:'2026-10-21',now:now+3600000,correctionHours:0}),[]);
 assert.notEqual(key,actualKey);
});

test('cache merge preserves a known newer claim generation',()=>{
 assert.equal(mergeFinalReplies({event:{claimGeneration:2,resultDigest:'new'}},{event:{claimGeneration:1,resultDigest:'old'}}).event.resultDigest,'new');
});

test('actual source refresh discovers a correction after acknowledgement and preserves the journal forecast',async t=>{
 const {refreshFinalGrades}=await import('../src/sportsData.js'),{recordPredictionJournal,readPredictionJournal}=await import('../src/predictionJournal.js');
 const value=slate(),remote=await service(t),scheduled={...structuredClone(value),games:[{...value.games[0],statusKey:'scheduled'}]};
 await recordPredictionJournal(scheduled,{now:Date.parse(value.generatedAt)});await recordPredictionJournal(value,{now:Date.parse(value.predictions[0].resultObservedAt),lifecycle:'results_only'});
 const first=await deliverFinalBatch(remote.client,value),original=(await readPredictionJournal()).find(row=>row.type==='forecast'&&row.payload.gameId===value.games[0].id);
 const oldFetch=globalThis.fetch;t.after(()=>globalThis.fetch=oldFetch);globalThis.fetch=async url=>{assert.match(String(url),/scoreboard/);return new Response(JSON.stringify({events:[{id:value.games[0].id,date:value.games[0].startTime,status:{type:{state:'post',completed:true,name:'STATUS_FINAL',description:'Final'}},competitions:[{competitors:[{homeAway:'away',score:'4',team:{id:'a',displayName:'Away',abbreviation:'AW'}},{homeAway:'home',score:'1',team:{id:'h',displayName:'Home',abbreviation:'HM'}}]}]}]}),{headers:{'content-type':'application/json'}});};
 const refreshed=await refreshFinalGrades(withReplies(value,first));assert.equal(refreshed.newFinals.length,1);const corrected=await deliverFinalBatch(remote.client,refreshed);assert.equal(corrected.correctedCount,1);assert.equal(remote.rows[0].embeds[0].color,LOG_COLORS.danger);
 const records=await readPredictionJournal();assert.deepEqual(records.find(row=>row.eventHash===original.eventHash),original);assert.equal(records.filter(row=>row.type==='result'&&row.payload.forecastId===original.payload.forecastId).length,2);
});

const worker=fileURLToPath(new URL('../test-support/final-claim-worker.mjs',import.meta.url));
test('a new process recovers an accepted correction edit without another edit or message',async t=>{
 const remote=await service(t),value=slate();await writeFile(join(remote.path,'empty.env'),'');
 const env={};for(const key of ['PATH','Path','SystemRoot','WINDIR','TEMP','TMP'])if(process.env[key])env[key]=process.env[key];
 const run=mode=>promisify(execFile)(process.execPath,[worker,remote.path,mode],{env,windowsHide:true,timeout:30000});
 await writeFile(join(remote.path,'slate.json'),JSON.stringify(value));await run('batch-retry');
 const cached=JSON.parse(await readFile(join(remote.path,'daily-transport-2026-10-20.json'),'utf8')),next=changed({...value,finalReplies:cached.finalReplies});await writeFile(join(remote.path,'slate.json'),JSON.stringify(next));
 await assert.rejects(run('batch-after-edit'),error=>error.code===76);const before=await readFile(join(remote.path,'fake-discord.json'),'utf8');
 const recovered=JSON.parse((await run('batch-retry')).stdout.trim());assert.equal(recovered.failed,0);assert.equal(recovered.sends,0);assert.equal(recovered.edits,0);assert.equal(await readFile(join(remote.path,'fake-discord.json'),'utf8'),before);assert.equal(JSON.parse(before).length,1);
});


test('a caller cannot mutate the outcome or forecast after the asynchronous delivery batch begins',async t=>{
 const value=slate(),remote=await service(t),running=deliverFinalBatch(remote.client,value);
 value.games[0].away.score=100;value.predictions[0].predictedWinner='MUTATED';value.predictions[0].outcomeProbabilities={away:99,home:1,draw:0};
 assert.equal((await running).failures.length,0);assert.match(remote.rows[0].embeds[0].description,/AW 1 - HM 2/);assert.match(remote.rows[0].embeds[0].description,/Home.*65%/);assert.doesNotMatch(remote.rows[0].embeds[0].description,/MUTATED|99%/);
});


test('delivery cannot attach an unrelated source ID without an explicit scoped upstream mapping',async t=>{
 const value=slate(),remote=await service(t);value.newFinals[0].game={...structuredClone(value.games[0]),id:'upstream-alias'};
 assert.equal((await deliverFinalBatch(remote.client,value)).failures.length,1);assert.equal(remote.counters.sends,0);
 value.games[0].upstreamEventId='upstream-alias';assert.equal((await deliverFinalBatch(remote.client,value)).failures.length,0);assert.equal(remote.counters.sends,1);
});
