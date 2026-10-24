import {quoteTimeEpoch} from './oddsPricing.js';
import {REFRESH_REASON_POLICY} from './refreshReasonCodes.js';
import {serializeAvailabilityRefreshProof} from './availabilityRefresh.js';
import {capturedEventTime} from './capturedEventTime.js';
import {auditJournalForecastIdentities} from './journalForecastIdentity.js';
import {journalResultState} from './journalResults.js';
import {operationalDrift} from './operationalDrift.js';
const epoch=quoteTimeEpoch;
const increment=(counts,key)=>{counts[key]=(counts[key]||0)+1;};

/** Read-only frozen evidence. This report is not a health attestation of an unreachable host. */
export function auditSportsOperations(records=[],{asOf=Date.now(),overdueAfterHours=24,windowDays=7,minDriftGames=30}={}){
  if(!Number.isFinite(asOf)||!Number.isFinite(new Date(asOf).getTime())||!Number.isFinite(overdueAfterHours)||overdueAfterHours<1
    ||!Number.isInteger(windowDays)||windowDays<1||!Number.isInteger(minDriftGames)||minDriftGames<2)throw new Error('Invalid operational audit bounds');
  const visible=records.filter(row=>Number.isFinite(epoch(row.recordedAt))&&epoch(row.recordedAt)<=asOf);
  const rawIssued=visible.filter(row=>row.type==='forecast'&&row.payload?.lifecycleState==='ISSUED'&&row.payload.recordEligibility==='observed_pregame');
  const identities=auditJournalForecastIdentities(rawIssued),issued=identities.events,byId=new Map(issued.map(row=>[row.payload.forecastId,row]));
  let invalidResultChronology=0,unboundResultRecords=0,invalidDeliveryChronology=0;
  const latestInvalidResults=new Set();
  const qualified=visible.filter(event=>{
    if(event.type!=='result')return true;
    const forecast=byId.get(event.payload?.forecastId);
    if(!forecast){unboundResultRecords++;return false;}
    const start=capturedEventTime(forecast.payload.startTime),observed=epoch(event.payload.observedAt),at=epoch(event.recordedAt);
    if(event.payload.scheduleChanged||![start,observed,at].every(Number.isFinite)||start>observed||observed>at){invalidResultChronology++;latestInvalidResults.add(event.payload.forecastId);return false;}
    latestInvalidResults.delete(event.payload.forecastId);return true;
  });
  const resultState=journalResultState(qualified);
  const results=new Map([...resultState.eligible].filter(([id])=>!latestInvalidResults.has(id)).map(([id,event])=>[id,{...event.payload,resultRecordedAt:event.recordedAt}]));
  const delivered=new Set();
  for(const event of visible.filter(row=>row.type==='forecast_lifecycle'&&row.payload?.state==='DELIVERED')){
    const forecast=byId.get(event.payload.forecastId);
    if(!forecast||epoch(event.recordedAt)<epoch(forecast.recordedAt)){invalidDeliveryChronology++;continue;}
    delivered.add(event.payload.forecastId);
  }
  const attempts=visible.filter(row=>row.type==='refresh_attempt'),statuses={},reasons={},coverage={},byLeague={};
  const currentPolicyAttempts=attempts.filter(row=>row.payload?.reasonPolicy===REFRESH_REASON_POLICY).length;
  const omittedCounts=attempts.filter(row=>row.payload?.reasonPolicy===REFRESH_REASON_POLICY).flatMap(row=>(row.payload.games||[]).map(game=>game.unrecognizedReasonCount));
  for(const {payload} of attempts)for(const game of payload.games||[]){increment(statuses,game.status);for(const reason of new Set(game.reasons||[]))increment(reasons,reason);}
  let selectedSnapshotCompletions=0,invalidSnapshotAcceptanceProofs=0;
  for(const {payload,recordedAt} of attempts)for(const game of payload.games||[]){
    if(!game.sourceAcceptanceEvidence)continue;
    try{
      if(epoch(payload.completedAt)>epoch(recordedAt))throw Error('Future refresh terminal evidence');
      serializeAvailabilityRefreshProof(game.sourceAcceptanceEvidence,game,{began:epoch(payload.attemptedAt),ended:epoch(payload.completedAt),
        frozenForecast:byId.get(game.sourceAcceptanceEvidence.forecastId)?.payload});
      selectedSnapshotCompletions++;
    }catch{invalidSnapshotAcceptanceProofs++;}
  }
  let unresolved=0,overdue=0,unknownStart=0,missingCoverage=0,unknownUnderlying=0;
  for(const {payload:row} of issued){
    const league=byLeague[row.league||'unknown'] ||= {issued:0,delivered:0,missingResults:0,overdueResults:0};
    league.issued++;if(delivered.has(row.forecastId))league.delivered++;
    if(!results.has(row.forecastId)){
      unresolved++;league.missingResults++;
      const start=capturedEventTime(row.startTime);
      if(!Number.isFinite(start))unknownStart++;
      else if(asOf-start>=overdueAfterHours*3600000){overdue++;league.overdueResults++;}
    }
    if(!row.evidenceCoverage){missingCoverage++;continue;}
    for(const reason of new Set(row.evidenceCoverage.missing||[]))increment(coverage,reason);
    if(row.evidenceCoverage.summary?.underlyingFreshnessVerified!==true)unknownUnderlying++;
  }
  const calibrationMonitoring=operationalDrift(rawIssued,results,resultState.conflicts,{asOf,windowDays,minDriftGames});
  const durations=attempts.filter(({payload:row,recordedAt})=>{
    const start=epoch(row.attemptedAt),end=epoch(row.completedAt);
    return typeof row.durationMs==='number'&&Number.isFinite(row.durationMs)&&row.durationMs>=0
      &&[start,end].every(Number.isFinite)&&start<=end&&end<=epoch(recordedAt)&&row.durationMs===end-start;
  }).map(row=>row.payload.durationMs);
  return {schema:'sports-operational-audit-v3',asOf:new Date(asOf).toISOString(),runtimeVerified:false,
    refreshes:{terminalAttempts:attempts.length,gameOutcomes:statuses,rejectionReasons:reasons,
      sourceAcceptance:{selectedSnapshotCompletions,invalidSnapshotAcceptanceProofs,scope:'Explicit linked proofs only; no inference from absent legacy metadata.'},
      reasonEvidence:{policy:REFRESH_REASON_POLICY,currentPolicyAttempts,legacyOrUnknownPolicyAttempts:attempts.length-currentPolicyAttempts,
        unrecognizedReasonsOmitted:omittedCounts.filter(value=>Number.isSafeInteger(value)&&value>=0).reduce((sum,value)=>sum+value,0),
        invalidOmissionCounters:omittedCounts.filter(value=>!Number.isSafeInteger(value)||value<0).length,historicalCompletenessVerified:false},
      averageDurationMs:durations.length?durations.reduce((sum,value)=>sum+value,0)/durations.length:null,
      timedAttempts:durations.length,invalidDurationRecords:attempts.length-durations.length,
      coverage:attempts.length?'recorded_terminal_attempts_only':'unknown_no_attempt_records'},
    forecasts:{rawIssuedRecords:rawIssued.length,issued:issued.length,delivered:issued.filter(row=>delivered.has(row.payload.forecastId)).length,
      withoutDeliveryAcknowledgement:issued.filter(row=>!delivered.has(row.payload.forecastId)).length,
      missingResults:unresolved,overdueResults:overdue,unknownStart,overdueAfterHours},
    journalIntegrity:{eventAssociationRejections:visible.filter(row=>row.type==='event_association_rejected').length,disputedResults:resultState.conflicts.size,invalidResultChronology,unboundResultRecords,invalidDeliveryChronology,
      invalidRecordTimestamps:records.filter(row=>!Number.isFinite(epoch(row.recordedAt))).length,
      recordsAfterCutoff:records.filter(row=>epoch(row.recordedAt)>asOf).length,
      duplicateForecastRecords:identities.duplicateRecords,conflictingForecastRecords:identities.conflictingRecords},
    evidence:{missingFrozenCoverage:missingCoverage,missingReasons:coverage,unknownUnderlyingFreshness:unknownUnderlying},
    byLeague,calibrationMonitoring,
    limitations:['Attempt counts cover only instrumented terminal attempts; process crashes and historical attempts may be absent.',
      'Older terminal records may omit cache/source-identity causes. Zero recorded causes is not proof of zero events; unavailable reasons are not reconstructed.',
      'Missing delivery acknowledgements do not prove Discord rejected a message; journal and transport can fail independently.',
      'Overdue is an operational age threshold, not a claim a postponed or long-running game has finished.',
      'Canonical operational counts deduplicate identical forecast IDs and exclude identity conflicts, but still count repeated games across horizons and guilds; raw issued counts remain explicit.',
      'Operational issuance is an asserted journal state, not independent source/transport truth. Invalid start clocks remain unknown and cannot produce an overdue or resolved claim.',
      'Drift separates declared horizons and quarantines contradictory/disputed results; pending outcomes and changing coverage can still bias comparisons. Horizon cohorts can share games and must not be summed as independent samples.',
      'Calibration gap is signed top-outcome confidence minus accuracy, not a complete calibration curve or significance test.',
      'No remote process, source entitlement, scheduler, data-directory or deployed model is verified by this journal-only report.']};
}
