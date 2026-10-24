import {cachedFetchJson} from './providerCache.js';
import {quoteTimeEpoch} from './oddsPricing.js';
import {localDateKey} from './time.js';
const DAY=86400000;
const dateAt=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)?quoteTimeEpoch(value+'T00:00:00Z'):NaN;
const signature=row=>JSON.stringify([row.startTime,row.awayTeamId,row.homeTeamId,row.awayAbbr,row.homeAbbr,row.awayScore,row.homeScore,row.seasonYear,row.seasonType]);
function uniqueFinals(rows,rejections){
 const grouped=new Map(),conflicts=new Set();
 for(const row of rows){const old=grouped.get(row.id);if(old&&signature(old)!==signature(row))conflicts.add(row.id);else if(!old)grouped.set(row.id,row);}
 for(const id of conflicts){grouped.delete(id);rejections.conflicting_native_event=(rejections.conflicting_native_event||0)+1;}
 return [...grouped.values()];
}
/** Native scores only: no ESPN ID mapping, starter confirmation or publication-time inference. */
export function parseNativeNhlHistory(payload,{cutoffDateKey,fetchedAt,cacheState='unknown',asOf=Date.now()}={}){
 const cutoff=dateAt(cutoffDateKey),receipt=quoteTimeEpoch(fetchedAt),rows=[],rejections={};
 const reject=reason=>rejections[reason]=(rejections[reason]||0)+1;
 if(!Number.isFinite(cutoff)||!Number.isFinite(asOf))throw Error('Valid native history cutoff required');
 if(!Number.isFinite(receipt)||receipt>asOf)return {rows,rejections:{unavailable_receipt:1}};
 if(!Array.isArray(payload?.games))return {rows,rejections:{invalid_native_payload:1}};
 for(const game of payload.games){
  if(!['OFF','FINAL'].includes(game?.gameState)){reject('not_final');continue;}
  const start=quoteTimeEpoch(game.startTimeUTC),away=game.awayTeam,home=game.homeTeam;
  if(!Number.isFinite(start)||start>=receipt){reject('invalid_final_chronology');continue;}
  const dateKey=localDateKey(new Date(start));
  if(dateKey>=cutoffDateKey){reject('not_before_forecast_date');continue;}
  if(!/^\d+$/.test(String(game.id||''))||!away?.abbrev||!home?.abbrev||away.abbrev===home.abbrev
    ||!/^\d+$/.test(String(away.id||''))||!/^\d+$/.test(String(home.id||''))||String(away.id)===String(home.id)){reject('invalid_native_identity');continue;}
  if(![away.score,home.score].every(v=>typeof v==='number'&&Number.isInteger(v)&&v>=0&&v<=100)||away.score===home.score){reject('invalid_final_scores');continue;}
  const season=typeof game.season==='number'&&Number.isInteger(game.season)?game.season:null;
  const type=typeof game.gameType==='number'&&Number.isInteger(game.gameType)?game.gameType:null;
  if(!season||!/^\d{8}$/.test(String(season))||Number(String(season).slice(4))!==Number(String(season).slice(0,4))+1||new Date(start).getUTCFullYear()<Number(String(season).slice(0,4))||new Date(start).getUTCFullYear()>Number(String(season).slice(4))||![1,2,3].includes(type)){reject('unknown_season');continue;}
  rows.push({id:'nhl-'+game.id,dateKey,startTime:new Date(start).toISOString(),league:'NHL',leagueKey:'nhl',sportGroup:'Hockey',
   awayTeam:away.name?.default||away.abbrev,awayTeamId:String(away.id),awayAbbr:away.abbrev,
   homeTeam:home.name?.default||home.abbrev,homeTeamId:String(home.id),homeAbbr:home.abbrev,
   awayScore:away.score,homeScore:home.score,neutralSite:typeof game.neutralSite==='boolean'?game.neutralSite:null,
   venueDetails:{id:'',name:game.venue?.default||'',address:{city:'',state:'',country:''}},probableStarters:[],
   seasonYear:season,seasonType:type,seasonSlug:'',source:'NHL official recent final history',
   sourceMeta:{provider:'NHL API',fetchedAt:new Date(receipt).toISOString(),cacheState,truncated:false,sourceObservationAt:null,
    publicationTimeVerified:false,scope:'final scores; no goalie, injury, roster or boxscore availability assertion'}});
 }
 return {rows:uniqueFinals(rows,rejections),rejections};
}
/** At most 14 sequential cached score-feed dates; pregame refreshes may use cache only. */
export async function collectNativeNhlHistory({cutoffDateKey,days=7,offline=false,fetchJson=cachedFetchJson,clock=()=>Date.now()}={}){
 const cutoff=dateAt(cutoffDateKey);
 if(!Number.isFinite(cutoff)||!Number.isInteger(days)||days<0||days>14)throw Error('Bounded native history date window required');
 const rows=[],rejections={},diagnostics=[];let externalCalls=0,failures=0,attemptedDates=0,deferredDates=0;
 for(let offset=1;offset<=days;offset++){
  const requestedDateKey=new Date(cutoff-offset*DAY).toISOString().slice(0,10);
  attemptedDates++;
  const result=await fetchJson('https://api-web.nhle.com/v1/score/'+requestedDateKey,{namespace:'official-nhl-score',ttlMs:12*3600000,staleMs:7*DAY,negativeTtlMs:300000,timeoutMs:12000,offline});
  if(['network','revalidated'].includes(result.cacheState))externalCalls++;
  if(!result.ok||!Array.isArray(result.json?.games)){failures++;diagnostics.push(requestedDateKey+': '+(result.error||'invalid payload'));if([401,403,429].includes(result.status)){deferredDates=days-offset;break;}continue;}
  if(result.upstreamError){failures++;diagnostics.push(requestedDateKey+': stale fallback ('+result.upstreamError+')');}
  const parsed=parseNativeNhlHistory(result.json,{cutoffDateKey,fetchedAt:result.fetchedAt,cacheState:result.cacheState,asOf:clock()});
  for(const [reason,count] of Object.entries(parsed.rejections))rejections[reason]=(rejections[reason]||0)+count;
  for(const row of parsed.rows){
   if(row.dateKey<new Date(cutoff-days*DAY).toISOString().slice(0,10)){rejections.outside_recent_window=(rejections.outside_recent_window||0)+1;continue;}
   rows.push({...row,sourceMeta:{...row.sourceMeta,requestedDateKey,coverageWindowDays:days}});
  }
  if([401,403,429].includes(result.upstreamStatus)){deferredDates=days-offset;break;}
 }
 const selected=uniqueFinals(rows,rejections);
 for(const row of selected)row.sourceMeta={...row.sourceMeta,truncated:failures>0,windowComplete:failures===0};
 return {rows:selected,rejections,externalCalls,attemptedDates,deferredDates,failures,diagnostics,windowDays:days,completeSeasonHistory:false};
}

/** Reconcile exact NHL schedule/abbreviation matches across native and ESPN histories. */
export function mergeNativeNhlHistory(rows=[]){
 const other=new Map(),groups=new Map();let duplicates=0,conflicts=0,unknownSeasonComparisons=0;
 for(const row of rows){
  const at=quoteTimeEpoch(row.startTime);
  if(row.leagueKey!=='nhl'||!Number.isFinite(at)||!row.awayAbbr||!row.homeAbbr){other.set(String(row.id||`${row.leagueKey}:${row.dateKey}:${row.awayTeam}:${row.homeTeam}`),row);continue;}
  const key=JSON.stringify([at,row.awayAbbr,row.homeAbbr]),group=groups.get(key)||[];group.push(row);groups.set(key,group);
 }
 const selected=[];
 for(const group of groups.values()){
  const seasons=new Map();let seasonConflict=false;
  for(const row of group){if(!row.seasonYear)continue;const format=String(row.seasonYear).length,old=seasons.get(format);if(old&&old!==row.seasonYear)seasonConflict=true;seasons.set(format,row.seasonYear);}
  if(seasonConflict||new Set(group.map(row=>JSON.stringify([row.awayScore,row.homeScore,row.seasonType]))).size>1){conflicts++;continue;}
  duplicates+=group.length-1;
  // Retain an already mapped ESPN event for its independently available boxscore route.
  const chosen=[...group].sort((a,b)=>Number(String(b.id).startsWith('espn:'))-Number(String(a.id).startsWith('espn:'))||String(a.id).localeCompare(String(b.id)))[0];
  if(seasons.size>1){unknownSeasonComparisons++;selected.push({...chosen,sourceMeta:{...chosen.sourceMeta,nativeSeasonComparison:'unverified_format_difference'}});}else selected.push(chosen);
 }
 return {rows:[...other.values(),...selected],duplicates,conflicts,unknownSeasonComparisons};
}
