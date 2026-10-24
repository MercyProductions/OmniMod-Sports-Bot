import {quoteTimeEpoch} from './oddsPricing.js';
import {capturedEventTime} from './capturedEventTime.js';

/** Receipt/binding checks for descriptive season context, not starter or medical verification. */
export function nativeGoalieContextState(payload,game,{fetchedAt,cacheState,asOf=Date.now()}={}){
 const start=capturedEventTime(game?.startTime),receipt=quoteTimeEpoch(fetchedAt),native=/^nhl-(\d+)$/.exec(String(game?.id||''));
 if(![asOf,start,receipt].every(Number.isFinite)||receipt>asOf||asOf>=start)return 'invalid_pregame_chronology';
 if(asOf-receipt>15*60000||!['network','fresh','revalidated'].includes(cacheState))return 'goalie_context_receipt_expired_or_unverified';
 if(game.leagueKey!=='nhl'||game.statusKey!=='scheduled'||!native||String(payload?.id)!==native[1]
  ||capturedEventTime(payload?.startTimeUTC)!==start||!['FUT','PRE'].includes(payload?.gameState)
  ||payload?.gameScheduleState&&payload.gameScheduleState!=='OK')return 'event_identity_or_state_mismatch';
 for(const side of ['away','home'])if(!/^\d+$/.test(String(game[side]?.id||''))||String(payload[side+'Team']?.id)!==String(game[side].id)
  ||!game[side].abbr||payload[side+'Team']?.abbrev!==game[side].abbr)return 'team_identity_mismatch';
 if(game.away.id===game.home.id||game.away.abbr===game.home.abbr)return 'team_identity_mismatch';
 if(game.seasonYear&&String(game.seasonYear).length===8&&game.seasonYear!==payload.season)return 'season_mismatch';
 return null;
}

export function retainedGoalieContextState(evidence,game,asOf){
 if(!evidence||evidence.status==='unavailable')return evidence?.reason||'goalie_context_unavailable';
 if(evidence.schema!=='sports-nhl-goalie-research-v1'||!evidence.sourceEvent)return 'goalie_context_binding_unverified';
 return nativeGoalieContextState(evidence.sourceEvent,game,{fetchedAt:evidence.fetchedAt,cacheState:evidence.cacheState,asOf});
}
