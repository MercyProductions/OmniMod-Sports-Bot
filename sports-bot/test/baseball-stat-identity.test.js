import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const directory=await mkdtemp(join(tmpdir(),'sports-baseball-identity-'));
process.env.OMNIMOD_SPORTS_DATA_DIR=directory;process.env.ADVANCED_DATASETS_ENABLED='true';process.env.LOCAL_ONLY='false';
const {syncAdvancedDatasets,attachAdvancedDatasetContext,advancedDatasetSnapshotFile}=await import('../src/advancedDatasets.js');
const {writeJson}=await import('../src/storage.js');
const now=Date.parse('2026-10-21T08:00:00Z');
const response=text=>({ok:true,text:async()=>text});
const csv=rows=>'player_name,player_id,est_woba\n'+rows.join('\n')+'\n';
async function seed(snapshot={}){await writeJson(advancedDatasetSnapshotFile,{version:2,sources:[],footballSchedules:[],...snapshot});}
async function sync(batters,pitchers,extra={}){
 return syncAdvancedDatasets({clock:()=>now,year:2026,force:true,fetchImpl:async url=>{
  if(url.includes('type=batter')&&batters!==null)return response(csv(batters));
  if(url.includes('type=pitcher')&&pitchers!==null)return response(csv(pitchers));
  throw new Error('Synthetic source unavailable');
 },...extra});
}
function game(name){return {id:'g',leagueKey:'mlb',away:{name:'Away'},home:{name:'Home'},autoLineups:[{name,team:'Away',role:'Batter',confirmedStarter:true,starter:true,updatedAt:new Date(now-1000).toISOString()}]};}
async function attach(g){await attachAdvancedDatasetContext([g],{clock:()=>now,year:2026,localOnly:true});return g.advancedDataset;}
test.after(()=>rm(directory,{recursive:true,force:true}));

test('a two-way player retains independent batter and pitcher statistics through the real importer',async()=>{
 await seed();const result=await sync(['Two Way,1,0.4'],['Two Way,1,0.2']);
 const advanced=await attach(game('Two Way'));
 assert.equal(advanced.awayLineupXwoba,.4);
 assert.equal(result.snapshot.baseballPlayersByRole.pitcher.twoway[0].expectedWoba,.2);
 assert.equal(result.snapshot.baseballPlayers.twoway.role,'batter');
});

test('same-name native IDs and duplicate rows are retained but cannot select a batter by row order',async()=>{
 for(const rows of [['Same Name,1,0.4','Same Name,2,0.2'],['Same Name,2,0.2','Same Name,1,0.4'],['Same Name,1,0.4','Same Name,1,0.4']]){
  await seed();const result=await sync(rows,['Same Name,3,0.1']);const advanced=await attach(game('Same Name'));
  assert.equal(advanced.awayLineupXwoba,null);
  assert.equal(advanced.lineupXwobaEvidence.away.statRejections.ambiguous_stat_identity,1);
  assert.equal(result.snapshot.sources.find(row=>row.id==='baseball-savant-batter').ambiguousNames,1);
  assert.equal(result.snapshot.baseballPlayersByRole.batter.samename.length,2);
 }
});

test('a successful role refresh replaces its old cohort while retaining the independently failed role',async()=>{
 await seed();await sync(['Old Batter,1,0.3'],['Old Pitcher,2,0.2']);
 const result=await sync(['New Batter,3,0.4'],null);
 assert.equal(result.snapshot.baseballPlayers.oldbatter,undefined);
 assert.equal(result.snapshot.baseballPlayersByRole.batter.oldbatter,undefined);
 assert.equal(result.snapshot.baseballPlayersByRole.pitcher.oldpitcher[0].expectedWoba,.2);
 assert.equal((await attach(game('Old Batter'))).awayLineupXwoba,null);
 assert.equal((await attach(game('New Batter'))).awayLineupXwoba,.4);
});

test('failed role refresh preserves the previous valid role with its original source receipt',async()=>{
 await seed();const first=await sync(['Two Way,1,0.4'],['Two Way,1,0.2']);
 const second=await sync(null,['Two Way,1,0.1'],{clock:()=>now+60000});
 assert.deepEqual(second.snapshot.baseballPlayersByRole.batter,JSON.parse(JSON.stringify(first.snapshot.baseballPlayersByRole.batter)));
 assert.equal((await attach(game('Two Way'))).awayLineupXwoba,.4);
 assert.equal(second.snapshot.sources.find(row=>row.id==='baseball-savant-batter').ok,false);
});

test('authoritative role indexes never fall back to stale compatibility names',async()=>{
 await seed({baseballPlayers:{ghost:{name:'Ghost',role:'batter',expectedWoba:.9}},baseballPlayersByRole:{batter:{}}});
 const g=game('Ghost');await attachAdvancedDatasetContext([g],{clock:()=>now,localOnly:true});
 assert.equal(g.advancedDataset.awayLineupXwoba,null);
 assert.equal(g.advancedDataset.lineupXwobaEvidence.away.statRejections.missing_stat_identity,1);
});

test('legacy unambiguous role records survive migration and role indexes keep request period checks',async()=>{
 await seed({baseballPlayers:{legacy:{name:'Legacy',role:'batter',expectedWoba:.3},keyonly:{role:'batter',expectedWoba:.2}}});
 const result=await sync(null,['Pitcher,2,0.2']);
 assert.equal(result.snapshot.baseballPlayersByRole.batter.legacy[0].expectedWoba,.3);
 assert.equal(result.snapshot.baseballPlayersByRole.batter.keyonly[0].expectedWoba,.2);
 await sync(['Current,3,0.4'],null);
 const g=game('Current');await attachAdvancedDatasetContext([g],{clock:()=>now,year:2025,localOnly:true});
 assert.equal(g.advancedDataset.awayLineupXwoba,null);
});
