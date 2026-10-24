import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {persistPregameRefresh} from '../src/pregameCachePersistence.js';
import {readDailyCache,writeDailyCache,updateDailyCache} from '../src/storage.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {duePregameRefreshes,markPregameRefreshes,nextPregameRefresh,completePregameRefreshAttempt,completeAndJournalPregameRefresh} from '../src/pregameRefresh.js';
import {eventReference,scopedEventKey} from '../src/slateEventIdentity.js';
import {recordPredictionJournal,readPredictionJournal} from '../src/predictionJournal.js';
import {formatSlateEmbeds} from '../src/discordPublisher.js';
const now=Date.parse('2026-10-21T18:00:00Z'),iso=offset=>new Date(now+offset).toISOString();
function slate(){
 const games=['nba','nhl'].map((leagueKey,i)=>({id:'same',leagueKey,league:leagueKey.toUpperCase(),statusKey:'scheduled',startTime:iso(i?300000:1200000),away:{name:'Away',abbr:'AW',score:0},home:{name:'Home',abbr:'HM',score:0},autoEnrichment:{fetchedAt:iso(-1000),cacheState:'network'}}));
 return {guildId:'scoped-refresh',dateKey:'2026-10-21',generatedAt:iso(-2000),games,predictions:games.map((game,i)=>({...eventReference(game),index:i+1,league:game.league,matchup:game.league+' Away @ Home',startTimeLocal:'fixture',modelVersion:'test-model',predictionGeneratedAt:iso(-2000),predictionMode:'pregame',predictedSide:'home',predictedWinner:game.league+' Home',outcomeProbabilities:{away:40,home:60,draw:0},predictionConfidence:'60%'}))};
}
const rebuilt=value=>{const copy=structuredClone(value);for(const game of copy.games)game.autoEnrichment.fetchedAt=iso(500);for(const row of copy.predictions){row.predictionGeneratedAt=iso(700);row.outcomeProbabilities={away:30,home:70,draw:0};}return copy;};
async function file(t){const directory=await mkdtemp(join(tmpdir(),'sports-scoped-refresh-'));t.after(()=>rm(directory,{recursive:true,force:true}));return join(directory,'journal.jsonl');}

test('refresh scheduling and completion remain independent for shared IDs across leagues',()=>{
 const value=slate(),due=duePregameRefreshes(value,new Date(now));assert.equal(due.length,2);assert.deepEqual(due.map(row=>row.leagueKey),['nba','nhl']);
 const marked=markPregameRefreshes(value,[due[0]],iso(1000));const remaining=duePregameRefreshes(marked,new Date(now));assert.equal(remaining.length,1);assert.equal(remaining[0].leagueKey,'nhl');
 assert.equal(nextPregameRefresh(marked,new Date(now)).leagueKey,'nhl');
 assert.deepEqual(duePregameRefreshes(markPregameRefreshes(marked,remaining,iso(2000)),new Date(now)),[]);
});

test('completion never borrows another league summary or replaces its frozen forecast',()=>{
 const previous=slate(),fresh=rebuilt(previous),due=duePregameRefreshes(previous,new Date(now));fresh.games[1].autoEnrichment.cacheState='stale';
 const result=completePregameRefreshAttempt(previous,fresh,due,iso(0),iso(1000));assert.equal(result.completed.length,1);assert.equal(result.completed[0].leagueKey,'nba');
 assert.equal(result.rejected[0].leagueKey,'nhl');assert.deepEqual(result.slate.predictions[1],previous.predictions[1]);assert.equal(result.slate.predictions[0].outcomeProbabilities.home,70);
 assert.deepEqual(result.slate.games[1],previous.games[1]);
});

test('journal issuance and terminal diagnostics acknowledge only the accepted scoped event',async t=>{
 const previous=slate(),fresh=rebuilt(previous),due=duePregameRefreshes(previous,new Date(now));fresh.games[1].autoEnrichment.cacheState='stale';
 const path=await file(t),result=await completeAndJournalPregameRefresh(previous,fresh,due,iso(0),iso(1000),{file:path});
 assert.equal(result.completed.length,1);assert.equal(result.completed[0].leagueKey,'nba');
 const records=await readPredictionJournal(path),forecasts=records.filter(row=>row.type==='forecast');assert.equal(forecasts.length,1);assert.equal(forecasts[0].payload.league,'nba');
 const terminal=records.find(row=>row.type==='refresh_attempt').payload.games;assert.deepEqual(terminal.map(row=>[row.leagueKey,row.status]),[['nba','completed'],['nhl','rejected']]);
 assert.ok(terminal[1].reasons.includes('summary_not_revalidated'));
 assert.equal(duePregameRefreshes(result.slate,new Date(now))[0].leagueKey,'nhl');
});

test('an ambiguous legacy bare-ID refresh request cannot become an approved refresh',()=>{
 const previous=slate(),fresh=rebuilt(previous),result=completePregameRefreshAttempt(previous,fresh,[{gameId:'same',dueWindows:[30]}],iso(0),iso(1000));
 assert.equal(result.completed.length,0);assert.ok(result.rejected[0].reasons.includes('ambiguous_game_observations'));assert.deepEqual(result.slate.predictions,previous.predictions);
});

test('rescheduled events and unbound legacy window state are retried instead of inherited',()=>{
 const value=slate();value.games.pop();value.predictions.pop();const due=duePregameRefreshes(value,new Date(now));
 const marked=markPregameRefreshes(value,due,iso(-100));assert.equal(duePregameRefreshes(marked,new Date(now)).length,0);
 const changed=structuredClone(marked);changed.games[0].startTime=iso(600000);assert.equal(duePregameRefreshes(changed,new Date(now)).length,1);
 value.pregameRefreshes={same:{windows:{90:iso(-100),30:iso(-100),10:iso(-100)}}};assert.equal(duePregameRefreshes(value,new Date(now)).length,1);
 const fresh=rebuilt(value);fresh.games[0].startTime=iso(600000);fresh.predictions[0].startTime=iso(600000);
 const result=completePregameRefreshAttempt(value,fresh,due,iso(0),iso(1000));assert.equal(result.completed.length,0);assert.ok(result.rejected[0].reasons.includes('scheduled_start_mismatch'));
});

test('conflicting predictions and conflicting game observations cannot pass the refresh gate',()=>{
 for(const kind of ['predictions','games']){
  const previous=slate(),fresh=rebuilt(previous);fresh[kind].push({...structuredClone(fresh[kind][0]),...(kind==='predictions'?{outcomeProbabilities:{away:1,home:99,draw:0}}:{statusKey:'postponed'})});
  const result=completePregameRefreshAttempt(previous,fresh,duePregameRefreshes(previous,new Date(now)),iso(0),iso(1000));
  assert.equal(result.completed.length,1);assert.equal(result.completed[0].leagueKey,'nhl');assert.deepEqual(result.slate.predictions[0],previous.predictions[0]);
 }
});

test('Discord attaches each retrospective score to its own league and hides ambiguous forecasts',()=>{
 const value=slate();for(const [i,game] of value.games.entries()){game.statusKey='final';game.away.score=i?8:3;game.home.score=i?2:1;value.predictions[i].predictionMode='retrospective_ungraded';}
 const fields=formatSlateEmbeds(value)[0].toJSON().fields;assert.match(fields[0].value,/AW 3 - HM 1/);assert.match(fields[1].value,/AW 8 - HM 2/);
 const bad=slate();bad.games.push({...structuredClone(bad.games[0]),statusKey:'postponed'});bad.predictions[0].predictionConfidence='99.9%';
 const hidden=formatSlateEmbeds(bad)[0].toJSON().fields;assert.match(hidden[0].value,/could not be matched uniquely/);assert.doesNotMatch(hidden[0].value,/99.9%|Pick:/);assert.match(hidden[1].value,/NHL Home/);
 assert.notEqual(scopedEventKey(eventReference(bad.games[0])),scopedEventKey(eventReference(bad.games[1])));
});

async function cachedFixture(){const value=slate();value.guildId='pregame-'+randomUUID();return writeDailyCache(value.dateKey,value,value.guildId);}
const persist=(base,fresh,due,path,clock=()=>now+1000)=>persistPregameRefresh(base,fresh,due,iso(0),iso(800),{file:path,clock});

test('a targeted refresh preserves concurrent quotes and metadata while issuing only its scoped new forecasts',async t=>{
 const base=await cachedFixture(),fresh=rebuilt(base),due=duePregameRefreshes(base,new Date(now)),path=await file(t);
 await recordPredictionJournal(base,{file:path,now});
 const latest=structuredClone(base);latest.games[0].odds={price:'concurrent'};latest.messageId='new-message';latest.finalReplies={other:{claimGeneration:4}};
 await writeDailyCache(base.dateKey,latest,base.guildId);
 const result=await persist(base,fresh,due,path),saved=await readDailyCache(base.dateKey,base.guildId);
 assert.equal(result.completed.length,2);assert.equal(saved.games[0].odds.price,'concurrent');assert.equal(saved.messageId,'new-message');
 assert.equal(saved.finalReplies.other.claimGeneration,4);assert.equal(saved.pregameRefreshDeliveryPending,true);
 assert.deepEqual(saved.predictions.map(row=>row.outcomeProbabilities.home),[70,70]);
 const records=await readPredictionJournal(path),forecasts=records.filter(row=>row.type==='forecast');assert.equal(forecasts.length,4);
 assert.equal(forecasts.filter(row=>row.payload.outcomePercentages.home===60).length,2);
 assert.equal(saved.pregameCacheMergeAudit.appliedEvents,2);
});

test('a changed cache forecast is rejected before issuance while another league completes',async t=>{
 const base=await cachedFixture(),fresh=rebuilt(base),due=duePregameRefreshes(base,new Date(now)),path=await file(t),latest=structuredClone(base);
 latest.predictions[0].outcomeProbabilities.home=85;await writeDailyCache(base.dateKey,latest,base.guildId);
 const priorContract=await completeAndJournalPregameRefresh(latest,fresh,due,iso(0),iso(1000),{file:await file(t)});
 assert.equal(priorContract.completed.length,2);
 const result=await persist(base,fresh,due,path),records=await readPredictionJournal(path);
 assert.equal(result.completed.length,1);assert.equal(result.completed[0].leagueKey,'nhl');assert.equal(result.slate.predictions[0].outcomeProbabilities.home,85);
 assert.equal(result.slate.pregameCacheMergeAudit.rejected[0].reason,'cache_forecast_changed');
 assert.ok(result.rejected[0].reasons.includes('cache_event_changed_during_refresh'));
 assert.deepEqual(records.filter(row=>row.type==='forecast').map(row=>row.payload.league),['nhl']);
 assert.equal(duePregameRefreshes(result.slate,new Date(now)).length,1);
});

test('waiting until after kickoff cannot issue or complete the expired event',async t=>{
 const base=await cachedFixture(),fresh=rebuilt(base),path=await file(t);
 const result=await persist(base,fresh,duePregameRefreshes(base,new Date(now)),path,()=>now+400000);
 assert.equal(result.completed.length,1);assert.equal(result.completed[0].leagueKey,'nba');
 assert.ok(result.rejected[0].reasons.includes('start_or_completion_invalid'));
 const forecasts=(await readPredictionJournal(path)).filter(row=>row.type==='forecast');assert.equal(forecasts.length,1);assert.equal(forecasts[0].recordedAt,iso(400000));
});

test('queued refresh inputs are frozen and stale writers cannot enter between validation and save',async t=>{
 const base=await cachedFixture(),fresh=rebuilt(base),due=duePregameRefreshes(base,new Date(now)),path=await file(t);
 let entered,release;const ready=new Promise(resolve=>{entered=resolve;}),gate=new Promise(resolve=>{release=resolve;});
 const holding=updateDailyCache(base.dateKey,base.guildId,async current=>{entered();await gate;current.predictions[0].outcomeProbabilities.home=90;return current;});
 await ready;const pending=persist(base,fresh,due,path);
 const stale=assert.rejects(writeDailyCache(base.dateKey,{...base,messageId:'stale'},base.guildId),{code:'DAILY_CACHE_CONFLICT'});
 fresh.predictions[1].outcomeProbabilities.home=99;release();await holding;
 const result=await pending;await stale;
 assert.equal(result.slate.predictions[0].outcomeProbabilities.home,90);assert.equal(result.slate.predictions[1].outcomeProbabilities.home,70);
 assert.notEqual(result.slate.messageId,'stale');assert.equal(result.completed.length,1);
});

test('journal failure leaves the cache revision and refresh windows unchanged',async t=>{
 const base=await cachedFixture(),path=await file(t),blocked=path+'.block';await writeFile(blocked,'not a directory');
 await assert.rejects(persist(base,rebuilt(base),duePregameRefreshes(base,new Date(now)),join(blocked,'journal.jsonl')));
 assert.deepEqual(await readDailyCache(base.dateKey,base.guildId),base);
});

test('missing or foreign cache scope cannot create issued forecasts or restore a deleted cache',async t=>{
 const base=slate();base.guildId='missing-'+randomUUID();const path=await file(t);
 await assert.rejects(persist(base,rebuilt(base),duePregameRefreshes(base,new Date(now)),path),/disappeared/);
 assert.equal(await readDailyCache(base.dateKey,base.guildId),null);assert.equal((await readPredictionJournal(path)).length,0);
 const existing=await cachedFixture(),fresh=rebuilt(existing);fresh.guildId='foreign';
 await assert.rejects(persist(existing,fresh,duePregameRefreshes(existing,new Date(now)),path),/scope/);
 assert.deepEqual(await readDailyCache(existing.dateKey,existing.guildId),existing);
});

test('stale summaries and journal-rejected identities still cannot complete durable refresh windows',async t=>{
 for(const mode of ['stale','rejected']){
  const base=await cachedFixture(),fresh=rebuilt(base),path=await file(t);
  if(mode==='stale')fresh.games[1].autoEnrichment.cacheState='stale';
  else await recordPredictionJournal({...fresh,predictions:[fresh.predictions[1]]},{file:path,now:now+800,lifecycle:'rejected'});
  const result=await persist(base,fresh,duePregameRefreshes(base,new Date(now)),path);
  assert.equal(result.completed.length,1);assert.equal(result.completed[0].leagueKey,'nba');assert.equal(result.slate.predictions[1].outcomeProbabilities.home,60);
  assert.equal(duePregameRefreshes(result.slate,new Date(now)).length,1);
 }
});

test('an independently completed refresh window is not overwritten by an older fetch',async t=>{
 const base=await cachedFixture(),fresh=rebuilt(base),due=duePregameRefreshes(base,new Date(now)),path=await file(t);
 const latest=markPregameRefreshes(base,[due[0]],iso(-100));await writeDailyCache(base.dateKey,latest,base.guildId);
 const result=await persist(base,fresh,due,path);
 assert.equal(result.completed.length,1);assert.equal(result.completed[0].leagueKey,'nhl');
 assert.equal(result.slate.pregameCacheMergeAudit.rejected[0].reason,'cache_refresh_window_changed');
 assert.equal(result.slate.predictions[0].outcomeProbabilities.home,60);
});

test('invalid cache updater output cannot erase data and a failed updater releases its queue',async()=>{
 const base=await cachedFixture();
 await assert.rejects(updateDailyCache(base.dateKey,base.guildId,()=>null),/return a slate/);
 await assert.rejects(updateDailyCache(base.dateKey,base.guildId,current=>({...current,cacheRevision:99})),/changed the revision/);
 await assert.rejects(updateDailyCache(base.dateKey,base.guildId,current=>({...current,guildId:'foreign'})),/changed the scope/);
 assert.deepEqual(await readDailyCache(base.dateKey,base.guildId),base);
 const saved=await updateDailyCache(base.dateKey,base.guildId,current=>({...current,messageId:'after failure'}));
 assert.equal(saved.messageId,'after failure');assert.equal(saved.cacheRevision,base.cacheRevision+1);
});

test('a writer in another process cannot enter a held cache update transaction',async()=>{
 const base=await cachedFixture();let entered,release;
 const ready=new Promise(resolve=>{entered=resolve;}),gate=new Promise(resolve=>{release=resolve;});
 const held=updateDailyCache(base.dateKey,base.guildId,async current=>{entered();await gate;return {...current,messageId:'transaction-owner'};});
 await ready;
 try{
  const module=new URL('../src/storage.js',import.meta.url).href;
  const code=`import {writeDailyCache} from ${JSON.stringify(module)};try{await writeDailyCache(${JSON.stringify(base.dateKey)},${JSON.stringify(base)},${JSON.stringify(base.guildId)});process.exitCode=2;}catch(error){if(!error.message.includes('locked'))throw error;}`;
  await promisify(execFile)(process.execPath,['--input-type=module','-e',code],{env:process.env,windowsHide:true,timeout:10000});
 }finally{release();await held;}
 const saved=await readDailyCache(base.dateKey,base.guildId);assert.equal(saved.messageId,'transaction-owner');assert.equal(saved.cacheRevision,base.cacheRevision+1);
});
