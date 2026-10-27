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


async function currentNflSnapshot(){
 await seed();return syncAdvancedDatasets({clock:()=>now,force:true,fetchImpl:async url=>{
  if(url.includes('/stats_team/'))return response(nflCsv(csv,url));throw new Error('Synthetic unavailable');
 }});
}
const periodGame=seasonYear=>({id:'period',leagueKey:'nfl',seasonYear,away:{abbr:'A'},home:{abbr:'H'}});

test('a fresh request-matching NFL source cannot attach to a game from a different season',async()=>{
 await currentNflSnapshot();const game=periodGame(2025);
 await attachAdvancedDatasetContext([game],{clock:()=>now,seasonStart:2026,localOnly:true});
 assert.equal(game.advancedDataset.epaDifference,null);assert.equal(game.advancedDataset.sourcePeriodEvidence.state,'season_mismatch');
});

test('matching game seasons retain features while later game-period changes cannot retain cached values',async()=>{
 await currentNflSnapshot();const game=periodGame(2026);
 await attachAdvancedDatasetContext([game],{clock:()=>now,localOnly:true});
 assert.ok(Number.isFinite(game.advancedDataset.epaDifference));assert.equal(game.advancedDataset.sourcePeriodEvidence.state,'matched');
 game.seasonYear=2025;await attachAdvancedDatasetContext([game],{clock:()=>now,localOnly:true});assert.equal(game.advancedDataset.epaDifference,null);
 game.seasonYear=2026;await attachAdvancedDatasetContext([game],{clock:()=>now,localOnly:true});assert.ok(Number.isFinite(game.advancedDataset.epaDifference));
});

test('unknown legacy source periods cannot certify current-season game features',async()=>{
 await seed();const known=periodGame(2026);await attachAdvancedDatasetContext([known],{clock:()=>now,localOnly:true});
 assert.equal(known.advancedDataset.epaDifference,null);assert.equal(known.advancedDataset.sourcePeriodEvidence.state,'source_season_unknown');
 const unknown=periodGame(null);await attachAdvancedDatasetContext([unknown],{clock:()=>now,localOnly:true});
 assert.equal(unknown.advancedDataset.sourcePeriodEvidence.state,'game_season_unknown');
});

test('native source season conflicting with its validated request identity is rejected',async()=>{
 const result=await currentNflSnapshot();result.snapshot.footballTeams.A.season=2025;await writeJson(advancedDatasetSnapshotFile,result.snapshot);
 const game=periodGame(2026);await attachAdvancedDatasetContext([game],{clock:()=>now,localOnly:true});
 assert.equal(game.advancedDataset.epaDifference,null);assert.equal(game.advancedDataset.sourcePeriodEvidence.state,'source_season_conflict');
});


test('previously validated request contracts retain period evidence without inventing native row metadata',async()=>{
 const result=await currentNflSnapshot();for(const row of Object.values(result.snapshot.footballTeams))delete row.season;
 await writeJson(advancedDatasetSnapshotFile,result.snapshot);const game=periodGame(2026);
 const attached=await attachAdvancedDatasetContext([game],{clock:()=>now,localOnly:true});
 assert.ok(Number.isFinite(game.advancedDataset.epaDifference));assert.equal(attached.periodRejections.length,0);
 assert.ok(game.advancedDataset.sourcePeriodEvidence.sourceEvidence.every(row=>row.basis==='validated_request_contract'));
});

test('per-game period rejection is frozen and future source receipts cannot leak that evidence backwards',async()=>{
 const {buildEvidenceCoverage}=await import('../src/evidenceCoverage.js');const {predictionInputsAt}=await import('../src/inputChronology.js');
 await currentNflSnapshot();
 for(const seasonYear of [2025,'invalid',20262027]){
  const game=periodGame(seasonYear),result=await attachAdvancedDatasetContext([game],{clock:()=>now,seasonStart:2026,localOnly:true});
  assert.equal(result.periodRejections.length,1);assert.equal(result.matched,0);
  assert.equal(game.advancedDataset.epaDifference,null);
  const frozen=buildEvidenceCoverage(game,{now});assert.equal(frozen.advancedDatasetProvenance.sourcePeriodEvidence.blocked,true);
  assert.ok(frozen.missing.some(reason=>reason.includes('season')));
  const before=predictionInputsAt(game,{},now-1).game;assert.equal(before.advancedDataset,null);
  assert.equal(buildEvidenceCoverage(before,{now:now-1}).advancedDatasetProvenance.sourcePeriodEvidence,null);
 }
});


async function currentHockeySnapshot(){
 await seed();return syncAdvancedDatasets({clock:()=>now,force:true,fetchImpl:async url=>{
  if(url.includes('moneypuck.com'))return response('team,situation,games_played,xGoalsFor,xGoalsAgainst,goalsFor,goalsAgainst\nA,all,2,4,3,4,3\nH,all,2,6,3,5,3\n');
  throw new Error('Synthetic unavailable');
 }});
}
const hockeyPeriodGame=seasonYear=>({id:'nhl-period',leagueKey:'nhl',seasonYear,source:'NHL official scoreboard',sourceMeta:{provider:'NHL API'},away:{abbr:'A'},home:{abbr:'H'}});

test('NHL consecutive-year game identifiers cannot use another season requests advanced data',async()=>{
 await currentHockeySnapshot();const game=hockeyPeriodGame(20252026);
 const result=await attachAdvancedDatasetContext([game],{clock:()=>now,localOnly:true});
 assert.equal(game.advancedDataset.xgDifference,null);assert.equal(result.periodRejections.length,1);
});

test('matching NHL composite seasons preserve features and disclose native dataset period uncertainty',async()=>{
 await currentHockeySnapshot();const game=hockeyPeriodGame(20262027);
 await attachAdvancedDatasetContext([game],{clock:()=>now,localOnly:true});
 assert.ok(Number.isFinite(game.advancedDataset.xgDifference));
 assert.equal(game.advancedDataset.sourcePeriodEvidence.state,'request_season_matched_native_unverified');
 assert.equal(game.advancedDataset.sourcePeriodEvidence.gameSeason,2026);
 assert.equal(game.advancedDataset.sourcePeriodEvidence.nativePeriodVerified,false);
});

test('unverified NHL four-digit conventions or malformed composite years cannot certify an alignment',async()=>{
 await currentHockeySnapshot();
 for(const seasonYear of [2027,20262028,'invalid']){
  const game=hockeyPeriodGame(seasonYear);await attachAdvancedDatasetContext([game],{clock:()=>now,localOnly:true});
  assert.equal(game.advancedDataset.xgDifference,null);assert.equal(game.advancedDataset.sourcePeriodEvidence.blocked,true);
 }
});


test('NHL cached feature values are cleared on a game-season change and restored only on request alignment',async()=>{
 await currentHockeySnapshot();const game=hockeyPeriodGame(20262027);
 await attachAdvancedDatasetContext([game],{clock:()=>now,localOnly:true});assert.ok(Number.isFinite(game.advancedDataset.xgDifference));
 game.seasonYear=20252026;await attachAdvancedDatasetContext([game],{clock:()=>now,localOnly:true});assert.equal(game.advancedDataset.xgDifference,null);
 game.seasonYear=20262027;await attachAdvancedDatasetContext([game],{clock:()=>now,localOnly:true});assert.ok(Number.isFinite(game.advancedDataset.xgDifference));
});

test('NHL request-only evidence remains explicitly unverified in frozen coverage and unknown legacy sources cannot certify a known season',async()=>{
 const {buildEvidenceCoverage}=await import('../src/evidenceCoverage.js');
 await currentHockeySnapshot();const game=hockeyPeriodGame(20262027);
 await attachAdvancedDatasetContext([game],{clock:()=>now,localOnly:true});
 const frozen=buildEvidenceCoverage(game,{now});assert.equal(frozen.advancedDatasetProvenance.sourcePeriodEvidence.nativePeriodVerified,false);
 assert.ok(frozen.missing.includes('advanced_dataset:request_season_matched_native_unverified'));
 await writeJson(advancedDatasetSnapshotFile,{version:2,sources:[],hockeyTeams:{A:{games:2,xGoalsFor:4,xGoalsAgainst:3,goalsAgainst:3},H:{games:2,xGoalsFor:6,xGoalsAgainst:3,goalsAgainst:3}}});
 const legacy=hockeyPeriodGame(20262027);await attachAdvancedDatasetContext([legacy],{clock:()=>now,localOnly:true});
 assert.equal(legacy.advancedDataset.xgDifference,null);assert.equal(legacy.advancedDataset.sourcePeriodEvidence.state,'source_season_unknown');
});
