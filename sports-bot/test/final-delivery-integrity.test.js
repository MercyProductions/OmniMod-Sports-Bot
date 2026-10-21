import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {EmbedBuilder} from 'discord.js';
import {fakeDiscord} from '../test-support/discord-transport.mjs';
const directory=await mkdtemp(join(tmpdir(),'sports-final-delivery-'));process.env.OMNIMOD_SPORTS_DATA_DIR=directory;
const {postFinalResult}=await import('../src/discordPublisher.js');
const {deliverFinalBatch}=await import('../src/finalDelivery.js');
const {finalResultKey,finalReplyFor}=await import('../src/finalResultIdentity.js');
const {claimFinalResult,finishFinalResult}=await import('../src/storage.js');
const {pendingFinalDateKeys}=await import('../src/finalReconciliation.js');
test.after(()=>rm(directory,{recursive:true,force:true}));
function slate(){
 const startTime='2026-10-20T19:00:00Z',generatedAt='2026-10-20T18:00:00Z';
 const games=['nba','nhl'].map(leagueKey=>({id:'same',leagueKey,league:leagueKey.toUpperCase(),startTime,statusKey:'final',away:{name:'Away',abbr:'AW',score:1},home:{name:'Home',abbr:'HM',score:2}}));
 return {guildId:'transport',dateKey:'2026-10-20',generatedAt,games,finalReplies:{},predictions:games.map((game,i)=>({gameId:'same',leagueKey:game.leagueKey,league:game.league,startTime,startTimeLocal:'2:00 PM',index:i+1,matchup:game.league+' Away @ Home',modelVersion:'delivery-fixture',predictionMode:'pregame',predictionGeneratedAt:generatedAt,predictedSide:'home',predictedWinner:'Home',predictionConfidence:'65%',outcomeProbabilities:{away:35,home:65,draw:0},predictionCorrect:true,finalScore:'AW 1 - HM 2',actualWinner:'Home',evidenceQuality:'60%'}))};
}
async function remote(t,options={}){const path=await mkdtemp(join(tmpdir(),'sports-final-remote-'));t.after(()=>rm(path,{recursive:true,force:true}));return {...await fakeDiscord(path,options),path};}
const final=(value,i=0)=>({game:value.games[i],prediction:value.predictions[i]});

test('final identity separates native ID punctuation, league, start, guild and date',()=>{
 const value=slate(),key=finalResultKey(value,value.predictions[0]);assert.notEqual(key,finalResultKey(value,value.predictions[1]));
 const punctuationKeys=['a:b','ab'].map(id=>{const copy=structuredClone(value);copy.games[0].id=id;copy.predictions[0].gameId=id;return finalResultKey(copy,copy.predictions[0]);});assert.notEqual(punctuationKeys[0],punctuationKeys[1]);
 const copy=structuredClone(value);copy.games[0].startTime='2026-10-20T22:00:00Z';copy.predictions[0].startTime=copy.games[0].startTime;assert.notEqual(key,finalResultKey(copy,copy.predictions[0]));
 assert.notEqual(key,finalResultKey({...value,guildId:'other'},value.predictions[0]));assert.notEqual(key,finalResultKey({...value,dateKey:'2026-10-21'},value.predictions[0]));
 assert.throws(()=>finalResultKey({...value,games:[...value.games,{...value.games[0],statusKey:'postponed'}]},value.predictions[0]),/unique/);
});

test('final reply acknowledgement and reconciliation cannot borrow the other league or an unbound legacy entry',()=>{
 const value=slate(),nba=finalResultKey(value,value.predictions[0]);value.finalReplies.same={messageId:'old',channelId:'channel'};assert.equal(finalReplyFor(value,value.predictions[0]),null);
 value.finalReplies[nba]={eventKey:nba,messageId:'nba',channelId:'channel'};assert.equal(finalReplyFor(value,value.predictions[1]),null);
 assert.deepEqual(pendingFinalDateKeys([{dateKey:value.dateKey,slate:value}],{today:'2026-10-21',now:Date.parse('2026-10-21T06:00:00Z')}),['2026-10-20']);
 const nhl=finalResultKey(value,value.predictions[1]);value.finalReplies[nhl]={eventKey:nhl,messageId:'nhl',channelId:'channel'};
 assert.deepEqual(pendingFinalDateKeys([{dateKey:value.dateKey,slate:value}],{today:'2026-10-21',now:Date.parse('2026-10-21T06:00:00Z')}),[]);
});

test('persistent final claims and acknowledgements remain independent for scoped events',async()=>{
 const value=slate(),keys=value.predictions.map(row=>finalResultKey(value,row));
 assert.equal((await claimFinalResult(value.dateKey,'claims',keys[0])).claimed,true);assert.equal((await claimFinalResult(value.dateKey,'claims',keys[1])).claimed,true);
 await finishFinalResult(value.dateKey,'claims',keys[0],{eventKey:keys[0],messageId:'posted',channelId:'channel'});
 assert.equal((await claimFinalResult(value.dateKey,'claims',keys[0])).claim.state,'posted');assert.equal((await claimFinalResult(value.dateKey,'claims',keys[1])).claim.state,'claimed');
});

test('final posting writes distinct scoped footers and recovers each existing result independently',async t=>{
 const value=slate(),service=await remote(t);const a=await postFinalResult(service.client,value,final(value)),b=await postFinalResult(service.client,value,final(value,1));
 assert.notEqual(a.id,b.id);assert.equal(service.rows.length,2);assert.notEqual(service.rows[0].embeds[0].footer.text,service.rows[1].embeds[0].footer.text);
 assert.equal((await postFinalResult(service.client,value,final(value))).id,a.id);assert.equal((await postFinalResult(service.client,value,final(value,1))).id,b.id);assert.equal(service.rows.length,2);
});

test('unreadable history blocks final send rather than establishing absence',async t=>{
 const value=slate(),service=await remote(t,{historyFails:true});await assert.rejects(postFinalResult(service.client,value,final(value)),/history is incomplete/);assert.equal(service.counters.sends,0);
});

test('bounded history exhaustion blocks final send',async t=>{
 const value=slate(),service=await remote(t,{historyFull:true});await assert.rejects(postFinalResult(service.client,value,final(value)),/history is incomplete/);assert.equal(service.counters.sends,0);
});

test('an ambiguous legacy footer is not an acknowledgement or permission to create a replacement',async t=>{
 const value=slate(),service=await remote(t);await service.channel.send({embeds:[new EmbedBuilder().setTitle('Old result').setFooter({text:'OmniMod Sports result | 2026-10-20 | same'})]});
 await assert.rejects(postFinalResult(service.client,value,final(value)),/history is incomplete/);assert.equal(service.rows.length,1);
});

test('a uniquely scoped legacy result with league, start and reply evidence can be recovered',async t=>{
 const value=slate();value.games.pop();value.predictions.pop();const service=await remote(t),prediction=value.predictions[0];
 await service.channel.send({embeds:[new EmbedBuilder().setTitle(`Final result #${prediction.index}: ${prediction.matchup}`).setFooter({text:'OmniMod Sports result | 2026-10-20 | same'}).addFields({name:'League',value:'NBA'},{name:'Started',value:'2:00 PM'})]});
 assert.equal((await postFinalResult(service.client,value,final(value))).id,'message-1');assert.equal(service.rows.length,1);
});

test('a timeout after reply acceptance never triggers another send and retry recovers the accepted reply',async t=>{
 const value=slate(),service=await remote(t);const daily=await service.channel.send({embeds:[new EmbedBuilder().setTitle('Daily slate')]});value.messageId=daily.id;value.channelId='channel';
 const failing=await fakeDiscord(service.path,{ambiguousSend:true});await assert.rejects(postFinalResult(failing.client,value,final(value)),/timeout after server acceptance/);assert.equal(failing.counters.sends,1);assert.equal(failing.rows.length,2);
 const retry=await fakeDiscord(service.path);assert.equal((await postFinalResult(retry.client,value,final(value))).id,'message-2');assert.equal(retry.counters.sends,0);
});

test('uncertain daily-message access cannot cause a fallback final send',async t=>{
 const value=slate(),service=await remote(t,{messageFetchFails:true});value.messageId='daily';value.channelId='channel';
 await assert.rejects(postFinalResult(service.client,value,final(value)),/access is uncertain/);assert.equal(service.counters.sends,0);
});

test('a confirmed missing daily message can use the results channel after a complete history check',async t=>{
 const value=slate(),service=await remote(t);value.messageId='missing';value.channelId='channel';
 assert.equal((await postFinalResult(service.client,value,final(value))).id,'message-1');assert.equal(service.counters.sends,1);
});

test('new child processes recover a final after abrupt exit at remote acceptance without another send',async t=>{
 const service=await remote(t),value=slate();value.games.pop();value.predictions.pop();await writeFile(join(service.path,'slate.json'),JSON.stringify(value));await writeFile(join(service.path,'empty.env'),'');
 const env={};for(const key of ['PATH','Path','SystemRoot','WINDIR','TEMP','TMP'])if(process.env[key])env[key]=process.env[key];
 Object.assign(env,{NODE_ENV:'test',OMNIMOD_DISABLE_DATA_MIGRATION:'true',OMNIMOD_SPORTS_DATA_DIR:service.path,DOTENV_CONFIG_PATH:join(service.path,'empty.env'),DOTENV_CONFIG_QUIET:'true',POST_ON_START:'false',REGISTER_COMMANDS:'false'});
 const worker=fileURLToPath(new URL('../test-support/discord-transport.mjs',import.meta.url)),run=mode=>promisify(execFile)(process.execPath,[worker,service.path,mode],{env,timeout:30000,windowsHide:true});
 await assert.rejects(run('final-crash'),error=>error.code===73);const before=await readFile(join(service.path,'fake-discord.json'),'utf8');
 await run('final-retry');assert.equal(await readFile(join(service.path,'fake-discord.json'),'utf8'),before);assert.equal(JSON.parse(before).length,1);
});


test('legacy league and start evidence can recover one shared-ID event without suppressing another league',async t=>{
 const value=slate(),service=await remote(t),prediction=value.predictions[0];
 await service.channel.send({embeds:[new EmbedBuilder().setTitle(`Final result #${prediction.index}: ${prediction.matchup}`).setFooter({text:'OmniMod Sports result | 2026-10-20 | same'}).addFields({name:'League',value:'NBA'},{name:'Started',value:'2:00 PM'})]});
 assert.equal((await postFinalResult(service.client,value,final(value))).id,'message-1');assert.equal(service.rows.length,1);
 assert.equal((await postFinalResult(service.client,value,final(value,1))).id,'message-2');assert.equal(service.rows.length,2);
});


test('one final delivery failure remains pending without starving a healthy scoped event',async t=>{
 const value=slate(),service=await remote(t);for(const game of value.games)game.id='batch-partial';for(const row of value.predictions)row.gameId='batch-partial';value.newFinals=[final(value),final(value,1)];
 const result=await deliverFinalBatch(service.client,value,{post:async(client,slate,item)=>{if(item.prediction.leagueKey==='nba')throw new Error('Synthetic event-local reply failure');return postFinalResult(client,slate,item);}});
 assert.equal(result.postedCount,1);assert.equal(result.failures.length,1);assert.equal(finalReplyFor({...value,finalReplies:result.finalReplies},value.predictions[0]),null);assert.ok(finalReplyFor({...value,finalReplies:result.finalReplies},value.predictions[1]));
 const retry=await deliverFinalBatch(service.client,{...value,finalReplies:result.finalReplies});assert.equal(retry.postedCount,1);assert.equal(retry.failures.length,0);assert.equal(service.rows.length,2);
});

test('a posted durable claim restores a lost cache acknowledgement without another transport call',async t=>{
 const value=slate(),service=await remote(t);for(const game of value.games)game.id='batch-cache-recovery';for(const row of value.predictions)row.gameId='batch-cache-recovery';value.newFinals=[final(value)];
 assert.equal((await deliverFinalBatch(service.client,value)).postedCount,1);
 const result=await deliverFinalBatch(service.client,value,{post:async()=>{throw new Error('Transport must not be called');}});
 assert.equal(result.recoveredCount,1);assert.equal(result.failures.length,0);assert.ok(finalReplyFor({...value,finalReplies:result.finalReplies},value.predictions[0]));assert.equal(service.rows.length,1);
});
