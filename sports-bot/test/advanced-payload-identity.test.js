import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const directory=await mkdtemp(join(tmpdir(),'sports-advanced-contracts-'));
process.env.OMNIMOD_SPORTS_DATA_DIR=directory;process.env.ADVANCED_DATASETS_ENABLED='true';
process.env.ADVANCED_NBA_STATS_ENABLED='true';process.env.LOCAL_ONLY='false';
const {syncAdvancedDatasets,attachAdvancedDatasetContext,advancedDatasetSnapshotFile}=await import('../src/advancedDatasets.js');
const {writeJson}=await import('../src/storage.js');
const now=Date.parse('2026-10-21T06:00:00Z'),old=new Date(now-20*86400000).toISOString();
const stored=()=>({version:2,updatedAt:old,sources:[],tennis:{atp:{preserved:{name:'Preserved',elo:1500}},wta:{}},
 baseballPlayers:{preserved:{name:'Preserved',role:'batter',expectedWoba:.3}},
 footballTeams:{A:{epaPerGame:1},H:{epaPerGame:2}},footballSchedules:[{season:2026,gameday:'2026-10-21',away_team:'A',home_team:'H'}],
 hockeyTeams:{preserved:{games:1}},basketballTeams:{preserved:{pace:100}},soccerCompetitions:[{competitionId:1}]});
const seed=()=>writeJson(advancedDatasetSnapshotFile,stored());
const response=text=>({ok:true,text:async()=>text});
const csv='team,games,passing_epa,rushing_epa,passing_cpoe\nA,2,4,2,0\nH,2,6,2,0\n';
test.after(()=>rm(directory,{recursive:true,force:true}));

test('HTTP-success HTML and unrelated CSV do not replace usable prior collections or advance source success',async()=>{
 for(const payload of ['', 'team,games,passing_epa,rushing_epa,passing_cpoe\n', '<html>Access unavailable</html>','unexpected,value\nfoo,1\n']){
  await seed();const result=await syncAdvancedDatasets({clock:()=>now,force:true,fetchImpl:async()=>response(payload)});
  for(const name of ['tennis','footballTeams','footballSchedules','hockeyTeams','basketballTeams','soccerCompetitions'])assert.deepEqual(result.snapshot[name],stored()[name]);
  assert.ok(result.snapshot.sources.every(row=>row.ok===false));
  assert.ok(result.snapshot.sources.every(row=>row.lastSuccessAt===null));
 }
});

test('malformed JSON shapes cannot empty the NBA or soccer catalog collections',async()=>{
 for(const payload of ['{}','[]','null','{"resultSets":[{"headers":["TEAM_NAME"],"rowSet":[{}]}]}']){
 await seed();const result=await syncAdvancedDatasets({clock:()=>now,force:true,fetchImpl:async()=>response(payload)});
 assert.deepEqual(result.snapshot.basketballTeams,stored().basketballTeams);
 assert.deepEqual(result.snapshot.soccerCompetitions,stored().soccerCompetitions);
 assert.equal(result.snapshot.sources.find(row=>row.id==='nba-advanced-teams').ok,false);
 }
});

test('invalid identity rows are counted while valid partial measurements and true zeros remain usable',async()=>{
 await seed();const result=await syncAdvancedDatasets({clock:()=>now,force:true,fetchImpl:async url=>{
  if(url.includes('/stats_team/'))return response(nflCsv('team,games,passing_epa,rushing_epa,passing_cpoe\nA,2,0,0,0\n,2,4,2,1\nH,2,,,\n',url));
  throw new Error('Synthetic unavailable');
 }});
 assert.equal(result.snapshot.footballTeams[''],undefined);
 assert.equal(result.snapshot.footballTeams.A.epaPerGame,0);
 assert.equal(result.snapshot.footballTeams.H.epaPerGame,null);
 assert.equal(result.snapshot.sources.find(row=>row.id==='nflverse-team-stats').rejectedRows,1);
});

test('a different requested historical year cannot reuse a fresh success for another request identity',async()=>{
 await seed();let calls=0;const fetchImpl=async url=>{
  if(url.includes('/stats_team/')){calls++;return response(nflCsv(csv,url));}throw new Error('Synthetic unavailable');
 };
 const first=await syncAdvancedDatasets({clock:()=>now,year:2024,force:true,fetchImpl});
 const originalKey=first.snapshot.footballTeams.A.sourceRequestKey;
 const second=await syncAdvancedDatasets({clock:()=>now+1,year:2025,fetchImpl});
 assert.equal(calls,2);assert.notEqual(second.snapshot.footballTeams.A.sourceRequestKey,originalKey);
});

test('failed year switches preserve old data but cannot attach it as the requested period',async()=>{
 await seed();const fetchImpl=async url=>{
  if(url.includes('stats_team_reg_2024'))return response(nflCsv(csv,url));throw new Error('Synthetic unavailable');
 };
 const first=await syncAdvancedDatasets({clock:()=>now,year:2024,force:true,fetchImpl});
 const second=await syncAdvancedDatasets({clock:()=>now+1,year:2025,fetchImpl});
 assert.equal(second.snapshot.footballTeams.A.sourceRequestKey,first.snapshot.footballTeams.A.sourceRequestKey);
 assert.equal(second.snapshot.sources.find(row=>row.id==='nflverse-team-stats').ok,false);
 const game={id:'year',leagueKey:'nfl',away:{abbr:'A'},home:{abbr:'H'}};
 await attachAdvancedDatasetContext([game],{clock:()=>now+1,year:2025,localOnly:true});
 assert.equal(game.advancedDataset,undefined);
});

test('invalid year or season arguments fail before any provider call',async()=>{
 let calls=0;const fetchImpl=async()=>{calls++;throw new Error('Unexpected request');};
 for(const extra of [{year:'invalid'},{year:0},{year:2025.5},{seasonStart:NaN}]){
  await assert.rejects(syncAdvancedDatasets({clock:()=>now,force:true,fetchImpl,...extra}),/year|season/i);
 }
 assert.equal(calls,0);
});

test('multi-year tennis fallback rows cannot contaminate the requested calendar-year cohort',async()=>{
 await seed();const result=await syncAdvancedDatasets({clock:()=>now,year:2024,force:true,fetchImpl:async url=>{
  if(url.includes('tennis_atp/master'))return {ok:false,status:404};
  if(url.includes('TML-Database'))return response('winner_name,loser_name,tourney_date,surface\nHome,Away,20240101,Hard\nFuture,Home,20250101,Hard\n');
  throw new Error('Synthetic unavailable');
 }});
 assert.equal(result.snapshot.tennis.atp.future,undefined);
 assert.equal(result.snapshot.tennis.atp.home.matches,1);
});

test('concurrent different-period requests cannot share the first callers result',{timeout:10000},async()=>{
 await seed();let enter,release;const started=new Promise(resolve=>enter=resolve),held=new Promise(resolve=>release=resolve);let calls=0;
 const fetchImpl=async url=>{
  if(url.includes('/stats_team/')){calls++;if(url.includes('reg_2024')){enter();await held;}return response(nflCsv(csv,url));}
  throw new Error('Synthetic unavailable');
 };
 const first=syncAdvancedDatasets({clock:()=>now,year:2024,force:true,fetchImpl});
 await started;const second=syncAdvancedDatasets({clock:()=>now+1,year:2025,fetchImpl});release();
 const [a,b]=await Promise.all([first,second]);
 assert.equal(a.year,2024);assert.equal(b.year,2025);assert.equal(calls,2);
});

test('explicit season changes independently invalidate seasonal sources',async()=>{
 await seed();const urls=[];const fetchImpl=async url=>{
  if(url.includes('/stats_team/')){urls.push(url);return response(nflCsv(csv,url));}throw new Error('Synthetic unavailable');
 };
 await syncAdvancedDatasets({clock:()=>now,year:2025,seasonStart:2023,force:true,fetchImpl});
 await syncAdvancedDatasets({clock:()=>now+1,year:2025,seasonStart:2024,fetchImpl});
 assert.equal(urls.length,2);assert.match(urls[0],/reg_2023/);assert.match(urls[1],/reg_2024/);
});

test('matching concurrent request identities still share one provider refresh',{timeout:10000},async()=>{
 await seed();let enter,release;const started=new Promise(resolve=>enter=resolve),held=new Promise(resolve=>release=resolve);let calls=0;
 const fetchImpl=async url=>{
  if(url.includes('/stats_team/')){calls++;enter();await held;return response(nflCsv(csv,url));}throw new Error('Synthetic unavailable');
 };
 const first=syncAdvancedDatasets({clock:()=>now,year:2024,force:true,fetchImpl});
 await started;const second=syncAdvancedDatasets({clock:()=>now,year:2024,fetchImpl});release();
 const [a,b]=await Promise.all([first,second]);
 assert.equal(calls,1);assert.equal(a.year,2024);assert.equal(b.year,2024);
});

test('changing period or forcing refresh does not bypass a provider retry restriction',async()=>{
 await seed();let calls=0;const fetchImpl=async url=>{
  if(url.includes('/stats_team/')){calls++;return {ok:false,status:429,headers:{get:()=>String(6*3600)}};}
  throw new Error('Synthetic unavailable');
 };
 await syncAdvancedDatasets({clock:()=>now,year:2024,force:true,fetchImpl});
 await syncAdvancedDatasets({clock:()=>now+2*3600000,year:2025,force:true,fetchImpl});assert.equal(calls,1);
});


test('NFL season summaries reject conflicting period, weekly grain and duplicate team rows before replacement',async()=>{
 const header='season,season_type,team,games,passing_epa,rushing_epa,passing_cpoe';
 for(const payload of [header+'\n2023,REG,A,17,4,2,0',header+'\n2024,POST,A,4,4,2,0',
  header+',week\n2024,REG,A,1,4,2,0,1',header+'\n2024,REG,A,17,4,2,0\n2024,REG,a,17,8,4,0',
  'team,games,passing_epa,rushing_epa,passing_cpoe\nA,17,4,2,0']){
  await seed();const result=await syncAdvancedDatasets({clock:()=>now,seasonStart:2024,force:true,fetchImpl:async url=>{
   if(url.includes('/stats_team/'))return response(payload);throw new Error('Synthetic unavailable');
  }});
  assert.equal(result.snapshot.sources.find(row=>row.id==='nflverse-team-stats').ok,false);
  assert.deepEqual(result.snapshot.footballTeams,stored().footballTeams);
 }
});

const nflCsv=(text,url)=>text.split('\n').map((line,index)=>!line?'':index===0?'season,season_type,'+line:String(url.match(/reg_(\d{4})/)[1])+',REG,'+line).join('\n');
