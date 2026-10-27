import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {auditCaptureAvailability} from '../scripts/audit-capture-availability.mjs';
import {applyAvailabilitySnapshot} from '../src/availabilityProvider.js';
import {buildEvidenceCoverage} from '../src/evidenceCoverage.js';
const now=Date.parse('2099-02-01T18:00:00Z');
const game=()=>({id:'nhl-2098020001',leagueKey:'nhl',sportGroup:'Hockey',statusKey:'scheduled',startTime:'2099-02-02T18:00:00Z',away:{name:'Away',abbr:'AAA'},home:{name:'Home',abbr:'HHH'}});
function fixture(){
 const g=game();return {schema:'sports-isolated-capture-v1',slate:{games:[g],predictions:[{gameId:g.id,leagueKey:'nhl',evidenceCoverage:buildEvidenceCoverage(g,{now})}]}};
}
function audit(value){const bytes=Buffer.from(JSON.stringify(value));return auditCaptureAvailability(bytes,{expectedSHA256:createHash('sha256').update(bytes).digest('hex')});}

test('unknown inputs and legacy unrecorded coverage remain distinct from zero injuries',()=>{
 const capture=fixture(),report=audit(capture);
 assert.equal(report.leagues.nhl.unknownInjuryCoverageSides,2);assert.equal(report.leagues.nhl.confirmedCriticalRoleSides,0);
 delete capture.slate.predictions[0].evidenceCoverage;
 const legacy=audit(capture);assert.equal(legacy.leagues.nhl.coverageNotRecorded,1);assert.equal(legacy.rows[0].sides,null);
});

test('native season candidates do not become event starters or medical coverage',()=>{
 const capture=fixture();capture.slate.predictions[0].evidenceCoverage.goalieResearch={status:'season_context_only',candidatesBySide:{away:2,home:2}};
 const report=audit(capture);assert.equal(report.leagues.nhl.seasonGoalieCandidateRows,4);
 assert.equal(report.leagues.nhl.confirmedCriticalRoleSides,0);assert.equal(report.leagues.nhl.unknownInjuryCoverageSides,2);
});

test('actual provider adapter and coverage contracts retain confirmation separately from team health',()=>{
 const capture=fixture(),g=capture.slate.games[0];
 const result=applyAvailabilitySnapshot([g],{schema:'sports-player-availability-v1',provider:'Example',sourceReference:'https://example.com/report',
  observedAt:'2099-02-01T17:59:00Z',expiresAt:'2099-02-01T18:20:00Z',records:[{
   kind:'goalie_starter',eventId:g.id,startTime:g.startTime,teamAbbr:'AAA',playerId:'123',playerIdNamespace:'nhl',name:'Goalie A'}]},{now});
 assert.equal(result.accepted,1);capture.slate.predictions[0].evidenceCoverage=buildEvidenceCoverage(g,{now});
 const report=audit(capture);assert.equal(report.leagues.nhl.confirmedCriticalRoleSides,1);
 assert.equal(report.leagues.nhl.unknownInjuryCoverageSides,2);assert.equal(report.rows[0].sides.away.criticalStarterStatus,'confirmed_record_present');
 assert.equal(report.leagues.nhl.preferredProviderGames,1);
});

test('conflicting confirmations are not counted as a confirmed usable role',()=>{
 const capture=fixture(),away=capture.slate.predictions[0].evidenceCoverage.sides.away;
 away.criticalConfirmedAssertions=2;away.criticalStarterStatus='conflicting_confirmed_records';
 assert.equal(audit(capture).leagues.nhl.confirmedCriticalRoleSides,0);
});

test('received team injury reports remain reports rather than clean health clearance',()=>{
 const capture=fixture(),away=capture.slate.predictions[0].evidenceCoverage.sides.away;
 away.injuryCoverage='team_report_received_not_a_clean_bill_of_health';away.injuryRecords=1;
 const report=audit(capture);assert.equal(report.leagues.nhl.unknownInjuryCoverageSides,1);
 assert.equal(report.leagues.nhl.injuryAssertionRows,1);assert.match(report.rows[0].sides.away.injuryCoverage,/not_a_clean_bill/);
});

test('failed requests, unverified mappings and cap omissions remain separate bottlenecks',()=>{
 for(const reason of ['provider_event_mapping_not_verified','provider_request_failed','request_cap_omission']){
  const capture=fixture();capture.slate.predictions[0].evidenceCoverage.summary.providerMapping.reason=reason;
  assert.equal(audit(capture).leagues.nhl.summaryMappingReasons[reason],1);
 }
});

test('absent or nonnumeric recorded counters stay unknown and cannot create coverage',()=>{
 const capture=fixture(),away=capture.slate.predictions[0].evidenceCoverage.sides.away;
 away.injuryRecords=null;away.criticalConfirmedAssertions='1';away.confirmedStarters=true;
 const report=audit(capture);assert.equal(report.rows[0].sides.away.injuryAssertionRows,null);
 assert.equal(report.leagues.nhl.sidesWithUnrecordedAssertionCounts,1);assert.equal(report.leagues.nhl.confirmedCriticalRoleSides,0);
});

test('mismatched event/league, duplicate games and post-start cutoffs fail closed',()=>{
 for(const mutation of [c=>c.slate.predictions[0].evidenceCoverage.gameId='other',c=>c.slate.predictions[0].leagueKey='other',
  c=>c.slate.games.push({...c.slate.games[0]}),c=>c.slate.predictions.push({...c.slate.predictions[0]}),
  c=>c.slate.predictions[0].evidenceCoverage.cutoffAt=c.slate.games[0].startTime]){
  const capture=fixture();mutation(capture);assert.throws(()=>audit(capture));
 }
});

test('explicit capture byte hash is required and no provider/trading dependency is invoked',()=>{
 const bytes=Buffer.from(JSON.stringify(fixture()));assert.throws(()=>auditCaptureAvailability(bytes));
 assert.throws(()=>auditCaptureAvailability(bytes,{expectedSHA256:'0'.repeat(64)}));
 const report=audit(fixture());assert.equal(report.providerRequests,0);assert.equal(report.liveOrders,false);assert.equal(report.discordPosts,0);
});
