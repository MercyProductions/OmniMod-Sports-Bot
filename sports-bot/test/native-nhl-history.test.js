import test from 'node:test';
import assert from 'node:assert/strict';
import {parseNativeNhlHistory,collectNativeNhlHistory,mergeNativeNhlHistory} from '../src/nativeNhlHistory.js';
import {buildAutomaticTeamProfiles,enrichGamesAutomatically} from '../src/autoEnrichment.js';
import {observedInputState} from '../src/inputChronology.js';
const asOf=Date.parse('2099-02-01T18:00:00Z'),fetchedAt='2099-02-01T17:00:00Z',cutoffDateKey='2099-02-01';
const game=(overrides={})=>({id:2099020001,season:20982100,gameType:2,gameState:'OFF',startTimeUTC:'2099-01-31T18:00:00Z',awayTeam:{id:1,abbrev:'AAA',name:{default:'Away'},score:0},homeTeam:{id:2,abbrev:'HHH',name:{default:'Home'},score:2},...overrides});
// A valid consecutive composite NHL season is separate from the calendar-year start date.
const native=(overrides={})=>game({season:20982099,...overrides});
const parse=games=>parseNativeNhlHistory({games},{cutoffDateKey,fetchedAt,cacheState:'network',asOf});
test('native finals retain zero scores, IDs, season, receipts and unknown goalie/injury provenance',()=>{
 const original=native(),result=parse([original]);assert.equal(result.rows.length,1);const row=result.rows[0];assert.equal(row.awayScore,0);assert.equal(row.id,'nhl-2099020001');assert.equal(row.sourceMeta.provider,'NHL API');assert.equal(row.sourceMeta.publicationTimeVerified,false);assert.deepEqual(row.probableStarters,[]);assert.equal(row.neutralSite,null);assert.equal(original.awayTeam.score,0);
});
test('native history rejects incomplete finals, invalid score types, ties and identity collisions',()=>{
 for(const change of [{gameState:'LIVE'},{awayTeam:{...native().awayTeam,score:null}},{awayTeam:{...native().awayTeam,score:'0'}},{awayTeam:{...native().awayTeam,score:2}},{awayTeam:{...native().awayTeam,id:2}},{season:20992099}])assert.equal(parse([native(change)]).rows.length,0);
});
test('native history requires real zoned dates, final receipts and strict pre-forecast days',()=>{
 for(const change of [{startTimeUTC:'2099-02-01T12:00:00Z'},{startTimeUTC:'2099-01-31T18:00:00'},{startTimeUTC:'2099-02-30T18:00:00Z'}])assert.equal(parse([native(change)]).rows.length,0);
 assert.equal(parseNativeNhlHistory({games:[native()]},{cutoffDateKey,fetchedAt:'2099-02-01T19:00:00Z',asOf}).rows.length,0);
});
test('native duplicate finals deduplicate and conflicting scores quarantine the entire event',()=>{
 assert.equal(parse([native(),native()]).rows.length,1);const conflict=parse([native(),native({homeTeam:{...native().homeTeam,score:3}})]);assert.equal(conflict.rows.length,0);assert.equal(conflict.rejections.conflicting_native_event,1);
});
test('collector bounds sequential dates, forwards offline policy and deduplicates overlapping score feeds',async()=>{
 const calls=[];let active=0,max=0;
 const result=await collectNativeNhlHistory({cutoffDateKey,days:3,offline:true,clock:()=>asOf,fetchJson:async(url,options)=>{calls.push({url,options});active++;max=Math.max(max,active);await Promise.resolve();active--;return {ok:true,json:{games:[native()]},fetchedAt,cacheState:'fresh'};}});
 assert.equal(calls.length,3);assert.equal(max,1);assert.equal(result.rows.length,1);assert.equal(result.externalCalls,0);assert.equal(result.completeSeasonHistory,false);assert.ok(calls.every(c=>c.options.offline&&c.options.namespace==='official-nhl-score'));assert.ok(calls[0].url.endsWith('/2099-01-31'));
});
test('rate limit and access failures stop the bounded sweep without retrying different days',async()=>{
 for(const status of [401,403,429]){let calls=0;const result=await collectNativeNhlHistory({cutoffDateKey,days:7,fetchJson:async()=>{calls++;return {ok:false,status,error:'HTTP '+status,cacheState:'network'};}});assert.equal(calls,1);assert.equal(result.attemptedDates,1);assert.equal(result.deferredDates,6);assert.equal(result.failures,1);assert.equal(result.rows.length,0);}
});
test('partial native date coverage remains truncated and exposes invalid payloads',async()=>{
 let calls=0;const result=await collectNativeNhlHistory({cutoffDateKey,days:2,clock:()=>asOf,fetchJson:async()=>++calls===1?{ok:true,json:{games:[native()]},fetchedAt,cacheState:'network'}:{ok:true,json:{wrong:[]},fetchedAt,cacheState:'network'}});assert.equal(result.rows.length,1);assert.equal(result.failures,1);assert.equal(result.rows[0].sourceMeta.truncated,true);assert.equal(result.rows[0].sourceMeta.windowComplete,false);
});
test('bounded history cannot be configured as an unlimited or malformed sweep',async()=>{
 for(const days of [-1,15,1.5])await assert.rejects(collectNativeNhlHistory({cutoffDateKey,days}),/Bounded/);
 assert.equal((await collectNativeNhlHistory({cutoffDateKey,days:0})).attemptedDates,0);
});
test('automatic team profiles preserve all native receipts and stale inputs instead of claiming ESPN provenance',()=>{
 const rows=parse([native(),native({id:2099020002,startTimeUTC:'2099-01-30T18:00:00Z'})]).rows;rows[0].sourceMeta.cacheState='stale';rows[1].sourceMeta.fetchedAt='2099-02-01T19:00:00Z';
 const profiles=Object.values(buildAutomaticTeamProfiles(rows,new Date(asOf),fetchedAt));assert.equal(profiles.length,2);assert.deepEqual(profiles[0].sourceProviders,['NHL API']);assert.equal(profiles[0].sourceReceiptTimes.length,2);assert.equal(profiles[0].sourceCacheState,'stale');assert.equal(observedInputState(profiles[0],asOf),'after_information_cutoff');assert.ok(!profiles[0].source.startsWith('ESPN'));
});

test('native and ESPN copies of the same NHL final do not double the team history',()=>{
 const row=parse([native()]).rows[0],espn={...row,id:'espn:123',sourceMeta:{...row.sourceMeta,provider:'ESPN'}};
 const result=mergeNativeNhlHistory([row,espn]);assert.equal(result.rows.length,1);assert.equal(result.duplicates,1);assert.equal(result.rows[0].id,'espn:123');
 const conflict=mergeNativeNhlHistory([row,{...espn,homeScore:4}]);assert.equal(conflict.rows.length,0);assert.equal(conflict.conflicts,1);
 const next={...row,id:'nhl-next',startTime:'2099-01-30T18:00:00Z'};assert.equal(mergeNativeNhlHistory([row,next]).rows.length,2);
});
test('enrichment falls back after primary history failure and reuses native score cache',async t=>{
 const previous=globalThis.fetch;t.after(()=>globalThis.fetch=previous);let nativeCalls=0;
 const now=new Date(),start=new Date(now.getTime()-2*86400000),year=start.getUTCFullYear(),seasonStart=start.getUTCMonth()>=6?year:year-1;
 const payload=native({id:2099020099,startTimeUTC:start.toISOString(),season:Number(String(seasonStart)+String(seasonStart+1))});
 globalThis.fetch=async url=>{
  if(String(url).includes('api-web.nhle.com')){nativeCalls++;return new Response(JSON.stringify({games:[payload]}),{status:200});}
  return new Response('{}',{status:403});
 };
 const league={key:'nhl',sport:'hockey',league:'nhl',group:'Hockey',label:'NHL',priority:100};
 const input={id:'nhl-2099020098',leagueKey:'nhl',startTime:new Date(now.getTime()+86400000).toISOString(),statusKey:'scheduled',sourceMeta:{provider:'NHL API'},away:{name:'Away',abbr:'AAA'},home:{name:'Home',abbr:'HHH'}};
 const first=await enrichGamesAutomatically([structuredClone(input)],now,{leagues:[league]});assert.ok(first.historyResults.some(row=>row.sourceMeta.provider==='NHL API'));const calls=nativeCalls;
 const second=await enrichGamesAutomatically([structuredClone(input)],now,{leagues:[league]});assert.equal(nativeCalls,calls);assert.ok(second.historyResults.length>0);assert.ok(first.diagnostics.some(x=>x.includes('NHL native history:')));
});

test('native composite NHL seasons are not numerically compared with four-digit provider labels',()=>{
 const rows=parse([native()]).rows;
 const profiles=buildAutomaticTeamProfiles(rows,new Date(asOf),fetchedAt,{currentGames:[{leagueKey:'nhl',seasonYear:2099,seasonType:2}]});assert.equal(Object.keys(profiles).length,2);
 assert.equal(Object.keys(buildAutomaticTeamProfiles(rows,new Date(asOf),fetchedAt,{currentGames:[{leagueKey:'nhl',seasonYear:20972098,seasonType:2}]})).length,0);
});

test('cross-provider season label formats stay unverified without double-counting or inventing a season mapping',()=>{
 const row=parse([native()]).rows[0],espn={...row,id:'espn:123',seasonYear:2099,sourceMeta:{provider:'ESPN',fetchedAt}};
 const original=structuredClone(espn),result=mergeNativeNhlHistory([row,espn]);assert.equal(result.rows.length,1);assert.equal(result.rows[0].id,'espn:123');assert.equal(result.unknownSeasonComparisons,1);assert.equal(result.rows[0].sourceMeta.nativeSeasonComparison,'unverified_format_difference');assert.deepEqual(espn,original);
 assert.equal(mergeNativeNhlHistory([row,{...row,id:'other',seasonYear:20992000}]).conflicts,1);
});
