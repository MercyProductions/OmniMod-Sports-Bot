import test from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
process.env.AUTO_ENRICH_ENABLED='true';process.env.AUTO_LEARNING_ENABLED='false';process.env.FEATURE_WAREHOUSE_ENABLED='false';process.env.HISTORICAL_REPLAY_ENABLED='false';process.env.LOCAL_ML_ENABLED='false';process.env.ADVANCED_DATASETS_ENABLED='false';process.env.AUTO_OFFICIAL_SOURCES='false';process.env.NHL_GOALIE_CONTEXT_MAX_GAMES='0';
const {parseEspnEvent}=await import('../src/sportsData.js');
const {enrichGamesAutomatically}=await import('../src/autoEnrichment.js');
const {hasAvailabilityObservation}=await import('../src/dataValidation.js');
const {buildEvidenceCoverage}=await import('../src/evidenceCoverage.js');
const {applyScoreboardStarters,scoreboardStarterState}=await import('../src/scoreboardStarters.js');
const {predictionInputsAt}=await import('../src/inputChronology.js');
const {predictGame}=await import('../src/predictionEngine.js');
const {recordPredictionJournal,readPredictionJournal}=await import('../src/predictionJournal.js');
const league={key:'mlb',sport:'baseball',league:'mlb',label:'MLB',group:'Baseball',priority:100};
const now=Date.parse('2099-02-01T18:00:00Z'),meta={provider:'ESPN',fetchedAt:new Date(now-1000).toISOString(),cacheState:'network'};
const event=()=>({id:'401000001',date:'2099-02-02T01:00Z',season:{year:2099,type:2},status:{type:{state:'pre',name:'STATUS_SCHEDULED'}},competitions:[{id:'401000001',date:'2099-02-02T01:00Z',competitors:['away','home'].map((side,i)=>({homeAway:side,team:{id:String(i+1),displayName:side,abbreviation:side==='away'?'AWY':'HOM'},probables:[{name:'probableStartingPitcher',displayName:'Probable Starting Pitcher',playerId:100+i,athlete:{id:String(100+i),displayName:'Pitcher '+i,position:'SP',team:{id:String(i+1)}},statistics:[{name:'ERA',displayValue:'1.29'}]}]}))}]});
const parsed=raw=>parseEspnEvent(raw||event(),league,meta);

test('scoreboard probable pitchers survive failed summary enrichment without becoming confirmed or healthy',async t=>{
 const game=parseEspnEvent(event(),league,{...meta,fetchedAt:new Date().toISOString()});
 t.mock.method(globalThis,'fetch',async()=>new Response('Unavailable',{status:403}));
 await enrichGamesAutomatically([game],new Date('2099-02-01T18:00:00Z'),{leagues:[league]});
 assert.equal(game.autoPlayers.length,2);
 for(const player of game.autoPlayers){assert.equal(player.confirmedStarter,false);assert.equal(player.availability,null);assert.equal(hasAvailabilityObservation(player),false);assert.equal(player.stats.ERA,undefined);}
 const coverage=buildEvidenceCoverage(game,{now:Date.now()});assert.equal(coverage.sides.away.projectedStarters,1);assert.equal(coverage.sides.away.criticalStarterStatus,'projected_or_unavailable');assert.equal(coverage.sides.away.injuryCoverage,'unknown');
 assert.equal(game.autoEnrichment,undefined);assert.equal(coverage.completenessVerified,false);
});

test('flat scoreboard statistics have no attested sample period and are not promoted into model measurements',()=>{
 const game=parsed(),raw=structuredClone(game.scoreboardStarterEvidence);assert.equal(applyScoreboardStarters([game],{now}).projected,2);
 for(const row of game.autoPlayers){assert.deepEqual(row.stats,{});assert.equal(row.playerIdNamespace,'espn');assert.equal(row.availability,null);assert.equal(row.confirmedStarter,false);}
 assert.deepEqual(game.scoreboardStarterEvidence,raw);assert.equal(game.autoLineups,undefined);
});

test('a newer summary injury or event-starter record supersedes a scoreboard projection without being rewritten',()=>{
 for(const selected of [
  {name:'Pitcher 0',sourceAthleteId:'100',team:'away',role:'Starting Pitcher',status:'Out',availability:0,starter:false},
  {name:'Confirmed Replacement',sourceAthleteId:'200',team:'away',role:'Starting Pitcher',starter:true,confirmedStarter:true}
 ]){
  const game=parsed(),original=structuredClone(selected);game.autoPlayers=[selected];assert.equal(applyScoreboardStarters([game],{now}).projected,1);assert.deepEqual(game.autoPlayers[0],original);assert.equal(game.autoPlayers.filter(row=>row.team==='away').length,1);
 }
 const game=parsed();game.autoLineups=[{team:'away',name:'Confirmed Replacement',athleteId:'200',role:'SP',starter:true,confirmedStarter:true}];assert.equal(applyScoreboardStarters([game],{now}).projected,1);assert.equal(game.autoPlayers.some(row=>row.team==='away'),false);
});

test('reapplying or emptying a source is idempotent and does not duplicate or retain withdrawn projections',()=>{
 const game=parsed();applyScoreboardStarters([game],{now});applyScoreboardStarters([game],{now});assert.equal(game.autoPlayers.length,2);
 const raw=event();for(const side of raw.competitions[0].competitors)side.probables=[];game.scoreboardStarterEvidence=parsed(raw).scoreboardStarterEvidence;
 applyScoreboardStarters([game],{now});assert.equal(game.autoPlayers.length,0);assert.equal(buildEvidenceCoverage(game,{now}).scoreboardStarters.reportedProbables,0);
});

test('replacing this source cannot erase a separately retained injury assertion from a materialized player view',()=>{
 const game=parsed();applyScoreboardStarters([game],{now});const projected=structuredClone(game.autoPlayers[0]);
 const injury={team:'away',sourceAthleteId:'100',name:'Pitcher 0',role:'Starting Pitcher',availability:0,status:'Out',source:'Independent injury report',availabilityProvider:'fixture'};
 game.autoPlayers[0]={...projected,...injury,availabilitySourceRows:[projected,structuredClone(injury)]};applyScoreboardStarters([game],{now});
 assert.equal(game.autoPlayers.filter(row=>row.team==='away').length,1);assert.deepEqual(game.autoPlayers.find(row=>row.team==='away'),injury);
});

test('stale, future, unknown and failed-cache receipts never materialize projected model inputs',()=>{
 for(const change of [{fetchedAt:new Date(now-15*60000).toISOString()},{fetchedAt:new Date(now+1).toISOString()},{fetchedAt:'2099-02-01T17:59:00'},{cacheState:'stale'},{cacheState:'negative_cache'},{cacheState:'unknown'}]){
  const game=parsed();Object.assign(game.scoreboardStarterEvidence,change);assert.equal(applyScoreboardStarters([game],{now}).projected,0);assert.equal(buildEvidenceCoverage(game,{now}).scoreboardStarters.usableCandidates,0);
 }
});

test('source projections cannot move between events, starts, seasons, teams or a post-start information cutoff',()=>{
 for(const change of [{id:'401000002'},{startTime:'2099-02-02T01:01Z'},{seasonYear:2100},{seasonType:3},{away:{id:'9',name:'away',abbr:'AWY'}},{statusKey:'live'}]){
  const game={...parsed(),...change};assert.equal(applyScoreboardStarters([game],{now}).projected,0);
 }
 const game=parsed();assert.equal(applyScoreboardStarters([game],{now:Date.parse(game.startTime)}).projected,0);
});

test('source event, competition start and athlete team contradictions are rejected independently',()=>{
 for(const change of [raw=>raw.competitions[0].id='401000002',raw=>raw.competitions[0].date='2099-02-02T01:01Z',raw=>raw.competitions[0].status={type:{state:'post',completed:true}}]){
  const raw=event();change(raw);const game=parsed(raw);assert.equal(applyScoreboardStarters([game],{now}).projected,0);assert.equal(game.scoreboardStarterEvidence.rejected.event_identity_or_status_conflict,1);
 }
 const raw=event();raw.competitions[0].competitors[0].probables[0].athlete.team.id='2';const game=parsed(raw);assert.equal(applyScoreboardStarters([game],{now}).projected,1);assert.equal(game.scoreboardStarterEvidence.rejected.athlete_team_conflict,1);
});

test('duplicate players deduplicate and conflicting side or cross-team probable identities remain unknown',()=>{
 const raw=event(),competitor=raw.competitions[0].competitors[0];competitor.probables.push(structuredClone(competitor.probables[0]));assert.equal(applyScoreboardStarters([parsed(raw)],{now}).projected,2);
 competitor.probables.push({...structuredClone(competitor.probables[0]),playerId:200,athlete:{...competitor.probables[0].athlete,id:'200'}});const conflict=parsed(raw);assert.equal(applyScoreboardStarters([conflict],{now}).projected,1);assert.equal(conflict.scoreboardStarterEvidence.rejected.conflicting_side_probables,1);
 const both=event();both.competitions[0].competitors[1].probables[0].playerId=100;both.competitions[0].competitors[1].probables[0].athlete.id='100';assert.equal(applyScoreboardStarters([parsed(both)],{now}).projected,0);
});

test('conflicting names, malformed rows and unsupported source roles cannot crash or manufacture starter records',()=>{
 const raw=event(),rows=raw.competitions[0].competitors[0].probables;rows.push({...structuredClone(rows[0]),athlete:{...rows[0].athlete,displayName:'Different person'}},structuredClone(rows[0]),null,{});const game=parsed(raw);assert.equal(applyScoreboardStarters([game],{now}).projected,1);assert.ok(game.scoreboardStarterEvidence.rejected.conflicting_player_name);
 for(const row of [{name:'unknown',athlete:{id:'100',displayName:'Someone',position:'SP'}},{name:'probableStartingPitcher',playerId:101,athlete:{id:'100',displayName:'Someone',position:'SP'}}]){const r=event();r.competitions[0].competitors[0].probables=[row];assert.equal(applyScoreboardStarters([parsed(r)],{now}).projected,1);}
});

test('inference expires serialized projections, clears dependent participation aggregates and leaves original evidence untouched',()=>{
 const game=parsed();applyScoreboardStarters([game],{now});game.participationSummary={away:{expectedShare:1}};const stored=JSON.parse(JSON.stringify(game)),original=structuredClone(stored);
 const safe=predictionInputsAt(stored,{},now+15*60000);assert.equal(safe.game.autoPlayers.length,0);assert.equal(safe.game.participationSummary,null);assert.ok(Object.keys(safe.audit.excluded).some(key=>key.includes('scoreboard_')));assert.deepEqual(stored,original);
 const moved={...stored,id:'401000002'};assert.equal(predictionInputsAt(moved,{},now).game.autoPlayers.length,0);
 const tampered=structuredClone(stored);tampered.autoPlayers[0].sourceAthleteId='999';assert.equal(predictionInputsAt(tampered,{},now).game.autoPlayers.length,1);
});

test('coverage and issued forecast evidence distinguish projections, unknown health and missing confirmation',async()=>{
 const game=parsed();applyScoreboardStarters([game],{now});const prediction=predictGame(game,1,{now});
 assert.equal(prediction.evidenceCoverage.scoreboardStarters.usableCandidates,2);assert.equal(prediction.evidenceCoverage.sides.away.projectedStarters,1);assert.equal(prediction.evidenceCoverage.sides.away.modelInputs.players[0].availabilityObserved,false);
 const file=join(process.env.OMNIMOD_SPORTS_DATA_DIR,'scoreboard-starter-journal.jsonl');
 await recordPredictionJournal({guildId:'scoreboard-starter-fixture',generatedAt:new Date(now).toISOString(),games:[game],predictions:[{...prediction,predictionGeneratedAt:new Date(now).toISOString()}]},{file,now});
 const journal=(await readPredictionJournal(file)).find(row=>row.type==='forecast').payload;assert.equal(journal.evidenceCoverage.scoreboardStarters.confirmedStarters,0);assert.equal(journal.evidenceCoverage.sides.away.injuryCoverage,'unknown');assert.equal(journal.evidenceCoverage.sides.away.criticalStarterStatus,'projected_or_unavailable');
 assert.equal(game.autoEnrichment,undefined);assert.equal(prediction.isActionablePrediction,false);
});

test('an empty or absent probable list is not injury coverage and NHL season leaders are not this contract',()=>{
 const raw=event();for(const competitor of raw.competitions[0].competitors)delete competitor.probables;assert.equal(parsed(raw).scoreboardStarterEvidence,undefined);
 const game=parseEspnEvent(event(),{...league,key:'nhl',label:'NHL',group:'Hockey'},meta);assert.equal(game.scoreboardStarterEvidence,undefined);assert.equal(scoreboardStarterState(undefined,game,now),'not_reported');
});
