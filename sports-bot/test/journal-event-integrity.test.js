import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {recordPredictionJournal,readPredictionJournal} from '../src/predictionJournal.js';
import {journalGameIndex,matchJournalGame} from '../src/journalEventMatch.js';
import {journalResultState} from '../src/journalResults.js';
import {summarizePredictionJournal} from '../src/journalEvaluation.js';
import {auditSportsOperations} from '../src/operationalAudit.js';
const now=Date.parse('2026-10-20T18:00:00Z'),iso=delta=>new Date(now+delta).toISOString();
function slate(league='nba'){
 const startTime=iso(3600000);
 return {guildId:'research',dateKey:'2026-10-20',generatedAt:iso(-1000),
 games:[{id:'shared',leagueKey:league,startTime,statusKey:'scheduled',away:{name:'Away',score:0},home:{name:'Home',score:0},sourceMeta:{fetchedAt:iso(-2000)}}],
 predictions:[{gameId:'shared',leagueKey:league,startTime,modelVersion:'test-model',predictionGeneratedAt:iso(-1000),predictionMode:'pregame',predictedSide:'home',predictionProbability:0.65,outcomeProbabilities:{away:35,home:65,draw:0},snapshotStage:'daily'}]};
}
async function fixture(t){const dir=await mkdtemp(join(tmpdir(),'sports-event-integrity-'));t.after(()=>rm(dir,{recursive:true,force:true}));return join(dir,'journal.jsonl');}
function final(value,at=14400000){const copy=structuredClone(value);copy.predictions=[];for(const game of copy.games){game.statusKey='final';game.home.score=100;game.away.score=90;game.sourceMeta.fetchedAt=iso(at-1000);}return copy;}

test('shared native IDs preserve independent league issuance, delivery and final results',async t=>{
 const file=await fixture(t),a=slate(),b=slate('nhl');a.games.push(...b.games);a.predictions.push(...b.predictions);
 const ack=await recordPredictionJournal(a,{file,now});assert.equal(ack.forecastRecords,2);assert.equal(ack.verifiedIssuedForecasts.length,2);
 await recordPredictionJournal({...a,messageId:'m',channelId:'c'},{file,now:now+100,lifecycle:'delivered'});
 const done=final(a);done.games[1].away.score=120;
 await recordPredictionJournal(done,{file,now:now+14400000,lifecycle:'results_only'});
 const records=await readPredictionJournal(file),forecasts=records.filter(row=>row.type==='forecast');
 const results=journalResultState(records).eligible;
 assert.equal(results.size,2);assert.equal(results.get(forecasts[0].payload.forecastId).payload.correct,true);assert.equal(results.get(forecasts[1].payload.forecastId).payload.correct,false);
 assert.equal(records.filter(row=>row.payload.state==='DELIVERED').length,2);
});

test('ambiguous unscoped observations remain auditable without anchoring a forecast; unique retry succeeds',async t=>{
 const file=await fixture(t),a=slate();delete a.predictions[0].leagueKey;a.games.push(...slate('nhl').games);
 let ack=await recordPredictionJournal(a,{file,now});assert.equal(ack.forecastRecords,0);assert.equal(ack.eventAssociationRejections,1);
 ack=await recordPredictionJournal(a,{file,now:now+100});assert.equal(ack.appended,0);
 a.games.pop();ack=await recordPredictionJournal(a,{file,now:now+200});assert.equal(ack.forecastRecords,1);
});

test('partial shared-ID acknowledgements cannot falsely attest all predictions',async t=>{
 const file=await fixture(t),a=slate(),b=slate('nhl');a.games.push(...b.games);a.predictions.push(...b.predictions);a.predictions[1].outcomeProbabilities.home=99;
 const ack=await recordPredictionJournal(a,{file,now});assert.equal(ack.verifiedIssuedForecasts.length,1);assert.deepEqual(ack.verifiedIssuedGameIds,[]);
});

test('known starts prevent cross-date grading and existing forecast ID reuse',async t=>{
 const file=await fixture(t),a=slate();a.predictions[0].horizon='Daily';await recordPredictionJournal(a,{file,now});
 const shifted=structuredClone(a);shifted.games[0].startTime=iso(86400000+3600000);shifted.predictions[0].startTime=shifted.games[0].startTime;
 const rejected=await recordPredictionJournal(shifted,{file,now:now+100});assert.equal(rejected.forecastRecords,0);
 await recordPredictionJournal(final(shifted),{file,now:now+2*86400000,lifecycle:'results_only'});
 const records=await readPredictionJournal(file);assert.equal(journalResultState(records).eligible.size,0);
 assert.ok(records.some(row=>row.payload.reason==='forecast_identity_start_conflict'));
 assert.ok(records.some(row=>row.payload.reason==='scheduled_start_mismatch'));
});

test('identical duplicates coalesce; contradictory scheduled payloads are rejected',async t=>{
 const file=await fixture(t),a=slate();a.games.push(structuredClone(a.games[0]));
 assert.equal((await recordPredictionJournal(a,{file,now})).forecastRecords,1);
 const b=slate();b.games.push({...structuredClone(b.games[0]),statusKey:'postponed'});
 const other=await fixture(t);assert.equal((await recordPredictionJournal(b,{file:other,now})).forecastRecords,0);
});

test('conflicting finals quarantine earlier accepted results until a fresh linked resolution',async t=>{
 const file=await fixture(t),a=slate();await recordPredictionJournal(a,{file,now});
 const done=final(a);await recordPredictionJournal(done,{file,now:now+14400000,lifecycle:'results_only'});
 const original=(await readPredictionJournal(file)).find(row=>row.type==='forecast');
 const contradictory=structuredClone(done);contradictory.games.push(structuredClone(done.games[0]));contradictory.games[1].away.score=120;
 let ack=await recordPredictionJournal(contradictory,{file,now:now+14401000,lifecycle:'results_only'});assert.equal(ack.resultConflicts,1);
 ack=await recordPredictionJournal(contradictory,{file,now:now+14402000,lifecycle:'results_only'});assert.equal(ack.appended,0);
 let records=await readPredictionJournal(file);assert.equal(journalResultState(records).eligible.size,0);
 assert.equal(summarizePredictionJournal(records).gradedForecasts,0);assert.equal(summarizePredictionJournal(records).disputedResults,1);
 assert.equal(auditSportsOperations(records,{asOf:now+14402000}).forecasts.missingResults,1);
 assert.equal(auditSportsOperations(records,{asOf:now+14400500}).forecasts.missingResults,0);
 await recordPredictionJournal(done,{file,now:now+14403000,lifecycle:'results_only'});assert.equal(journalResultState(await readPredictionJournal(file)).eligible.size,0);
 done.games[0].sourceMeta.fetchedAt=iso(14404000);
 ack=await recordPredictionJournal(done,{file,now:now+14405000,lifecycle:'results_only'});assert.equal(ack.resultRecords,1);
 records=await readPredictionJournal(file);const state=journalResultState(records);assert.equal(state.conflicts.size,0);assert.equal(state.eligible.size,1);
 const result=[...state.eligible.values()][0].payload;assert.ok(result.resolvesConflictId);assert.equal(result.revision,2);assert.equal(result.observedAt,iso(14405000));
 assert.deepEqual(records.find(row=>row.type==='forecast'),original);
});

test('conflicts without an earlier label cannot grade and stale or future receipts cannot resolve them',async t=>{
 const file=await fixture(t),a=slate();await recordPredictionJournal(a,{file,now});const done=final(a),bad=structuredClone(done);
 bad.games.push({...structuredClone(done.games[0]),away:{name:'Away',score:110}});
 await recordPredictionJournal(bad,{file,now:now+14400000,lifecycle:'results_only'});
 done.games[0].sourceMeta.fetchedAt=iso(15000000);await recordPredictionJournal(done,{file,now:now+14401000,lifecycle:'results_only'});
 assert.equal(journalResultState(await readPredictionJournal(file)).eligible.size,0);
});

test('result selector refuses unlinked readmission and scopes eligibility to supplied history',()=>{
 const event=(type,payload)=>({type,payload}),first=event('result',{forecastId:'x',actualSide:'home'}),conflict=event('result_conflict',{forecastId:'x',conflictId:'c'});
 const unrelated=event('result',{forecastId:'x',actualSide:'away',resolvesConflictId:'other'});
 assert.equal(journalResultState([first]).eligible.size,1);assert.equal(journalResultState([first,conflict,unrelated]).eligible.size,0);
 assert.equal(journalResultState([first,conflict,event('result',{forecastId:'x',actualSide:'away',resolvesConflictId:'c'})]).eligible.size,1);
 const game=slate().games[0];assert.equal(matchJournalGame(journalGameIndex([game]),{gameId:'shared',leagueKey:'nhl'}).reason,'league_mismatch');
});


test('quote observations link only the original event, generation and explicit horizon',async t=>{
 const file=await fixture(t),a=slate();a.predictions[0].horizon='T-30';await recordPredictionJournal(a,{file,now});
 const quote=structuredClone(a);Object.assign(quote.predictions[0],{horizon:undefined,snapshotStage:'quote-refresh',quoteRefreshOnly:true,originalForecastGeneratedAt:a.predictions[0].predictionGeneratedAt,originalForecastHorizon:'T-30',predictionGeneratedAt:iso(1000)});
 const ack=await recordPredictionJournal(quote,{file,now:now+1000,lifecycle:'prices_only'});assert.equal(ack.priceObservations,1);
 let records=await readPredictionJournal(file);assert.equal(records.find(row=>row.type==='price_observation').payload.sourceForecastId,records.find(row=>row.type==='forecast').payload.forecastId);
 quote.predictions[0].originalForecastHorizon='T-10';
 await recordPredictionJournal(quote,{file,now:now+2000,lifecycle:'prices_only'});
 records=await readPredictionJournal(file);assert.equal(records.filter(row=>row.type==='unlinked_price_observation').length,1);
 assert.equal(records.filter(row=>row.type==='forecast').length,1);
});
