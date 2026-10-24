import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const count=value=>Number.isSafeInteger(value)&&value>=0?value:null;
const time=value=>typeof value==='string'&&/(?:Z|[+-]\d{2}:\d{2})$/.test(value)&&Number.isFinite(Date.parse(value));
const reasons=new Set(['provider_event_mapping_not_verified','provider_request_failed','request_cap_omission']);
const statuses=new Set(['missing','not_applicable','conflicting_confirmed_records','confirmed_record_present','projected_or_unavailable']);

/** Summarize already frozen evidence; never fetch, rebuild a forecast or infer health from silence. */
export function auditCaptureAvailability(bytes,{expectedSHA256}={}){
 if(!/^[a-f0-9]{64}$/.test(expectedSHA256||'')||hash(bytes)!==expectedSHA256)throw new Error('Capture bytes unverified');
 const capture=JSON.parse(bytes.toString()),slate=capture?.slate;
 if(!['sports-isolated-capture-v1','sports-forward-capture-v1'].includes(capture.schema)
  ||!Array.isArray(slate?.games)||!Array.isArray(slate?.predictions)||slate.games.length>10000||slate.predictions.length>10000)
  throw new Error('Unsupported availability capture');
 const games=new Map();
 for(const game of slate.games){
  if(!game||typeof game.id!=='string'||!game.id||games.has(game.id))throw new Error('Capture game identity ambiguous');
  games.set(game.id,game);
 }
 const rows=[],seen=new Set();
 for(const prediction of slate.predictions){
  const game=games.get(prediction.gameId),evidence=prediction.evidenceCoverage;
  if(!game||seen.has(game.id))throw new Error('Prediction game binding unverified');seen.add(game.id);
  const league=game.leagueKey;
  if(typeof league!=='string'||!/^[a-z0-9-]{1,80}$/i.test(league)||prediction.leagueKey!==league)
   throw new Error('Prediction league binding unverified');
  if(!evidence){rows.push({gameId:game.id,league,status:'coverage_not_recorded',sides:null});continue;}
  if(evidence.schema!=='sports-evidence-coverage-v2'||evidence.gameId!==game.id||evidence.league!==league||!time(evidence.cutoffAt)
   ||!time(game.startTime)||Date.parse(evidence.cutoffAt)>=Date.parse(game.startTime))throw new Error('Pregame availability coverage binding unverified');
  const summary=evidence.summary||{},mapping=summary.providerMapping||{},goalie=evidence.goalieResearch;
  rows.push({gameId:game.id,league,status:'recorded_at_forecast_cutoff',cutoffAt:evidence.cutoffAt,
   summaryReceiptFresh:summary.receiptFresh===true,
   summaryMappingReason:reasons.has(mapping.reason)?mapping.reason:mapping.reason?'other_recorded_reason':'not_recorded',
   nativeGoalieContext:goalie?.status==='season_context_only'?'season_context_only':goalie?'other_recorded_status':'not_recorded',
   seasonGoalieCandidates:goalie?.status==='season_context_only'?Object.fromEntries(['away','home'].map(side=>[side,count(goalie.candidatesBySide?.[side])])):null,
   preferredProviderRecorded:!!evidence.availabilityProviderEvidence,
   sides:Object.fromEntries(['away','home'].map(side=>{
    const input=evidence.sides?.[side];
    return [side,{injuryCoverage:input?.injuryCoverage==='team_report_received_not_a_clean_bill_of_health'?input.injuryCoverage:'unknown',
     injuryAssertionRows:count(input?.injuryRecords),confirmedStarterAssertions:count(input?.confirmedStarters),
     criticalConfirmedAssertions:count(input?.criticalConfirmedAssertions),projectedStarterRows:count(input?.projectedStarters),
     criticalStarterStatus:statuses.has(input?.criticalStarterStatus)?input.criticalStarterStatus:'unknown'}];
   }))});
 }
 const leagues={};
 for(const row of rows){
  const summary=leagues[row.league]??={games:0,coverageNotRecorded:0,freshSummaryReceipts:0,summaryMappingReasons:{},
   seasonContextGames:0,seasonGoalieCandidateRows:0,confirmedCriticalRoleSides:0,unknownInjuryCoverageSides:0,
   injuryAssertionRows:0,preferredProviderGames:0,sidesWithUnrecordedAssertionCounts:0};
  summary.games++;
  if(row.status==='coverage_not_recorded'){summary.coverageNotRecorded++;continue;}
  if(row.summaryReceiptFresh)summary.freshSummaryReceipts++;
  summary.summaryMappingReasons[row.summaryMappingReason]=(summary.summaryMappingReasons[row.summaryMappingReason]||0)+1;
  if(row.nativeGoalieContext==='season_context_only')summary.seasonContextGames++;
  for(const value of Object.values(row.seasonGoalieCandidates||{}))if(value!==null)summary.seasonGoalieCandidateRows+=value;
  if(row.preferredProviderRecorded)summary.preferredProviderGames++;
  for(const side of Object.values(row.sides)){
   if(side.criticalConfirmedAssertions===1&&side.criticalStarterStatus==='confirmed_record_present')summary.confirmedCriticalRoleSides++;
   if(side.injuryCoverage==='unknown')summary.unknownInjuryCoverageSides++;
   if(side.injuryAssertionRows!==null)summary.injuryAssertionRows+=side.injuryAssertionRows;
   if([side.injuryAssertionRows,side.confirmedStarterAssertions,side.criticalConfirmedAssertions,side.projectedStarterRows].includes(null))summary.sidesWithUnrecordedAssertionCounts++;
  }
 }
 return {schema:'sports-capture-availability-audit-v1',captureSHA256:expectedSHA256,scope:'Frozen evidence as recorded at each original forecast cutoff; no current re-enrichment.',
  predictions:rows.length,leagues,rows,providerRequests:0,liveOrders:false,discordPosts:0,
  limitations:['A local byte hash is not source authentication or independent publication-time verification.',
   'Season goalie candidates are neither projected nor confirmed starters. Missing medical evidence stays unknown.',
   'Individual injury assertions do not certify complete team coverage; legacy unrecorded coverage is not zero injury.',
   'Counts explain missing inputs; they do not establish predictive performance, selection approval or profitable opportunities.']};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const option=name=>process.argv.slice(2).find(value=>value.startsWith('--'+name+'='))?.slice(name.length+3);
 try{
  const file=option('capture');if(!file)throw new Error('Explicit saved capture required');
  const bytes=await readFile(file);if(bytes.length>100*1024*1024)throw new Error('Capture exceeds audit bound');
  console.log(JSON.stringify(auditCaptureAvailability(bytes,{expectedSHA256:option('expected-sha256')}),null,2));
 }catch{
  console.error('Saved availability audit failed. Preserve the capture and verify its schema, byte hash and forecast binding privately.');process.exitCode=1;
 }
}
