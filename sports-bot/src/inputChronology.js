import {quoteTimeEpoch} from './oddsPricing.js';
import {availabilitySourceRows,reconcileAvailabilityRows} from './availabilityReconciliation.js';

const time=quoteTimeEpoch;
const dayOnly=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value);
const observationTime=value=>dayOnly(value)?time(value+'T00:00:00Z'):time(value);

/** Known observation times only; absence remains explicitly unknown, never a publication-time attestation. */
export function observedInputState(row,cutoff){
 if(!Number.isFinite(cutoff))throw new Error('Valid observation information cutoff required');
 const values=[row?.updatedAt,row?.fetchedAt,row?.sourceFetchedAt,row?.recordedAt,row?.observedAt,row?.sourceObservationAt,
  row?.sourceMeta?.fetchedAt,row?.sourceMeta?.sourceObservationAt,...Object.values(row?.fetchedAtBySide||{}),
  ...(Array.isArray(row?.sourceReceiptTimes)?row.sourceReceiptTimes:[]),
  ...(Array.isArray(row?.sourceContributions)?row.sourceContributions.flatMap(entry=>Array.isArray(entry?.sourceReceiptTimes)?entry.sourceReceiptTimes:[]):[]),
  ...(Array.isArray(row?.matches)?row.matches.flatMap(match=>[match?.fetchedAt,match?.sourceObservationAt]):[]),
  row?.environment?.fetchedAt,row?.environment?.sourceFetchedAt,row?.environment?.sourceObservationAt]
  .filter(value=>value!==undefined&&value!==null&&value!=='');
 if(!values.length)return 'unknown';
 const timestamps=values.map(observationTime);
 if(timestamps.some(value=>!Number.isFinite(value)))return 'invalid_observation_time';
 if(timestamps.some(value=>value>cutoff))return 'after_information_cutoff';
 const missing=value=>value===undefined||value===null||value==='';
 if(values.some(dayOnly)
  ||(Array.isArray(row?.sourceReceiptTimes)&&row.sourceReceiptTimes.some(missing))
  ||(Array.isArray(row?.sourceContributions)&&row.sourceContributions.some(entry=>!Array.isArray(entry?.sourceReceiptTimes)||!entry.sourceReceiptTimes.length||entry.sourceReceiptTimes.some(missing)))
  ||Object.values(row?.fetchedAtBySide||{}).some(missing)
  ||(Array.isArray(row?.matches)&&row.matches.some(match=>missing(match?.fetchedAt)&&missing(match?.sourceObservationAt))))return 'unknown';
 return 'observed_by_cutoff';
}

/** Clone inference inputs and exclude known invalid/future observations and their inseparable derived aggregates. */
export function predictionInputsAt(game={},context={},cutoff=Date.now()){
 if(!Number.isFinite(cutoff))throw new Error('Valid prediction information cutoff required');
 const excluded={},unknown={};
 const retain=(row,path)=>{
  if(!row)return row;
  if(row.availabilityExpiresAt!==undefined){
   const expiry=time(row.availabilityExpiresAt);
   if(!Number.isFinite(expiry)||expiry<=cutoff){const reason=path+':availability_report_expired_or_invalid';excluded[reason]=(excluded[reason]||0)+1;return null;}
  }
  const state=observedInputState(row,cutoff);
  if(state==='unknown'){unknown[path]=(unknown[path]||0)+1;return row;}
  if(state==='observed_by_cutoff')return row;
  const reason=path+':'+state;excluded[reason]=(excluded[reason]||0)+1;return null;
 };
 const safe={...game},intelligence={...context.intelligence};
 for(const name of ['teams','players','contexts'])intelligence[name]=Object.fromEntries(Object.entries(context.intelligence?.[name]||{}).filter(([,row])=>retain(row,'manual_'+name)));
 for(const field of ['autoEnrichment','autoHistory','autoContext','autoLineup','advancedDataset','sourceCorroboration','eventEnvironment','participationSummary','goalieResearch','nhlTeamIdentity','availabilityProviderEvidence'])safe[field]=retain(game[field],field);
 safe.autoTeamMetrics=Object.fromEntries(Object.entries(game.autoTeamMetrics||{}).map(([side,row])=>[side,retain(row,'auto_team_'+side)]));
 const rawPlayers=availabilitySourceRows(game.autoPlayers||[]),rawLineups=availabilitySourceRows(game.autoLineups||[]);
 const playerInputs=rawPlayers.filter(row=>retain(row,'auto_player')),lineupInputs=rawLineups.filter(row=>retain(row,'auto_lineup_player'));
 const availabilityChanged=playerInputs.length!==rawPlayers.length||lineupInputs.length!==rawLineups.length;
 safe.autoPlayers=availabilityChanged?reconcileAvailabilityRows(playerInputs):(game.autoPlayers||[]).filter(row=>retain(row,'auto_player_view'));
 safe.autoLineups=availabilityChanged?reconcileAvailabilityRows(lineupInputs,playerInputs):(game.autoLineups||[]).filter(row=>retain(row,'auto_lineup_view'));
 safe.availabilityProviderEvidenceByProvider=Object.fromEntries(Object.entries(game.availabilityProviderEvidenceByProvider||{}).filter(([,row])=>retain(row,'availability_provider_state')));
 safe.participationProjections=(game.participationProjections||[]).filter(row=>retain(row,'participation_projection'));
 let excludedNestedProjection=false;
 safe.autoPlayers=safe.autoPlayers.map(row=>{
  if(!row.participationProjection||retain(row.participationProjection,'player_participation_projection'))return row;
  excludedNestedProjection=true;const copy={...row};delete copy.participationProjection;return copy;
 });
 const clearParticipation=reason=>{
  safe.participationSummary=null;safe.participationProjections=[];
  safe.autoPlayers=safe.autoPlayers.map(row=>{const copy={...row};delete copy.participationProjection;return copy;});
  excluded['participation_derived_inputs:'+reason]=1;
 };
 if(excludedNestedProjection){safe.autoLineup=null;excluded['autoLineup:excluded_projection_dependency']=1;}
 if(availabilityChanged||safe.autoPlayers.length!==(game.autoPlayers||[]).length||safe.autoLineups.length!==(game.autoLineups||[]).length){
  safe.autoLineup=null;excluded['autoLineup:excluded_player_dependency']=1;clearParticipation('player_or_lineup_unavailable');
 }
 if(excludedNestedProjection||(game.autoLineup&&!safe.autoLineup)||(game.participationSummary&&!safe.participationSummary)
  ||safe.participationProjections.length!==(game.participationProjections||[]).length)clearParticipation('aggregate_dependency_unavailable');
 if(Object.entries(game.autoTeamMetrics||{}).some(([side,row])=>row&&!safe.autoTeamMetrics[side])){
  safe.advancedDataset=null;excluded['advancedDataset:excluded_team_dependency']=1;
 }
 if(game.autoEnrichment&&!safe.autoEnrichment){
  safe.autoPlayers=[];safe.autoLineups=[];safe.autoLineup=null;safe.autoContext=null;safe.eventEnvironment=null;safe.advancedDataset=null;
  clearParticipation('summary_unavailable');
  excluded['summary_derived_inputs:parent_unavailable']=1;
 }
 if(game.autoHistory&&!safe.autoHistory){
  safe.autoTeamMetrics={};safe.autoLineup=null;safe.advancedDataset=null;
  clearParticipation('history_unavailable');
  excluded['history_derived_inputs:parent_unavailable']=1;
 }
 if(game.sourceCorroboration&&!safe.sourceCorroboration){
  safe.autoContext=null;safe.eventEnvironment=null;
  excluded['corroboration_derived_inputs:parent_unavailable']=1;
 }
 const schedule=observedInputState(game.sourceMeta,cutoff);
 if(['after_information_cutoff','invalid_observation_time'].includes(schedule)){
  safe.away={...game.away,record:''};safe.home={...game.home,record:''};excluded['schedule:'+schedule]=1;
 }
 const next={...context,intelligence,externalResults:(context.externalResults||[]).filter(row=>{
  const selected=retain(row,'head_to_head_result');
  if(!selected)return false;
  if(observedInputState(row,cutoff)==='unknown'){excluded['head_to_head_result:availability_unknown']=(excluded['head_to_head_result:availability_unknown']||0)+1;return false;}
  const start=observationTime(row.startTime||row.dateKey);
  if(!Number.isFinite(start)||start>=cutoff){excluded['head_to_head_result:event_not_before_cutoff']=(excluded['head_to_head_result:event_not_before_cutoff']||0)+1;return false;}
  return true;
 })};
 const learnedAt=time(context.learningInputAudit?.cutoffAt);
 const learningState=context.learningInputAudit?(!Number.isFinite(learnedAt)?'invalid_observation_time':learnedAt>cutoff?'after_information_cutoff':'observed_by_cutoff'):'unknown';
 if(learningState==='unknown')unknown.learning_context=1;
 if(['after_information_cutoff','invalid_observation_time'].includes(learningState)){
  for(const field of ['eloRatings','calibration','outcomeValidation','featureLearning','drift'])next[field]={};
  next.history={overall:{sampleSize:0}};excluded['learning_context:'+learningState]=1;
 }
 return {game:safe,context:next,audit:{schema:'sports-input-cutoff-v2',cutoffAt:new Date(cutoff).toISOString(),excluded,unknownAvailability:unknown,
  scope:'Provided context collections, selected nested receipts and dependent automatic aggregates; evidence coverage is reported separately.',
  pointInTimeComplete:false,limitations:['Declared receipt/update times are not independently verified publication times.',
   'Untimestamped or date-only legacy profiles and unaudited learned state remain explicitly unknown; older revisions are not reconstructed.',
   'Untimestamped derived aggregates and manually supplied learned state require further provenance review.']}};
}
