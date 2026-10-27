import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {applyAvailabilitySnapshot,applyAvailabilitySnapshotFile} from '../src/availabilityProvider.js';
import {predictGame} from '../src/predictionEngine.js';
import {completePregameRefreshAttempt,completeAndJournalPregameRefresh} from '../src/pregameRefresh.js';
import {recordPredictionJournal,readPredictionJournal} from '../src/predictionJournal.js';
import {eventReference,scopedEventKey} from '../src/slateEventIdentity.js';
import {auditSportsOperations} from '../src/operationalAudit.js';
const now=Date.parse('2099-02-01T18:00:00Z'),iso=delta=>new Date(now+delta).toISOString();
const makeGame=()=>({id:'nhl-2098020001',leagueKey:'nhl',league:'NHL',sportGroup:'Hockey',statusKey:'scheduled',startTime:iso(1800000),
 away:{name:'Away',abbr:'AAA'},home:{name:'Home',abbr:'HHH'}});
const snapshot=(change={})=>({schema:'sports-player-availability-v1',provider:'Example Provider',sourceReference:'https://example.com/report',
 observedAt:iso(-60000),expiresAt:iso(600000),records:[{kind:'goalie_projection',eventId:makeGame().id,startTime:makeGame().startTime,
 teamAbbr:'AAA',playerId:'123',playerIdNamespace:'nhl',name:'Goalie A'}],...change});
const prediction=(game,time)=>({...predictGame(game,1,{now:time,forecastHorizon:'T-30'}),predictionGeneratedAt:new Date(time).toISOString(),snapshotStage:'t-30'});
function fixture(payload=snapshot(),received=now+200){
 const old=makeGame(),g=makeGame(),previous={guildId:'snapshot-refresh',dateKey:'2099-02-01',games:[old],predictions:[prediction(old,now-300000)]};
 assert.equal(applyAvailabilitySnapshot([g],payload,{now:received}).accepted,1);
 return {previous,rebuilt:{...previous,games:[g],predictions:[prediction(g,now+700)]},due:[{...eventReference(g),dueWindows:[30]}]};
}
async function journalFile(t){const dir=await mkdtemp(join(tmpdir(),'sports-availability-refresh-'));t.after(()=>rm(dir,{recursive:true,force:true}));return join(dir,'journal.jsonl');}

test('a fresh event-bound snapshot actually selected by the predictor can complete a refresh without ESPN',async t=>{
 const f=fixture(),p=f.rebuilt.predictions[0],sources=p.evidenceCoverage.sides.away.modelInputs.players[0].availabilityProviderSources;
 assert.equal(sources[0].inputState,'current_bound_assertion');assert.equal(p.evidenceCoverage.sides.away.injuryCoverage,'unknown');
 assert.equal(p.evidenceCoverage.sides.away.confirmedStarters,0);
 const result=completePregameRefreshAttempt(f.previous,f.rebuilt,f.due,iso(0),iso(1000));
 assert.equal(result.completed.length,1);assert.equal(result.rejected.length,0);
 assert.equal(result.slate.predictions[0].predictionGeneratedAt,iso(700));
});

test('actual adapter/predictor/provisional journal path issues only after alternate-source validation',async t=>{
 const f=fixture(),file=await journalFile(t);
 await recordPredictionJournal(f.rebuilt,{file,now:now+800,lifecycle:'provisional'});
 assert.equal((await readPredictionJournal(file)).filter(row=>row.type==='forecast').length,0);
 const result=await completeAndJournalPregameRefresh(f.previous,f.rebuilt,f.due,iso(0),iso(1000),{file});
 assert.equal(result.completed.length,1);
 const rows=await readPredictionJournal(file),issued=rows.find(row=>row.type==='forecast'),terminal=rows.find(row=>row.type==='refresh_attempt');
 assert.equal(issued.payload.lifecycleState,'ISSUED');assert.equal(terminal.payload.games[0].status,'completed');
 const proof=terminal.payload.games[0].sourceAcceptanceEvidence;
 assert.equal(proof.forecastId,issued.payload.forecastId);assert.equal(proof.inputs[0].snapshotHash,
  issued.payload.evidenceCoverage.sides.away.modelInputs.players[0].availabilityProviderSources[0].snapshotHash);
 assert.equal(rows.some(row=>row.payload.state==='DELIVERED'),false);
 assert.equal(issued.payload.evidenceCoverage.sides.away.injuryCoverage,'unknown');
 assert.equal(issued.payload.evidenceCoverage.sides.away.confirmedStarters,0);
 assert.equal(auditSportsOperations(rows,{asOf:now+1000}).refreshes.sourceAcceptance.selectedSnapshotCompletions,1);
 const changed=structuredClone(rows);changed.find(row=>row.type==='refresh_attempt').payload.games[0].sourceAcceptanceEvidence.forecastId='f'.repeat(64);
 assert.equal(auditSportsOperations(changed,{asOf:now+1000}).refreshes.sourceAcceptance.invalidSnapshotAcceptanceProofs,1);
});

test('a newly reported injury can refresh a forecast without becoming team-wide medical coverage',()=>{
 const original=snapshot().records[0],f=fixture(snapshot({records:[{...original,kind:'injury',status:'out',role:'Goalie'}]}));
 const result=completePregameRefreshAttempt(f.previous,f.rebuilt,f.due,iso(0),iso(1000));
 assert.equal(result.completed.length,1);assert.equal(f.rebuilt.predictions[0].evidenceCoverage.sides.away.injuryCoverage,'unknown');
 assert.equal(f.rebuilt.predictions[0].evidenceCoverage.sides.away.modelInputs.players[0].availabilityObserved,true);
});

test('observations older than 15 minutes cannot provide alternate refresh authority',()=>{
 const f=fixture(snapshot({observedAt:iso(-16*60000)}));f.previous.predictions=[prediction(f.previous.games[0],now-30*60000)];
 const result=completePregameRefreshAttempt(f.previous,f.rebuilt,f.due,iso(0),iso(1000));
 assert.equal(result.completed.length,0);assert.ok(result.rejected[0].reasons.includes('availability_refresh_input_not_new_or_current'));
});

test('expiry between inference and completion rejects without replacing the earlier forecast',()=>{
 const f=fixture(snapshot({expiresAt:iso(900)}));
 const result=completePregameRefreshAttempt(f.previous,f.rebuilt,f.due,iso(0),iso(1000));
 assert.equal(result.completed.length,0);assert.deepEqual(result.slate.predictions,f.previous.predictions);
});

test('rereading an observation already older than the previous forecast is not a new input',()=>{
 const f=fixture();f.previous.predictions=[prediction(f.previous.games[0],now-30000)];
 assert.equal(completePregameRefreshAttempt(f.previous,f.rebuilt,f.due,iso(0),iso(1000)).completed.length,0);
});

test('receipt before the refresh attempt cannot provide its freshness authority',()=>{
 const f=fixture(snapshot(),now-200);
 assert.equal(completePregameRefreshAttempt(f.previous,f.rebuilt,f.due,iso(0),iso(1000)).completed.length,0);
});

test('new source data must be present in the actual selected prediction inputs',()=>{
 const f=fixture();f.rebuilt.predictions[0].evidenceCoverage.sides.away.modelInputs.players=[];
 const result=completePregameRefreshAttempt(f.previous,f.rebuilt,f.due,iso(0),iso(1000));
 assert.equal(result.completed.length,0);assert.ok(result.rejected[0].reasons.includes('availability_refresh_selected_input_not_verified'));
});

test('future, inconsistent or missing information cutoffs cannot authorize a refresh',()=>{
 for(const mutate of [p=>p.evidenceCoverage.cutoffAt=iso(800),p=>delete p.inputChronology,p=>p.inputChronology.cutoffAt=iso(600)]){
  const f=fixture();mutate(f.rebuilt.predictions[0]);
  assert.equal(completePregameRefreshAttempt(f.previous,f.rebuilt,f.due,iso(0),iso(1000)).completed.length,0);
 }
});

const originalRow=f=>f.rebuilt.games[0].autoPlayers[0].availabilitySourceRows?.[0]||f.rebuilt.games[0].autoPlayers[0];
test('changed event, side, native namespace or source receipt bindings reject',()=>{
 for(const mutate of [row=>row.availabilityEventIdentity.eventId='wrong',row=>row.availabilityEventIdentity.side='home',
  row=>row.availabilityEventIdentity.playerIdNamespace='espn',row=>row.updatedAt=iso(2000),row=>row.availabilitySnapshotHash='f'.repeat(64)]){
  const f=fixture();mutate(originalRow(f));
  assert.equal(completePregameRefreshAttempt(f.previous,f.rebuilt,f.due,iso(0),iso(1000)).completed.length,0);
 }
});

test('frozen selected-source event identities cannot borrow a valid raw input',()=>{
 const f=fixture();f.rebuilt.predictions[0].evidenceCoverage.sides.away.modelInputs.players[0].availabilityProviderSources[0].eventIdentity.playerId='999';
 assert.equal(completePregameRefreshAttempt(f.previous,f.rebuilt,f.due,iso(0),iso(1000)).completed.length,0);
});

test('changed teams or an unknown prior forecast time cannot establish refresh continuity',()=>{
 for(const mutate of [f=>f.previous.games[0].away.abbr='OTHER',f=>delete f.previous.predictions[0].predictionGeneratedAt]){
  const f=fixture();mutate(f);
  const result=completePregameRefreshAttempt(f.previous,f.rebuilt,f.due,iso(0),iso(1000));assert.equal(result.completed.length,0);
  assert.ok(result.rejected[0].reasons.includes('availability_refresh_previous_forecast_unverified'));
 }
});

test('cache and summary conflicts retain their veto over valid alternative data',()=>{
 for(const mode of ['cache','summary','journal']){
  const f=fixture(),key=scopedEventKey(eventReference(f.rebuilt.games[0])),options={};
  if(mode==='cache')options.cacheBlockedEventKeys=[key];
  if(mode==='journal')options.blockedEventKeys=[key];
  if(mode==='summary')f.rebuilt.games[0].autoEnrichment={sourceIdentity:{status:'conflict'}};
  const result=completePregameRefreshAttempt(f.previous,f.rebuilt,f.due,iso(0),iso(1000),options);
  assert.equal(result.completed.length,0);assert.deepEqual(result.slate.predictions,f.previous.predictions);
 }
});

test('rescheduled or started events cannot qualify through snapshots',()=>{
 for(const mutate of [g=>g.startTime=iso(3600000),g=>g.statusKey='live']){
  const f=fixture();mutate(f.rebuilt.games[0]);
  assert.equal(completePregameRefreshAttempt(f.previous,f.rebuilt,f.due,iso(0),iso(1000)).completed.length,0);
 }
});

test('prior journal rejection cannot be requalified by alternative input',async t=>{
 const f=fixture(),file=await journalFile(t);await recordPredictionJournal(f.rebuilt,{file,now:now+800,lifecycle:'rejected'});
 const result=await completeAndJournalPregameRefresh(f.previous,f.rebuilt,f.due,iso(0),iso(1000),{file});
 assert.equal(result.completed.length,0);const rows=await readPredictionJournal(file);
 assert.equal(rows.filter(row=>row.type==='forecast').length,0);
 assert.equal(rows.find(row=>row.type==='refresh_attempt').payload.games[0].sourceAcceptanceEvidence,undefined);
});

test('matching probabilities cannot hide different frozen provisional inputs at issuance',async t=>{
 const f=fixture(),file=await journalFile(t),old=structuredClone(f.rebuilt);
 old.predictions[0].evidenceCoverage.sides.away.modelInputs.players=[];
 await recordPredictionJournal(old,{file,now:now+800,lifecycle:'provisional'});
 const result=await completeAndJournalPregameRefresh(f.previous,f.rebuilt,f.due,iso(0),iso(1000),{file});
 assert.equal(result.completed.length,0);const rows=await readPredictionJournal(file);
 assert.equal(rows.filter(row=>row.type==='forecast').length,0);
 assert.ok(rows.some(row=>row.payload.reason==='availability_refresh_frozen_input_not_verified'));
 assert.equal(auditSportsOperations(rows,{asOf:now+1000}).refreshes.sourceAcceptance.rejectedFrozenInputProofs,1);
});

test('alternate-source retries preserve the same issued forecast and terminal proof bytes',async t=>{
 const f=fixture(),file=await journalFile(t);await completeAndJournalPregameRefresh(f.previous,f.rebuilt,f.due,iso(0),iso(1000),{file});
 const first=await readFile(file);await completeAndJournalPregameRefresh(f.previous,f.rebuilt,f.due,iso(0),iso(1000),{file});
 assert.deepEqual(await readFile(file),first);
});

test('JSON-reloaded inputs retain the actual receipt and binding evidence',()=>{
 const f=JSON.parse(JSON.stringify(fixture()));
 assert.equal(completePregameRefreshAttempt(f.previous,f.rebuilt,f.due,iso(0),iso(1000)).completed.length,1);
});

test('the configured file adapter flows into the same real predictor and refresh gate',async t=>{
 const file=await journalFile(t),input=join(file,'..','snapshot.json'),g=makeGame(),old=makeGame();await writeFile(input,JSON.stringify(snapshot()));
 assert.equal((await applyAvailabilitySnapshotFile([g],{file:input,now:now+200})).accepted,1);
 const previous={guildId:'file-refresh',dateKey:'2099-02-01',games:[old],predictions:[prediction(old,now-300000)]};
 const rebuilt={...previous,games:[g],predictions:[prediction(g,now+700)]};
 assert.equal(completePregameRefreshAttempt(previous,rebuilt,[{...eventReference(g),dueWindows:[30]}],iso(0),iso(1000)).completed.length,1);
});

test('the declared forecast horizon must match the refresh window',()=>{
 const f=fixture();f.rebuilt.predictions[0].horizon='Daily';
 const result=completePregameRefreshAttempt(f.previous,f.rebuilt,f.due,iso(0),iso(1000));
 assert.equal(result.completed.length,0);assert.ok(result.rejected[0].reasons.includes('availability_refresh_horizon_unverified'));
});

test('changing caller input during asynchronous issuance cannot replace the captured evidence',async t=>{
 const f=fixture(),file=await journalFile(t),operation=completeAndJournalPregameRefresh(f.previous,f.rebuilt,f.due,iso(0),iso(1000),{file});
 f.rebuilt.predictions[0].evidenceCoverage.sides.away.modelInputs.players=[];
 const result=await operation;assert.equal(result.completed.length,1);
 const issued=(await readPredictionJournal(file)).find(row=>row.type==='forecast');
 assert.equal(issued.payload.evidenceCoverage.sides.away.modelInputs.players.length,1);
});

test('persisted source proofs cannot reference an absent issued forecast',async t=>{
 const f=fixture(),file=await journalFile(t),proof=completePregameRefreshAttempt(f.previous,f.rebuilt,f.due,iso(0),iso(1000)).completed[0].sourceAcceptanceEvidence;
 await assert.rejects(recordPredictionJournal(f.rebuilt,{file,now:now+1000,lifecycle:'refresh_attempt',refreshAttempt:{
  attemptedAt:iso(0),completedAt:iso(1000),games:[{...eventReference(f.rebuilt.games[0]),status:'completed',
   sourceAcceptanceEvidence:{...proof,forecastId:'a'.repeat(64)}}]}}),/forecast binding unverified/);
 await assert.rejects(readFile(file),{code:'ENOENT'});
});

test('forged scope, clocks, horizon, duplicate inputs and forecast links reject without changing the journal',async t=>{
 const f=fixture(),file=await journalFile(t);await completeAndJournalPregameRefresh(f.previous,f.rebuilt,f.due,iso(0),iso(1000),{file});
 const before=await readFile(file),terminal=(await readPredictionJournal(file)).find(row=>row.type==='refresh_attempt').payload;
 for(const mutate of [p=>p.forecastId='f'.repeat(64),p=>p.horizon='T-10',p=>p.informationCutoffAt=iso(650),
  p=>p.inputs[0].eventBindingHash='f'.repeat(64),p=>p.inputs[0].receivedAt=iso(900),p=>p.inputs.push({...p.inputs[0]})]){
  const proof=structuredClone(terminal.games[0].sourceAcceptanceEvidence);mutate(proof);
  await assert.rejects(recordPredictionJournal(f.rebuilt,{file,now:now+1000,lifecycle:'refresh_attempt',refreshAttempt:{
   attemptedAt:terminal.attemptedAt,completedAt:terminal.completedAt,games:[{...terminal.games[0],sourceAcceptanceEvidence:proof}]}}));
  assert.deepEqual(await readFile(file),before);
 }
});

test('acceptance proof serialization discards extra raw text while preserving an identical retry',async t=>{
 const f=fixture(),file=await journalFile(t);await completeAndJournalPregameRefresh(f.previous,f.rebuilt,f.due,iso(0),iso(1000),{file});
 const before=await readFile(file),terminal=(await readPredictionJournal(file)).find(row=>row.type==='refresh_attempt').payload;
 const game=structuredClone(terminal.games[0]);game.sourceAcceptanceEvidence.rawError='PRIVATE_RAW_FIXTURE';
 game.sourceAcceptanceEvidence.inputs[0].providerKey='PRIVATE_RAW_FIXTURE';
 await recordPredictionJournal(f.rebuilt,{file,now:now+1000,lifecycle:'refresh_attempt',refreshAttempt:{
  attemptedAt:terminal.attemptedAt,completedAt:terminal.completedAt,games:[game]}});
 assert.deepEqual(await readFile(file),before);assert.equal((await readFile(file,'utf8')).includes('PRIVATE_RAW_FIXTURE'),false);
});

test('a mismatched acceptance request cannot silently skip validation and issue provider-only data',async t=>{
 const f=fixture(),file=await journalFile(t),proof=completePregameRefreshAttempt(f.previous,f.rebuilt,f.due,iso(0),iso(1000)).completed[0].sourceAcceptanceEvidence;
 const result=await recordPredictionJournal(f.rebuilt,{file,now:now+1000,lifecycle:'issued',refreshAcceptance:{
  attemptedAt:iso(0),completedAt:iso(1000),events:[{...eventReference(f.rebuilt.games[0]),gameId:'wrong',sourceAcceptanceEvidence:proof}]}});
 assert.equal(result.verifiedIssuedForecasts.length,0);assert.equal((await readPredictionJournal(file)).filter(row=>row.type==='forecast').length,0);
});
