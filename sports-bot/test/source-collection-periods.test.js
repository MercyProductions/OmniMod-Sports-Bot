import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const directory=await mkdtemp(join(tmpdir(),'sports-source-periods-'));
process.env.OMNIMOD_SPORTS_DATA_DIR=directory;process.env.ADVANCED_DATASETS_ENABLED='true';process.env.ADVANCED_NBA_STATS_ENABLED='true';process.env.LOCAL_ONLY='false';
const {syncAdvancedDatasets,attachAdvancedDatasetContext,advancedDatasetSnapshotFile,advancedDatasetRequest}=await import('../src/advancedDatasets.js');
const {writeJson}=await import('../src/storage.js');
const now=Date.parse('2026-08-01T12:00:00Z');
const game=(leagueKey,seasonYear)=>({id:leagueKey+seasonYear,leagueKey,seasonYear,sourceMeta:{provider:leagueKey==='nba'?'ESPN CDN':'Test'},away:{name:'Away',abbr:'A'},home:{name:'Home',abbr:'H'}});
async function seed(){await writeJson(advancedDatasetSnapshotFile,{version:2,sources:[],footballSchedules:[]});}
function fetcher(calls){return async url=>{
 calls.push(url);let text;
 if(url.includes('/stats_team/')){const year=url.match(/reg_(\d{4})/)[1];text=`season,season_type,team,games,passing_epa,rushing_epa,passing_cpoe\n${year},REG,A,10,10,10,0\n${year},REG,H,10,20,20,0\n`;}
 else if(url.includes('stats.nba.com'))text=JSON.stringify({resultSets:[{headers:['TEAM_NAME','TEAM_ID','GP','PACE','NET_RATING'],rowSet:[['Away',1,10,100,0],['Home',2,10,110,10]]}]});
 else if(url.includes('moneypuck'))text='team,situation,games_played,xGoalsFor,xGoalsAgainst,goalsAgainst\nA,all,10,10,10,10\nH,all,10,20,10,10\n';
 else throw new Error('Synthetic unavailable');
 return {ok:true,text:async()=>text};
};}
test.after(()=>rm(directory,{recursive:true,force:true}));

test('August NFL metadata selects its new season without changing NBA or NHL collection periods',async()=>{
 await seed();const calls=[],games=[game('nfl',2026),game('nba',2026),game('nhl',20252026)];
 const result=await attachAdvancedDatasetContext(games,{clock:()=>now,force:true,fetchImpl:fetcher(calls)});
 assert.ok(calls.some(url=>url.includes('stats_team_reg_2026.csv')));
 assert.ok(calls.some(url=>url.includes('Season=2025-26')));
 assert.ok(calls.some(url=>url.includes('/seasonSummary/2025/')));
 assert.ok(Number.isFinite(games[0].advancedDataset.epaDifference));
 assert.equal(result.collectionPeriodPlan['nflverse-team-stats'].basis,'game_season_metadata');
 assert.equal(games[0].advancedDataset.sourcePeriodEvidence.collectionSelection.period,2026);
});

test('explicit global pins preserve historical research scope instead of being silently overridden by a game',async()=>{
 await seed();const calls=[],g=game('nfl',2026);
 await attachAdvancedDatasetContext([g],{clock:()=>now,seasonStart:2024,force:true,fetchImpl:fetcher(calls)});
 assert.ok(calls.some(url=>url.includes('stats_team_reg_2024.csv')));assert.equal(g.advancedDataset.epaDifference,null);
});

test('conflicting game seasons do not arbitrarily select or fetch one NFL cohort',async()=>{
 await seed();const calls=[],games=[game('nfl',2025),game('nfl',2026)];
 const result=await attachAdvancedDatasetContext(games,{clock:()=>now,force:true,fetchImpl:fetcher(calls)});
 assert.equal(calls.some(url=>url.includes('/stats_team/')),false);
 assert.equal(result.collectionPeriodPlan['nflverse-team-stats'].basis,'conflicting_game_seasons');
 assert.ok(games.every(g=>!g.advancedDataset||g.advancedDataset.epaDifference===null));
});

test('source-specific overrides reach endpoint URLs and row receipts without changing unrelated source identities',async()=>{
 await seed();const calls=[];
 const result=await syncAdvancedDatasets({clock:()=>now,force:true,sourcePeriods:{'nflverse-team-stats':{seasonStart:2026}},fetchImpl:fetcher(calls)});
 assert.ok(calls.some(url=>url.includes('stats_team_reg_2026.csv')));
 assert.equal(JSON.parse(result.snapshot.footballTeams.A.sourceRequestKey).seasonStart,2026);
 assert.equal(JSON.parse(result.requestIdentities['nba-advanced-teams']).seasonStart,2025);
});

test('invalid scoped periods reject before any provider request',async()=>{
 for(const sourcePeriods of [null,[],{'unknown':{seasonStart:2026}},{'nflverse-team-stats':{year:2026}},{'nba-advanced-teams':{seasonStart:0}},{'baseball-savant-batter':{year:'bad'}}]){
  let calls=0;await assert.rejects(syncAdvancedDatasets({clock:()=>now,force:true,sourcePeriods,fetchImpl:async()=>{calls++;throw new Error('Unexpected request');}}),/source|period|season|year/i);assert.equal(calls,0);
 }
});

test('source-only scope changes invalidate cache success without invalidating independent source caches',async()=>{
 await seed();const calls=[];await syncAdvancedDatasets({clock:()=>now,force:true,fetchImpl:fetcher(calls)});
 calls.length=0;const result=await syncAdvancedDatasets({clock:()=>now+1,sourcePeriods:{'nflverse-team-stats':{seasonStart:2026}},fetchImpl:fetcher(calls)});
 assert.equal(calls.filter(url=>url.includes('/stats_team/')).length,1);assert.equal(calls.some(url=>url.includes('stats.nba.com')),false);
 assert.equal(JSON.parse(result.snapshot.footballTeams.A.sourceRequestKey).seasonStart,2026);
});


test('provider Retry-After cannot be bypassed by a new scoped period or force flag',async()=>{
 await seed();let calls=0;
 const fetchImpl=async url=>{if(url.includes('/stats_team/')){calls++;return {ok:false,status:429,headers:{get:()=> '1200'}};}throw new Error('Synthetic unavailable');};
 await syncAdvancedDatasets({clock:()=>now,force:true,fetchImpl});
 await syncAdvancedDatasets({clock:()=>now+1,force:true,sourcePeriods:{'nflverse-team-stats':{seasonStart:2026}},fetchImpl});
 assert.equal(calls,1);
});

test('ambiguous game periods cannot reuse a cached cohort as an arbitrarily chosen answer',async()=>{
 await seed();await syncAdvancedDatasets({clock:()=>now,force:true,fetchImpl:fetcher([])});
 const games=[game('nfl',2025),game('nfl',2026)];const result=await attachAdvancedDatasetContext(games,{clock:()=>now+1,localOnly:true});
 assert.equal(result.periodRejections.length,2);
 for(const g of games){assert.equal(g.advancedDataset.epaDifference,null);assert.equal(g.advancedDataset.sourcePeriodEvidence.collectionSelection.basis,'conflicting_game_seasons');}
});

test('MLB role URLs follow an unambiguous game year while unsupported NBA conventions retain fallback diagnostics',async()=>{
 await seed();const calls=[];const result=await attachAdvancedDatasetContext([game('mlb',2025),{...game('nba',2027),sourceMeta:{provider:'Unknown'}}],{clock:()=>now,force:true,fetchImpl:fetcher(calls)});
 assert.equal(calls.filter(url=>url.includes('baseballsavant')&&url.includes('year=2025')).length,2);
 assert.equal(result.collectionPeriodPlan['nba-advanced-teams'].basis,'calendar_fallback');
});

test('concurrent different source periods serialize rather than coalescing or racing snapshot writes',async()=>{
 await seed();let active=0,maxActive=0;const calls=[],base=fetcher(calls);
 const fetchImpl=async url=>{if(!url.includes('/stats_team/'))return base(url);active++;maxActive=Math.max(maxActive,active);try{await new Promise(resolve=>setTimeout(resolve,5));return await base(url);}finally{active--;}};
 const results=await Promise.all([2025,2026].map(seasonStart=>syncAdvancedDatasets({clock:()=>now,force:true,sourcePeriods:{'nflverse-team-stats':{seasonStart}},fetchImpl})));
 assert.equal(maxActive,1);assert.equal(calls.filter(url=>url.includes('/stats_team/')).length,2);
 assert.deepEqual(results.map(result=>JSON.parse(result.snapshot.footballTeams.A.sourceRequestKey).seasonStart),[2025,2026]);
});
