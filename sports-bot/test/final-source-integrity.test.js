import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const directory=await mkdtemp(join(tmpdir(),'sports-final-source-'));process.env.OMNIMOD_SPORTS_DATA_DIR=directory;process.env.LOCAL_ONLY='false';
const {refreshFinalGrades}=await import('../src/sportsData.js');
const {recordPredictionJournal,readPredictionJournal}=await import('../src/predictionJournal.js');
const {journalResultState}=await import('../src/journalResults.js');
const {readFeatureWarehouse}=await import('../src/featureWarehouse.js');
const start='2026-10-20T19:00:00Z',issued='2026-10-20T18:00:00Z';
test.after(()=>rm(directory,{recursive:true,force:true}));
function slate(leagues=['nba','nhl']){
 const games=leagues.map(leagueKey=>({id:'same',leagueKey,league:leagueKey.toUpperCase(),startTime:start,statusKey:'scheduled',away:{name:'Away',abbr:'AW'},home:{name:'Home',abbr:'HM'}}));
 return {guildId:'final-source',dateKey:'2026-10-20',generatedAt:issued,games,predictions:games.map(game=>({gameId:game.id,leagueKey:game.leagueKey,startTime:start,modelVersion:'final-source-fixture',predictionGeneratedAt:issued,predictionMode:'pregame',predictedSide:'home',predictedWinner:'Home',outcomeProbabilities:{away:35,home:65,draw:0}})),finalReplies:{}};
}
function event(game,awayScore=1,homeScore=2){return {id:game.id,date:game.startTime,status:{type:{state:'post',completed:true,name:'STATUS_FINAL',description:'Final'}},competitions:[{competitors:[{homeAway:'away',score:String(awayScore),team:{id:'a',displayName:'Away',abbreviation:'AW'}},{homeAway:'home',score:String(homeScore),team:{id:'h',displayName:'Home',abbreviation:'HM'}}]}]};}
async function provider(t,rows){
 await rm(join(directory,'provider-cache'),{recursive:true,force:true});
 const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original;});let calls=0;
 globalThis.fetch=async url=>{assert.match(String(url),/site.api.espn.com.*scoreboard/);calls++;const league=String(url).includes('/hockey/')?'nhl':'nba';return new Response(JSON.stringify({events:rows[league]||[]}),{headers:{'content-type':'application/json'}});};
 return ()=>calls;
}

test('actual final refresh grades same-ID NBA and NHL games against their own scores',async t=>{
 const value=slate(),calls=await provider(t,{nba:[event(value.games[0],100,110)],nhl:[event(value.games[1],4,1)]});
 const frozen=structuredClone(value.predictions);const result=await refreshFinalGrades(value);assert.equal(calls(),2);
 assert.deepEqual(result.predictions.map(row=>row.predictionCorrect),[true,false]);assert.deepEqual(result.predictions.map(row=>row.finalScore),['AW 100 - HM 110','AW 4 - HM 1']);
 assert.equal(result.newFinals.length,2);assert.deepEqual(result.predictions.map(row=>row.outcomeProbabilities),frozen.map(row=>row.outcomeProbabilities));
});

test('actual final refresh does not reuse an ID or repeated team names across different starts',async t=>{
 const value=slate(['nba']),later={...value.games[0],startTime:'2026-10-20T22:00:00Z'},observations=[event(later)];await provider(t,{nba:observations});
 let result=await refreshFinalGrades(value);assert.equal(result.newFinals.length,0);assert.equal(typeof result.predictions[0].predictionCorrect,'undefined');
 later.id='different-id';observations[0]=event(later);await rm(join(directory,'provider-cache'),{recursive:true,force:true});result=await refreshFinalGrades(value);assert.equal(result.newFinals.length,0);
});

test('source ID changes can reconcile only the same league, start and ordered teams',async t=>{
 const value=slate(['nba']),alias={...value.games[0],id:'official-alias'};await provider(t,{nba:[event(alias,2,4)]});
 const result=await refreshFinalGrades(value);assert.equal(result.predictions[0].predictionCorrect,true);assert.equal(result.games[0].id,'same');assert.equal(result.games[0].upstreamEventId,'official-alias');assert.equal(result.predictions[0].predictionGeneratedAt,issued);
});

test('conflicting final observations quarantine the existing journal label instead of choosing the last score',async t=>{
 const value=slate(['nba']);value.guildId='final-conflict';const file=join(directory,'prediction-journal.jsonl');
 await recordPredictionJournal(value,{file,now:Date.parse(issued)});
 let observations=[event(value.games[0],1,2)];
 await provider(t,{nba:observations});let result=await refreshFinalGrades(value);assert.equal(result.predictions[0].predictionCorrect,true);
 const forecast=(await readPredictionJournal(file)).find(row=>row.type==='forecast'&&row.payload.guildId==='final-conflict');assert.ok(journalResultState(await readPredictionJournal(file)).eligible.has(forecast.payload.forecastId));
 observations.push(event(value.games[0],4,1));await rm(join(directory,'provider-cache'),{recursive:true,force:true});
 result=await refreshFinalGrades(result);assert.equal(result.predictions[0].predictionCorrect,null);assert.equal(result.newFinals.length,0);assert.equal(result.finalAssociationRejections[0].reason,'ambiguous_source_observations');
 assert.equal(journalResultState(await readPredictionJournal(file)).eligible.has(forecast.payload.forecastId),false);
 const rows=(await readFeatureWarehouse()).predictions.filter(row=>row.guildId==='final-conflict');assert.equal(rows.length,1);assert.ok(rows.every(row=>row.resultEvidenceStatus==='disputed'));
});
