import {capturedEventTime} from './capturedEventTime.js';
import {quoteTimeEpoch} from './oddsPricing.js';
import {normalizeEntityName} from './intelligenceStore.js';

const TTL=15*60000,sides=['away','home'],sourceSchema='sports-espn-scoreboard-mapping-source-v1',schema='sports-espn-event-mapping-v1';
const nativeId=value=>typeof value==='string'&&/^[1-9]\d{0,11}$/.test(value);
const text=value=>typeof value==='string'&&value.trim()&&value.length<=160;
const fresh=(meta,now)=>['network','fresh','revalidated'].includes(meta?.cacheState)&&!meta.upstreamError
 &&Number.isFinite(quoteTimeEpoch(meta.fetchedAt))&&quoteTimeEpoch(meta.fetchedAt)<=now&&now-quoteTimeEpoch(meta.fetchedAt)<TTL;
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const localEvent=game=>({id:String(game.id),leagueKey:game.leagueKey,startTime:new Date(capturedEventTime(game.startTime)).toISOString(),
 seasonYear:game.seasonYear??null,seasonType:game.seasonType??null,
 ...Object.fromEntries(sides.map(side=>[side,{id:String(game[side]?.id||''),name:game[side]?.name||'',abbr:game[side]?.abbr||''}]))});

/** ESPN NHL seasons name the ending year; NHL native seasons declare YYYY(YYYY+1). */
export function espnExpectedSeasonYear(game){
 const value=game.seasonYear;
 if(game.leagueKey==='nhl'&&game.sourceMeta?.provider==='NHL API'&&/^\d{8}$/.test(String(value))){
  const year=Number(String(value).slice(0,4)),end=Number(String(value).slice(4));return end===year+1?end:null;
 }
 return value;
}

/** Retain explicit scoreboard fields, never a name-derived ID or fallback competitor order. */
export function espnScoreboardMappingSource(event,game){
 if(game.leagueKey!=='nhl'||!['ESPN','ESPN CDN'].includes(game.sourceMeta?.provider)||!nativeId(game.id)
  ||!Array.isArray(event?.competitions)||event.competitions.length!==1)return null;
 const competition=event.competitions[0],source={schema:sourceSchema,id:game.id,leagueKey:game.leagueKey,startTime:game.startTime,
  seasonYear:game.seasonYear,seasonType:game.seasonType,statusKey:game.statusKey,
  fetchedAt:game.sourceMeta.fetchedAt||null,cacheState:game.sourceMeta.cacheState||'unknown',upstreamError:game.sourceMeta.upstreamError||null};
 if([event.id,competition?.id].some(id=>id!==undefined&&String(id)!==game.id)
  ||[event.date,competition?.date].some(date=>date!==undefined&&capturedEventTime(date)!==capturedEventTime(game.startTime)))return null;
 for(const side of sides){
  const rows=competition?.competitors?.filter(row=>row?.homeAway===side);
  if(!Array.isArray(rows)||rows.length!==1)return null;
  const team=rows[0].team,names=[team?.displayName,team?.shortDisplayName,team?.name].filter(text);
  if(!nativeId(String(team?.id||''))||!names.length||!text(team?.abbreviation))return null;
  source[side]={id:String(team.id),names:[...new Set(names)],abbr:team.abbreviation};
 }
 return source.away.id!==source.home.id?source:null;
}

function sourceState(source,now){
 if(source?.schema!==sourceSchema||source.leagueKey!=='nhl'||!nativeId(source.id)||source.statusKey!=='scheduled'
  ||!Number.isFinite(capturedEventTime(source.startTime))||now>=capturedEventTime(source.startTime))return 'source_event_unverified';
 if(!fresh(source,now))return 'source_receipt_stale_future_or_unverified';
 for(const side of sides)if(!nativeId(source[side]?.id)||!text(source[side]?.abbr)||!Array.isArray(source[side]?.names)
  ||!source[side].names.length||source[side].names.length>3||!source[side].names.every(text))return 'source_team_unverified';
 if(source.away.id===source.home.id)return 'source_team_conflict';
 return null;
}
function contextState(game,source){
 if(game.leagueKey!=='nhl'||game.sourceMeta?.provider!=='NHL API'||!/^nhl-[1-9]\d{0,11}$/.test(String(game.id))
  ||capturedEventTime(source.startTime)!==capturedEventTime(game.startTime))return 'local_event_unmatched';
 const year=espnExpectedSeasonYear(game);
 if(year===null||source.seasonYear!==year||source.seasonType!==game.seasonType)return 'source_season_unmatched';
 for(const side of sides)if(!nativeId(String(game[side]?.id||''))||!text(game[side]?.name)||!text(game[side]?.abbr)
  ||!source[side].names.map(normalizeEntityName).includes(normalizeEntityName(game[side].name)))return 'ordered_team_unmatched';
 if(String(game.away.id)===String(game.home.id))return 'local_team_conflict';
 return null;
}
export function espnEventMappingState(record,game,now=Date.now()){
 if(!Number.isFinite(now))throw Error('Valid mapping cutoff required');
 if(record?.schema!==schema||record.status!=='matched'||!Number.isFinite(capturedEventTime(game.startTime)))return 'mapping_unverified';
 if(!same(record.localEvent,localEvent(game))||game.statusKey!=='scheduled')return 'mapping_local_binding_mismatch';
 const state=sourceState(record.sourceEvent,now)||contextState(game,record.sourceEvent);if(state)return state;
 const bound=quoteTimeEpoch(record.boundAt),receipt=quoteTimeEpoch(record.fetchedAt),nativeReceipt=quoteTimeEpoch(record.nativeReceiptAt);
 if(![bound,receipt,nativeReceipt].every(Number.isFinite)||bound>now||bound<receipt||bound<nativeReceipt||record.recordedAt!==record.boundAt
  ||now-nativeReceipt>=TTL||receipt!==quoteTimeEpoch(record.sourceEvent.fetchedAt)
  ||record.expiresAt!==new Date(Math.min(receipt+TTL,nativeReceipt+TTL,capturedEventTime(game.startTime))).toISOString()
  ||quoteTimeEpoch(record.expiresAt)<=now||String(game.espnEventId)!==record.sourceEvent.id)return 'mapping_receipt_or_id_unverified';
 return null;
}

/** Use only already collected, fresh exact ESPN/NHL observations. No requests or invented IDs. */
export function bindEspnSummaryMappings(games,sources,{now=Date.now()}={}){
 if(!Number.isFinite(now))throw Error('Valid mapping clock required');
 const result={eligible:0,mapped:0,rejected:{},providerRequests:0};
 const reject=reason=>{result.rejected[reason]=(result.rejected[reason]||0)+1;};
 const observations=sources.map(game=>game.summaryMappingSource).filter(source=>source&&!sourceState(source,now));
 for(const game of games){
  if(game.leagueKey!=='nhl'||game.sourceMeta?.provider!=='NHL API'||game.statusKey!=='scheduled'
   ||game.espnEventId!==undefined&&!game.espnEventMapping)continue;
  result.eligible++;
  if(game.espnEventMapping&&!espnEventMappingState(game.espnEventMapping,game,now)){
   const original=game.espnEventMapping.sourceEvent;
   const competing=observations.filter(source=>source.id===original.id||!contextState(game,source));
   const identity=source=>JSON.stringify([source.id,source.startTime,source.seasonYear,source.seasonType,source.away,source.home]);
   if(competing.some(source=>identity(source)!==identity(original))){delete game.espnEventMapping;delete game.espnEventId;reject('conflicting_espn_event_observations');continue;}
   result.mapped++;continue;
  }
  delete game.espnEventMapping;delete game.espnEventId;
  if(!fresh(game.sourceMeta,now)||now>=capturedEventTime(game.startTime)){reject('native_receipt_or_status_unverified');continue;}
  const candidates=observations.filter(source=>!contextState(game,source)),ids=[...new Set(candidates.map(source=>source.id))];
  if(ids.length!==1){reject(ids.length?'ambiguous_espn_events':'matching_espn_observation_unavailable');continue;}
  const sameId=observations.filter(source=>source.id===ids[0]);
  const identities=new Set(sameId.map(source=>JSON.stringify([source.startTime,source.seasonYear,source.seasonType,source.away,source.home])));
  if(identities.size!==1){reject('conflicting_espn_event_observations');continue;}
  const source=candidates.sort((a,b)=>quoteTimeEpoch(b.fetchedAt)-quoteTimeEpoch(a.fetchedAt))[0];
  const receipt=quoteTimeEpoch(source.fetchedAt),nativeReceipt=quoteTimeEpoch(game.sourceMeta.fetchedAt);
  game.espnEventId=source.id;
  game.espnEventMapping={schema,status:'matched',localEvent:localEvent(game),sourceEvent:structuredClone(source),
   fetchedAt:source.fetchedAt,nativeReceiptAt:game.sourceMeta.fetchedAt,boundAt:new Date(now).toISOString(),recordedAt:new Date(now).toISOString(),
   expiresAt:new Date(Math.min(receipt+TTL,nativeReceipt+TTL,capturedEventTime(game.startTime))).toISOString(),
   publicationTimeVerified:false,independentlyVerified:false};
  result.mapped++;
 }
 return result;
}

export function mappedEspnTeams(game,now=Date.now()){
 const record=game.espnEventMapping;
 return record&&!espnEventMappingState(record,game,now)?record.sourceEvent:null;
}

/** Historic alias identity may outlive routing freshness; it grants no current input authority. */
export function mappedSourceEventsMatch(native,other){
 const record=native.espnEventMapping,at=quoteTimeEpoch(record?.boundAt);
 if(!record||!Number.isFinite(at)||espnEventMappingState(record,native,at)||!['ESPN','ESPN CDN'].includes(other.sourceMeta?.provider)
  ||String(other.id)!==record.sourceEvent.id||other.leagueKey!==native.leagueKey
  ||capturedEventTime(other.startTime)!==capturedEventTime(native.startTime))return false;
 return sides.every(side=>String(other[side]?.id)===record.sourceEvent[side].id
  &&record.sourceEvent[side].names.map(normalizeEntityName).includes(normalizeEntityName(other[side]?.name)));
}
