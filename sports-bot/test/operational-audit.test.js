import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {recordPredictionJournal,readPredictionJournal} from '../src/predictionJournal.js';
import {completeAndJournalPregameRefresh,buildJournaledPregameRefresh} from '../src/pregameRefresh.js';
import {auditSportsOperations} from '../src/operationalAudit.js';
const now=Date.parse('2026-10-20T18:00:00Z');
const iso=delta=>new Date(now+delta).toISOString();
async function fixture(t){const dir=await mkdtemp(join(tmpdir(),'sports-ops-'));t.after(()=>rm(dir,{recursive:true,force:true}));return join(dir,'journal.jsonl');}
const due=[{gameId:'absent',dueWindows:[30]}];

test('refresh with no prediction preserves durable rejected-game evidence and deduplicates retries',async t=>{
  const file=await fixture(t),slate={guildId:'fixture',games:[],predictions:[]};
  await completeAndJournalPregameRefresh(slate,slate,due,iso(-1000),iso(0),{file});
  await completeAndJournalPregameRefresh(slate,slate,due,iso(-1000),iso(0),{file});
  const records=await readPredictionJournal(file),report=auditSportsOperations(records,{asOf:now});
  assert.equal(records.length,1);assert.equal(records[0].type,'refresh_attempt');
  assert.equal(report.refreshes.gameOutcomes.rejected,1);
  assert.equal(report.refreshes.rejectionReasons.pregame_forecast_not_verified,1);
  assert.equal(report.forecasts.issued,0);assert.equal(report.runtimeVerified,false);
});

test('failed provider build is recorded without persisting exception text or creating forecasts',async t=>{
  const file=await fixture(t),failure=new Error('SENSITIVE_FIXTURE_TEXT');
  await assert.rejects(buildJournaledPregameRefresh({guildId:'fixture'},due,iso(-1000),async()=>{throw failure;},{file,clock:()=>now}),error=>error===failure);
  const records=await readPredictionJournal(file);
  assert.equal(records.length,1);assert.equal(records[0].payload.games[0].status,'build_failed');
  assert.equal((await readFile(file,'utf8')).includes('SENSITIVE_FIXTURE_TEXT'),false);
});

test('terminal attempt identity rejects contradictory evidence and malformed chronology',async t=>{
  const file=await fixture(t),refreshAttempt={attemptedAt:iso(-1000),completedAt:iso(0),games:[{gameId:'g',status:'completed'}]};
  await recordPredictionJournal({},{file,now,lifecycle:'refresh_attempt',refreshAttempt});
  await assert.rejects(recordPredictionJournal({},{file,now,lifecycle:'refresh_attempt',refreshAttempt:{...refreshAttempt,games:[{gameId:'g',status:'rejected'}]}}),/different terminal/);
  await assert.rejects(recordPredictionJournal({},{file,now,lifecycle:'refresh_attempt',refreshAttempt:{...refreshAttempt,completedAt:iso(1000)}}),/Invalid refresh/);
  assert.equal((await readPredictionJournal(file)).length,1);
});

function forecast(id,daysAgo=2){
 const start=iso(-daysAgo*86400000),issued=iso(-daysAgo*86400000-3600000);
 return {type:'forecast',recordedAt:issued,payload:{forecastId:id,gameId:id,league:'nba',modelVersion:'fixture',startTime:start,
   predictionGeneratedAt:issued,lifecycleState:'ISSUED',recordEligibility:'observed_pregame',outcomePercentages:{home:60,away:40,draw:0}}};
}
function result(row,actualSide='home'){return {type:'result',recordedAt:iso(-1000),payload:{forecastId:row.payload.forecastId,actualSide,observedAt:iso(-2000)}};}

test('health report distinguishes overdue, unresolved, delivery unknown and absent coverage',()=>{
 const a=forecast('a'),b=forecast('b',0),future={type:'forecast_lifecycle',recordedAt:iso(1000),payload:{forecastId:'a',state:'DELIVERED'}};
 a.payload.evidenceCoverage={missing:['home:injury_coverage_unknown','summary:stale_cache'],summary:{underlyingFreshnessVerified:false}};
 const report=auditSportsOperations([a,b,future],{asOf:now});
 assert.equal(report.forecasts.missingResults,2);assert.equal(report.forecasts.overdueResults,1);
 assert.equal(report.forecasts.withoutDeliveryAcknowledgement,2);assert.equal(report.evidence.missingFrozenCoverage,1);
 assert.equal(report.evidence.missingReasons['home:injury_coverage_unknown'],1);
 assert.equal(report.refreshes.coverage,'unknown_no_attempt_records');
 assert.equal(report.refreshes.averageDurationMs,null);
});

test('drift keeps versions/leagues distinct and does not count guild or horizon duplicates as games',()=>{
 const records=[];
 for(const [i,days] of [9,10,2,3].entries()){
  const row=forecast('g'+i,days);records.push(row,result(row,days>7?'home':'away'));
  const duplicate=structuredClone(row);duplicate.payload.forecastId+='-later';duplicate.recordedAt=new Date(Date.parse(row.recordedAt)+1000).toISOString();
  records.push(duplicate,result(duplicate,'home'));
 }
 const report=auditSportsOperations(records,{asOf:now,minDriftGames:2});
 const drift=report.calibrationMonitoring.cohorts[0];
 assert.equal(drift.previous.games,2);assert.equal(drift.recent.games,2);
 assert.ok(drift.brierChange>0);assert.ok(drift.calibrationGapChange>0);
 assert.equal(drift.status,'descriptive_comparison_only');assert.equal(report.calibrationMonitoring.automaticAction,false);
 const unsupported=auditSportsOperations(records,{asOf:now,minDriftGames:30}).calibrationMonitoring.cohorts[0];
 assert.equal(unsupported.status,'insufficient_games');assert.equal(unsupported.brierChange,null);
});

test('future results cannot change an earlier operational report',()=>{
 const row=forecast('g'),outcome=result(row);outcome.recordedAt=iso(1000);
 const report=auditSportsOperations([row,outcome],{asOf:now});
 assert.equal(report.forecasts.missingResults,1);assert.equal(report.calibrationMonitoring.cohorts.length,0);
 assert.throws(()=>auditSportsOperations([],{overdueAfterHours:-1}),/Invalid operational/);
});


test('malformed frozen probabilities and result chronology cannot enter drift scores',()=>{
 for(const mutate of [row=>row.payload.outcomePercentages={home:100,away:null},
   row=>row.payload.outcomePercentages={home:100,away:false},
   row=>row.payload.predictionGeneratedAt=iso(1000)]){
  const row=forecast('bad');mutate(row);
  assert.equal(auditSportsOperations([row,result(row)],{asOf:now}).calibrationMonitoring.cohorts.length,0);
 }
 const row=forecast('bad-result'),outcome=result(row);outcome.payload.observedAt=iso(1000);
 assert.equal(auditSportsOperations([row,outcome],{asOf:now}).calibrationMonitoring.cohorts.length,0);
});
