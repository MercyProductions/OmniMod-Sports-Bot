import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const directory=await mkdtemp(join(tmpdir(),'sports-advanced-receipts-'));
process.env.OMNIMOD_SPORTS_DATA_DIR=directory;
process.env.ADVANCED_DATASETS_ENABLED='true';process.env.LOCAL_ONLY='false';process.env.ADVANCED_NBA_STATS_ENABLED='true';
const {syncAdvancedDatasets,attachAdvancedDatasetContext,advancedDatasetSnapshotFile,advancedDatasetRequest}=await import('../src/advancedDatasets.js');
const {writeJson}=await import('../src/storage.js');
const {observedInputState,predictionInputsAt}=await import('../src/inputChronology.js');
const {buildEvidenceCoverage}=await import('../src/evidenceCoverage.js');
const now=Date.now(),old=new Date(now-20*86400000).toISOString();
const ids=['tennis-atp','tennis-wta','baseball-savant-batter','baseball-savant-pitcher','nflverse-team-stats','nflverse-schedules','moneypuck-team-xg','statsbomb-open-data','nba-advanced-teams'];
const team=()=>({epaPerGame:1,passingEpaPerGame:1,rushingEpaPerGame:0,cpoe:0,sourceFetchedAt:old});
const seed=(extra={})=>writeJson(advancedDatasetSnapshotFile,{version:2,updatedAt:old,sources:[],footballTeams:{A:team(),H:team()},footballSchedules:[],...extra});
const nflGame=()=>({id:'g',dateKey:'2099-01-01',leagueKey:'nfl',away:{abbr:'A',name:'Away'},home:{abbr:'H',name:'Home'}});
test.after(()=>rm(directory,{recursive:true,force:true}));

test('future container timestamps cannot establish an advanced-data cache hit',async()=>{
 await seed({updatedAt:new Date(now+86400000).toISOString()});let calls=0;
 const result=await syncAdvancedDatasets({fetchImpl:async()=>{calls++;throw new Error('synthetic unavailable');}});
 assert.ok(calls>0);assert.equal(result.externalCalls,calls);
});

test('failed refresh keeps original row receipts and retries after bounded backoff rather than seven-day suppression',async()=>{
 await seed();let calls=0;
 const options={clock:()=>now,fetchImpl:async()=>{calls++;throw new Error('synthetic unavailable');}};
 const first=await syncAdvancedDatasets(options);assert.ok(calls>0);assert.equal(first.externalCalls,calls);
 assert.equal(first.snapshot.footballTeams.A.sourceFetchedAt,old);
 const initial=calls;await syncAdvancedDatasets(options);assert.equal(calls,initial);
 await syncAdvancedDatasets({...options,clock:()=>now+3600001});assert.ok(calls>initial);
 const game=nflGame();await attachAdvancedDatasetContext([game],{localOnly:true});
 assert.equal(game.advancedDataset.sourceRefreshStatuses[0].state,'failed');
 assert.ok(buildEvidenceCoverage(game,{now:now+3600001}).missing.includes('advanced_dataset:refresh_failed'));
});

test('failed sources retry independently without re-requesting a successfully refreshed source',async()=>{
 await seed();let nflCalls=0,failedCalls=0;
 const fetchImpl=async url=>{
  if(url.includes('/stats_team/')){nflCalls++;return {ok:true,text:async()=> nflCsv('team,games,passing_epa,rushing_epa,passing_cpoe\nA,2,4,2,0\nH,2,6,2,0\n',url)};}
  failedCalls++;throw new Error('synthetic unavailable');
 };
 await syncAdvancedDatasets({clock:()=>now,fetchImpl});const first=failedCalls;
 await syncAdvancedDatasets({clock:()=>now+3600001,fetchImpl});
 assert.equal(nflCalls,1);assert.ok(failedCalls>first);
});

test('attached features retain actual contributing row receipts instead of the container update time',async()=>{
 await seed({updatedAt:new Date(now).toISOString()});const game=nflGame();
 await attachAdvancedDatasetContext([game],{localOnly:true});
 assert.deepEqual(game.advancedDataset.sourceReceiptTimes,[old,old]);
 assert.equal(observedInputState(game.advancedDataset,now-86400000),'observed_by_cutoff');
 const coverage=buildEvidenceCoverage(game,{now});
 assert.deepEqual(coverage.advancedDatasetProvenance.sourceReceiptTimes,[old,old]);
 assert.equal(coverage.advancedDatasetProvenance.nativePublicationVerified,false);
 const future=structuredClone(game);future.advancedDataset.sourceReceiptTimes=[old,new Date(now+1000).toISOString()];
 assert.equal(predictionInputsAt(future,{},now).game.advancedDataset,null);
});

test('unknown legacy row receipts remain unknown despite a fresh container timestamp',async()=>{
 await seed({updatedAt:new Date(now).toISOString(),footballTeams:{A:{epaPerGame:1},H:{epaPerGame:2}}});
 const game=nflGame();await attachAdvancedDatasetContext([game],{localOnly:true});
 assert.deepEqual(game.advancedDataset.sourceReceiptTimes,[null,null]);
 assert.equal(observedInputState(game.advancedDataset,now),'unknown');
 assert.ok(buildEvidenceCoverage(game,{now}).missing.includes('advanced_dataset:receipt_times_unknown'));
});

test('explicit provider Retry-After is respected even by a forced sync',async()=>{
 const fresh=new Date(now).toISOString();
 for(const delay of [String(6*3600),new Date(now+6*3600000).toUTCString()]){
 await seed({sources:ids.filter(id=>id!=='nflverse-team-stats').map(id=>({id,ok:true,checkedAt:fresh,lastSuccessAt:fresh,
  requestKey:advancedDatasetRequest({clock:()=>now}).requestIdentities[id]}))});
 let calls=0;const fetchImpl=async()=>{calls++;return {ok:false,status:429,headers:{get:()=>delay}};};
 await syncAdvancedDatasets({clock:()=>now,fetchImpl});assert.equal(calls,1);
 await syncAdvancedDatasets({clock:()=>now+2*3600000,force:true,fetchImpl});
 // A forced batch may visit other sources, but must not revisit the limited source.
 const snapshot=(await syncAdvancedDatasets({clock:()=>now+2*3600000,localOnly:true})).snapshot;
 assert.equal(snapshot.sources.find(row=>row.id==='nflverse-team-stats').checkedAt,fresh);
 await syncAdvancedDatasets({clock:()=>now-1000,force:true,fetchImpl});
 const afterClockRegression=(await syncAdvancedDatasets({localOnly:true})).snapshot;
 assert.equal(afterClockRegression.sources.find(row=>row.id==='nflverse-team-stats').checkedAt,fresh);
 }
});

test('all existing source adapters stamp only newly processed rows and retain those receipts through attachment',async()=>{
 await seed({baseballPlayers:{oldhitter:{name:'Old Hitter',role:'batter',expectedWoba:.2,sourceFetchedAt:old}}});
 const fetchImpl=async url=>{
  let text;
  if(url.includes('tennis_'))text='winner_name,loser_name,tourney_date,surface\nHome,Away,20260101,Hard\n';
  else if(url.includes('expected_statistics'))text=url.includes('type=batter')
   ?'player_name,est_woba\nHitter A,0.3\nHitter H,0.4\n':'player_name,est_woba\nPitcher A,0.3\n';
  else if(url.includes('/stats_team/'))text=nflCsv('team,games,passing_epa,rushing_epa,passing_cpoe\nA,2,4,2,0\nH,2,6,2,0\n',url);
  else if(url.includes('/schedules/'))text='season,gameday,away_team,home_team,roof\n2099,2099-01-01,A,H,dome\n';
  else if(url.includes('moneypuck'))text='team,situation,games_played,xGoalsFor,xGoalsAgainst,goalsAgainst\nA,all,2,6,5,5\nH,all,2,7,5,5\n';
  else if(url.includes('stats.nba'))text=JSON.stringify({resultSets:[{headers:['TEAM_NAME','TEAM_ID','GP','PACE','NET_RATING'],rowSet:[['Away',1,2,100,0],['Home',2,2,101,1]]}]});
  else if(url.includes('competitions.json'))text=JSON.stringify([{competition_id:1,season_id:2}]);
  else throw new Error('Unexpected synthetic source');
  return {ok:true,text:async()=>text};
 };
 const result=await syncAdvancedDatasets({clock:()=>now,fetchImpl});
 assert.equal(result.externalCalls,ids.length);assert.ok(result.snapshot.sources.every(row=>row.ok));
 const at=new Date(now).toISOString();
 assert.equal(result.snapshot.baseballPlayers.oldhitter.sourceFetchedAt,old);
 assert.equal(result.snapshot.footballTeams.A.sourceFetchedAt,at);
 assert.equal(result.snapshot.soccerCompetitions[0].sourceFetchedAt,at);
 const games=['nfl','mlb','nhl','nba','atp','wta'].map(leagueKey=>({...nflGame(),leagueKey,
  autoPlayers:leagueKey==='mlb'?[{team:'Away',name:'Hitter A'},{team:'Home',name:'Hitter H'}]:[]}));
 await attachAdvancedDatasetContext(games,{localOnly:true});
 for(const game of games){assert.deepEqual(game.advancedDataset.sourceReceiptTimes,[at,at]);assert.equal(game.advancedDataset.publicationTimeVerified,false);}
 assert.ok(games.every(game=>game.advancedDataset.sourceRefreshStatuses[0].state==='success'));
 assert.equal(buildEvidenceCoverage(games[0],{now:now-1}).advancedDatasetProvenance.sourceRefreshStatuses[0].state,'unknown_at_cutoff');
 assert.equal(games[0].sourceCorroboration.matches[0].fetchedAt,at);
 assert.equal((await syncAdvancedDatasets({clock:()=>now+1000,fetchImpl})).externalCalls,0);
});

test('independent schedule receipts use the actual row and never the container timestamp',async()=>{
 const row={gameday:'2099-01-01',away_team:'A',home_team:'H',roof:'dome',sourceFetchedAt:old};
 await seed({updatedAt:new Date(now).toISOString(),footballSchedules:[row]});
 const game=nflGame();await attachAdvancedDatasetContext([game],{localOnly:true});
 assert.equal(game.sourceCorroboration.matches[0].fetchedAt,old);
 assert.deepEqual(game.eventEnvironment.sourceReceiptTimes,[old]);
 assert.deepEqual(game.autoContext.sourceReceiptTimes,[old]);
 delete row.sourceFetchedAt;await seed({updatedAt:new Date(now).toISOString(),footballSchedules:[row]});
 const legacy=nflGame();await attachAdvancedDatasetContext([legacy],{localOnly:true});
 assert.equal(legacy.sourceCorroboration.matches[0].fetchedAt,'');
 assert.equal(observedInputState(legacy.eventEnvironment,now),'unknown');
});

const nflCsv=(text,url)=>text.split('\n').map((line,index)=>!line?'':index===0?'season,season_type,'+line:String(url.match(/reg_(\d{4})/)[1])+',REG,'+line).join('\n');
