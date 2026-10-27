import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {completeAndJournalPregameRefresh,completePregameRefreshAttempt} from '../src/pregameRefresh.js';
import {recordPredictionJournal,readPredictionJournal} from '../src/predictionJournal.js';
import {auditSportsOperations} from '../src/operationalAudit.js';
import {eventReference,scopedEventKey} from '../src/slateEventIdentity.js';
import {REFRESH_REASON_POLICY} from '../src/refreshReasonCodes.js';
const now=Date.parse('2099-02-01T18:00:00Z'),iso=delta=>new Date(now+delta).toISOString();
const codes=['build_failed','game_not_scheduled','start_or_completion_invalid','summary_not_revalidated',
 'summary_receipt_outside_attempt','pregame_forecast_not_verified','forecast_issuance_not_verified','journal_issuance_not_verified',
 'ambiguous_game_observations','game_identity_not_found','league_mismatch','scheduled_start_mismatch',
 'unique_event_forecast_not_verified','game_identity_not_verified','cache_event_changed_during_refresh','summary_source_identity_conflict'];
const slate=()=>({guildId:'refresh-evidence',dateKey:'2099-02-01',generatedAt:iso(-2000),
 games:[{id:'game',leagueKey:'nhl',statusKey:'scheduled',startTime:iso(3600000),away:{name:'Away',abbr:'AW'},home:{name:'Home',abbr:'HM'},
  autoEnrichment:{fetchedAt:iso(-2000),cacheState:'network'}}],
 predictions:[{gameId:'game',leagueKey:'nhl',startTime:iso(3600000),modelVersion:'refresh-evidence-fixture',
  predictionGeneratedAt:iso(-2000),predictionMode:'pregame',snapshotStage:'t-30',predictedSide:'home',
  outcomeProbabilities:{away:40,home:60,draw:0}}]});
async function file(t){const dir=await mkdtemp(join(tmpdir(),'sports-refresh-rejection-'));t.after(()=>rm(dir,{recursive:true,force:true}));return join(dir,'journal.jsonl');}
function attemptFixture(){
 const previous=slate(),rebuilt=slate();rebuilt.games[0].autoEnrichment.fetchedAt=iso(500);
 rebuilt.predictions[0].predictionGeneratedAt=iso(700);rebuilt.predictions[0].outcomeProbabilities={away:35,home:65,draw:0};
 return {previous,rebuilt,due:[{...eventReference(rebuilt.games[0]),dueWindows:[30]}]};
}

for(const code of ['cache_event_changed_during_refresh','summary_source_identity_conflict'])test('actual completion gate preserves '+code+' through journal and operational audit',async t=>{
 const path=await file(t),f=attemptFixture(),options={file:path};
 if(code==='cache_event_changed_during_refresh')options.cacheBlockedEventKeys=[scopedEventKey(eventReference(f.rebuilt.games[0]))];
 else f.rebuilt.games[0].autoEnrichment.sourceIdentity={status:'conflict',reason:'event_mismatch'};
 const result=await completeAndJournalPregameRefresh(f.previous,f.rebuilt,f.due,iso(0),iso(1000),options);
 assert.equal(result.completed.length,0);assert.ok(result.rejected[0].reasons.includes(code));
 assert.deepEqual(result.slate.predictions,f.previous.predictions);
 const rows=await readPredictionJournal(path),terminal=rows.find(row=>row.type==='refresh_attempt');
 assert.ok(terminal.payload.games[0].reasons.includes(code));
 assert.equal(rows.filter(row=>row.type==='forecast').length,0);
 assert.equal(auditSportsOperations(rows,{asOf:now+1000}).refreshes.rejectionReasons[code],1);
});

test('all documented reason codes survive the durable terminal record; raw provider text stays excluded',async t=>{
 const path=await file(t),reasons=[...codes,'RAW_PROVIDER_SECRET_TEXT',{message:'RAW_PROVIDER_SECRET_TEXT'},null,7];
 await recordPredictionJournal({guildId:'fixture'},{file:path,now,lifecycle:'refresh_attempt',refreshAttempt:{attemptedAt:iso(-1000),completedAt:iso(0),
  games:[{gameId:'g',status:'rejected',reasons}]}});
 const terminal=(await readPredictionJournal(path))[0];assert.deepEqual(terminal.payload.games[0].reasons,codes);
 assert.equal(terminal.payload.reasonPolicy,REFRESH_REASON_POLICY);assert.equal(terminal.payload.games[0].unrecognizedReasonCount,4);
 assert.equal((await readFile(path,'utf8')).includes('RAW_PROVIDER_SECRET_TEXT'),false);
 const report=auditSportsOperations([terminal],{asOf:now});
 assert.ok(codes.every(code=>report.refreshes.rejectionReasons[code]===1));
 assert.equal(report.refreshes.reasonEvidence.unrecognizedReasonsOmitted,4);
 assert.equal(report.refreshes.reasonEvidence.currentPolicyAttempts,1);
});

test('concurrent cache and source conflicts remain two distinct reasons without creating an issued forecast',async t=>{
 const path=await file(t),f=attemptFixture();f.rebuilt.games[0].autoEnrichment.sourceIdentity={status:'conflict'};
 await completeAndJournalPregameRefresh(f.previous,f.rebuilt,f.due,iso(0),iso(1000),{file:path,cacheBlockedEventKeys:[scopedEventKey(eventReference(f.rebuilt.games[0]))]});
 const rows=await readPredictionJournal(path),report=auditSportsOperations(rows,{asOf:now+1000});
 assert.equal(report.refreshes.gameOutcomes.rejected,1);
 assert.equal(report.refreshes.rejectionReasons.cache_event_changed_during_refresh,1);
 assert.equal(report.refreshes.rejectionReasons.summary_source_identity_conflict,1);
 assert.equal(report.forecasts.issued,0);
});

test('equivalent retry preserves original bytes and counts one terminal rejection',async t=>{
 const path=await file(t),f=attemptFixture();f.rebuilt.games[0].autoEnrichment.sourceIdentity={status:'conflict'};
 await completeAndJournalPregameRefresh(f.previous,f.rebuilt,f.due,iso(0),iso(1000),{file:path});const before=await readFile(path);
 await completeAndJournalPregameRefresh(f.previous,f.rebuilt,f.due,iso(0),iso(1000),{file:path});
 assert.deepEqual(await readFile(path),before);
 assert.equal(auditSportsOperations(await readPredictionJournal(path),{asOf:now+1000}).refreshes.rejectionReasons.summary_source_identity_conflict,1);
});

test('ESPN-independent provider metadata alone cannot bypass the existing fresh-summary acceptance rule',()=>{
 const f=attemptFixture();delete f.rebuilt.games[0].autoEnrichment;
 f.rebuilt.games[0].availabilityProviderEvidence={provider:'Example',fetchedAt:iso(500),acceptedObservations:2};
 const result=completePregameRefreshAttempt(f.previous,f.rebuilt,f.due,iso(0),iso(1000));
 assert.equal(result.completed.length,0);assert.ok(result.rejected[0].reasons.includes('summary_not_revalidated'));
 assert.deepEqual(result.slate.predictions,f.previous.predictions);
});

async function legacyRecord(path,reasons){
 const refreshAttempt={attemptedAt:iso(-1000),completedAt:iso(0),games:[{gameId:'g',status:'rejected',reasons}]};
 await recordPredictionJournal({guildId:'legacy'},{file:path,now,lifecycle:'refresh_attempt',refreshAttempt});
 const row=(await readPredictionJournal(path))[0];delete row.eventHash;delete row.payload.reasonPolicy;
 for(const game of row.payload.games)delete game.unrecognizedReasonCount;
 row.eventHash=createHash('sha256').update(JSON.stringify(row)).digest('hex');
 await writeFile(path,JSON.stringify(row)+'\n');return refreshAttempt;
}

test('identical legacy retry keeps original hash-chain bytes and unknown reason coverage',async t=>{
 const path=await file(t),refreshAttempt=await legacyRecord(path,['summary_not_revalidated']),before=await readFile(path);
 await recordPredictionJournal({guildId:'legacy'},{file:path,now,lifecycle:'refresh_attempt',refreshAttempt});
 assert.deepEqual(await readFile(path),before);
 const report=auditSportsOperations(await readPredictionJournal(path),{asOf:now});
 assert.equal(report.refreshes.reasonEvidence.legacyOrUnknownPolicyAttempts,1);assert.equal(report.refreshes.reasonEvidence.currentPolicyAttempts,0);
 assert.equal(report.refreshes.reasonEvidence.historicalCompletenessVerified,false);
});

test('previously lost causes cannot be silently backfilled into a legacy terminal record',async t=>{
 const path=await file(t),refreshAttempt=await legacyRecord(path,[]),before=await readFile(path);
 refreshAttempt.games[0].reasons=['summary_source_identity_conflict'];
 await assert.rejects(recordPredictionJournal({guildId:'legacy'},{file:path,now,lifecycle:'refresh_attempt',refreshAttempt}),/different terminal evidence/);
 assert.deepEqual(await readFile(path),before);
});

test('newly observed unknown cause counts cannot be hidden by a legacy retry',async t=>{
 const path=await file(t),refreshAttempt=await legacyRecord(path,[]),before=await readFile(path);
 refreshAttempt.games[0].reasons=['PRIVATE_UNKNOWN_CAUSE'];
 await assert.rejects(recordPredictionJournal({guildId:'legacy'},{file:path,now,lifecycle:'refresh_attempt',refreshAttempt}),/different terminal evidence/);
 assert.deepEqual(await readFile(path),before);
});

test('malformed reason containers fail without recording or echoing raw input',async t=>{
 const path=await file(t);
 await assert.rejects(recordPredictionJournal({},{file:path,now,lifecycle:'refresh_attempt',refreshAttempt:{
  attemptedAt:iso(-1000),completedAt:iso(0),games:[{gameId:'g',status:'rejected',reasons:{message:'PRIVATE_UNKNOWN_CAUSE'}}]}}),
  error=>error.message==='Invalid structured refresh rejection reasons');
 await assert.rejects(readFile(path),{code:'ENOENT'});
});

test('operational reason evidence flags invalid counters without numeric coercion',()=>{
 const payload={reasonPolicy:REFRESH_REASON_POLICY,attemptedAt:iso(-1000),completedAt:iso(0),durationMs:1000,
  games:[{gameId:'g',status:'rejected',reasons:[],unrecognizedReasonCount:'4'}]};
 const report=auditSportsOperations([{type:'refresh_attempt',recordedAt:iso(0),payload}],{asOf:now});
 assert.equal(report.refreshes.reasonEvidence.invalidOmissionCounters,1);
 assert.equal(report.refreshes.reasonEvidence.unrecognizedReasonsOmitted,0);
});
