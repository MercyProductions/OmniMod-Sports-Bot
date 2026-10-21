import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {duePregameRefreshes,markPregameRefreshes,nextPregameRefresh,completePregameRefreshAttempt,completeAndJournalPregameRefresh} from '../src/pregameRefresh.js';
import {eventReference,scopedEventKey} from '../src/slateEventIdentity.js';
import {readPredictionJournal} from '../src/predictionJournal.js';
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
