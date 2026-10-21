import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const directory=await mkdtemp(join(tmpdir(),'sports-team-rates-'));
process.env.OMNIMOD_SPORTS_DATA_DIR=directory;process.env.ADVANCED_DATASETS_ENABLED='true';process.env.LOCAL_ONLY='false';
const {syncAdvancedDatasets,attachAdvancedDatasetContext,advancedDatasetSnapshotFile,advancedDatasetRequest}=await import('../src/advancedDatasets.js');
const {writeJson}=await import('../src/storage.js');
const {buildEvidenceCoverage}=await import('../src/evidenceCoverage.js');
const {predictionInputsAt}=await import('../src/inputChronology.js');
const now=Date.parse('2026-10-21T08:00:00Z'),old=new Date(now-1000).toISOString();
const keys=advancedDatasetRequest({clock:()=>now}).requestIdentities;
const nfl=games=>({games,season:2026,epaPerGame:-1,passingEpaPerGame:-2,rushingEpaPerGame:1,cpoe:0,sourceRequestKey:keys['nflverse-team-stats'],sourceFetchedAt:old});
const nhl=games=>({games,xGoalsFor:0,xGoalsAgainst:2,goalsAgainst:2,sourceRequestKey:keys['moneypuck-team-xg'],sourceFetchedAt:old});
const game=leagueKey=>({id:leagueKey,leagueKey,seasonYear:leagueKey==='nfl'?2026:20262027,away:{abbr:'A'},home:{abbr:'H'}});
async function attach(league,away,home){
 await writeJson(advancedDatasetSnapshotFile,{sources:[],footballSchedules:[],[league==='nfl'?'footballTeams':'hockeyTeams']:{A:away,H:home}});
 const g=game(league);const result=await attachAdvancedDatasetContext([g],{clock:()=>now,localOnly:true});return {g,advanced:g.advancedDataset,result};
}
test.after(()=>rm(directory,{recursive:true,force:true}));

test('NFL legacy derived rates cannot bypass missing or invalid games-count evidence',async()=>{
 for(const games of [undefined,null,'',false,0,-1,2.5,1e18]){
  const {g,advanced,result}=await attach('nfl',nfl(games),nfl(2));
  assert.equal(advanced.epaDifference,null);assert.equal(advanced.cpoeDifference,null);assert.equal(result.matched,0);
  assert.equal(advanced.teamSampleEvidence.away.positiveSample,false);
  assert.ok(buildEvidenceCoverage(g,{now}).missing.includes('away:advanced_team_sample_unknown_or_invalid'));
 }
});

test('NHL rates require measured safe positive integer games on both sides',async()=>{
 for(const games of [undefined,null,0,-1,2.5,1e18]){
  const {advanced}=await attach('nhl',nhl(games),nhl(2));
  assert.equal(advanced.awayXg,null);assert.equal(advanced.xgDifference,null);assert.equal(advanced.gsaxDifference,null);
  assert.equal(advanced.teamSampleEvidence.away.positiveSample,false);
 }
});

test('positive integer samples preserve negative NFL EPA and real zero measurements',async()=>{
 const a=nfl('2'),h={...nfl(2),epaPerGame:1,passingEpaPerGame:0,rushingEpaPerGame:1};
 const {advanced}=await attach('nfl',a,h);assert.equal(advanced.epaDifference,2/60);assert.equal(advanced.passingEpaDifference,2/38);assert.equal(advanced.rushingEpaDifference,0);assert.equal(advanced.cpoeDifference,0);
 assert.equal(advanced.teamSampleEvidence.sampleAdequacyValidated,false);assert.equal(advanced.teamSampleEvidence.away.games,2);
});

test('source import cannot divide totals by fractional games and keeps true zero and negative EPA',async()=>{
 await writeJson(advancedDatasetSnapshotFile,{sources:[],footballSchedules:[]});
 const result=await syncAdvancedDatasets({clock:()=>now,force:true,fetchImpl:async url=>{
  if(url.includes('/stats_team/'))return {ok:true,text:async()=> 'season,season_type,team,games,passing_epa,rushing_epa,passing_cpoe\n2026,REG,A,2.5,10,10,0\n2026,REG,H,2,-4,0,0\n'};throw new Error('Synthetic unavailable');
 }});
 assert.equal(result.snapshot.footballTeams.A.games,2.5);assert.equal(result.snapshot.footballTeams.A.epaPerGame,null);
 assert.equal(result.snapshot.footballTeams.H.passingEpaPerGame,-2);assert.equal(result.snapshot.footballTeams.H.rushingEpaPerGame,0);
});

test('invalid NHL totals disable only dependent measurements while observed zeros survive',async()=>{
 for(const [field,value] of [['xGoalsFor',-1],['xGoalsAgainst',-1],['goalsAgainst',-1],['goalsAgainst',1.5]]){
  const a={...nhl(2),[field]:value};const {g,advanced}=await attach('nhl',a,nhl(2));
  assert.ok(buildEvidenceCoverage(g,{now}).missing.includes('away:advanced_team_measurement_invalid'));
  assert.ok(advanced.teamSampleEvidence.away.invalidMeasurements.includes(field));
  if(field==='xGoalsFor'){assert.equal(advanced.awayXg,null);assert.equal(advanced.xgDifference,null);assert.equal(advanced.gsaxDifference,0);}
  else if(field==='xGoalsAgainst'){assert.equal(advanced.xgDifference,null);assert.equal(advanced.gsaxDifference,null);assert.equal(advanced.awayXg,0);}
  else{assert.equal(advanced.gsaxDifference,null);assert.equal(advanced.xgDifference,0);}
 }
});

test('duplicate all-situation NHL identities preserve the previous valid cohort and original receipts',async()=>{
 const preserved=nhl(2);await writeJson(advancedDatasetSnapshotFile,{sources:[],hockeyTeams:{A:preserved}});
 const result=await syncAdvancedDatasets({clock:()=>now,force:true,fetchImpl:async url=>{
  if(url.includes('moneypuck'))return {ok:true,text:async()=> 'team,situation,games_played,xGoalsFor\nA,all,2,4\n a ,all,2,9\n'};throw new Error('Synthetic unavailable');
 }});
 assert.equal(result.snapshot.sources.find(row=>row.id==='moneypuck-team-xg').ok,false);
 assert.deepEqual(result.snapshot.hockeyTeams.A,preserved);
});

test('other NHL situations do not overwrite all-situation totals and whitespace is normalized',async()=>{
 await writeJson(advancedDatasetSnapshotFile,{sources:[]});
 const result=await syncAdvancedDatasets({clock:()=>now,force:true,fetchImpl:async url=>{
  if(url.includes('moneypuck'))return {ok:true,text:async()=> 'team,situation,games_played,xGoalsFor\nA, all ,2,4\nA,5on5,2,9\n'};throw new Error('Synthetic unavailable');
 }});
 assert.equal(result.snapshot.hockeyTeams.A.xGoalsFor,4);assert.equal(result.snapshot.sources.find(row=>row.id==='moneypuck-team-xg').excludedSituationRows,1);
});

test('sample evidence is frozen with source receipts and cannot cross a known future cutoff',async()=>{
 const {g,advanced}=await attach('nfl',nfl(2),nfl(4));
 const frozen=buildEvidenceCoverage(g,{now});assert.equal(frozen.advancedDatasetProvenance.teamSampleEvidence.home.games,4);
 assert.equal(advanced.teamSampleEvidence.sampleAdequacyValidated,false);
 assert.equal(predictionInputsAt(g,{},Date.parse(old)-1).game.advancedDataset,null);
});
