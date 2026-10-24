import {quoteTimeEpoch} from './oddsPricing.js';
import {capturedEventTime} from './capturedEventTime.js';
const empty=reason=>({wins:0,losses:0,ties:0,games:0,pct:.5,present:false,reason});
function seasonStart(value){
 const text=String(value||'');if(/^\d{4}$/.test(text))return Number(text);
 if(/^\d{8}$/.test(text)&&Number(text.slice(4))===Number(text.slice(0,4))+1)return Number(text.slice(0,4));
 return null;
}
/** A record percentage is a descriptive result fraction, not a calibrated forecast probability. */
export function parseTeamRecord(record,game={}){
 if(String(game.leagueKey||game.league||'').toLowerCase()==='nhl'){
  const year=seasonStart(game.seasonYear);
  if(year===null||year<2005||game.seasonType!==2)return empty('nhl_record_period_or_format_unverified');
  const match=typeof record==='string'&&/^(\d+)-(\d+)-(\d+)$/.exec(record);
  if(!match)return empty('native_w_l_otl_format_required');
  const [wins,regulationLosses,overtimeLosses]=match.slice(1).map(Number),games=wins+regulationLosses+overtimeLosses;
  // Calendar-scale sanity bound only; not an assertion of the NHL schedule length.
  if(![wins,regulationLosses,overtimeLosses,games].every(Number.isSafeInteger)||games>366)return empty('invalid_or_unbounded_record_counts');
  return {wins,regulationLosses,overtimeLosses,losses:regulationLosses+overtimeLosses,ties:0,games,pct:games?wins/games:.5,present:games>0,format:'NHL_W_L_OTL',reason:games?null:'zero_games'};
 }
 // Preserve the established non-NHL format behavior; its provider-specific formats remain a separate audit.
 const numbers=String(record??'').match(/\d+(?:\.\d+)?/g)?.map(Number)??[];
 if(numbers.length<2)return empty('record_missing');
 const [wins,losses,ties=0]=numbers,games=wins+losses+ties;
 return {wins,losses,ties,games,pct:games?(wins+.5*ties)/games:.5,present:games>0,format:'legacy_non_nhl_w_l_t',reason:games?null:'zero_games'};
}
/** Only current pregame regular-season assertions; never infer a historical pregame record from a final. */
export function nativeNhlRecordEvidence(game,side,sourceMeta={}, {asOf=Date.now()}={}){
 const team=game?.[side+'Team'],receipt=quoteTimeEpoch(sourceMeta.fetchedAt),start=capturedEventTime(game?.startTimeUTC),year=seasonStart(game?.season);
 const base={schema:'sports-native-nhl-record-v1',raw:typeof team?.record==='string'?team.record.slice(0,128):null,status:'unavailable',format:'NHL_W_L_OTL',eventId:String(game?.id||''),teamId:String(team?.id||''),seasonYear:game?.season??null,seasonType:game?.gameType??null,
  fetchedAt:Number.isFinite(receipt)?new Date(receipt).toISOString():null,cacheState:sourceMeta.cacheState||'unknown',sourceObservationAt:null,nativePublicationVerified:false};
 const fail=reason=>({...base,reason});
 if(![receipt,start,asOf].every(Number.isFinite)||receipt>asOf||asOf-receipt>15*60000||asOf>=start)return fail('record_receipt_not_current_pregame');
 if(!['network','fresh','revalidated'].includes(sourceMeta.cacheState))return fail('record_cache_freshness_unverified');
 if(!['FUT','PRE'].includes(game.gameState)||game.gameScheduleState&&game.gameScheduleState!=='OK')return fail('native_event_not_scheduled');
 if(year===null||year<2005||game.gameType!==2||new Date(start).getUTCFullYear()<year||new Date(start).getUTCFullYear()>year+1
  ||new Date(receipt).getUTCFullYear()<year||new Date(receipt).getUTCFullYear()>year+1)return fail('native_record_season_or_period_unverified');
 const teams=[game.awayTeam,game.homeTeam];
 if(!/^\d+$/.test(String(game.id||''))||teams.some(row=>!/^\d+$/.test(String(row?.id||''))||!row.abbrev)||String(teams[0].id)===String(teams[1].id)||teams[0].abbrev===teams[1].abbrev)return fail('native_record_team_identity_unverified');
 const stats=parseTeamRecord(team.record,{leagueKey:'nhl',seasonYear:game.season,seasonType:game.gameType});
 if(!stats.format)return fail(stats.reason);
 const sourceEvent={id:game.id,season:game.season,gameType:game.gameType,gameState:game.gameState,gameScheduleState:game.gameScheduleState,startTimeUTC:game.startTimeUTC,
  ...Object.fromEntries(['away','home'].map(key=>[key+'Team',{id:game[key+'Team'].id,abbrev:game[key+'Team'].abbrev,record:game[key+'Team'].record}]))};
 return {...base,...stats,status:stats.present?'parsed_native_assertion':'zero_games',reason:stats.reason,sourceEvent,scope:'pregame_regular_season_full_game_results_not_standings_point_percentage'};
}

/** Recheck stored assertions at each inference; a once-fresh parsed row cannot be transplanted or extended. */
export function nativeNhlRecordInputState(evidence,game,side,asOf){
 if(evidence?.schema!=='sports-native-nhl-record-v1')return 'native_record_schema_unverified';
 const source=evidence.sourceEvent;
 if(!source||game.leagueKey!=='nhl'||game.statusKey!=='scheduled'||game.id!=='nhl-'+source.id
  ||game.seasonYear!==source.season||game.seasonType!==source.gameType
  ||capturedEventTime(game.startTime)!==capturedEventTime(source.startTimeUTC)
  ||['away','home'].some(key=>String(game[key]?.id)!==String(source[key+'Team']?.id)||game[key]?.abbr!==source[key+'Team']?.abbrev)
  ||game[side]?.record!==source[side+'Team']?.record)return 'native_record_event_or_value_mismatch';
 const checked=nativeNhlRecordEvidence(source,side,{fetchedAt:evidence.fetchedAt,cacheState:evidence.cacheState},{asOf});
 return ['parsed_native_assertion','zero_games'].includes(checked.status)?null:checked.reason;
}
