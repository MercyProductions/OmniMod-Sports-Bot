import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const directory=await mkdtemp(join(tmpdir(),'sports-nba-period-'));
process.env.OMNIMOD_SPORTS_DATA_DIR=directory;process.env.ADVANCED_DATASETS_ENABLED='true';process.env.ADVANCED_NBA_STATS_ENABLED='true';process.env.LOCAL_ONLY='false';
const {attachAdvancedDatasetContext,syncAdvancedDatasets,advancedDatasetSnapshotFile}=await import('../src/advancedDatasets.js');
const {writeJson}=await import('../src/storage.js');
const {buildEvidenceCoverage}=await import('../src/evidenceCoverage.js');
const now=Date.parse('2026-10-21T08:00:00Z'),old=new Date(now-1000).toISOString();
const key=seasonStart=>JSON.stringify({contract:'advanced-source-contract-v1',source:'nba-advanced-teams',seasonStart});
const game=seasonYear=>({id:'nba',leagueKey:'nba',seasonYear,sourceMeta:{provider:'ESPN CDN'},away:{name:'Away'},home:{name:'Home'}});
const teams=()=>({away:{team:'Away',teamId:1,games:10,pace:100,netRating:0,sourceRequestKey:key(2026),sourceFetchedAt:old},home:{team:'Home',teamId:2,games:10,pace:110,netRating:10,sourceRequestKey:key(2026),sourceFetchedAt:old}});
async function seed(basketballTeams){await writeJson(advancedDatasetSnapshotFile,{version:2,sources:[],footballSchedules:[],basketballTeams});}
async function attach(g,options={}){return attachAdvancedDatasetContext([g],{clock:()=>now,localOnly:true,...options});}
test.after(()=>rm(directory,{recursive:true,force:true}));

test('observed ESPN NBA end-year metadata maps 2027 to the requested 2026-27 scope',async()=>{
 await seed(teams());const g=game(2027);await attach(g);
 assert.equal(g.advancedDataset.pace,105);assert.equal(g.advancedDataset.efficiencyDifference,10);
 assert.equal(g.advancedDataset.sourcePeriodEvidence.gameSeason,2026);
 assert.equal(g.advancedDataset.sourcePeriodEvidence.nativePeriodVerified,false);
});

test('wrong NBA seasons clear existing numeric factors and produce structured rejections',async()=>{
 await seed(teams());const g=game(2026);g.advancedDataset={provider:'NBA.com advanced team stats',pace:999,efficiencyDifference:99};
 const result=await attach(g,{seasonStart:2026});assert.equal(g.advancedDataset.pace,null);assert.equal(g.advancedDataset.efficiencyDifference,null);
 assert.equal(g.advancedDataset.sourcePeriodEvidence.state,'season_mismatch');assert.equal(result.periodRejections.length,1);
});

test('a known game cannot consume unknown source periods or assume an unknown provider end-year convention',async()=>{
 await seed({away:{games:10,pace:100,netRating:0},home:{games:10,pace:110,netRating:10}});
 let g=game(2027);await attach(g);assert.equal(g.advancedDataset.pace,null);assert.equal(g.advancedDataset.sourcePeriodEvidence.state,'source_season_unknown');
 await seed(teams());g=game(2027);g.sourceMeta={provider:'Unknown'};await attach(g);assert.equal(g.advancedDataset.pace,null);assert.equal(g.advancedDataset.sourcePeriodEvidence.state,'game_season_convention_unverified');
});

test('unknown season remains disclosed, invalid season is rejected, and native contradictions block a matching request',async()=>{
 for(const season of [null,'bad']){await seed(teams());const g=game(season);await attach(g);assert.equal(g.advancedDataset.sourcePeriodEvidence.state,season===null?'game_season_unknown':'game_season_invalid');if(season!==null)assert.equal(g.advancedDataset.pace,null);}
 const rows=teams();rows.home.nativeSeasonLabel='2025-26';await seed(rows);const g=game(2027);await attach(g);assert.equal(g.advancedDataset.pace,null);assert.equal(g.advancedDataset.sourcePeriodEvidence.state,'source_season_conflict');
});

test('unmeasured zero negative or fractional team samples cannot supply external NBA factors',async()=>{
 for(const games of [undefined,null,0,-1,1.5]){
  const rows=teams();rows.away.games=games;await seed(rows);const g=game(2027);await attach(g);
  assert.equal(g.advancedDataset.pace,null);assert.equal(g.advancedDataset.efficiencyDifference,null);
  assert.equal(g.advancedDataset.teamSampleEvidence.away.positiveSample,false);
  assert.ok(buildEvidenceCoverage(g,{now}).missing.includes('away:advanced_team_sample_unknown_or_invalid'));
 }
});

test('true zero ratings remain data when both sides have measured positive samples',async()=>{
 const rows=teams();rows.home.netRating=0;rows.away.netRating=0;rows.home.games=1;rows.away.games=1;
 await seed(rows);const g=game(2027);await attach(g);assert.equal(g.advancedDataset.efficiencyDifference,0);
 assert.equal(g.advancedDataset.teamSampleEvidence.sampleAdequacyValidated,false);
});

const payload=rows=>({resultSets:[{headers:['TEAM_NAME','TEAM_ID','GP','PACE','NET_RATING'],rowSet:rows}]});
async function sync(data){return syncAdvancedDatasets({clock:()=>now,year:2026,seasonStart:2026,force:true,fetchImpl:async url=>{
 if(url.includes('stats.nba.com'))return {ok:true,text:async()=>JSON.stringify(data)};throw new Error('Synthetic unavailable');
}});}

test('duplicate normalized team names or native IDs cannot silently overwrite provider rows',async()=>{
 for(const data of [payload([['Same Team',1,10,100,0],['Same-Team',2,10,110,10]]),payload([['Away',1,10,100,0],['Home',1,10,110,10]])]){
  await seed(teams());const result=await sync(data);assert.equal(result.snapshot.sources.find(row=>row.id==='nba-advanced-teams').ok,false);
  assert.equal(result.snapshot.basketballTeams.away.pace,100);assert.equal(result.snapshot.basketballTeams.home.pace,110);
 }
});

test('native season labels conflict before replacing old rows and numeric strings are normalized',async()=>{
 await seed(teams());let data=payload([['Away',1,10,100,0],['Home',2,10,110,10]]);data.resultSets[0].headers.push('SEASON_YEAR');data.resultSets[0].rowSet.forEach(row=>row.push('2025-26'));
 const rejected=await sync(data);assert.equal(rejected.snapshot.sources.find(row=>row.id==='nba-advanced-teams').ok,false);
 const accepted=await sync(payload([['Away',1,'10','100','0'],['Home',2,'10','110','10']]));
 assert.equal(accepted.snapshot.basketballTeams.away.games,10);assert.equal(accepted.snapshot.basketballTeams.away.netRating,0);
});


test('a shared native team identity cannot supply an opponent comparison even in a legacy snapshot',async()=>{
 const rows=teams();rows.home.teamId=' '+rows.away.teamId+' ';await seed(rows);const g=game(2027);await attach(g);
 assert.equal(g.advancedDataset.pace,null);assert.equal(g.advancedDataset.teamSampleEvidence.sharedTeamIdentity,true);
 assert.ok(buildEvidenceCoverage(g,{now}).missing.includes('advanced_dataset:shared_team_identity'));
});
