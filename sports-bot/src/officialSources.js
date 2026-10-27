import {config} from './config.js';
import {cachedFetchJson} from './providerCache.js';
import {applyOfficialSchedulePayload} from './officialScheduleEvidence.js';
const DAY_MS=86400000;
export {applyOfficialSchedulePayload} from './officialScheduleEvidence.js';

async function collect(games,dateKey,provider,{now}){
 const mlb=provider==='MLB StatsAPI',league=mlb?'mlb':'nhl';
 const url=mlb?new URL('https://statsapi.mlb.com/api/v1/schedule'):new URL('https://api-web.nhle.com/v1/score/'+encodeURIComponent(dateKey));
 if(mlb){url.searchParams.set('sportId','1');url.searchParams.set('date',dateKey);url.searchParams.set('hydrate','probablePitcher,team,venue');}
 let attempts=0;
 const result=await cachedFetchJson(url.toString(),{namespace:mlb?'official-mlb-schedule':'official-nhl-score',ttlMs:Math.min(config.scoreboardCacheMinutes*60000,15*60000),staleMs:0,negativeTtlMs:60000,timeoutMs:12000,
  fetch:(...args)=>{attempts++;return globalThis.fetch(...args);}});
 const output=applyOfficialSchedulePayload(games,result.ok?result.json:null,{provider,fetchedAt:result.fetchedAt,cacheState:result.cacheState,now:now??Date.now()});
 return {...output,externalCalls:attempts,providerFailures:attempts&&!result.ok?1:0,diagnostics:[`${provider}: ${output.matched}/${games.filter(game=>game.leagueKey===league).length} event(s) corroborated; ${output.probableStarters} reported pitcher projection(s), ${output.addedProjections} added; rejections ${JSON.stringify(output.rejected)}; source=${result.cacheState}${result.ok?'':', unavailable ('+(result.error||'no data')+')'}. No confirmed starters or medical clearance.`]};
}
export async function corroborateOfficialSources(games,dateKey,options={}){
 if(options.localOnly||config.localOnly||!config.autoOfficialSources)return {games,diagnostics:[`Official-source corroboration: skipped (${options.localOnly||config.localOnly?'LOCAL_ONLY=true':'AUTO_OFFICIAL_SOURCES=false'}).`],externalCalls:0,matched:0,probableStarters:0,addedProjections:0,confirmedStarters:0,providerFailures:0};
 const tasks=[];
 if(games.some(game=>game.leagueKey==='mlb'))tasks.push(collect(games,dateKey,'MLB StatsAPI',options));
 if(games.some(game=>game.leagueKey==='nhl'))tasks.push(collect(games,dateKey,'NHL API',options));
 const rows=await Promise.all(tasks),sum=key=>rows.reduce((total,row)=>total+(row[key]||0),0);
 return {games,diagnostics:rows.flatMap(row=>row.diagnostics),externalCalls:sum('externalCalls'),matched:sum('matched'),probableStarters:sum('probableStarters'),addedProjections:sum('addedProjections'),confirmedStarters:0,providerFailures:sum('providerFailures')};
}
export function officialSourceStaleWindowMs(){return Math.max(config.scoreboardStaleHours*3600000,2*DAY_MS);}
