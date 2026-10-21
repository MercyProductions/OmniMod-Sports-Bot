import {validCandidateVector} from './candidateCohorts.js';
const epoch=value=>Date.parse(value||'');
const increment=(counts,key)=>{counts[key]=(counts[key]||0)+1;};

/** Read-only frozen evidence. This report is not a health attestation of an unreachable host. */
export function auditSportsOperations(records=[],{asOf=Date.now(),overdueAfterHours=24,windowDays=7,minDriftGames=30}={}){
  if(!Number.isFinite(asOf)||!Number.isFinite(overdueAfterHours)||overdueAfterHours<1
    ||!Number.isInteger(windowDays)||windowDays<1||!Number.isInteger(minDriftGames)||minDriftGames<2)throw new Error('Invalid operational audit bounds');
  const visible=records.filter(row=>Number.isFinite(epoch(row.recordedAt))&&epoch(row.recordedAt)<=asOf);
  const issued=visible.filter(row=>row.type==='forecast'&&row.payload.lifecycleState==='ISSUED'&&row.payload.recordEligibility==='observed_pregame');
  const results=new Map(visible.filter(row=>row.type==='result').map(row=>[row.payload.forecastId,{...row.payload,resultRecordedAt:row.recordedAt}]));
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
  // First issued horizon per game/version/league avoids counting repeated guild/horizon observations as independent games.
  const first=new Map();
  for(const event of [...issued].sort((a,b)=>epoch(a.recordedAt)-epoch(b.recordedAt))){
    const row=event.payload,key=JSON.stringify([row.league,row.gameId,row.startTime,row.modelVersion]);
    if(!first.has(key))first.set(key,event);
  }
  const cohorts={},width=windowDays*86400000;
  for(const event of first.values()){
    const row=event.payload,result=results.get(row.forecastId),start=epoch(row.startTime),generated=epoch(row.predictionGeneratedAt),issuedAt=epoch(event.recordedAt);
    const raw=row.outcomePercentages;
    if(!raw||['away','home'].some(side=>typeof raw[side]!=='number'||!Number.isFinite(raw[side]))
      ||Object.values(raw).some(value=>typeof value!=='number'||!Number.isFinite(value)))continue;
    const vector=Object.fromEntries(Object.entries(raw).filter(([side,p])=>side!=='draw'||p>0).map(([side,p])=>[side,p/100]));
    if(!result||result.scheduleChanged||!validCandidateVector(vector)||!(result.actualSide in vector)
      ||epoch(result.observedAt)>epoch(result.resultRecordedAt)||!Number.isFinite(start)||!Number.isFinite(generated)||generated>issuedAt||issuedAt>=start||epoch(result.observedAt)<start||!Number.isFinite(epoch(result.observedAt)))continue;
    const cohort=JSON.stringify([row.league,row.modelVersion]),entry=cohorts[cohort] ||= {league:row.league,modelVersion:row.modelVersion,previous:[],recent:[]};
    const age=asOf-start,period=age>=0&&age<width?'recent':age>=width&&age<2*width?'previous':null;
    if(!period)continue;
    const actual=result.actualSide,selected=Object.entries(vector).sort((a,b)=>b[1]-a[1])[0];
    entry[period].push({brier:Object.entries(vector).reduce((sum,[side,p])=>sum+(p-(side===actual?1:0))**2,0),
      logLoss:-Math.log(Math.max(1e-12,vector[actual])),confidence:selected[1],correct:selected[0]===actual?1:0});
  }
  const metrics=rows=>{
    if(!rows.length)return {games:0,brier:null,logLoss:null,calibrationGap:null};
    const mean=key=>rows.reduce((sum,row)=>sum+row[key],0)/rows.length;
    return {games:rows.length,brier:mean('brier'),logLoss:mean('logLoss'),calibrationGap:mean('confidence')-mean('correct')};
  };
  const drift=Object.values(cohorts).map(row=>{
    const previous=metrics(row.previous),recent=metrics(row.recent),supported=Math.min(previous.games,recent.games)>=minDriftGames;
    return {league:row.league,modelVersion:row.modelVersion,previous,recent,status:supported?'descriptive_comparison_only':'insufficient_games',
      brierChange:supported?recent.brier-previous.brier:null,calibrationGapChange:supported?recent.calibrationGap-previous.calibrationGap:null};
  });
  return {schema:'sports-operational-audit-v1',asOf:new Date(asOf).toISOString(),runtimeVerified:false,
    refreshes:{terminalAttempts:attempts.length,gameOutcomes:statuses,rejectionReasons:reasons,
      averageDurationMs:attempts.length?attempts.reduce((sum,row)=>sum+row.payload.durationMs,0)/attempts.length:null,
      coverage:attempts.length?'recorded_terminal_attempts_only':'unknown_no_attempt_records'},
    forecasts:{issued:issued.length,delivered:issued.filter(row=>delivered.has(row.payload.forecastId)).length,
      withoutDeliveryAcknowledgement:issued.filter(row=>!delivered.has(row.payload.forecastId)).length,
      missingResults:unresolved,overdueResults:overdue,unknownStart,overdueAfterHours},
    evidence:{missingFrozenCoverage:missingCoverage,missingReasons:coverage,unknownUnderlyingFreshness:unknownUnderlying},
    byLeague,calibrationMonitoring:{windowDays,minDriftGames,cohorts:drift,automaticAction:false},
    limitations:['Attempt counts cover only instrumented terminal attempts; process crashes and historical attempts may be absent.',
      'Missing delivery acknowledgements do not prove Discord rejected a message; journal and transport can fail independently.',
      'Overdue is an operational age threshold, not a claim a postponed or long-running game has finished.',
      'Counts outside drift cohorts are forecast records and can repeat games across horizons and guilds.',
      'Drift uses first issued records and observed resolved outcomes; pending results and changing coverage can bias comparisons.',
      'Calibration gap is signed top-outcome confidence minus accuracy, not a complete calibration curve or significance test.',
      'No remote process, source entitlement, scheduler, data-directory or deployed model is verified by this journal-only report.']};
}
