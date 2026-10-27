import {quoteTimeEpoch} from './oddsPricing.js';
import {capturedEventTime} from './capturedEventTime.js';
import {normalizeEntityName} from './intelligenceStore.js';
const schema='sports-native-nhl-team-identity-v1',TTL=15*60000;
/** Native event fields are source assertions, not independent authentication or starter/health data. */
export function parseNhlTeamIdentity(payload,game,{fetchedAt,asOf=Date.now()}={}){
 const unavailable=reason=>({schema,status:'unavailable',reason});
 const id=/^nhl-(\d+)$/.exec(String(game?.id||'')),start=capturedEventTime(game?.startTime),receipt=quoteTimeEpoch(fetchedAt);
 if(game?.leagueKey!=='nhl'||game.statusKey!=='scheduled'||![start,receipt,asOf].every(Number.isFinite)||receipt>asOf||asOf-receipt>TTL||asOf>=start)return unavailable('unverified_or_expired_pregame_receipt');
 if(!id||String(payload?.id)!==id[1]||capturedEventTime(payload?.startTimeUTC)!==start||!['FUT','PRE'].includes(payload?.gameState))return unavailable('native_event_identity_mismatch');
 if(game.seasonYear&&String(game.seasonYear).length===8&&game.seasonYear!==payload.season)return unavailable('native_season_mismatch');
 const sides={};
 for(const side of ['away','home']){
  const source=payload[side+'Team'],local=game[side],commonName=source?.commonName?.default,placeName=source?.placeName?.default;
  if(!/^\d+$/.test(String(local?.id||''))||String(source?.id)!==String(local.id)||!local.abbr||source.abbrev!==local.abbr
   ||typeof commonName!=='string'||!commonName.trim()||typeof placeName!=='string'||!placeName.trim()
   ||![normalizeEntityName(commonName),normalizeEntityName(local.abbr)].includes(normalizeEntityName(local.name)))return unavailable('native_team_identity_or_name_unverified');
  sides[side]={nativeTeamId:String(source.id),abbr:source.abbrev,commonName:commonName.trim(),placeName:placeName.trim(),fullName:placeName.trim()+' '+commonName.trim()};
 }
 if(sides.away.nativeTeamId===sides.home.nativeTeamId||sides.away.abbr===sides.home.abbr||normalizeEntityName(sides.away.fullName)===normalizeEntityName(sides.home.fullName))return unavailable('native_team_identity_conflict');
 const sourceEvent={id:payload.id,season:payload.season,gameState:payload.gameState,startTimeUTC:payload.startTimeUTC,
  ...Object.fromEntries(['away','home'].map(side=>[side+'Team',{id:payload[side+'Team'].id,abbrev:payload[side+'Team'].abbrev,commonName:{default:sides[side].commonName},placeName:{default:sides[side].placeName}}]))};
 return {schema,status:'matched_native_event',provider:'NHL API',fetchedAt:new Date(receipt).toISOString(),eventId:id[1],startTime:new Date(start).toISOString(),sides,sourceEvent,
  nativePublicationVerified:false,policy:'Exact event/start/native team IDs/abbreviations/common names; alias composes native place and common-name fields. No fuzzy matching, starter confirmation or health clearance.'};
}
export function oddsTeamNames(game,side,{asOf=Date.now()}={}){
 const names=[game[side]?.name,game[side]?.abbr],evidence=game.nhlTeamIdentity;
 if(evidence?.schema===schema&&evidence.provider==='NHL API'){
  const checked=parseNhlTeamIdentity(evidence.sourceEvent,game,{fetchedAt:evidence.fetchedAt,asOf});
  if(checked.status==='matched_native_event')names.push(checked.sides[side]?.fullName);
 }
 return new Set(names.filter(value=>typeof value==='string').map(normalizeEntityName).filter(Boolean));
}
