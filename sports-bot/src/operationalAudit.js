import {journalResultState} from './journalResults.js';
import {operationalDrift} from './operationalDrift.js';
const epoch=value=>Date.parse(value||'');
const increment=(counts,key)=>{counts[key]=(counts[key]||0)+1;};

/** Read-only frozen evidence. This report is not a health attestation of an unreachable host. */
export function auditSportsOperations(records=[],{asOf=Date.now(),overdueAfterHours=24,windowDays=7,minDriftGames=30}={}){
  if(!Number.isFinite(asOf)||!Number.isFinite(overdueAfterHours)||overdueAfterHours<1
    ||!Number.isInteger(windowDays)||windowDays<1||!Number.isInteger(minDriftGames)||minDriftGames<2)throw new Error('Invalid operational audit bounds');
  const visible=records.filter(row=>Number.isFinite(epoch(row.recordedAt))&&epoch(row.recordedAt)<=asOf);
  const issued=visible.filter(row=>row.type==='forecast'&&row.payload.lifecycleState==='ISSUED'&&row.payload.recordEligibility==='observed_pregame');
  const resultState=journalResultState(visible);
  const results=new Map([...resultState.eligible].map(([id,event])=>[id,{...event.payload,resultRecordedAt:event.recordedAt}]));
  const delivered=new Set(visible.filter(row=>row.type==='forecast_lifecycle'&&row.payload.state==='DELIVERED').map(row=>row.payload.forecastId));
  const attempts=visible.filter(row=>row.type==='refresh_attempt'),statuses={},reasons={},coverage={},byLeague={};
  for(const {payload} of attempts)for(const game of payload.games||[]){increment(statuses,game.status);for(const reason of new Set(game.reasons||[]))increment(reasons,reason);}
  let unresolved=0,overdue=0,unknownStart=0,missingCoverage=0,unknownUnderlying=0;
  for(const {payload:row} of issued){
    const league=byLeague[row.league||'unknown'] ||= {issued:0,delivered:0,missingResults:0,overdueResults:0};
    league.issued++;if(delivered.has(row.forecastId))league.delivered++;
    if(!results.has(row.forecastId)){
      unresolved++;league.missingResults++;
      const start=epoch(row.startTime);
      if(!Number.isFinite(start))unknownStart++;
      else if(asOf-start>=overdueAfterHours*3600000){overdue++;league.overdueResults++;}
    }
    if(!row.evidenceCoverage){missingCoverage++;continue;}
    for(const reason of new Set(row.evidenceCoverage.missing||[]))increment(coverage,reason);
    if(row.evidenceCoverage.summary?.underlyingFreshnessVerified!==true)unknownUnderlying++;
  }
  const calibrationMonitoring=operationalDrift(issued,results,resultState.conflicts,{asOf,windowDays,minDriftGames});
  return {schema:'sports-operational-audit-v2',asOf:new Date(asOf).toISOString(),runtimeVerified:false,
    refreshes:{terminalAttempts:attempts.length,gameOutcomes:statuses,rejectionReasons:reasons,
      averageDurationMs:attempts.length?attempts.reduce((sum,row)=>sum+row.payload.durationMs,0)/attempts.length:null,
      coverage:attempts.length?'recorded_terminal_attempts_only':'unknown_no_attempt_records'},
    forecasts:{issued:issued.length,delivered:issued.filter(row=>delivered.has(row.payload.forecastId)).length,
      withoutDeliveryAcknowledgement:issued.filter(row=>!delivered.has(row.payload.forecastId)).length,
      missingResults:unresolved,overdueResults:overdue,unknownStart,overdueAfterHours},
    journalIntegrity:{eventAssociationRejections:visible.filter(row=>row.type==='event_association_rejected').length,disputedResults:journalResultState(visible).conflicts.size},
    evidence:{missingFrozenCoverage:missingCoverage,missingReasons:coverage,unknownUnderlyingFreshness:unknownUnderlying},
    byLeague,calibrationMonitoring,
    limitations:['Attempt counts cover only instrumented terminal attempts; process crashes and historical attempts may be absent.',
      'Missing delivery acknowledgements do not prove Discord rejected a message; journal and transport can fail independently.',
      'Overdue is an operational age threshold, not a claim a postponed or long-running game has finished.',
      'Counts outside drift cohorts are forecast records and can repeat games across horizons and guilds.',
      'Drift separates declared horizons and quarantines contradictory/disputed results; pending outcomes and changing coverage can still bias comparisons. Horizon cohorts can share games and must not be summed as independent samples.',
      'Calibration gap is signed top-outcome confidence minus accuracy, not a complete calibration curve or significance test.',
      'No remote process, source entitlement, scheduler, data-directory or deployed model is verified by this journal-only report.']};
}
