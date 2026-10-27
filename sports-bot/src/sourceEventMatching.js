import {eventObservationHash} from './journalEventMatch.js';
import {normalizeEntityName} from './intelligenceStore.js';
import {eventReference} from './slateEventIdentity.js';
import {mappedSourceEventsMatch} from './espnEventMapping.js';

/** Source aliases may differ in native ID, but never in known league, start or ordered teams. */
export function sourceEventsMatch(left={},right={}){
 const a=eventReference(left),b=eventReference(right);
 if(!a.leagueKey||a.leagueKey.toLowerCase()!==b.leagueKey.toLowerCase()||!a.startTime||a.startTime!==b.startTime)return false;
 const id=value=>value!==undefined&&value!==null&&String(value)!=='';
 if(id(left.id)&&id(right.id)&&String(left.id)===String(right.id))return true;
 if(mappedSourceEventsMatch(left,right)||mappedSourceEventsMatch(right,left))return true;
 const names=game=>[normalizeEntityName(game.away?.name),normalizeEntityName(game.home?.name)];
 const [away,home]=names(left),[otherAway,otherHome]=names(right);
 return Boolean(away&&home&&otherAway&&otherHome&&away===otherAway&&home===otherHome);
}

export function matchSourceEvent(games=[],subject={}){
 const candidates=games.filter(game=>sourceEventsMatch(game,subject));
 const unique=[...new Map(candidates.map(game=>[eventObservationHash(game),game])).values()];
 return unique.length===1?{game:unique[0],observations:unique,reason:null}
  :{game:null,observations:unique,reason:unique.length?'ambiguous_source_observations':'source_event_not_matched'};
}
