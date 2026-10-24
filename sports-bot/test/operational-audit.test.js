import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
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
   horizon:'Daily',selectedSide:'home',guildId:'fixture',predictionGeneratedAt:issued,lifecycleState:'ISSUED',recordEligibility:'observed_pregame',outcomePercentages:{home:60,away:40,draw:0}}};
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

test('drift keeps versions/leagues distinct and does not count same-horizon guild duplicates as games',()=>{
 const records=[];
 for(const [i,days] of [9,10,2,3].entries()){
  const row=forecast('g'+i,days);records.push(row,result(row,days>7?'home':'away'));
  const duplicate=structuredClone(row);duplicate.payload.forecastId+='-later';duplicate.payload.guildId='other';duplicate.recordedAt=new Date(Date.parse(row.recordedAt)+1000).toISOString();
  records.push(duplicate,result(duplicate,days>7?'home':'away'));
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

const monitoring=records=>auditSportsOperations(records,{asOf:now,minDriftGames:2}).calibrationMonitoring;
function copyForecast(row,id){const copy=structuredClone(row);copy.payload.forecastId=id;copy.payload.guildId=id;return copy;}

test('conflicting outcomes across guild forecasts quarantine the game instead of choosing the first label',()=>{
 const a=forecast('conflict'),b=copyForecast(a,'other');b.recordedAt=new Date(Date.parse(a.recordedAt)+1000).toISOString();
 const records=[a,result(a,'home'),b,result(b,'away')],before=JSON.stringify(records),report=monitoring(records);
 assert.equal(report.cohorts.length,0);assert.equal(report.conflictingResultGames,1);assert.equal(report.exclusions.conflicting_game_results,1);
 assert.deepEqual(monitoring([...records].reverse()),report);assert.equal(JSON.stringify(records),before);
});

test('different forecast horizons remain separate calibration cohorts',()=>{
 const daily=forecast('horizon'),near=copyForecast(daily,'near');near.payload.horizon='T-10';
 near.recordedAt=new Date(Date.parse(daily.payload.startTime)-600000).toISOString();near.payload.predictionGeneratedAt=near.recordedAt;
 near.payload.outcomePercentages={home:80,away:20,draw:0};
 const report=monitoring([daily,result(daily),near,result(near)]);
 assert.equal(report.cohorts.length,2);assert.deepEqual(report.cohorts.map(row=>row.horizon),['daily','t-10']);
 assert.ok(report.cohorts.every(row=>row.recent.games===1&&row.status==='insufficient_games'));
});

test('equivalent offset timestamps and league casing cannot duplicate a monitored game',()=>{
 const a=forecast('alias'),b=copyForecast(a,'alias-copy');b.payload.league='NBA';b.payload.horizon='daily';b.payload.startTime='2026-10-18T13:00:00-05:00';
 b.recordedAt=new Date(Date.parse(a.recordedAt)+1000).toISOString();
 const report=monitoring([a,result(a),b,result(b)]);assert.equal(report.cohorts.length,1);assert.equal(report.cohorts[0].recent.games,1);
 assert.equal(report.cohorts[0].league,'nba');
});

test('tied maximum probabilities use the frozen selected side rather than object property order',()=>{
 const row=forecast('tie');row.payload.outcomePercentages={away:50,home:50,draw:0};row.payload.selectedSide='home';
 const score=monitoring([row,result(row,'home')]).cohorts[0].recent;
 assert.equal(score.calibrationGap,-.5);assert.equal(score.accuracy,1);assert.equal(score.brier,.5);
});

test('an actual draw assigned zero forecast probability is penalized rather than removed',()=>{
 const row=forecast('zero-draw');row.payload.league='mls';
 const report=monitoring([row,result(row,'draw')]);assert.equal(report.cohorts.length,1);
 const score=report.cohorts[0].recent;assert.equal(score.games,1);assert.ok(Math.abs(score.brier-1.52)<1e-12);
 assert.ok(Math.abs(score.logLoss+Math.log(1e-12))<1e-12);assert.equal(score.accuracy,0);
});

test('an unresolved first forecast is not replaced by a later resolved forecast',()=>{
 const first=forecast('pending'),later=copyForecast(first,'resolved');later.recordedAt=new Date(Date.parse(first.recordedAt)+1000).toISOString();
 const report=monitoring([first,later,result(later)]);assert.equal(report.cohorts.length,0);assert.equal(report.exclusions.unresolved,1);
 assert.equal(report.exclusions.later_same_horizon_record_not_selected,1);
});

test('identical duplicate forecast records have one game weight and an explicit duplicate count',()=>{
 const row=forecast('duplicate'),report=monitoring([row,structuredClone(row),result(row)]);
 assert.equal(report.cohorts[0].recent.games,1);assert.equal(report.exclusions.duplicate_forecast_record,1);
});

test('a reused forecast identity with different frozen probabilities is quarantined',()=>{
 const row=forecast('mutated'),changed=structuredClone(row);changed.payload.outcomePercentages={home:90,away:10,draw:0};
 const report=monitoring([row,changed,result(row)]);assert.equal(report.cohorts.length,0);assert.equal(report.exclusions.forecast_identity_conflict,2);
});

test('simultaneous conflicting forecasts cannot be selected by input order',()=>{
 const a=forecast('simultaneous'),b=copyForecast(a,'simultaneous-other');b.payload.outcomePercentages={home:90,away:10,draw:0};
 const records=[a,b,result(a),result(b)],report=monitoring(records);
 assert.equal(report.cohorts.length,0);assert.equal(report.exclusions.simultaneous_forecast_conflict,1);
 assert.deepEqual(monitoring([...records].reverse()),report);
});

test('missing horizon or selection, unknown outcomes and naive clocks cannot create drift scores',()=>{
 for(const mutate of [row=>delete row.payload.horizon,row=>delete row.payload.selectedSide,
  row=>row.payload.outcomePercentages.extra=1,row=>delete row.payload.outcomePercentages.draw,row=>row.payload.startTime='2026-10-18T18:00:00']){
  const row=forecast('invalid-monitor');mutate(row);assert.equal(monitoring([row,result(row)]).cohorts.length,0);
 }
});

test('an unresolved result dispute blocks another guild copy until explicitly reconciled',()=>{
 const disputed=forecast('disputed'),other=copyForecast(disputed,'other-result');
 other.recordedAt=new Date(Date.parse(disputed.recordedAt)-1000).toISOString();other.payload.predictionGeneratedAt=other.recordedAt;
 const records=[other,result(other),disputed,result(disputed),{type:'result_conflict',recordedAt:iso(-900),payload:{forecastId:disputed.payload.forecastId,conflictId:'conflict'}}];
 const report=monitoring(records);assert.equal(report.cohorts.length,0);assert.equal(report.disputedResultGames,1);
 assert.equal(report.exclusions.unresolved_game_result_dispute,1);
});

test('a frozen explicit binary outcome space permits structural zero without filling unknown legacy draws',()=>{
 const row=forecast('binary');row.payload.outcomePercentages.draw=null;
 const legacy=monitoring([row,result(row)]);assert.equal(legacy.cohorts.length,0);assert.equal(legacy.exclusions.modeled_outcome_space_unverified,1);
 row.payload.modeledOutcomes=['away','home'];
 const score=monitoring([row,result(row)]).cohorts[0].recent;assert.equal(score.games,1);assert.ok(Math.abs(score.brier-.32)<1e-12);
 assert.equal(row.payload.outcomePercentages.draw,null);
});

test('contradictory, incomplete and duplicate declared outcome spaces fail closed',()=>{
 for(const declared of [['away','home','home'],['home'],['away','home','other'],['away','home','draw']]){
  const row=forecast('bad-space');row.payload.outcomePercentages.draw=null;row.payload.modeledOutcomes=declared;
  assert.equal(monitoring([row,result(row)]).cohorts.length,0);
 }
 const row=forecast('contradiction');row.payload.modeledOutcomes=['away','home'];row.payload.outcomePercentages={away:30,home:60,draw:10};
 assert.equal(monitoring([row,result(row)]).cohorts.length,0);
});

test('the read-only CLI scores an actual issued-and-graded immutable journal without rewriting it',async t=>{
 const file=await fixture(t),row=forecast('journal-integration'),generated=row.payload.predictionGeneratedAt;
 const game={id:row.payload.gameId,leagueKey:'nba',startTime:row.payload.startTime,statusKey:'scheduled',away:{name:'Away',abbr:'AW'},home:{name:'Home',abbr:'HM'}};
 const prediction={gameId:game.id,leagueKey:'nba',startTime:game.startTime,predictionGeneratedAt:generated,predictionMode:'pregame',modelVersion:'integration',predictedSide:'home',outcomeProbabilities:{away:40,home:60}};
 const slate={guildId:'fixture',dateKey:'2026-10-18',generatedAt:generated,games:[game],predictions:[prediction]};
 await recordPredictionJournal(slate,{file,now:Date.parse(generated)});
 const graded=structuredClone(slate);graded.games[0].statusKey='final';graded.games[0].away.score=90;graded.games[0].home.score=100;
 graded.games[0].sourceMeta={provider:'fixture',cacheState:'network',fetchedAt:iso(-2000)};
 Object.assign(graded.predictions[0],{actualSide:'home',actualWinner:'Home',predictionCorrect:true,resultObservedAt:iso(-2000),finalScore:'AW 90 - HM 100'});
 await recordPredictionJournal(graded,{file,now:now-1000,lifecycle:'results_only'});
 const before=await readFile(file),records=await readPredictionJournal(file);assert.equal(records.filter(event=>event.type==='forecast').length,1);
 const frozen=records.find(event=>event.type==='forecast').payload;assert.deepEqual(frozen.modeledOutcomes,['away','home']);assert.equal(frozen.outcomePercentages.draw,null);
 const script=fileURLToPath(new URL('../scripts/audit-operations.js',import.meta.url));
 const {stdout}=await promisify(execFile)(process.execPath,[script,'--journal='+file,'--as-of='+iso(0)],{env:process.env,windowsHide:true});
 const report=JSON.parse(stdout);assert.equal(report.schema,'sports-operational-audit-v3');assert.equal(report.runtimeVerified,false);
 const cohort=report.calibrationMonitoring.cohorts[0];assert.equal(cohort.recent.games,1);assert.equal(cohort.recent.accuracy,1);assert.ok(Math.abs(cohort.recent.brier-.32)<1e-12);
 assert.equal(report.calibrationMonitoring.automaticAction,false);
 const early=JSON.parse((await promisify(execFile)(process.execPath,[script,'--journal='+file,'--as-of='+iso(-2000)],{env:process.env,windowsHide:true})).stdout);
 assert.equal(early.forecasts.missingResults,1);assert.equal(early.calibrationMonitoring.cohorts.length,0);
 for(const args of [['--as-of=2026-10-20T18:00:00'],['--as-of'],['--as-of='+iso(0),'--as-of='+iso(-2000)]])await assert.rejects(promisify(execFile)(process.execPath,[script,'--journal='+file,...args],{env:process.env,windowsHide:true}),error=>error.code===1&&error.stdout===''&&!error.stderr.includes('2026-10-20T18:00:00'));
 assert.deepEqual(await readFile(file),before);
});
