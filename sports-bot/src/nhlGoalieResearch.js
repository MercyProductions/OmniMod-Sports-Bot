import {parseNhlTeamIdentity} from './nhlTeamIdentity.js';
import {cachedFetchJson} from './providerCache.js';
import {quoteTimeEpoch} from './oddsPricing.js';
const numeric=value=>typeof value==='number'&&Number.isFinite(value);
/** Native season leaders are context, never an event starter/health confirmation. */
export function parseNhlGoalieResearch(payload,game,{fetchedAt,cacheState='unknown',asOf=Date.now()}={}){
 const start=quoteTimeEpoch(game?.startTime),receipt=quoteTimeEpoch(fetchedAt),native=/^nhl-(\d+)$/.exec(String(game?.id||''));
 const unavailable=reason=>({schema:'sports-nhl-goalie-research-v1',status:'unavailable',reason,confirmedStarters:0,injuryCoverage:'unknown'});
 if(!Number.isFinite(asOf)||!Number.isFinite(start)||!Number.isFinite(receipt)||receipt>asOf||asOf>=start)return unavailable('invalid_pregame_chronology');
 if(!native||String(payload?.id)!==native[1]||quoteTimeEpoch(payload?.startTimeUTC)!==start||!['FUT','PRE'].includes(payload?.gameState))return unavailable('event_identity_or_state_mismatch');
 for(const side of ['away','home'])if(!game[side]?.abbr||payload[side+'Team']?.abbrev!==game[side].abbr)return unavailable('team_identity_mismatch');
 const comparison=payload.matchup?.goalieComparison;
 if(!comparison||comparison.contextSeason!==payload.season||!Array.isArray(comparison.awayTeam?.leaders)||!Array.isArray(comparison.homeTeam?.leaders))return unavailable('native_goalie_context_missing');
 if(game.seasonYear&&String(game.seasonYear).length===8&&game.seasonYear!==payload.season)return unavailable('season_mismatch');
 const sides={};let rejectedRows=0;
 for(const side of ['away','home']){
  const groups=new Map(),conflicts=new Set();
  for(const row of comparison[side+'Team'].leaders){
   const id=String(row?.playerId||'');
   if(!/^\d+$/.test(id)||row.positionCode!=='G'||!numeric(row.gamesPlayed)||!Number.isInteger(row.gamesPlayed)||row.gamesPlayed<=0||!numeric(row.savePctg)||row.savePctg<0||row.savePctg>1||!numeric(row.gaa)||row.gaa<0){rejectedRows++;continue;}
   const name=[row.firstName?.default,row.lastName?.default].filter(Boolean).join(' ')||row.name?.default;
   if(!name){rejectedRows++;continue;}
   const selected={playerId:id,name,team:game[side].name||game[side].abbr,teamAbbr:game[side].abbr,gamesPlayed:row.gamesPlayed,savePercentage:row.savePctg,goalsAgainstAverage:row.gaa,
    starterStatus:'not_provided',healthStatus:'unknown',availability:null};
   if(groups.has(id)&&JSON.stringify(groups.get(id))!==JSON.stringify(selected))conflicts.add(id);else groups.set(id,selected);
  }
  for(const id of conflicts){groups.delete(id);rejectedRows++;}
  sides[side]={candidates:[...groups.values()],starterStatus:'unknown'};
 }
 const awayIds=new Set(sides.away.candidates.map(row=>row.playerId));
 const shared=sides.home.candidates.filter(row=>awayIds.has(row.playerId));if(shared.length)return unavailable('cross_team_player_identity_conflict');
 return {schema:'sports-nhl-goalie-research-v1',status:sides.away.candidates.length&&sides.home.candidates.length?'season_context_only':'incomplete_context',provider:'NHL API',eventId:native[1],startTime:new Date(start).toISOString(),fetchedAt:new Date(receipt).toISOString(),cacheState,
  sourceObservationAt:null,nativePublicationVerified:false,season:payload.season,confirmedStarters:0,injuryCoverage:'unknown',sides,rejectedRows,
  policy:'Season leaders only; not projected or confirmed starters. No health clearance, model-confidence bonus or automatic player input.'};
}
export async function enrichNhlGoalieResearch(games,{maxGames=6,forcedIds=null,fetchJson=cachedFetchJson,clock=()=>Date.now()}={}){
 if(!Number.isInteger(maxGames)||maxGames<0||maxGames>12)throw Error('Bounded NHL goalie context request budget required');
 const eligible=games.filter(game=>game.leagueKey==='nhl'&&game.statusKey==='scheduled'&&/^nhl-\d+$/.test(String(game.id))&&quoteTimeEpoch(game.startTime)>clock()&&(!forcedIds||forcedIds.has(String(game.id))));
 const selected=[...eligible].sort((a,b)=>quoteTimeEpoch(a.startTime)-quoteTimeEpoch(b.startTime)||String(a.id).localeCompare(String(b.id))).slice(0,maxGames);
 let externalCalls=0,attempted=0,available=0,failures=0,deferred=0;
 for(const game of selected){
  attempted++;const native=String(game.id).slice(4);
  const result=await fetchJson('https://api-web.nhle.com/v1/gamecenter/'+native+'/landing',{namespace:'official-nhl-goalie-context',ttlMs:15*60000,staleMs:0,negativeTtlMs:300000,timeoutMs:12000});
  if(['network','revalidated'].includes(result.cacheState))externalCalls++;
  const evidence=result.ok?parseNhlGoalieResearch(result.json,game,{fetchedAt:result.fetchedAt,cacheState:result.cacheState,asOf:clock()}):{schema:'sports-nhl-goalie-research-v1',status:'unavailable',reason:'provider_unavailable',confirmedStarters:0,injuryCoverage:'unknown'};
  game.nhlTeamIdentity=result.ok?parseNhlTeamIdentity(result.json,game,{fetchedAt:result.fetchedAt,asOf:clock()}):null;
  game.goalieResearch=evidence;if(evidence.status==='season_context_only')available++;else failures++;
  if([401,403,429].includes(result.status)){deferred=selected.length-attempted;break;}
 }
 return {eligible:eligible.length,selected:selected.length,attempted,available,failures,deferred,capOmissions:eligible.length-selected.length,externalCalls,confirmedStarters:0};
}
