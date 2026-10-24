import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {forecastIssuanceEvidence,recordPredictionJournal,readPredictionJournal} from '../src/predictionJournal.js';
import {auditSportsOperations} from '../src/operationalAudit.js';
const now=Date.parse('2026-03-03T18:00:00Z');
const game=()=>({id:'g',leagueKey:'nba',statusKey:'scheduled',startTime:'2026-03-04T18:00:00Z',away:{name:'A'},home:{name:'H'}});
const prediction=()=>({gameId:'g',leagueKey:'nba',predictionMode:'pregame',modelVersion:'fixture',startTime:game().startTime,predictionGeneratedAt:'2026-03-03T17:00:00Z',predictedSide:'home',outcomeProbabilities:{away:40,home:60}});
function issued(){return {type:'forecast',recordedAt:'2026-03-01T17:00:00Z',payload:{forecastId:'f',gameId:'g',league:'nba',horizon:'Daily',modelVersion:'fixture',lifecycleState:'ISSUED',recordEligibility:'observed_pregame',predictionGeneratedAt:'2026-03-01T16:59:00Z',startTime:'2026-03-01T18:00:00Z',selectedSide:'home',outcomePercentages:{away:40,home:60,draw:0}}};}
const result=(observedAt='2026-03-01T21:00:00Z')=>({type:'result',recordedAt:'2026-03-01T22:00:00Z',payload:{forecastId:'f',actualSide:'home',observedAt}});
const report=records=>auditSportsOperations(records,{asOf:now,minDriftGames:2});

test('generated clocks with missing zones, day precision or impossible dates cannot prove pregame issuance',()=>{
 for(const value of ['2026-03-03T01:00:00','2026-03-03','2026-02-30T17:00:00Z']){
  const p={...prediction(),predictionGeneratedAt:value};assert.equal(forecastIssuanceEvidence(p,game(),{},now).recordEligibility,'unverifiable_or_late_observation',value);
 }
});

test('unknown event timezone/date cannot be manufactured into a verified start',()=>{
 for(const value of ['2026-03-04T18:00:00','2026-03-04']){
  assert.equal(forecastIssuanceEvidence({...prediction(),startTime:value},{...game(),startTime:value},{},now).recordEligibility,'unverifiable_or_late_observation');
 }
});

test('explicit minute-precision source starts remain valid without weakening generated clock rules',()=>{
 const p={...prediction(),startTime:'2026-03-04T18:00Z'};
 assert.equal(forecastIssuanceEvidence(p,{...game(),startTime:p.startTime},{},now).recordEligibility,'observed_pregame');
});

test('invalid generated time remains an auditable unqualified journal observation',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'sports-clock-journal-'));t.after(()=>rm(dir,{recursive:true,force:true}));const file=join(dir,'journal.jsonl');
 await recordPredictionJournal({guildId:'fixture',dateKey:'2026-03-04',games:[game()],predictions:[{...prediction(),predictionGeneratedAt:'2026-03-03'}]},{file,now});
 const records=await readPredictionJournal(file);assert.equal(records.filter(row=>row.type==='forecast').length,0);assert.ok(records.some(row=>row.type==='unverifiable_observation'));
});

test('refresh attempt inputs require strict instants before any terminal record is appended',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'sports-clock-attempt-'));t.after(()=>rm(dir,{recursive:true,force:true}));const file=join(dir,'journal.jsonl');
 await assert.rejects(recordPredictionJournal({},{file,now,lifecycle:'refresh_attempt',refreshAttempt:{attemptedAt:'2026-03-03T01:00:00',completedAt:'2026-03-03T17:01:00Z',games:[{gameId:'g',status:'completed'}]}}),/Invalid refresh/);
 assert.equal((await readPredictionJournal(file)).length,0);
});

test('operational results observed before start or after their receipt do not clear pending outcomes',()=>{
 for(const value of ['2026-03-01T17:00:00Z','2026-03-01T23:00:00Z','2026-03-01T21:00:00']){
  const r=report([issued(),result(value)]);assert.equal(r.forecasts.missingResults,1);assert.equal(r.journalIntegrity.invalidResultChronology,1);
 }
});

test('malformed or inferred journal receipt clocks cannot clear operational pending results',()=>{
 const r=result();r.recordedAt='2026-03-01T22:00:00';const audit=report([issued(),r]);assert.equal(audit.forecasts.missingResults,1);assert.equal(audit.journalIntegrity.invalidRecordTimestamps,1);
});

test('delivery acknowledgement before the issued receipt is not counted as delivery',()=>{
 const ack={type:'forecast_lifecycle',recordedAt:'2026-03-01T16:59:00Z',payload:{forecastId:'f',state:'DELIVERED'}};
 const r=report([issued(),ack]);assert.equal(r.forecasts.delivered,0);assert.equal(r.journalIntegrity.invalidDeliveryChronology,1);
});

test('unverifiable event start stays unknown in operational overdue counts',()=>{
 const f=issued();f.payload.startTime='2026-03-01T18:00:00';const r=report([f]);assert.equal(r.forecasts.unknownStart,1);assert.equal(r.forecasts.overdueResults,0);
});

test('duplicate and contradictory forecast identities cannot inflate canonical operational counts',()=>{
 const f=issued(),same=report([f,structuredClone(f)]);assert.equal(same.forecasts.issued,1);assert.equal(same.forecasts.rawIssuedRecords,2);assert.equal(same.journalIntegrity.duplicateForecastRecords,1);
 const other=structuredClone(f);other.payload.outcomePercentages={away:10,home:90,draw:0};const r=report([f,other]);assert.equal(r.forecasts.issued,0);assert.equal(r.journalIntegrity.conflictingForecastRecords,2);
});

test('invalid duration assertions do not become measured scan latency',()=>{
 const attempt={type:'refresh_attempt',recordedAt:'2026-03-03T17:02:00Z',payload:{attemptedAt:'2026-03-03T17:00:00Z',completedAt:'2026-03-03T17:01:00Z',durationMs:'60000',games:[{gameId:'g',status:'completed'}]}};
 const r=report([attempt]);assert.equal(r.refreshes.averageDurationMs,null);assert.equal(r.refreshes.invalidDurationRecords,1);
});

test('valid explicit-zone chronology retains resolved and delivered state',()=>{
 const ack={type:'forecast_lifecycle',recordedAt:'2026-03-01T12:01:00-05:00',payload:{forecastId:'f',state:'DELIVERED'}};
 const r=report([issued(),ack,result()]);assert.equal(r.forecasts.delivered,1);assert.equal(r.forecasts.missingResults,0);assert.equal(r.calibrationMonitoring.cohorts[0].recent.games,1);
});


test('a later invalid result does not silently revive an earlier resolved label',()=>{
 const invalid={...result('2026-03-01T17:00:00Z'),recordedAt:'2026-03-02T00:00:00Z'};
 const blocked=report([issued(),result(),invalid]);assert.equal(blocked.forecasts.missingResults,1);assert.equal(blocked.calibrationMonitoring.cohorts.length,0);
 const repaired={...result(),recordedAt:'2026-03-02T01:00:00Z'};
 assert.equal(report([issued(),result(),invalid,repaired]).forecasts.missingResults,0);
});
