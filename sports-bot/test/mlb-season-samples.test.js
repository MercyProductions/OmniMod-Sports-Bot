import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const directory=await mkdtemp(join(tmpdir(),'sports-mlb-season-'));
process.env.OMNIMOD_SPORTS_DATA_DIR=directory;process.env.ADVANCED_DATASETS_ENABLED='true';process.env.LOCAL_ONLY='false';
const {attachAdvancedDatasetContext,syncAdvancedDatasets,advancedDatasetSnapshotFile}=await import('../src/advancedDatasets.js');
const {writeJson}=await import('../src/storage.js');
const {normalizeEntityName}=await import('../src/intelligenceStore.js');
const {buildEvidenceCoverage}=await import('../src/evidenceCoverage.js');
const now=Date.parse('2026-10-21T08:00:00Z'),old=new Date(now-1000).toISOString();
const key=year=>JSON.stringify({contract:'advanced-source-contract-v1',source:'baseball-savant-batter',year});
function fixture(year=2026){
 const game={id:'g',leagueKey:'mlb',seasonYear:2026,away:{name:'Away'},home:{name:'Home'},autoLineups:[]},baseballPlayers={};
 for(const side of ['Away','Home'])for(let i=0;i<9;i++){
  const name=side+' Batter '+i;game.autoLineups.push({name,team:side,role:'Batter',confirmedStarter:true,batOrder:i+1,updatedAt:old});
  baseballPlayers[normalizeEntityName(name)]={name,role:'batter',playerId:side+i,expectedWoba:side==='Home'?.4:.3,plateAppearances:100,battedBallEvents:50,sourceRequestKey:key(year),sourceFetchedAt:old};
 }
 return {game,snapshot:{sources:[],footballSchedules:[],baseballPlayers}};
}
async function attach({game,snapshot}){await writeJson(advancedDatasetSnapshotFile,snapshot);const result=await attachAdvancedDatasetContext([game],{clock:()=>now,localOnly:true});return {advanced:game.advancedDataset,result};}
test.after(()=>rm(directory,{recursive:true,force:true}));

test('a known MLB game season cannot consume another calendar-year cohort and clears an old comparison',async()=>{
 const f=fixture();f.game.seasonYear=2025;f.game.advancedDataset={provider:'MLB Baseball Savant',lineupXwobaDifference:.9};
 const {advanced,result}=await attach(f);assert.equal(advanced.lineupXwobaDifference,null);assert.equal(advanced.awayLineupXwoba,null);
 assert.equal(advanced.sourcePeriodEvidence.state,'season_mismatch');assert.equal(advanced.lineupXwobaCoverage,'blocked_period');assert.equal(result.periodRejections.length,1);
});

test('known games reject unknown source periods and malformed or conflicting native assertions',async()=>{
 for(const mutate of [row=>delete row.sourceRequestKey,row=>row.seasonYear=2025,row=>row.seasonYear='bad']){
  const f=fixture();for(const row of Object.values(f.snapshot.baseballPlayers))mutate(row);
  const {advanced}=await attach(f);assert.equal(advanced.lineupXwobaDifference,null);assert.equal(advanced.sourcePeriodEvidence.blocked,true);
 }
});

test('matching request scopes remain usable but explicitly native-unverified; matching native assertions can be distinguished',async()=>{
 for(const native of [false,true]){
  const f=fixture();if(native)for(const row of Object.values(f.snapshot.baseballPlayers))row.seasonYear=2026;
  const {advanced}=await attach(f);assert.ok(Math.abs(advanced.lineupXwobaDifference-.1)<1e-9);
  assert.equal(advanced.sourcePeriodEvidence.nativePeriodVerified,native);
  assert.equal(advanced.sourcePeriodEvidence.nativePublicationVerified,false);
 }
});

test('unknown game seasons remain disclosed and invalid game seasons cannot qualify the factor',async()=>{
 for(const season of [null,'nonsense']){
  const f=fixture();f.game.seasonYear=season;const {advanced}=await attach(f);
  assert.equal(advanced.sourcePeriodEvidence.state,season===null?'game_season_unknown':'game_season_invalid');
  if(season!==null)assert.equal(advanced.lineupXwobaDifference,null);
 }
});

test('unknown zero negative and fractional sample counts cannot establish a complete batting comparison',async()=>{
 for(const count of [undefined,null,0,-1,1.5]){
  const f=fixture();const row=f.snapshot.baseballPlayers.awaybatter0;row.plateAppearances=count;delete row.battedBallEvents;
  const {advanced}=await attach(f);assert.equal(advanced.lineupXwobaDifference,null);assert.equal(advanced.awayLineupXwoba,.3);
  assert.equal(advanced.lineupXwobaEvidence.away.positiveSampleStats,8);
  assert.ok(buildEvidenceCoverage(f.game,{now}).missing.includes('away:advanced_batting_sample_unknown_or_invalid'));
 }
});

test('positive samples are evidence presence, never an assertion of statistical adequacy',async()=>{
 const f=fixture();for(const row of Object.values(f.snapshot.baseballPlayers)){row.plateAppearances=1;delete row.battedBallEvents;}
 const {advanced}=await attach(f);assert.ok(Math.abs(advanced.lineupXwobaDifference-.1)<1e-9);
 assert.equal(advanced.lineupXwobaEvidence.away.sampleAdequacyValidated,false);
 assert.equal(advanced.lineupXwobaEvidence.away.sampleMeasurements.length,9);
});

test('native season contradictions cannot replace a previously valid provider cohort',async()=>{
 await writeJson(advancedDatasetSnapshotFile,{sources:[],footballSchedules:[]});
 const fetchImpl=year=>async url=>{if(url.includes('type=batter'))return {ok:true,text:async()=>`player_name,player_id,year,pa,bip,est_woba\nBatter,1,${year},100,50,0.3\n`};throw new Error('Synthetic unavailable');};
 const first=await syncAdvancedDatasets({clock:()=>now,year:2026,force:true,fetchImpl:fetchImpl(2026)});
 const second=await syncAdvancedDatasets({clock:()=>now+1000,year:2026,force:true,fetchImpl:fetchImpl(2025)});
 assert.deepEqual(second.snapshot.baseballPlayers.batter,first.snapshot.baseballPlayers.batter);
 assert.equal(second.snapshot.sources.find(row=>row.id==='baseball-savant-batter').ok,false);
});

test('import preserves both sample fields and does not let blank PA erase a measured BIP count',async()=>{
 await writeJson(advancedDatasetSnapshotFile,{sources:[],footballSchedules:[]});
 const result=await syncAdvancedDatasets({clock:()=>now,year:2026,force:true,fetchImpl:async url=>{
  if(url.includes('type=batter'))return {ok:true,text:async()=> 'player_name,year,pa,bip,est_woba\nBatter, ,,20,0.3\nZero,,0,0,0.0\n'};throw new Error('Synthetic unavailable');
 }});
 const row=result.snapshot.baseballPlayers.batter;assert.equal(row.plateAppearances,null);assert.equal(row.battedBallEvents,20);assert.equal(row.sampleSize,20);assert.equal(row.sampleSizeKind,'bip');
 assert.equal(result.snapshot.baseballPlayers.zero.plateAppearances,0);assert.equal(result.snapshot.baseballPlayers.zero.battedBallEvents,0);
});


test('contradictory or invalid paired counts remain visible but cannot qualify batting evidence',async()=>{
 for(const [pa,bip] of [[10,20],[100,-1],[100,1.5]]){
  const f=fixture();Object.assign(f.snapshot.baseballPlayers.awaybatter0,{plateAppearances:pa,battedBallEvents:bip});
  const {advanced}=await attach(f);assert.equal(advanced.lineupXwobaDifference,null);
  assert.equal(advanced.lineupXwobaEvidence.away.sampleMeasurements[0].invalid,true);
 }
});
