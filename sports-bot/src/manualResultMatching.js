import {normalizeEntityName} from './intelligenceStore.js';
import {validScore,scoreOutcome} from './dataValidation.js';
import {eventReference,scopedEventKey} from './slateEventIdentity.js';
import {eventObservationHash} from './journalEventMatch.js';
const iso=value=>Number.isFinite(Date.parse(value||''))?new Date(value).toISOString():null;
const recordView=row=>({recordId:String(row.id||''),gameId:row.gameId||null,startTime:iso(row.startTime),awayScore:validScore(row.awayScore),homeScore:validScore(row.homeScore),scoreBasis:row.scoreBasis||'unknown',recordedAt:iso(row.recordedAt||row.updatedAt),observedAt:iso(row.observedAt),sourceChecked:row.sourceChecked===true,sourceReference:row.sourceReference||'',recordedBy:row.recordedBy||''});

/** Unique legacy matches remain usable; explicit scope is required for reviewed correction qualification. */
export function applyManualResults(games=[],intelligence={},dateKey,{now=Date.now(),audit=[]}={}){
 if(!Number.isFinite(now))throw new Error('A valid manual-result observation clock is required');
 const groups=new Map();
 for(const row of Object.values(intelligence.results||{})){
  if(String(row.dateKey)!==String(dateKey))continue;
  const view=recordView(row),reject=(reason,count=0)=>audit.push({recordId:view.recordId,status:'rejected',reason,candidateCount:count});
  if(view.awayScore===null||view.homeScore===null){reject('invalid_manual_scores');continue;}
  if(!['unknown','regulation','full_game'].includes(view.scoreBasis)){reject('invalid_manual_score_basis');continue;}
  if(row.startTime&&(typeof row.startTime!=='string'||!/[Tt].*(?:[Zz]|[+-]\d{2}:\d{2})$/.test(row.startTime))){reject('invalid_manual_start');continue;}
  const pair=games.filter(game=>normalizeEntityName(game.leagueKey||game.league)===normalizeEntityName(row.leagueKey||row.league)
   &&normalizeEntityName(game.away?.name)&&normalizeEntityName(game.away?.name)===normalizeEntityName(row.awayTeam)
   &&normalizeEntityName(game.home?.name)&&normalizeEntityName(game.home?.name)===normalizeEntityName(row.homeTeam));
  let matches=pair;
  if(row.gameId)matches=matches.filter(game=>String(game.id)===String(row.gameId)||String(game.upstreamEventId||'')===String(row.gameId));
  if(row.startTime){if(!iso(row.startTime)){reject('invalid_manual_start');continue;}matches=matches.filter(game=>iso(game.startTime)===iso(row.startTime));}
  const unique=[...new Map(matches.map(game=>[eventObservationHash(game),game])).values()];
  if(unique.length!==1){reject(unique.length?'ambiguous_manual_event':pair.length?'manual_scope_mismatch':'manual_event_not_found',unique.length);continue;}
  const target=unique[0],start=Date.parse(target.startTime||''),receipt=Date.parse(view.recordedAt||''),observed=Date.parse(view.observedAt||view.recordedAt||'');
  if(!Number.isFinite(start)||!Number.isFinite(receipt)||receipt<start||receipt>now||!Number.isFinite(observed)||observed<start||observed>receipt){reject('manual_receipt_chronology_unverified',1);continue;}
  const key=scopedEventKey(eventReference(target));if(!groups.has(key))groups.set(key,{targets:matches,rows:[]});groups.get(key).rows.push(view);
 }
 for(const {targets,rows} of groups.values()){
  const scores=new Set(rows.map(row=>JSON.stringify([row.awayScore,row.homeScore]))),bases=new Set(rows.map(row=>row.scoreBasis).filter(value=>value!=='unknown'));
  if(scores.size>1||bases.size>1){
   const conflict={reason:'conflicting_manual_results',recordIds:rows.slice(0,20).map(row=>row.recordId),observations:rows.slice(0,20).map(row=>({...row,actualSide:scoreOutcome(row.awayScore,row.homeScore)})),observationCount:rows.length,truncated:rows.length>20,evidenceHash:eventObservationHash(rows)};
   for(const target of targets)target.manualResultConflict=structuredClone(conflict);
   for(const row of rows)audit.push({recordId:row.recordId,status:'rejected',reason:conflict.reason,event:eventReference(targets[0])});continue;
  }
  const scoped=row=>Boolean(row.gameId||row.startTime);
  const publicReference=row=>{try{const url=new URL(row.sourceReference);return ['http:','https:'].includes(url.protocol)&&!url.username&&!url.password;}catch{return false;}};
  const reviewed=rows.filter(row=>scoped(row)&&row.sourceChecked&&publicReference(row)&&row.recordedBy).sort((a,b)=>Date.parse(b.recordedAt)-Date.parse(a.recordedAt));
  const selected=reviewed[0]||rows.find(scoped)||rows[0],basis=[...bases][0]||'unknown';
  for(const target of targets){
   const previousDetail=target.detail||'';delete target.manualResultConflict;
   target.away.score=selected.awayScore;target.home.score=selected.homeScore;target.away.winner=selected.awayScore>selected.homeScore;target.home.winner=selected.homeScore>selected.awayScore;
   target.statusKey='final';target.statusLabel='Final';target.detail=basis==='regulation'?'Final (local regulation result)':`Final (local result); ${previousDetail}`;
   target.manualResultEvidence={kind:'manual_result',eventIdentityVerified:scoped(selected),identityPolicy:scoped(selected)?'explicit_scope_and_unique_ordered_pair':'unique_legacy_pair_only',
    recordIds:rows.slice(0,20).map(row=>row.recordId),recordedAt:selected.recordedAt,observedAt:selected.observedAt||selected.recordedAt,observedAtKind:selected.observedAt?'operator_supplied_observation':'local_recording_receipt',
    recordedBy:selected.recordedBy,sourceChecked:reviewed.includes(selected),sourceReference:selected.sourceReference,scoreBasis:basis,underlyingPublicationVerified:false};
   target.source=String(target.source||'Manual source')+' + local result';
  }
  for(const row of rows)audit.push({recordId:row.recordId,status:'applied',event:eventReference(targets[0]),identityVerified:scoped(row)});
 }
 return games;
}
