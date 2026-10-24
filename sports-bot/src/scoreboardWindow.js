import {capturedEventTime} from './capturedEventTime.js';
function day(value){
 if(typeof value!=='string')return null;
 const normalized=/^\d{8}$/.test(value)?value.slice(0,4)+'-'+value.slice(4,6)+'-'+value.slice(6):value;
 return /^\d{4}-\d{2}-\d{2}$/.test(normalized)&&Number.isFinite(capturedEventTime(normalized+'T00:00:00Z'))?normalized:null;
}
/** Preserve native declarations before compact caching; never infer complete coverage from HTTP200. */
export function cdnWindowEvidence(payload){
 const content=payload?.content||{},parameters=content.dateParams||{},values=[parameters.date,content.sbData?.day?.date];
 const bounded=(value,min,max)=>Number.isInteger(value)&&value>=min&&value<=max?value:null;
 return {schema:'sports-cdn-window-v1',declaredDays:[...new Set(values.map(day).filter(Boolean))],
  invalidDayDeclarations:values.filter(value=>value!==undefined&&value!==null&&day(value)===null).length,
  weekOriented:typeof content.isWeekOriented==='boolean'?content.isWeekOriented:null,
  weekContext:{year:bounded(parameters.year,1900,9999),week:bounded(parameters.week,1,60),seasonType:bounded(parameters.seasontype,1,9)},
  scope:'Provider selector/window assertions only; not publication freshness or independent schedule completeness.'};
}
export function scoreboardCoverage({leagueKey,provider,requestedDay,reportedEvents,parsedGames=[],sourceMeta={},windowEvidence=null}){
 const accepted=parsedGames.filter(game=>game.dateKey===requestedDay),days=windowEvidence?.declaredDays||[];
 const status=windowEvidence?.invalidDayDeclarations?'invalid_declared_day':days.length>1?'conflicting_provider_days'
  :windowEvidence?.weekOriented===true?'declared_weekly_window':days.length===1?(days[0]===requestedDay?'declared_requested_day':'different_declared_day'):'provider_day_unverified';
 return {schema:'sports-scoreboard-coverage-v1',leagueKey,provider,requestedLocalDay:requestedDay,windowStatus:status,windowEvidence,
  reportedEvents,validRows:parsedGames.length,acceptedLocalDayGames:accepted.length,outsideLocalDayGames:parsedGames.length-accepted.length,
  invalidRows:reportedEvents===null?null:reportedEvents-parsedGames.length,
  fetchedAt:sourceMeta.fetchedAt||null,cacheState:sourceMeta.cacheState||'unknown',httpStatus:typeof sourceMeta.status==='number'?sourceMeta.status:null,upstreamError:sourceMeta.upstreamError||null,
  returnedLocalDays:Object.fromEntries([...new Set(parsedGames.map(game=>game.dateKey))].sort().map(key=>[key,parsedGames.filter(game=>game.dateKey===key).length])),
  completenessVerified:false,scope:'Rows returned by this league selector; absent games and full-market completeness are not independently verified.'};
}
