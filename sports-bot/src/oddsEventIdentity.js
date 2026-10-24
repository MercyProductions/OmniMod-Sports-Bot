import {oddsTeamNames} from './nhlTeamIdentity.js';
import {normalizeEntityName} from './intelligenceStore.js';
import {eventObservationHash} from './journalEventMatch.js';
import {scopedEventKey,eventReference} from './slateEventIdentity.js';
const timestamp=value=>typeof value==='string'&&/[Tt].*(?:[Zz]|[+-]\d{2}:\d{2})$/.test(value)&&Number.isFinite(Date.parse(value));
const id=value=>value!==null&&value!==undefined&&String(value).trim()!=='';

export function inspectOddsEventCandidate(game={},event={},sportKey='',options={}){
 const reasons=[],away=oddsTeamNames(game,'away',options),home=oddsTeamNames(game,'home',options),providerAway=normalizeEntityName(event?.away_team),providerHome=normalizeEntityName(event?.home_team);
 if(!sportKey||!game.leagueKey)reasons.push('local_sport_scope_unverified');
 if(event?.sport_key&&event.sport_key!==sportKey)reasons.push('provider_sport_mismatch');
 if(!away.size||!home.size||[...away].some(name=>home.has(name))||!providerAway||!providerHome||!away.has(providerAway)||!home.has(providerHome))reasons.push('ordered_team_mismatch');
 if(!timestamp(game.startTime)||!timestamp(event?.commence_time))reasons.push('event_timestamp_unverified');
 else if(Math.abs(Date.parse(game.startTime)-Date.parse(event.commence_time))>60*60000)reasons.push('event_start_outside_tolerance');
 if(!id(event?.id))reasons.push('provider_event_id_missing');
 const bound=game.odds?.eventId&&!game.odds.freeProvider?String(game.odds.eventId):null;
 if(bound&&String(event?.id)!==bound)reasons.push('bound_provider_event_id_mismatch');
 const nativeIdentityUsed=!['name','abbr'].some(key=>normalizeEntityName(game.away?.[key])===providerAway)||!['name','abbr'].some(key=>normalizeEntityName(game.home?.[key])===providerHome);
 return {eligible:reasons.length===0,reasons,nativeIdentityUsed:nativeIdentityUsed&&reasons.length===0,nativeIdentityFetchedAt:nativeIdentityUsed&&reasons.length===0?game.nhlTeamIdentity?.fetchedAt||null:null,eventId:id(event?.id)?String(event.id):null,sportKey:event?.sport_key||null,
  providerSportKeyVerified:Boolean(sportKey&&event?.sport_key===sportKey),startTime:timestamp(event?.commence_time)?new Date(event.commence_time).toISOString():null};
}

export function inspectOddsEventMatch(game,events=[],sportKey='',options={}){
 const observations=Array.isArray(events)?events:[],candidates=[];
 const inspected=observations.map(event=>({event,evidence:inspectOddsEventCandidate(game,event,sportKey,options)}));
 for(const row of inspected)if(row.evidence.eligible)candidates.push(row);
 const unique=[...new Map(candidates.map(row=>[eventObservationHash(row.event),row])).values()];
 const selected=unique.length===1?unique[0]:null;
 return {event:selected?.event||null,evidence:{status:selected?'matched':'rejected',reason:selected?null:unique.length?'ambiguous_provider_events':'no_verified_provider_event',
  policy:'ordered-teams-scoped-native-names-bound-id-unique-observation-v2',nativeIdentityUsed:selected?.evidence.nativeIdentityUsed||false,nativeIdentityFetchedAt:selected?.evidence.nativeIdentityFetchedAt||null,eventId:selected?.evidence.eventId||null,providerSportKeyVerified:selected?.evidence.providerSportKeyVerified||false,
  sportScope:selected?.evidence.providerSportKeyVerified?'native_verified':'request_scoped_native_unverified',startToleranceMinutes:60,
  startDifferenceMs:selected?Date.parse(selected.event.commence_time)-Date.parse(game.startTime):null,
  candidateCount:unique.length,rejectedCount:inspected.filter(row=>!row.evidence.eligible).length,
  observations:inspected.slice(0,10).map(row=>({...row.evidence,observationHash:eventObservationHash(row.event)})),observationsTruncated:inspected.length>10}};
}

/** One provider event must not be reused for different local scoped games. */
export function matchOddsEventCohort(games,events,sportKey,options={}){
 const matches=new Map(),owners=new Map(),local=new Map();
 for(const game of games){const key=scopedEventKey(eventReference(game));if(!local.has(key))local.set(key,[]);local.get(key).push(game);}
 for(const [scope,rows] of local){
  if(new Set(rows.map(eventObservationHash)).size>1){matches.set(scope,{event:null,evidence:{status:'rejected',reason:'ambiguous_local_event_observations',localObservationCount:rows.length}});continue;}
  const game=rows[0];
  const key=scopedEventKey(eventReference(game)),match=inspectOddsEventMatch(game,events,sportKey,options);matches.set(key,match);
  if(match.event){const providerId=String(match.event.id);if(!owners.has(providerId))owners.set(providerId,new Set());owners.get(providerId).add(key);}
 }
 for(const [key,match] of matches)if(match.event&&owners.get(String(match.event.id)).size>1)matches.set(key,{event:null,evidence:{...match.evidence,status:'rejected',reason:'provider_event_reused_across_local_games',localEventCount:owners.get(String(match.event.id)).size}});
 return matches;
}
