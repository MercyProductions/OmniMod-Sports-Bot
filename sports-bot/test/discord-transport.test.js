import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {fakeDiscord} from '../test-support/discord-transport.mjs';
import {Collection} from 'discord.js';

const directory=await mkdtemp(join(tmpdir(),'sports-transport-'));
process.env.OMNIMOD_SPORTS_DATA_DIR=directory;
const {readDailyCache,writeDailyCache,dailyCachePath}=await import('../src/storage.js');
const {unlink}=await import('node:fs/promises');
test.beforeEach(async()=>{await unlink(dailyCachePath('2099-01-01','transport')).catch(error=>{if(error.code!=='ENOENT')throw error;});});
const {postDailySlate}=await import('../src/discordPublisher.js');
const {recordPredictionJournal,readPredictionJournal}=await import('../src/predictionJournal.js');
const {CURRENT_MODEL_VERSION}=await import('../src/modelIdentity.js');
const {completeAndJournalPregameRefresh}=await import('../src/pregameRefresh.js');
function slate(id){
 const now=Date.now(),generatedAt=new Date(now-1000).toISOString(),startTime=new Date(now+3600000).toISOString();
 return {guildId:'transport',dateKey:'2099-01-01',generatedAt,timezone:'America/Chicago',source:'Synthetic transport fixture',
  games:[{id,leagueKey:'nba',statusKey:'scheduled',startTime,away:{name:'Away'},home:{name:'Home'}}],
  predictions:[{gameId:id,index:1,league:'NBA',matchup:'Away @ Home',startTime,startTimeLocal:'Fixture time',
   modelVersion:CURRENT_MODEL_VERSION,predictionMode:'pregame',predictionGeneratedAt:generatedAt,
   predictedSide:'home',predictedWinner:'Home',outcomeProbabilities:{away:35,home:65,draw:0},recommendationStatus:'withheld'}]};
}
const delivered=rows=>rows.filter(row=>row.type==='forecast_lifecycle'&&row.payload.state==='DELIVERED');
async function remoteDirectory(t){const value=await mkdtemp(join(tmpdir(),'sports-fake-discord-'));t.after(()=>rm(value,{recursive:true,force:true}));return value;}
test.after(()=>rm(directory,{recursive:true,force:true}));

test('failed send leaves an issued forecast undelivered and successful retry acknowledges it once',async t=>{
 const path=await remoteDirectory(t),value=slate('send-failure');await recordPredictionJournal(value);
 const before=delivered(await readPredictionJournal()).length;
 await assert.rejects(postDailySlate((await fakeDiscord(path,{sendFails:true})).client,value),/Synthetic send/);
 assert.equal(delivered(await readPredictionJournal()).length,before);
 const remote=await fakeDiscord(path);const posted=await postDailySlate(remote.client,value);
 await postDailySlate(remote.client,posted);
 assert.equal(remote.rows.length,1);assert.equal(remote.counters.sends,1);
 assert.equal(delivered(await readPredictionJournal()).length,before+1);
});

test('failed cached-message edit cannot turn into a replacement send when history is unavailable',async t=>{
 const path=await remoteDirectory(t),value=slate('edit-failure');await recordPredictionJournal(value);
 const posted=await postDailySlate((await fakeDiscord(path)).client,value);
 const remote=await fakeDiscord(path,{editFails:true,historyFails:true});
 await assert.rejects(postDailySlate(remote.client,posted,{reuseExisting:false}));
 assert.equal(remote.rows.length,1);assert.equal(remote.counters.sends,0);
});

test('unreadable history cannot establish that no daily slate exists',async t=>{
 const path=await remoteDirectory(t),value=slate('history-failure');await recordPredictionJournal(value);
 const remote=await fakeDiscord(path,{historyFails:true});
 await assert.rejects(postDailySlate(remote.client,value));
 assert.equal(remote.rows.length,0);assert.equal(remote.counters.sends,0);
});

test('cached message permission failures do not become missing-message replacements',async t=>{
 const path=await remoteDirectory(t),value=slate('fetch-permission');await recordPredictionJournal(value);
 const posted=await postDailySlate((await fakeDiscord(path)).client,value);
 const remote=await fakeDiscord(path,{cachedFetchFails:true});
 await assert.rejects(postDailySlate(remote.client,posted,{reuseExisting:false}),/Cannot verify cached/);
 assert.equal(remote.counters.sends,0);assert.equal(remote.rows.length,1);
});

test('confirmed missing cached IDs recover through history and edit the existing post',async t=>{
 const path=await remoteDirectory(t),value=slate('missing-message');await recordPredictionJournal(value);
 const posted=await postDailySlate((await fakeDiscord(path)).client,value);
 const remote=await fakeDiscord(path);
 await postDailySlate(remote.client,{...posted,messageId:'deleted',channelId:'channel'},{reuseExisting:false});
 assert.equal(remote.counters.sends,0);assert.equal(remote.counters.edits,1);assert.equal(remote.rows.length,1);
});

test('bounded history exhaustion remains unknown rather than permission to send',async t=>{
 const path=await remoteDirectory(t),value=slate('full-history');
 const remote=await fakeDiscord(path,{historyFull:true});
 await assert.rejects(postDailySlate(remote.client,value),/Cannot verify daily slate history/);
 assert.equal(remote.counters.sends,0);
});

test('daily publication recovers an existing slate beyond the first 500 messages without sending a duplicate',async t=>{
 const path=await remoteDirectory(t),value=slate('deep-history-existing');
 const remote=await fakeDiscord(path);const posted=await postDailySlate(remote.client,value);
 const actual=await remote.channel.messages.fetch(posted.messageId);let pages=0;
 remote.channel.messages.fetch=async()=>{
  pages++;
  return pages<=5?new Collection(Array.from({length:100},(_,i)=>[`older-${pages}-${i}`,{id:`older-${pages}-${i}`,author:{id:'bot'},embeds:[]}]))
   :new Collection([[actual.id,actual]]);
 };
 const recovered=await postDailySlate(remote.client,{...posted,messageId:'',channelId:''});
 assert.equal(pages,6);assert.equal(recovered.messageId,posted.messageId);assert.equal(remote.counters.sends,1);
});

test('daily publication can establish absence in a complete history longer than 500 messages',async t=>{
 const path=await remoteDirectory(t),value=slate('deep-history-absent'),remote=await fakeDiscord(path);let pages=0;
 remote.channel.messages.fetch=async()=>{
  pages++;const count=pages<=5?100:78;
  return new Collection(Array.from({length:count},(_,i)=>[`older-${pages}-${i}`,{id:`older-${pages}-${i}`,author:{id:'bot'},embeds:[]} ]));
 };
 const posted=await postDailySlate(remote.client,value);
 assert.equal(pages,6);assert.ok(posted.messageId);assert.equal(remote.counters.sends,1);
});

test('non-advancing history cursors remain unknown and cannot authorize a send',async t=>{
 const path=await remoteDirectory(t),value=slate('history-cursor'),remote=await fakeDiscord(path,{historyFull:true});
 await assert.rejects(postDailySlate(remote.client,value),{code:'DAILY_HISTORY_CURSOR_INVALID'});
 assert.equal(remote.counters.sends,0);
});

test('advancing but incomplete history stops at its request budget without sending',async t=>{
 const path=await remoteDirectory(t),value=slate('history-budget'),remote=await fakeDiscord(path);let pages=0;
 remote.channel.messages.fetch=async()=>{
  pages++;return new Collection(Array.from({length:100},(_,i)=>[`older-${pages}-${i}`,{id:`older-${pages}-${i}`,author:{id:'bot'},embeds:[]} ]));
 };
 await assert.rejects(postDailySlate(remote.client,value),{code:'DAILY_HISTORY_LIMIT_REACHED'});
 assert.equal(pages,25);assert.equal(remote.counters.sends,0);
});

test('a later history permission failure cannot be mistaken for an empty last page',async t=>{
 const path=await remoteDirectory(t),value=slate('history-late-denial'),remote=await fakeDiscord(path);let pages=0;
 remote.channel.messages.fetch=async()=>{
  pages++;if(pages===6)throw Object.assign(Error('Synthetic history denied'),{code:50013});
  return new Collection(Array.from({length:100},(_,i)=>[`older-${pages}-${i}`,{id:`older-${pages}-${i}`,author:{id:'bot'},embeds:[]} ]));
 };
 await assert.rejects(postDailySlate(remote.client,value),{code:'DAILY_HISTORY_UNAVAILABLE'});
 assert.equal(pages,6);assert.equal(remote.counters.sends,0);
});

test('finding an older post does not acknowledge new forecast content that was never written',async t=>{
 const path=await remoteDirectory(t),old=slate('older-content'),fresh=slate('unwritten-content');
 await recordPredictionJournal(old);await postDailySlate((await fakeDiscord(path)).client,old);
 await recordPredictionJournal(fresh);
 const remote=await fakeDiscord(path);await postDailySlate(remote.client,{...fresh,cacheRevision:(await readDailyCache(fresh.dateKey,fresh.guildId)).cacheRevision});
 const rows=await readPredictionJournal(),id=rows.find(row=>row.type==='forecast'&&row.payload.gameId==='unwritten-content').payload.forecastId;
 assert.equal(delivered(rows).filter(row=>row.payload.forecastId===id).length,0);
 assert.equal(remote.counters.edits,0);assert.equal(remote.counters.sends,0);
});

test('only forecasts actually retained by the Discord character budget are acknowledged as delivered',async t=>{
 const path=await remoteDirectory(t),value=slate('large');
 const firstGame=value.games[0],firstPrediction=value.predictions[0];
 value.games=Array.from({length:26},(_,i)=>({...firstGame,id:`large-${i}`}));
 value.predictions=value.games.map((game,i)=>({...firstPrediction,gameId:game.id,index:i+1,
  abstentionReason:'Uncertain lineup and source observations. '.repeat(8)}));
 await recordPredictionJournal(value);
 const remote=await fakeDiscord(path);await postDailySlate(remote.client,value);
 const shown=remote.rows[0].embeds.flatMap(embed=>embed.fields||[]).length;
 assert.ok(shown>0&&shown<25);
 const rows=await readPredictionJournal();
 const ids=new Set(rows.filter(row=>row.type==='forecast'&&row.payload.gameId.startsWith('large-')).map(row=>row.payload.forecastId));
 assert.equal(delivered(rows).filter(row=>ids.has(row.payload.forecastId)).length,shown);
});

test('mixed targeted refresh publishes only accepted forecasts while rejected and unsolicited observations stay auditable',async t=>{
 const path=await remoteDirectory(t),value=slate('refresh-accepted');
 const began=Date.now()-5000,received=new Date(began+1000).toISOString(),generated=new Date(began+2000).toISOString();
 value.games[0].autoEnrichment={cacheState:'network',fetchedAt:received};
 value.predictions[0].predictionGeneratedAt=generated;
 value.games.push({...value.games[0],id:'refresh-rejected',autoEnrichment:{cacheState:'stale',fetchedAt:received}},
  {...value.games[0],id:'refresh-unsolicited'});
 value.predictions.push({...value.predictions[0],gameId:'refresh-rejected'},
  {...value.predictions[0],gameId:'refresh-unsolicited'});
 await recordPredictionJournal(value,{lifecycle:'provisional'});
 const result=await completeAndJournalPregameRefresh({guildId:'transport',games:[],predictions:[]},value,
  [{gameId:'refresh-accepted',dueWindows:[30]},{gameId:'refresh-rejected',dueWindows:[30]}],
  new Date(began).toISOString(),new Date().toISOString());
 assert.equal(result.completed.length,1);assert.equal(result.rejected.length,1);
 assert.deepEqual(result.slate.predictions.map(row=>row.gameId),['refresh-accepted']);
 const remote=await fakeDiscord(path);await postDailySlate(remote.client,result.slate,{reuseExisting:false});
 assert.equal(remote.rows[0].embeds.flatMap(embed=>embed.fields||[]).length,1);
 const rows=await readPredictionJournal(),observations=rows.filter(row=>row.type==='provisional_forecast'&&row.payload.gameId.startsWith('refresh-'));
 assert.equal(observations.length,3);
 const ids=new Set(observations.map(row=>row.payload.forecastId));
 assert.equal(rows.filter(row=>row.type==='forecast'&&ids.has(row.payload.forecastId)).length,1);
 assert.equal(delivered(rows).filter(row=>ids.has(row.payload.forecastId)).length,1);
});

test('abrupt exit after remote acceptance recovers in new processes without duplicating or changing the forecast',async t=>{
 const path=await remoteDirectory(t),value=slate('process-restart');await writeFile(join(path,'slate.json'),JSON.stringify(value));
 await writeFile(join(path,'empty.env'),'');
 const env={};for(const key of ['PATH','Path','SystemRoot','WINDIR','TEMP','TMP'])if(process.env[key])env[key]=process.env[key];
 Object.assign(env,{NODE_ENV:'test',OMNIMOD_DISABLE_DATA_MIGRATION:'true',OMNIMOD_SPORTS_DATA_DIR:path,
  DOTENV_CONFIG_PATH:join(path,'empty.env'),DOTENV_CONFIG_QUIET:'true',POST_ON_START:'false',REGISTER_COMMANDS:'false'});
 const worker=fileURLToPath(new URL('../test-support/discord-transport.mjs',import.meta.url));
 const run=mode=>promisify(execFile)(process.execPath,[worker,path,mode],{env,timeout:30000,windowsHide:true});
 await assert.rejects(run('crash'),error=>error.code===73);
 const file=join(path,'prediction-journal.jsonl'),before=await readPredictionJournal(file);
 assert.equal(before.filter(row=>row.type==='forecast').length,1);assert.equal(delivered(before).length,0);
 const frozen=before.find(row=>row.type==='forecast');
 await run('retry');await run('retry');
 const recovery=JSON.parse(await readFile(join(path,'daily-publication-claims','daily-transport-2099-01-01.json.claims','decision-0.json'),'utf8'));
 assert.equal(recovery.state,'recovered');assert.equal(recovery.recovery,'same_host_owner_pid_absent');
 const after=await readPredictionJournal(file);
 assert.equal(after.filter(row=>row.type==='forecast').length,1);assert.equal(delivered(after).length,1);
 assert.deepEqual(after.find(row=>row.type==='forecast'),frozen);
 assert.equal(JSON.parse(await readFile(join(path,'fake-discord.json'),'utf8')).length,1);
});


test('hidden ambiguous rows never receive a Discord forecast-delivery acknowledgement',async t=>{
 const path=await remoteDirectory(t),value=slate('ambiguous-delivery');value.predictions[0].leagueKey='nba';
 value.games.push({...structuredClone(value.games[0]),leagueKey:'nhl'});value.predictions.push({...structuredClone(value.predictions[0]),leagueKey:'nhl',league:'NHL',index:2});
 await recordPredictionJournal(value);const forecasts=(await readPredictionJournal()).filter(row=>row.type==='forecast'&&row.payload.gameId==='ambiguous-delivery');assert.equal(forecasts.length,2);
 value.games.push({...structuredClone(value.games[0]),statusKey:'postponed'});
 const remote=await fakeDiscord(path);await postDailySlate(remote.client,value,{reuseExisting:false});
 const acknowledgements=delivered(await readPredictionJournal());
 assert.equal(acknowledgements.some(row=>row.payload.forecastId===forecasts.find(row=>row.payload.league==='nba').payload.forecastId),false);
 assert.equal(acknowledgements.some(row=>row.payload.forecastId===forecasts.find(row=>row.payload.league==='nhl').payload.forecastId),true);
 assert.match(remote.rows[0].embeds[0].fields[0].value,/could not be matched uniquely/);
});


test('delivery accepted during a concurrent cache update is journaled without replacing newer state', async t => {
 const path=await remoteDirectory(t),value=slate('cache-conflict-delivery');
 await recordPredictionJournal(value);
 const cached=await writeDailyCache(value.dateKey,value,value.guildId);
 const remote=await fakeDiscord(path),send=remote.channel.send;
 let newer;
 remote.channel.send=async payload=>{
  const message=await send(payload);
  newer=await writeDailyCache(value.dateKey,{...cached,finalReplies:{other:{claimGeneration:2}}},value.guildId);
  return message;
 };
 await assert.rejects(postDailySlate(remote.client,cached),{code:'DAILY_CACHE_CONFLICT'});
 assert.deepEqual(await readDailyCache(value.dateKey,value.guildId),newer);
 const rows=await readPredictionJournal(),forecast=rows.find(row=>row.type==='forecast'&&row.payload.gameId==='cache-conflict-delivery');
 assert.equal(delivered(rows).filter(row=>row.payload.forecastId===forecast.payload.forecastId).length,1);
 assert.equal(remote.counters.sends,1);
});


test('an obsolete publisher cannot edit a newer remote payload before its cache save rejects',async t=>{
 const path=await remoteDirectory(t),value=slate('publication-old'),remote=await fakeDiscord(path);
 await recordPredictionJournal(value);
 const old=await postDailySlate(remote.client,value);
 const fresh={...old,predictions:[{...old.predictions[0],predictedWinner:'Away',predictedSide:'away',outcomeProbabilities:{away:70,home:30,draw:0}}]};
 await recordPredictionJournal(fresh);
 const latest=await writeDailyCache(fresh.dateKey,fresh,fresh.guildId);
 await postDailySlate(remote.client,latest,{reuseExisting:false});
 const content=JSON.stringify(remote.rows[0]),edits=remote.counters.edits;
 await assert.rejects(postDailySlate(remote.client,old,{reuseExisting:false}),{code:'DAILY_CACHE_CONFLICT'});
 assert.equal(JSON.stringify(remote.rows[0]),content);assert.equal(remote.counters.edits,edits);
});

test('competing publishers of the same revision cannot both send a new daily post',async t=>{
 const path=await remoteDirectory(t),value=slate('publication-race'),remote=await fakeDiscord(path);
 await recordPredictionJournal(value);
 const results=await Promise.allSettled([postDailySlate(remote.client,value),postDailySlate(remote.client,value)]);
 assert.equal(results.filter(row=>row.status==='fulfilled').length,1);
 assert.equal(results.filter(row=>row.status==='rejected'&&row.reason.code==='DAILY_CACHE_CONFLICT').length,1);
 assert.equal(remote.counters.sends,1);assert.equal(remote.rows.length,1);
});

test('a publisher delayed before ownership cannot overwrite a newer completed publication',async t=>{
 const path=await remoteDirectory(t),value=slate('publication-delayed'),remote=await fakeDiscord(path);
 const old=await writeDailyCache(value.dateKey,value,value.guildId);
 let entered,release;const waiting=new Promise(resolve=>{entered=resolve;}),gate=new Promise(resolve=>{release=resolve;});
 const fetch=remote.client.guilds.fetch;
 const delayedClient={...remote.client,guilds:{fetch:async(...args)=>{entered();await gate;return fetch(...args);}}};
 const pending=postDailySlate(delayedClient,old,{reuseExisting:false});
 const rejection=assert.rejects(pending,{code:'DAILY_CACHE_CONFLICT'});
 await waiting;
 try {
  const fresh=await writeDailyCache(value.dateKey,{...old,source:'New source observation'},value.guildId);
  await postDailySlate(remote.client,fresh,{reuseExisting:false});
 } finally {release();}
 await rejection;
 assert.equal(remote.counters.sends,1);assert.equal(remote.counters.edits,0);
 assert.equal((await readDailyCache(value.dateKey,value.guildId)).source,'New source observation');
});

test('publication freezes forecasts and transport options before asynchronous resource discovery',async t=>{
 const path=await remoteDirectory(t),value=slate('publication-frozen'),remote=await fakeDiscord(path),options={reuseExisting:false};
 await recordPredictionJournal(value);
 const original=await postDailySlate(remote.client,value);
 let entered,release;const waiting=new Promise(resolve=>{entered=resolve;}),gate=new Promise(resolve=>{release=resolve;});
 const fetch=remote.client.guilds.fetch;
 remote.client.guilds.fetch=async(...args)=>{entered();await gate;return fetch(...args);};
 const pending=postDailySlate(remote.client,original,options);
 await waiting;original.predictions[0].predictedWinner='Caller mutation';options.reuseExisting=true;release();
 const posted=await pending;
 assert.equal(posted.predictions[0].predictedWinner,'Home');
 assert.equal(remote.counters.edits,1);
 assert.doesNotMatch(JSON.stringify(remote.rows),/Caller mutation/);
});

test('a live publisher in another process blocks sends without stealing its ownership',async t=>{
 const path=await remoteDirectory(t),value=slate('publication-owner');await writeFile(join(path,'slate.json'),JSON.stringify(value));await writeFile(join(path,'empty.env'),'');
 const env={};for(const key of ['PATH','Path','SystemRoot','WINDIR','TEMP','TMP'])if(process.env[key])env[key]=process.env[key];
 Object.assign(env,{NODE_ENV:'test',OMNIMOD_DISABLE_DATA_MIGRATION:'true',OMNIMOD_SPORTS_DATA_DIR:directory,DOTENV_CONFIG_PATH:join(path,'empty.env'),DOTENV_CONFIG_QUIET:'true',POST_ON_START:'false',REGISTER_COMMANDS:'false'});
 const worker=fileURLToPath(new URL('../test-support/daily-publication-worker.mjs',import.meta.url));
 const child=spawn(process.execPath,[worker,path],{env,windowsHide:true,stdio:['pipe','pipe','pipe']});
 t.after(()=>{if(child.exitCode===null)child.kill();});
 const exited=new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>resolve(code));});
 await new Promise((resolve,reject)=>{
  const timeout=setTimeout(()=>reject(new Error('Publication worker readiness timed out')),10000);
  const ready=()=>{clearTimeout(timeout);resolve();};
  child.stdout.once('data',ready);
  child.once('error',error=>{clearTimeout(timeout);reject(error);});
  child.once('exit',()=>{clearTimeout(timeout);reject(new Error('Publication worker exited before readiness'));});
 });
 const remote=await fakeDiscord(path);
 await assert.rejects(postDailySlate(remote.client,value),{code:'DAILY_PUBLICATION_BUSY'});
 assert.equal(remote.counters.sends,0);assert.equal(remote.counters.edits,0);
 child.stdin.end('release\n');assert.equal(await exited,0);
 assert.equal(JSON.parse(await readFile(join(path,'fake-discord.json'),'utf8')).length,1);
});
