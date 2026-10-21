import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const directory=await mkdtemp(join(tmpdir(),'sports-mlb-lineups-'));
process.env.OMNIMOD_SPORTS_DATA_DIR=directory;process.env.LOCAL_ONLY='true';
const {attachAdvancedDatasetContext,advancedDatasetSnapshotFile}=await import('../src/advancedDatasets.js');
const {writeJson}=await import('../src/storage.js');
const {normalizeEntityName}=await import('../src/intelligenceStore.js');
const {predictionInputsAt,observedInputState}=await import('../src/inputChronology.js');
const {buildEvidenceCoverage}=await import('../src/evidenceCoverage.js');
const {parseEspnSummary}=await import('../src/autoEnrichment.js');
const now=Date.parse('2026-10-21T08:00:00Z'),old=new Date(now-60000).toISOString();
test.after(()=>rm(directory,{recursive:true,force:true}));
function fixture(){
 const game={id:'g',leagueKey:'mlb',league:'MLB',sportGroup:'Baseball',away:{name:'Away'},home:{name:'Home'},autoPlayers:[],autoLineups:[],autoEnrichment:{fetchedAt:old,cacheState:'fresh'}};
 const baseballPlayers={};
 for(const side of ['Away','Home'])for(let i=0;i<9;i++){
  const name=side+' Batter '+i;game.autoLineups.push({name,team:side,athleteId:side+i,role:'Batter',starter:true,confirmedStarter:true,batOrder:i+1,updatedAt:old});
  baseballPlayers[normalizeEntityName(name)]={name,role:'batter',playerId:'mlbam-'+side+i,expectedWoba:side==='Away'?.3:.4,sourceFetchedAt:old};
 }
 return {game,snapshot:{version:2,sources:[],footballSchedules:[],baseballPlayers}};
}
async function attach(game){return attachAdvancedDatasetContext([game],{clock:()=>now,localOnly:true});}

test('injury or generic player lists cannot masquerade as the current batting lineup',async()=>{
 const {game,snapshot}=fixture();game.autoPlayers=game.autoLineups.map(row=>({...row,status:'out',availability:0}));game.autoLineups=[];
 await writeJson(advancedDatasetSnapshotFile,snapshot);await attach(game);
 assert.equal(game.advancedDataset.lineupXwobaDifference,null);assert.equal(game.advancedDataset.lineupXwobaEvidence.away.confirmedBatters,0);
});

test('two complete confirmed batting lineups produce the observed comparison without injury-list substitution',async()=>{
 const {game,snapshot}=fixture();await writeJson(advancedDatasetSnapshotFile,snapshot);await attach(game);
 assert.ok(Math.abs(game.advancedDataset.lineupXwobaDifference-.1)<1e-9);
 assert.equal(game.advancedDataset.lineupXwobaEvidence.away.matchedStats,9);
 assert.equal(game.advancedDataset.lineupXwobaEvidence.identityMatchBasis,'normalized_name_only');
});

test('an unavailable confirmed batter prevents a complete-lineup comparison',async()=>{
 const {game,snapshot}=fixture();game.autoPlayers=[{...game.autoLineups[0],sourceAthleteId:game.autoLineups[0].athleteId,status:'out',availability:0}];
 await writeJson(advancedDatasetSnapshotFile,snapshot);await attach(game);
 assert.equal(game.advancedDataset.lineupXwobaDifference,null);assert.equal(game.advancedDataset.lineupXwobaEvidence.away.complete,false);
});

test('duplicates cannot inflate membership and same-name conflicting IDs cannot share one stat identity',async()=>{
 const {game,snapshot}=fixture();game.autoLineups.push({...game.autoLineups[0]});await writeJson(advancedDatasetSnapshotFile,snapshot);await attach(game);
 assert.equal(game.advancedDataset.lineupXwobaEvidence.away.confirmedBatters,9);
 game.autoLineups.push({...game.autoLineups[0],athleteId:'other-person'});await attach(game);
 assert.equal(game.advancedDataset.lineupXwobaDifference,null);assert.ok(game.advancedDataset.lineupXwobaEvidence.away.ambiguousNames.length);
});

test('partial historical-stat coverage stays research-only and cannot be a complete lineup factor',async()=>{
 const {game,snapshot}=fixture();delete snapshot.baseballPlayers[normalizeEntityName('Away Batter 8')];
 await writeJson(advancedDatasetSnapshotFile,snapshot);await attach(game);
 assert.equal(game.advancedDataset.lineupXwobaDifference,null);assert.equal(game.advancedDataset.lineupXwobaEvidence.away.matchedStats,8);
 assert.equal(game.advancedDataset.lineupXwobaEvidence.away.complete,false);
});

test('a future lineup receipt invalidates its derived average despite older player-stat receipts',async()=>{
 const {game,snapshot}=fixture();game.autoPlayers=game.autoLineups.map(row=>({...row}));game.autoLineups[0].updatedAt=new Date(now+1000).toISOString();
 await writeJson(advancedDatasetSnapshotFile,snapshot);await attach(game);
 assert.equal(observedInputState(game.advancedDataset,now),'after_information_cutoff');assert.equal(predictionInputsAt(game,{},now).game.advancedDataset,null);
});

test('the current summary parser stamps lineup receipts and frozen coverage reports membership counts',async()=>{
 const {game,snapshot}=fixture();const summary={rosters:['Away','Home'].map(team=>({team:{displayName:team},roster:game.autoLineups.filter(row=>row.team===team).map(row=>({starter:true,batOrder:row.batOrder,position:{displayName:'Batter'},athlete:{id:row.athleteId,displayName:row.name}}))}))};
 const parsed=parseEspnSummary(summary,game,{fetchedAt:old,cacheState:'network'});game.autoLineups=parsed.lineups;game.autoPlayers=parsed.players;game.autoEnrichment=parsed.meta;
 assert.ok(parsed.lineups.every(row=>row.updatedAt===old));await writeJson(advancedDatasetSnapshotFile,snapshot);await attach(game);
 const frozen=buildEvidenceCoverage(game,{now});assert.equal(frozen.advancedDatasetProvenance.lineupXwobaEvidence.away.confirmedBatters,9);
 for(const row of game.autoLineups){delete row.updatedAt;delete row.source;}await attach(game);
 assert.equal(observedInputState(game.advancedDataset,now),'unknown');
});


test('a pitcher without a batting slot and a shared provider stat identity cannot fill missing batters',async()=>{
 const {game,snapshot}=fixture();game.autoLineups[0].role='Starting pitcher';delete game.autoLineups[0].batOrder;
 await writeJson(advancedDatasetSnapshotFile,snapshot);await attach(game);assert.equal(game.advancedDataset.lineupXwobaDifference,null);
 assert.equal(game.advancedDataset.lineupXwobaEvidence.away.rejected.pitcherWithoutBattingSlot,1);
 game.autoLineups[0].batOrder=1;await attach(game);assert.ok(Number.isFinite(game.advancedDataset.lineupXwobaDifference));
 snapshot.baseballPlayers[normalizeEntityName('Home Batter 0')].playerId=snapshot.baseballPlayers[normalizeEntityName('Away Batter 0')].playerId;
 await writeJson(advancedDatasetSnapshotFile,snapshot);await attach(game);assert.equal(game.advancedDataset.lineupXwobaDifference,null);
 assert.ok(game.advancedDataset.lineupXwobaEvidence.sharedStatIdentities.length);
});

test('observed zero xwOBA stays usable while missing or invalid statistics cannot complete a lineup',async()=>{
 const {game,snapshot}=fixture();for(const row of Object.values(snapshot.baseballPlayers))row.expectedWoba=0;
 await writeJson(advancedDatasetSnapshotFile,snapshot);await attach(game);assert.equal(game.advancedDataset.lineupXwobaDifference,0);
 snapshot.baseballPlayers[normalizeEntityName('Away Batter 0')].expectedWoba=-.1;
 await writeJson(advancedDatasetSnapshotFile,snapshot);await attach(game);assert.equal(game.advancedDataset.lineupXwobaDifference,null);
});

test('tennis surface-dependent features include the actual context receipt in their cutoff lineage',async()=>{
 const snapshot={version:2,sources:[],tennis:{atp:{away:{elo:1500,surfaces:{clay:1400},serveWon:.5,returnWon:.4,matches:2,sourceFetchedAt:old},home:{elo:1600,surfaces:{clay:1700},serveWon:.6,returnWon:.4,matches:2,sourceFetchedAt:old}}}};
 const game={id:'tennis',leagueKey:'atp',away:{name:'Away'},home:{name:'Home'},autoContext:{surface:'clay',updatedAt:new Date(now+1000).toISOString()}};
 await writeJson(advancedDatasetSnapshotFile,snapshot);await attach(game);
 assert.equal(observedInputState(game.advancedDataset,now),'after_information_cutoff');assert.equal(predictionInputsAt(game,{},now).game.advancedDataset,null);
});


test('unknown batting roles, duplicate supplied slots or extra starters cannot establish a complete lineup',async()=>{
 for(const variant of ['unknown-role','duplicate-slot','extra-starter']){
  const {game,snapshot}=fixture();
  if(variant==='unknown-role'){game.autoLineups[0].role='';delete game.autoLineups[0].batOrder;}
  if(variant==='duplicate-slot')game.autoLineups[0].batOrder=2;
  if(variant==='extra-starter')game.autoLineups.push({...game.autoLineups[0],athleteId:'extra',name:'Extra Batter'});
  await writeJson(advancedDatasetSnapshotFile,snapshot);await attach(game);
  assert.equal(game.advancedDataset.lineupXwobaDifference,null);assert.equal(game.advancedDataset.lineupXwobaEvidence.away.complete,false);
 }
});
