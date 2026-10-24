import {normalizeEntityName} from './intelligenceStore.js';
import {capturedEventTime} from './capturedEventTime.js';
import {quoteTimeEpoch} from './oddsPricing.js';
import {availabilitySourceRows,reconcileAvailabilityRows} from './availabilityReconciliation.js';
import {scoreboardStarterInputState} from './scoreboardStarters.js';

const TTL=15*60000,sides=['away','home'],schema='sports-official-schedule-event-v1';
const nativeId=value=>typeof value==='number'&&Number.isSafeInteger(value)&&value>0&&value<1e12||typeof value==='string'&&/^[1-9]\d{0,11}$/.test(value);
const canonical=value=>value&&typeof value==='object'?Array.isArray(value)?value.map(canonical):Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const same=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
export const legacyOfficialProjection=row=>!row.officialProjection&&(row.source==='MLB StatsAPI probable pitcher'||Array.isArray(row.sources)&&row.sources.includes('MLB StatsAPI probable pitcher')&&!row.summaryObservationType&&!row.scoreboardProjection&&!row.availabilityProvider);
const localEvent=game=>({id:String(game.id),leagueKey:game.leagueKey,startTime:Number.isFinite(capturedEventTime(game.startTime))?new Date(capturedEventTime(game.startTime)).toISOString():null,
 seasonYear:game.seasonYear??null,seasonType:game.seasonType??null,sourceProvider:game.sourceMeta?.provider||null,
 ...Object.fromEntries(sides.map(side=>[side,{id:String(game[side]?.id||''),name:normalizeEntityName(game[side]?.name),abbr:game[side]?.abbr||''}]))});
function sourceEvent(row,provider){
 const mlb=provider==='MLB StatsAPI',status=mlb?String(row.status?.abstractGameState||'').toLowerCase():String(row.gameState||'').toUpperCase();
 const special=mlb&&/postponed|cancelled|canceled|suspended|delayed/i.test(row.status?.detailedState||'');
 const statusKey=special?'unavailable':mlb?['final','completed'].includes(status)?'final':status==='live'?'live':status==='preview'?'scheduled':'unknown'
  :['OFF','FINAL'].includes(status)?'final':['LIVE','CRIT'].includes(status)?'live':['FUT','PRE'].includes(status)?'scheduled':'unknown';
 return {id:String(mlb?row.gamePk:row.id),startTime:mlb?row.gameDate:row.startTimeUTC,season:row.season??null,statusKey,
  ...Object.fromEntries(sides.map(side=>{const team=mlb?row.teams?.[side]?.team:row[side+'Team'];return [side,{id:String(team?.id||''),abbr:mlb?team?.abbreviation:team?.abbrev,
   names:(mlb?[team?.name]:[team?.name?.default,team?.commonName?.default,team?.placeName?.default&&team?.commonName?.default?team.placeName.default+' '+team.commonName.default:null]).filter(Boolean),
   probable:mlb?row.teams?.[side]?.probablePitcher||null:null}];}))};
}
function teamsMatch(game,event){
 return sides.every(side=>Boolean(game[side]?.abbr)&&event?.[side]?.abbr===game[side].abbr&&Array.isArray(event[side].names)&&event[side].names.some(name=>
  [game[side].name,...(game[side].aliases||[])].filter(Boolean).map(normalizeEntityName).includes(normalizeEntityName(name))));
}
function sourceContextReason(event,game,provider){
 if(game.leagueKey!==(provider==='MLB StatsAPI'?'mlb':'nhl'))return 'provider_league_mismatch';
 if(provider==='NHL API'&&game.sourceMeta?.provider==='NHL API'){
  const id=/^nhl-(\d+)$/.exec(String(game.id));
  if(!id||id[1]!==event.id||sides.some(side=>String(game[side]?.id)!==event[side].id))return 'native_event_or_team_id_conflict';
 }
 if(game.seasonYear!==undefined&&event.season!==null&&String(game.seasonYear).length===String(event.season).length&&String(game.seasonYear)!==String(event.season))return 'source_season_conflict';
 return null;
}
/** Exact ordered teams/start; provider IDs are not guessed across namespaces. */
export function matchOfficialScheduleEvent(rows,game,provider){
 const candidates=rows.filter(row=>row&&typeof row==='object'&&!Array.isArray(row)).map(row=>sourceEvent(row,provider)).filter(row=>teamsMatch(game,row));
 const start=capturedEventTime(game.startTime),matching=candidates.filter(row=>Number.isFinite(start)&&capturedEventTime(row.startTime)===start);
 if(matching.length!==1)return {reason:matching.length?'ambiguous_source_event':candidates.length?'start_mismatch_or_invalid':'ordered_team_identity_unmatched'};
 const event=matching[0];if(!nativeId(event.id))return {reason:'native_event_id_invalid'};
 const reason=sourceContextReason(event,game,provider);return reason?{reason}:{event};
}
export function officialCorroborationInputState(record,game,now){
 if(!Number.isFinite(now))throw Error('Valid official-source cutoff required');
 if(record?.schema!==schema||!['MLB StatsAPI','NHL API'].includes(record.provider)||!same(record.localEvent,localEvent(game)))return 'local_event_binding_mismatch';
 const receipt=quoteTimeEpoch(record.fetchedAt),expires=quoteTimeEpoch(record.expiresAt);
 if(!Number.isFinite(receipt)||receipt>now||now-receipt>=TTL||expires!==receipt+TTL||expires<=now||!['network','fresh','revalidated'].includes(record.cacheState))return 'receipt_stale_future_or_unverified';
 if(!nativeId(record.sourceEvent?.id)||record.eventId!==record.sourceEvent.id||capturedEventTime(record.sourceEvent?.startTime)!==capturedEventTime(game.startTime)||!teamsMatch(game,record.sourceEvent))return 'source_event_binding_mismatch';
 const context=sourceContextReason(record.sourceEvent,game,record.provider);if(context)return context;
 const independent=Boolean(game.sourceMeta?.provider)&&normalizeEntityName(game.sourceMeta.provider)!==normalizeEntityName(record.provider);
 if(record.independentFromSchedule!==independent||record.conflict!==(record.sourceEvent.statusKey==='unknown'||record.sourceEvent.statusKey!==game.statusKey))return 'corroboration_flags_conflict';
 return null;
}
export function officialProjectionInputState(row,game,now){
 const record=row.officialProjectionEvidence,state=officialCorroborationInputState(record,game,now);if(state)return state;
 if(!same(game.officialStarterEvidence,record))return 'projection_snapshot_no_longer_selected';
 const side=row.officialProjectionSide,start=capturedEventTime(game.startTime),probable=record.sourceEvent?.[side]?.probable;
 if(game.leagueKey!=='mlb'||game.statusKey!=='scheduled'||record.conflict||record.sourceEvent.statusKey!=='scheduled'||now>=start)return 'not_eligible_pregame_projection';
 if(!sides.includes(side)||!nativeId(probable?.id)||row.sourceAthleteId!=='mlb:'+probable.id||row.playerIdNamespace!=='mlb'||row.name!==probable.fullName
  ||normalizeEntityName(row.team)!==normalizeEntityName(game[side].name||game[side].abbr)||row.role!=='Starting Pitcher'||row.starter!==true||row.confirmedStarter!==false||row.availability!==null
  ||quoteTimeEpoch(row.updatedAt)!==quoteTimeEpoch(record.fetchedAt)||quoteTimeEpoch(row.availabilityExpiresAt)!==Math.min(quoteTimeEpoch(record.expiresAt),start))return 'projection_source_binding_mismatch';
 return null;
}
/** Consume an already collected API payload; never performs network, orders or model activation. */
export function applyOfficialSchedulePayload(games,payload,{provider,fetchedAt,cacheState,now=Date.now()}={}){
 if(!Number.isFinite(now))throw Error('Valid official schedule cutoff required');
 const league=provider==='MLB StatsAPI'?'mlb':provider==='NHL API'?'nhl':null;if(!league)throw Error('Unsupported official schedule provider');
 const rows=league==='mlb'?(Array.isArray(payload?.dates)?payload.dates.flatMap(day=>Array.isArray(day?.games)?day.games:[]):[]):Array.isArray(payload?.games)?payload.games:[],rejected={},reject=reason=>rejected[reason]=(rejected[reason]||0)+1;
 let matched=0,probableStarters=0,addedProjections=0;
 const selected=games.filter(game=>game.leagueKey===league).map(game=>({game,...matchOfficialScheduleEvent(rows,game,provider)}));
 for(const selection of selected){
  const {game,event}=selection,old=game.sourceCorroboration||{};
  game.sourceCorroboration={...old,providers:(old.providers||[]).filter(name=>name!==provider),matches:(old.matches||[]).filter(row=>row.provider!==provider),conflicts:(old.conflicts||[]).filter(row=>row.provider!==provider)};
  const players=availabilitySourceRows(game.autoPlayers||[]).filter(row=>(!row.officialProjection||row.officialProjectionEvidence?.provider!==provider)&&(league!=='mlb'||!legacyOfficialProjection(row)));
  if(league==='mlb')game.autoPlayers=reconcileAvailabilityRows(players,availabilitySourceRows(game.autoLineups||[]));
  if(league==='mlb')game.officialStarterEvidence=null;
  if(selection.reason){reject(selection.reason);continue;}
  if(selected.filter(other=>other.event?.id===event.id).length!==1){reject('ambiguous_local_event_alias');continue;}
  const receipt=quoteTimeEpoch(fetchedAt),record={schema,provider,eventId:event.id,localEvent:localEvent(game),sourceEvent:event,fetchedAt,cacheState,
   expiresAt:Number.isFinite(receipt)?new Date(receipt+TTL).toISOString():null,startDeltaMinutes:0,status:event.statusKey,
   conflict:event.statusKey==='unknown'||event.statusKey!==game.statusKey,independentFromSchedule:Boolean(game.sourceMeta?.provider)&&normalizeEntityName(game.sourceMeta.provider)!==normalizeEntityName(provider),
   nativePublicationVerified:false,identityPolicy:'Exact ordered team names/abbreviations and start; local and native IDs kept in separate namespaces.'};
  const state=officialCorroborationInputState(record,game,now);if(state){reject(state);continue;}
  matched++;game.sourceCorroboration[record.conflict?'conflicts':'matches'].push(record);
  if(!record.conflict&&record.independentFromSchedule&&!game.sourceCorroboration.providers.includes(provider))game.sourceCorroboration.providers.push(provider);
  if(league!=='mlb')continue;
  game.officialStarterEvidence=record;
  if(record.conflict||game.statusKey!=='scheduled'||event.statusKey!=='scheduled'||now>=capturedEventTime(game.startTime)){reject('not_eligible_pregame_projection');continue;}
  const candidates=sides.map(side=>({side,probable:event[side].probable})).filter(row=>row.probable);
  const ids=candidates.filter(row=>nativeId(row.probable.id)).map(row=>String(row.probable.id));
  if(new Set(ids).size!==ids.length){reject('cross_team_probable_player_conflict');continue;}
  for(const {side,probable} of candidates){
   if(!nativeId(probable.id)||typeof probable.fullName!=='string'||!probable.fullName.trim()){reject('invalid_probable_player_identity');continue;}
   probableStarters++;
   const existing=players.filter(row=>normalizeEntityName(row.team)===normalizeEntityName(game[side].name||game[side].abbr)).filter(row=>{
    let reason=row.scoreboardProjection?scoreboardStarterInputState(row,game,now):null;
    if(row.availabilityExpiresAt!==undefined&&(!Number.isFinite(quoteTimeEpoch(row.availabilityExpiresAt))||quoteTimeEpoch(row.availabilityExpiresAt)<=now))reason||='assertion_expired_or_invalid';
    if(row.summaryObservationType&&game.autoEnrichment&&(game.autoEnrichment.sourceIdentity?.status==='conflict'||!Number.isFinite(quoteTimeEpoch(game.autoEnrichment.fetchedAt))||quoteTimeEpoch(game.autoEnrichment.fetchedAt)>now))reason||='summary_parent_unavailable';
    if(reason){reject('blocking_input_'+reason);return false;}return true;
   });
   if(existing.some(row=>normalizeEntityName(row.name)===normalizeEntityName(probable.fullName)||row.sourceAthleteId==='mlb:'+probable.id||/starting pitcher|\bsp\b/i.test(row.role||''))){reject('existing_player_or_role_no_namespace_bridge');continue;}
   players.push({id:'official-mlb-'+event.id+'-'+probable.id,sourceAthleteId:'mlb:'+probable.id,playerIdNamespace:'mlb',name:probable.fullName,team:game[side].name||game[side].abbr,
    league:game.league,leagueKey:game.leagueKey,role:'Starting Pitcher',impact:6,availability:null,availabilityEvidence:'role_prior_not_injury_clearance',status:'Projected starter; health unknown',
    starter:true,confirmedStarter:false,confirmationStatus:'projected',form:50,stats:{},source:'MLB StatsAPI probable pitcher',sources:['MLB StatsAPI probable pitcher'],autoGenerated:true,
    officialProjection:true,officialProjectionSide:side,officialProjectionEvidence:structuredClone(record),updatedAt:fetchedAt,
    availabilityExpiresAt:new Date(Math.min(receipt+TTL,capturedEventTime(game.startTime))).toISOString()});addedProjections++;
  }
  game.autoPlayers=reconcileAvailabilityRows(players,availabilitySourceRows(game.autoLineups||[]));
 }
 return {matched,probableStarters,addedProjections,confirmedStarters:0,rejected};
}

/** Remove obsolete scoped evidence before confidence calculation; retain other providers separately. */
export function selectOfficialCorroboration(value,game,now,reject){
 if(!value)return value;
 if(typeof value!=='object'||Array.isArray(value)||['matches','conflicts','providers'].some(key=>value[key]!==undefined&&!Array.isArray(value[key]))
  ||[...(value.matches||[]),...(value.conflicts||[])].some(row=>!row||typeof row!=='object'||Array.isArray(row))
  ||(value.providers||[]).some(provider=>typeof provider!=='string'||!provider.trim())){reject('official_corroboration:invalid_collection_shape');return null;}
 const known=[...(value.matches||[]),...(value.conflicts||[])].filter(row=>row.schema===schema),providers=new Set(known.map(row=>row.provider));
 if(!known.length)return value;
 const keep=row=>{if(row.schema!==schema)return true;const state=officialCorroborationInputState(row,game,now);if(state){reject('official_corroboration:'+state);return false;}return true;};
 const matches=(value.matches||[]).filter(keep),conflicts=(value.conflicts||[]).filter(keep);
 return {...value,matches,conflicts,providers:[...new Set([...(value.providers||[]).filter(provider=>!providers.has(provider)),...matches.filter(row=>row.schema===schema&&row.independentFromSchedule&&!row.conflict).map(row=>row.provider)])]};
}
