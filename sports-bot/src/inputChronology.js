const time=value=>Date.parse(value||'');

/** Known observation times only; absence remains explicitly unknown, never a publication-time attestation. */
export function observedInputState(row,cutoff){
 const values=[row?.updatedAt,row?.fetchedAt,row?.sourceFetchedAt,row?.recordedAt,row?.observedAt,row?.sourceObservationAt,
  row?.sourceMeta?.fetchedAt,row?.sourceMeta?.sourceObservationAt,...Object.values(row?.fetchedAtBySide||{})]
  .filter(value=>value!==undefined&&value!==null&&value!=='');
 if(!values.length)return 'unknown';
 const timestamps=values.map(time);
 return timestamps.some(value=>!Number.isFinite(value))?'invalid_observation_time':timestamps.some(value=>value>cutoff)?'after_information_cutoff':'observed_by_cutoff';
}

/** Clone inference inputs and exclude known invalid/future observations and their inseparable derived aggregates. */
export function predictionInputsAt(game={},context={},cutoff=Date.now()){
 if(!Number.isFinite(cutoff))throw new Error('Valid prediction information cutoff required');
 const excluded={},unknown={};
 const retain=(row,path)=>{
  if(!row)return row;
  const state=observedInputState(row,cutoff);
  if(state==='unknown'){unknown[path]=(unknown[path]||0)+1;return row;}
  if(state==='observed_by_cutoff')return row;
  const reason=path+':'+state;excluded[reason]=(excluded[reason]||0)+1;return null;
 };
 const safe={...game},intelligence={...context.intelligence};
 for(const name of ['teams','players','contexts'])intelligence[name]=Object.fromEntries(Object.entries(context.intelligence?.[name]||{}).filter(([,row])=>retain(row,'manual_'+name)));
 for(const field of ['autoEnrichment','autoHistory','autoContext','autoLineup','advancedDataset','sourceCorroboration'])safe[field]=retain(game[field],field);
 safe.autoTeamMetrics=Object.fromEntries(Object.entries(game.autoTeamMetrics||{}).map(([side,row])=>[side,retain(row,'auto_team_'+side)]));
 safe.autoPlayers=(game.autoPlayers||[]).filter(row=>retain(row,'auto_player'));
 if(safe.autoPlayers.length!==(game.autoPlayers||[]).length){safe.autoLineup=null;excluded['autoLineup:excluded_player_dependency']=1;}
 if(game.autoEnrichment&&!safe.autoEnrichment){
  safe.autoPlayers=[];safe.autoLineup=null;safe.autoContext=null;
  excluded['summary_derived_inputs:parent_unavailable']=1;
 }
 if(game.autoHistory&&!safe.autoHistory){
  safe.autoTeamMetrics={};safe.autoLineup=null;safe.advancedDataset=null;
  excluded['history_derived_inputs:parent_unavailable']=1;
 }
 const schedule=observedInputState(game.sourceMeta,cutoff);
 if(['after_information_cutoff','invalid_observation_time'].includes(schedule)){
  safe.away={...game.away,record:''};safe.home={...game.home,record:''};excluded['schedule:'+schedule]=1;
 }
 const next={...context,intelligence,externalResults:(context.externalResults||[]).filter(row=>{
  const selected=retain(row,'head_to_head_result');
  if(!selected)return false;
  if(observedInputState(row,cutoff)==='unknown'){excluded['head_to_head_result:availability_unknown']=(excluded['head_to_head_result:availability_unknown']||0)+1;return false;}
  const start=time(row.startTime||row.dateKey);
  if(!Number.isFinite(start)||start>=cutoff){excluded['head_to_head_result:event_not_before_cutoff']=(excluded['head_to_head_result:event_not_before_cutoff']||0)+1;return false;}
  return true;
 })};
 const learnedAt=time(context.learningInputAudit?.cutoffAt);
 if(Number.isFinite(learnedAt)&&learnedAt>cutoff){
  for(const field of ['eloRatings','calibration','outcomeValidation','featureLearning','drift'])next[field]={};
  next.history={overall:{sampleSize:0}};excluded['learning_context:after_information_cutoff']=1;
 }
 return {game:safe,context:next,audit:{schema:'sports-input-cutoff-v1',cutoffAt:new Date(cutoff).toISOString(),excluded,unknownAvailability:unknown,
  scope:'Provided context collections and per-game automatic inputs; selected evidence coverage is reported separately.',
  pointInTimeComplete:false,limitations:['Declared receipt/update times are not independently verified publication times.',
   'Untimestamped legacy profiles remain explicitly unknown; older revisions are not reconstructed.',
   'Untimestamped derived aggregates and manually supplied learned state require further provenance review.']}};
}
