import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const directory=await mkdtemp(join(tmpdir(),'sports-measured-features-'));
process.env.OMNIMOD_SPORTS_DATA_DIR=directory;process.env.ADVANCED_DATASETS_ENABLED='true';process.env.LOCAL_ONLY='false';
const {derivedAdvancedDataset}=await import('../src/sportsData.js');
const {attachAdvancedDatasetContext,syncAdvancedDatasets,advancedDatasetSnapshotFile}=await import('../src/advancedDatasets.js');
const {writeJson}=await import('../src/storage.js');
const {buildEvidenceCoverage}=await import('../src/evidenceCoverage.js');
test.after(()=>rm(directory,{recursive:true,force:true}));
const profile=advancedMetrics=>({advancedMetrics});

test('historical differences need two measured sides while real zeros remain zero',()=>{
 for(const [sport,field,output] of [['Baseball','bullpenRunsAllowedProxy','bullpenDifference'],
  ['Basketball','offensiveEfficiency','efficiencyDifference'],['Football','epaProxy','epaDifference'],
  ['Hockey','expectedGoalsProxy','xgDifference'],['Soccer','shotQuality','shotQualityDifference']]){
  for(const missing of [undefined,null,'',false,NaN]){
   const result=derivedAdvancedDataset({sportGroup:sport},profile({[field]:2}),profile({[field]:missing}));
   assert.equal(result[output],null,`${sport}: missing home metric`);
  }
  assert.equal(derivedAdvancedDataset({sportGroup:sport},profile({[field]:0}),profile({[field]:0}))[output],0);
  assert.equal(derivedAdvancedDataset({sportGroup:sport},profile({}),profile({})).playValueDifference,null);
  assert.equal(derivedAdvancedDataset({sportGroup:sport},profile({playValue:2}),profile({playValue:5})).playValueDifference,3);
 }
});

test('derived pace neither averages one side alone nor discards measured zero',()=>{
 const game={sportGroup:'Basketball'};
 assert.equal(derivedAdvancedDataset(game,profile({possessions:100}),profile({})).pace,null);
 assert.equal(derivedAdvancedDataset(game,profile({possessions:0}),profile({possessions:0})).pace,0);
 assert.equal(derivedAdvancedDataset(game,profile({possessions:100}),profile({possessions:110})).pace,105);
});

test('external NFL NBA and NHL features cannot compare a known metric with missing-as-zero',async()=>{
 await writeJson(advancedDatasetSnapshotFile,{version:2,sources:[],footballSchedules:[],
  footballTeams:{A:{epaPerGame:null,passingEpaPerGame:null,rushingEpaPerGame:null,cpoe:null},H:{epaPerGame:2,passingEpaPerGame:2,rushingEpaPerGame:1,cpoe:1}},
  basketballTeams:{away:{pace:null,netRating:null},home:{pace:100,netRating:10}},
  hockeyTeams:{A:{games:null,xGoalsFor:null,xGoalsAgainst:null,goalsAgainst:null},H:{games:2,xGoalsFor:6,xGoalsAgainst:5,goalsAgainst:4}}});
 const games=['nfl','nba','nhl'].map(leagueKey=>({id:leagueKey,leagueKey,away:{name:'Away',abbr:'A'},home:{name:'Home',abbr:'H'}}));
 await attachAdvancedDatasetContext(games,{localOnly:true});
 assert.equal(games[0].advancedDataset.epaDifference,null);assert.equal(games[0].advancedDataset.cpoeDifference,null);
 assert.equal(games[1].advancedDataset.pace,null);assert.equal(games[1].advancedDataset.efficiencyDifference,null);
 assert.equal(games[2].advancedDataset.awayXg,null);assert.equal(games[2].advancedDataset.xgDifference,null);assert.equal(games[2].advancedDataset.gsaxDifference,null);
 const coverage=buildEvidenceCoverage(games[0]);
 assert.ok(coverage.advancedDatasetProvenance.missingMeasurements.includes('epaDifference'));
 assert.ok(coverage.missing.includes('advanced_dataset:measurements_incomplete'));
});

test('tennis observed zero serve rates remain data and absent rates do not become synthetic priors',async()=>{
 for(const serveWon of [0,null]){
  await writeJson(advancedDatasetSnapshotFile,{version:2,sources:[],footballSchedules:[],tennis:{atp:{
   away:{elo:1500,serveWon,returnWon:0},home:{elo:1500,serveWon:.6,returnWon:.4}}}});
  const game={id:'tennis',leagueKey:'atp',away:{name:'Away'},home:{name:'Home'}};
  await attachAdvancedDatasetContext([game],{localOnly:true});
  assert.equal(game.advancedDataset.serveReturnDifference,serveWon===null?null:1);
 }
});

test('provider imports preserve unknown sample sizes and require positive games for rates',async()=>{
 await writeJson(advancedDatasetSnapshotFile,{version:2,sources:[],footballSchedules:[]});
 const fetchImpl=async url=>{
  if(url.includes('/stats_team/'))return {ok:true,text:async()=> nflCsv('team,games,passing_epa,rushing_epa,passing_cpoe\nA,0,4,,\nH,2,0,0,0\n',url)};
  if(url.includes('moneypuck'))return {ok:true,text:async()=> 'team,situation,games_played,xGoalsFor\nA,all,,4\n'};
  if(url.includes('type=batter'))return {ok:true,text:async()=> 'player_name,est_woba\nHitter,0\n'};
  throw new Error('Synthetic unavailable');
 };
 const result=await syncAdvancedDatasets({force:true,fetchImpl});
 assert.equal(result.snapshot.footballTeams.A.epaPerGame,null);
 assert.equal(result.snapshot.footballTeams.A.passingEpaPerGame,null);
 assert.equal(result.snapshot.footballTeams.A.cpoe,null);
 assert.equal(result.snapshot.footballTeams.H.epaPerGame,0);
 assert.equal(result.snapshot.footballTeams.A.games,0);
 assert.equal(result.snapshot.hockeyTeams.A.games,null);
 assert.equal(result.snapshot.baseballPlayers.hitter.sampleSize,null);
 assert.equal(result.snapshot.baseballPlayers.hitter.expectedWoba,0);
});

test('known external values preserve the existing units, difference signs and true-zero rates',async()=>{
 await writeJson(advancedDatasetSnapshotFile,{version:2,sources:[],footballSchedules:[],
  footballTeams:{A:{epaPerGame:1,passingEpaPerGame:1,rushingEpaPerGame:1,cpoe:0},H:{epaPerGame:2,passingEpaPerGame:2,rushingEpaPerGame:2,cpoe:0}},
  basketballTeams:{away:{pace:100,netRating:-2},home:{pace:110,netRating:10}},
  hockeyTeams:{A:{games:2,xGoalsFor:4,xGoalsAgainst:5,goalsAgainst:6},H:{games:2,xGoalsFor:6,xGoalsAgainst:5,goalsAgainst:4}}});
 const games=['nfl','nba','nhl'].map(leagueKey=>({id:leagueKey,leagueKey,away:{name:'Away',abbr:'A'},home:{name:'Home',abbr:'H'}}));
 await attachAdvancedDatasetContext(games,{localOnly:true});
 assert.equal(games[0].advancedDataset.epaDifference,1/60);
 assert.equal(games[0].advancedDataset.passingEpaDifference,1/38);
 assert.equal(games[0].advancedDataset.rushingEpaDifference,1/24);
 assert.equal(games[0].advancedDataset.cpoeDifference,0);
 assert.equal(games[1].advancedDataset.pace,105);assert.equal(games[1].advancedDataset.efficiencyDifference,12);
 assert.equal(games[2].advancedDataset.awayXg,2);assert.equal(games[2].advancedDataset.homeXg,3);
 assert.equal(games[2].advancedDataset.xgDifference,1);assert.equal(games[2].advancedDataset.gsaxDifference,1);
 assert.equal(buildEvidenceCoverage(games[0]).advancedDatasetProvenance.missingMeasurements.includes('cpoeDifference'),false);
});

const nflCsv=(text,url)=>text.split('\n').map((line,index)=>!line?'':index===0?'season,season_type,'+line:String(url.match(/reg_(\d{4})/)[1])+',REG,'+line).join('\n');


test('opponent ratings exclude unknown or invalid scores rather than inventing zero-score games',async()=>{
 const {opponentAdjustedRatings}=await import('../src/advancedMetrics.js');
 const good={leagueKey:'nba',awayTeam:'Away',homeTeam:'Home',awayScore:0,homeScore:10,neutralSite:false};
 const baseline=opponentAdjustedRatings([good]);
 for(const value of [null,undefined,'',true,{},NaN,-1]){
  assert.deepEqual(opponentAdjustedRatings([good,{...good,awayScore:value}]),baseline);
  assert.deepEqual(opponentAdjustedRatings([good,{...good,homeScore:value}]),baseline);
 }
 assert.equal(baseline.get('nba__home').sampleSize,1);
 assert.equal(opponentAdjustedRatings([{...good,awayScore:'0',homeScore:'10'}]).get('nba__home').sampleSize,1);
});

test('neutral fixtures never enter observed home advantage, but remain rating evidence',async()=>{
 const {opponentAdjustedRatings}=await import('../src/advancedMetrics.js');
 const rows=opponentAdjustedRatings([
  {leagueKey:'nba',awayTeam:'A',homeTeam:'B',awayScore:90,homeScore:100,neutralSite:false},
  {leagueKey:'nba',awayTeam:'C',homeTeam:'D',awayScore:0,homeScore:90,neutralSite:true}
 ]);
 assert.equal(rows.get('nba__b').observedHomeEdge,10);
 assert.equal(rows.get('nba__d').observedHomeEdge,10);
 assert.equal(rows.get('nba__d').sampleSize,1);
 const neutral=opponentAdjustedRatings([{leagueKey:'nba',awayTeam:'A',homeTeam:'B',awayScore:0,homeScore:10,neutralSite:true}]);
 assert.equal(neutral.get('nba__b').observedHomeEdge,null);
 assert.equal(neutral.get('nba__b').homeEdgeSampleSize,0);
});


test('unknown venues do not certify home advantage and incomplete boxscore scores cannot train advanced ratings',async()=>{
 const {opponentAdjustedRatings,enhanceTeamProfiles}=await import('../src/advancedMetrics.js');
 const row={leagueKey:'nba',league:'NBA',sportGroup:'Basketball',awayTeam:'Away',homeTeam:'Home',awayScore:0,homeScore:10};
 assert.equal(opponentAdjustedRatings([row]).get('nba__home').homeEdgeSampleSize,0);
 const profiles=()=>({a:{name:'Away',leagueKey:'nba',powerRating:50,offense:50,defense:50},h:{name:'Home',leagueKey:'nba',powerRating:50,offense:50,defense:50}});
 const baseline=enhanceTeamProfiles(profiles(),[row],[row]);
 for(const value of [null,undefined,'',false,{},NaN,-1]){
  const bad={...row,homeScore:value};
  assert.deepEqual(enhanceTeamProfiles(profiles(),[row,bad],[row,bad]),baseline);
 }
 assert.equal(baseline.a.stats.advancedBoxscoreSample,1);
});


test('opponent adjustment converges for a two-team neutral matchup instead of oscillating back to zero',async()=>{
 const {opponentAdjustedRatings}=await import('../src/advancedMetrics.js');
 const rows=opponentAdjustedRatings([{leagueKey:'nba',awayTeam:'Away',homeTeam:'Home',awayScore:0,homeScore:10,neutralSite:true}]);
 assert.ok(Math.abs(rows.get('nba__home').rawRating-5)<1e-7);
 assert.ok(Math.abs(rows.get('nba__away').rawRating+5)<1e-7);
 assert.equal(rows.get('nba__home').solverConverged,true);
});


test('converged opponent ratings satisfy multi-team equations and reverse with score direction',async()=>{
 const {opponentAdjustedRatings}=await import('../src/advancedMetrics.js');
 const margins=[['A','B',10],['A','C',4],['B','C',-2],['B','C',6]];
 const games=margins.map(([awayTeam,homeTeam,margin])=>({leagueKey:'nba',awayTeam,homeTeam,awayScore:100,homeScore:100+margin,neutralSite:true}));
 const ratings=opponentAdjustedRatings(games),reversed=opponentAdjustedRatings(games.map(row=>({...row,awayScore:row.homeScore,homeScore:row.awayScore})));
 for(const team of ['A','B','C']){
  const key='nba__'+team.toLowerCase(),value=ratings.get(key).rawRating;
  const terms=games.filter(row=>row.homeTeam===team||row.awayTeam===team).map(row=>{
   const home=row.homeTeam===team,opponent=home?row.awayTeam:row.homeTeam;
   return (home?row.homeScore-row.awayScore:row.awayScore-row.homeScore)+ratings.get('nba__'+opponent.toLowerCase()).rawRating;
  });
  assert.ok(Math.abs(value-terms.reduce((a,b)=>a+b,0)/terms.length)<=1e-7);
  assert.ok(Math.abs(value+reversed.get(key).rawRating)<=1e-7);
 }
});


test('a slowly converging schedule cannot publish an unverified intermediate opponent rating',async()=>{
 const {opponentAdjustedRatings}=await import('../src/advancedMetrics.js');
 const games=Array.from({length:63},(_,index)=>({leagueKey:'nba',awayTeam:'T'+index,homeTeam:'T'+(index+1),
  awayScore:0,homeScore:index===0?10:0,neutralSite:true}));
 assert.equal(opponentAdjustedRatings(games).size,0);
});
