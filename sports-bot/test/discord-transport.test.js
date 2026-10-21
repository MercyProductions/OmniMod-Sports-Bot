import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {fakeDiscord} from '../test-support/discord-transport.mjs';

const directory=await mkdtemp(join(tmpdir(),'sports-transport-'));
process.env.OMNIMOD_SPORTS_DATA_DIR=directory;
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
 const remote=await fakeDiscord(path);await postDailySlate(remote.client,value);
 await postDailySlate(remote.client,value);
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
 await postDailySlate((await fakeDiscord(path)).client,value);
 const remote=await fakeDiscord(path);
 await postDailySlate(remote.client,{...value,messageId:'deleted',channelId:'channel'},{reuseExisting:false});
 assert.equal(remote.counters.sends,0);assert.equal(remote.counters.edits,1);assert.equal(remote.rows.length,1);
});

test('bounded history exhaustion remains unknown rather than permission to send',async t=>{
 const path=await remoteDirectory(t),value=slate('full-history');
 const remote=await fakeDiscord(path,{historyFull:true});
 await assert.rejects(postDailySlate(remote.client,value),/Cannot verify daily slate history/);
 assert.equal(remote.counters.sends,0);
});

test('finding an older post does not acknowledge new forecast content that was never written',async t=>{
 const path=await remoteDirectory(t),old=slate('older-content'),fresh=slate('unwritten-content');
 await recordPredictionJournal(old);await postDailySlate((await fakeDiscord(path)).client,old);
 await recordPredictionJournal(fresh);
 const remote=await fakeDiscord(path);await postDailySlate(remote.client,fresh);
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
 const after=await readPredictionJournal(file);
 assert.equal(after.filter(row=>row.type==='forecast').length,1);assert.equal(delivered(after).length,1);
 assert.deepEqual(after.find(row=>row.type==='forecast'),frozen);
 assert.equal(JSON.parse(await readFile(join(path,'fake-discord.json'),'utf8')).length,1);
});
