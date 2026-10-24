import test from 'node:test';
import assert from 'node:assert/strict';
import {parseNhlGoalieResearch,enrichNhlGoalieResearch} from '../src/nhlGoalieResearch.js';
import {buildEvidenceCoverage} from '../src/evidenceCoverage.js';
import {predictionInputsAt} from '../src/inputChronology.js';
import {importIntelligence,readIntelligenceStore} from '../src/intelligenceStore.js';
import {projectPlayerParticipation} from '../src/participationProjection.js';
import {isConfirmedStarter} from '../src/playerEvidence.js';
const asOf=Date.parse('2099-02-01T18:00:00Z'),fetchedAt='2099-02-01T17:59:00Z';
const game=()=>({id:'nhl-2098020001',leagueKey:'nhl',sportGroup:'Hockey',statusKey:'scheduled',startTime:'2099-02-02T18:00:00Z',seasonYear:20982099,away:{id:'1',name:'Away',abbr:'AAA'},home:{id:'2',name:'Home',abbr:'HHH'}});
const leader=(playerId)=>({playerId,positionCode:'G',name:{default:'Goalie '+playerId},gamesPlayed:5,savePctg:.91,gaa:2.5});
const payload=()=>({id:2098020001,gameState:'FUT',startTimeUTC:game().startTime,season:20982099,awayTeam:{id:1,abbrev:'AAA'},homeTeam:{id:2,abbrev:'HHH'},matchup:{goalieComparison:{contextSeason:20982099,awayTeam:{leaders:[leader(1),leader(2)]},homeTeam:{leaders:[leader(3),leader(4)]}}}});
const parse=(p=payload(),g=game(),meta={})=>parseNhlGoalieResearch(p,g,{asOf,fetchedAt,cacheState:'network',...meta});
test('native goalie season candidates retain samples but never become starters or health clearances',()=>{
 const result=parse();assert.equal(result.status,'season_context_only');assert.equal(result.confirmedStarters,0);assert.equal(result.injuryCoverage,'unknown');assert.equal(result.sides.away.candidates.length,2);
 for(const row of result.sides.away.candidates){assert.equal(row.availability,null);assert.equal(row.healthStatus,'unknown');assert.equal(isConfirmedStarter(row),false);}assert.equal(result.nativePublicationVerified,false);
});
test('goalie context requires exact event, scheduled start and both team identities',()=>{
 for(const change of [{id:999},{startTimeUTC:'2099-02-02T18:01:00Z'},{awayTeam:{abbrev:'HHH'}},{gameState:'OFF'}])assert.equal(parse({...payload(),...change}).status,'unavailable');
 assert.equal(parse(payload(),{...game(),id:'401234'}).status,'unavailable');
});
test('known future or unzoned receipts and post-start observations cannot become pregame evidence',()=>{
 for(const meta of [{fetchedAt:'2099-02-01T19:00:00Z'},{fetchedAt:'2099-02-01T17:59:00'},{asOf:Date.parse(game().startTime)}])assert.equal(parse(payload(),game(),meta).status,'unavailable');
});
test('season mismatch and absent native leaders remain unavailable',()=>{
 assert.equal(parse({...payload(),season:20992000}).status,'unavailable');assert.equal(parse({...payload(),matchup:{}}).status,'unavailable');
});
test('invalid samples and conflicting duplicate goalie identities are not silently scored as zero',()=>{
 const p=payload();p.matchup.goalieComparison.awayTeam.leaders=[leader(1),{...leader(1),gaa:3},{...leader(2),gamesPlayed:null}];const result=parse(p);assert.equal(result.status,'incomplete_context');assert.equal(result.sides.away.candidates.length,0);assert.equal(result.rejectedRows,2);
});
test('the same player cannot supply native goalie context for both teams',()=>{
 const p=payload();p.matchup.goalieComparison.homeTeam.leaders=[leader(1)];assert.equal(parse(p).reason,'cross_team_player_identity_conflict');
});
test('collector respects event cap and does not change automatic model player inputs',async()=>{
 const games=[game(),{...game(),id:'nhl-2098020002'}];let calls=0;const result=await enrichNhlGoalieResearch(games,{maxGames:1,clock:()=>asOf,fetchJson:async()=>{calls++;return {ok:true,json:payload(),fetchedAt,cacheState:'network'};}});
 assert.equal(calls,1);assert.equal(result.capOmissions,1);assert.equal(result.available,1);assert.equal(games[0].autoPlayers,undefined);assert.equal(games[1].goalieResearch,undefined);
});
test('access and rate failures stop remaining goalie context requests',async()=>{
 for(const status of [403,429]){let calls=0;const result=await enrichNhlGoalieResearch([game(),{...game(),id:'nhl-2098020002'}],{maxGames:2,clock:()=>asOf,fetchJson:async()=>{calls++;return {ok:false,status,cacheState:'network'};}});assert.equal(calls,1);assert.equal(result.deferred,1);assert.equal(result.confirmedStarters,0);}
});
test('research context cannot satisfy missing confirmed-goalie or injury coverage',()=>{
 const g={...game(),goalieResearch:parse()};const report=buildEvidenceCoverage(g,{now:asOf});assert.equal(report.goalieResearch.candidatesBySide.away,2);assert.equal(report.sides.away.criticalStarterStatus,'missing');assert.equal(report.sides.away.injuryCoverage,'unknown');assert.ok(report.missing.includes('away:critical_starter_unconfirmed'));
});
test('future native research receipts are excluded at an earlier inference cutoff',()=>{
 const g={...game(),goalieResearch:{...parse(),fetchedAt:'2099-02-01T19:00:00Z'}};assert.equal(predictionInputsAt(g,{},asOf).game.goalieResearch,null);
});

test('imported missing player availability remains unknown rather than 100 percent healthy',async()=>{
 await importIntelligence('goalie-health-unknown',{players:[{name:'Unknown Goalie',team:'Away',league:'NHL',role:'Goalie'},{name:'Known Out',team:'Away',league:'NHL',role:'Goalie',status:'Out'},{name:'Explicit Zero',team:'Away',league:'NHL',availability:0}]});
 const players=Object.values((await readIntelligenceStore('goalie-health-unknown')).players),unknown=players.find(p=>p.name==='Unknown Goalie');assert.equal(unknown.availability,null);assert.equal(unknown.status,'unknown');assert.equal(unknown.availabilityEvidence,'unknown');assert.equal(players.find(p=>p.name==='Explicit Zero').availability,0);
 const report=buildEvidenceCoverage(game(),{now:Date.now(),players:{away:players,home:[]}});assert.equal(report.sides.away.modelInputs.players.find(p=>p.playerId===unknown.id).availabilityObserved,false);
 assert.equal(projectPlayerParticipation(players.find(p=>p.name==='Known Out'),null,'hockey').availabilityProbability,0);
});
test('unknown availability adds uncertainty instead of claiming an observed health probability',()=>{
 const unknown=projectPlayerParticipation({role:'Goalie'},null,'hockey'),known=projectPlayerParticipation({role:'Goalie',availability:100},null,'hockey');assert.equal(unknown.availabilityObserved,false);assert.equal(known.availabilityObserved,true);assert.ok(unknown.uncertainty>known.uncertainty);assert.equal(unknown.availabilityBasis,'unobserved_role_prior_not_health_clearance');
 const rolePrior=projectPlayerParticipation({role:'Goalie',availability:100,status:'probable starter',availabilityEvidence:'role_prior_not_injury_clearance'},null,'hockey');assert.equal(rolePrior.availabilityObserved,false);
});
test('stale, negative-cache and unknown-cache goalie receipts cannot be described as usable season context',()=>{
 for(const meta of [{fetchedAt:'2099-02-01T17:00:00Z'},{cacheState:'stale'},{cacheState:'unknown'},{cacheState:'negative_cache'}])assert.equal(parse(payload(),game(),meta).status,'unavailable');
});
test('native goalie context rejects postponed games and unverified team ID bindings',()=>{
 for(const p of [{...payload(),gameScheduleState:'PPD'},{...payload(),awayTeam:{id:999,abbrev:'AAA'}},{...payload(),homeTeam:{id:1,abbrev:'HHH'}},{...payload(),startTimeUTC:'2099-02-30T18:00:00Z'}])assert.equal(parse(p).status,'unavailable');
 assert.equal(parse(payload(),{...game(),statusKey:'alert'}).status,'unavailable');
});
test('retained goalie context expires at inference and cannot be transplanted to another game',()=>{
 const g={...game(),goalieResearch:parse()},original=structuredClone(g);
 for(const [input,at] of [[g,asOf+15*60000],[{...g,id:'nhl-2098020002'},asOf],[{...g,away:{...g.away,id:'999'}},asOf]]){
  const safe=predictionInputsAt(input,{},at);assert.equal(safe.game.goalieResearch,null);assert.ok(Object.keys(safe.audit.excluded).some(key=>key.startsWith('goalieResearch:')));
  const report=buildEvidenceCoverage(input,{now:at});assert.equal(report.goalieResearch.status,'unavailable');assert.equal(report.goalieResearch.candidatesBySide.away,0);assert.equal(report.sides.away.injuryCoverage,'unknown');
 }
 assert.deepEqual(g,original);
});
