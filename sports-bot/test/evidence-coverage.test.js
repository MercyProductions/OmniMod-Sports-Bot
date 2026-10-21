import test from 'node:test';
import assert from 'node:assert/strict';
import {parseEspnSummary} from '../src/autoEnrichment.js';
import {buildEvidenceCoverage, summaryEvidence, summarizeEvidenceCoverage} from '../src/evidenceCoverage.js';
import {attachParticipationProjections, projectPlayerParticipation} from '../src/participationProjection.js';
import {predictGame} from '../src/predictionEngine.js';
import {modelDecisionForSport} from '../src/modelRegistry.js';
import {applyPlayerProfilesAndLineups} from '../src/advancedMetrics.js';
import {reconcilePlayerEvidence} from '../src/playerEvidence.js';

const now=Date.parse('2026-10-20T18:00:00Z');
const game=()=>({id:'coverage',leagueKey:'mlb',league:'MLB',sportGroup:'Baseball',statusKey:'scheduled',
  startTime:'2099-07-01T20:00:00Z',away:{name:'Away',abbr:'AWY'},home:{name:'Home',abbr:'HOM'}});

test('probable pitcher remains projected unless the current event roster confirms the starter',()=>{
  const value=game();
  const payload={header:{competitions:[{competitors:[{team:{displayName:'Away'},probables:[{
    athlete:{id:'pitcher',displayName:'Pitcher',position:{displayName:'Starting Pitcher'}}
  }]}]}]}};
  let parsed=parseEspnSummary(payload,value,{fetchedAt:new Date(now).toISOString(),cacheState:'network'});
  assert.equal(parsed.players[0].confirmedStarter,false);
  assert.equal(parsed.players[0].availabilityEvidence,'role_prior_not_injury_clearance');
  value.autoPlayers=parsed.players;value.autoLineups=parsed.lineups;
  const projected=attachParticipationProjections(value)[0];
  assert.equal(buildEvidenceCoverage(value,{now}).sides.away.modelInputs.players[0].availabilityObserved,false);
  assert.ok(projected.startProbability<0.96);
  payload.rosters=[{team:{displayName:'Away'},roster:[{athlete:{id:'pitcher',displayName:'Pitcher'},starter:true}]}];
  parsed=parseEspnSummary(payload,value,{fetchedAt:new Date(now).toISOString(),cacheState:'network'});
  assert.equal(parsed.players[0].confirmedStarter,true);
  value.autoPlayers=parsed.players;value.autoLineups=parsed.lineups;
  assert.ok(attachParticipationProjections(value)[0].startProbability>=0.96);
});

test('empty injury arrays do not establish team coverage or earn the report bonus',()=>{
  const value=game(),meta={fetchedAt:new Date(now).toISOString(),cacheState:'network'};
  const empty=parseEspnSummary({injuries:[]},value,meta);
  value.autoEnrichment=empty.meta;
  const absent=predictGame(value,0,{now});
  assert.equal(summaryEvidence(value,now).injuryCoverage,'unknown');
  const reported=parseEspnSummary({injuries:[{team:{displayName:'Away'},injuries:[]},{team:{displayName:'Home'},injuries:[]}]},value,meta);
  value.autoEnrichment=reported.meta;
  const covered=predictGame(value,0,{now});
  assert.equal(covered.apiConfidenceValue-absent.apiConfidenceValue,5);
  assert.equal(covered.evidenceCoverage.sides.away.injuryCoverage,'team_report_received_not_a_clean_bill_of_health');
});

test('stale and future summary receipts cannot earn fresh summary or injury confidence',()=>{
  const value=game();
  value.autoEnrichment={cacheState:'network',fetchedAt:new Date(now+1000).toISOString(),injuryTeams:['Away','Home']};
  assert.equal(summaryEvidence(value,now).receiptFresh,false);
  assert.ok(buildEvidenceCoverage(value,{now}).missing.includes('summary:future_receipt'));
  value.autoEnrichment={cacheState:'stale',fetchedAt:new Date(now-1000).toISOString(),injuryTeams:['Away','Home']};
  assert.equal(summaryEvidence(value,now).receiptFresh,false);
});

test('coverage distinguishes true numeric zero, missing values, absent starters and unknown history',()=>{
  const value=game();
  value.autoPlayers=[{id:'p',team:'Away',role:'Starting Pitcher',starter:true,confirmationStatus:'projected',stats:{zero:0,unknown:null,blank:'',number:4}}];
  const report=buildEvidenceCoverage(value,{now});
  assert.deepEqual(report.sides.away.numericStats,{observed:2,zero:1,missing:2});
  assert.equal(report.sides.away.historyGames,null);
  assert.equal(report.sides.away.criticalStarterStatus,'projected_or_unavailable');
  assert.equal(report.sides.home.criticalStarterStatus,'missing');
  assert.equal(report.sides.away.bullpenAvailability,'not_independently_verified');
  assert.equal(report.venue.neutral,null);
});

test('coverage records the actual model-selected manual rows separately from automatic evidence',()=>{
  const value=game();value.autoPlayers=[{id:'unused',team:'Away',availability:100}];
  const manual={id:'manual',team:'Away',role:'Starting Pitcher',starter:true,availability:0,status:'Out',updatedAt:new Date(now-1000).toISOString()};
  const report=buildEvidenceCoverage(value,{now,players:{away:[manual],home:[]}});
  assert.equal(report.sides.away.modelInputs.manualPlayers,1);
  assert.equal(report.sides.away.modelInputs.players[0].playerId,'manual');
  assert.equal(report.sides.away.modelInputs.players[0].availabilityObserved,true);
  assert.equal(report.sides.away.criticalStarterStatus,'projected_or_unavailable');
});

test('unavailable confirmed starters cannot satisfy frozen lineup coverage',()=>{
  for (const state of [{status:'Out'}, {notes:'ruled out'}, {status:'Suspended'}, {active:false}, {availability:0}]) {
    const value=game();
    const player={id:'p',team:'Away',role:'Starting Pitcher',starter:true,confirmedStarter:true,...state};
    value.autoPlayers=[player];value.autoLineups=[player];
    const report=buildEvidenceCoverage(value,{now});
    assert.equal(report.sides.away.criticalStarterStatus,'projected_or_unavailable');
    assert.equal(report.sides.away.confirmedStarters,0);
    assert.ok(report.missing.includes('away:critical_starter_unconfirmed'));
    assert.equal(projectPlayerParticipation(player,null,'baseball').startProbability,0);
  }
  const value=game();
  value.autoPlayers=[{id:'p',team:'Away',role:'Starting Pitcher',confirmedStarter:true}];
  // A confirmed role is still a record, never an independent medical clearance.
  assert.equal(buildEvidenceCoverage(value,{now}).sides.away.criticalStarterStatus,'confirmed_record_present');
});

test('evidence audit excludes rejected observations and preserves unknown legacy inputs',()=>{
  const coverage=buildEvidenceCoverage(game(),{now});
  const report=summarizeEvidenceCoverage([
    {type:'provisional_forecast',payload:{evidenceCoverage:coverage}},
    {type:'forecast',payload:{forecastId:'issued',lifecycleState:'ISSUED',evidenceCoverage:coverage,league:'mlb'}},
    {type:'forecast',payload:{forecastId:'old-inputs',lifecycleState:'ISSUED',league:'mlb'}}
  ]);
  assert.equal(report.issuedForecasts,2);assert.equal(report.withFrozenCoverage,1);
  assert.equal(report.missingReasons.frozen_evidence_coverage_unavailable,1);
  assert.equal(report.byLeague.mlb,2);assert.equal(report.accuracyImprovementEstablished,false);
});


test('availability is applied once to workload and unavailable confirmed starters cannot start',()=>{
  const learned={participation:0.8,starterRate:0.75,sampleSize:20};
  const healthy=projectPlayerParticipation({role:'Starting Pitcher',starter:true,availability:100,confirmationStatus:'projected'},learned,'baseball');
  const uncertain=projectPlayerParticipation({role:'Starting Pitcher',starter:true,availability:50,confirmationStatus:'projected'},learned,'baseball');
  assert.ok(Math.abs(uncertain.expectedShare-healthy.expectedShare*0.5)<1e-12);
  assert.equal(uncertain.conditionalStartProbability,healthy.conditionalStartProbability);
  assert.equal(uncertain.startProbability,healthy.startProbability*0.5);
  const out=projectPlayerParticipation({role:'Starting Pitcher',starter:true,status:'Out'},learned,'baseball',{confirmedStarter:true});
  assert.equal(out.startProbability,0);assert.equal(out.expectedShare,0);
});

test('participation lineup joins stay within the player team when names or IDs coincide',()=>{
  for (const identity of [{name:'Shared Name'},{name:'Shared Name',sourceAthleteId:'shared'}]) {
    const value=game();
    value.autoLineups=[{...identity,team:'Away',starter:true,confirmedStarter:true,active:true},
      {...identity,team:'Home',starter:false,confirmedStarter:false,active:false}];
    value.autoPlayers=[{...identity,team:'Away',starter:true,availability:100},
      {...identity,team:'Home',starter:false,availability:100}];
    const rows=attachParticipationProjections(value);
    assert.equal(rows.find(row=>row.team==='Away').startProbability,1);
    assert.equal(rows.find(row=>row.team==='Home').startProbability,0);
    assert.equal(value.autoPlayers[0].participationProjection.startProbability,1);
  }
});

test('known conflicting athlete IDs cannot borrow same-name learned participation',()=>{
  const value=game();
  value.autoPlayers=[{name:'Shared Name',team:'Away',sourceAthleteId:'new-player',starter:true}];
  const rows=attachParticipationProjections(value,{old:{name:'Shared Name',team:'Away',athleteId:'old-player',participation:.1,participationSamples:99,sampleSize:99}});
  assert.equal(rows[0].historySamples,0);
  const matching=attachParticipationProjections(value,{correct:{name:'Renamed Player',team:'Away',athleteId:'new-player',participation:.8,participationSamples:12,sampleSize:12}});
  assert.equal(matching[0].historySamples,12);
});

test('advanced profile caller rejects conflicting IDs and matches stable IDs after a name change',()=>{
  const value=game();
  value.autoPlayers=[{name:'Shared Name',team:'Away',sourceAthleteId:'new-player',starter:true,availability:100}];
  applyPlayerProfilesAndLineups([value],{old:{name:'Shared Name',team:'Away',leagueKey:'mlb',athleteId:'old-player',participation:.1,participationSamples:99,sampleSize:99,impact:8,form:10}});
  assert.equal(value.autoPlayers[0].stats?.historicalBoxscoreGames,undefined);
  assert.equal(value.autoPlayers[0].participationProjection.historySamples,0);
  applyPlayerProfilesAndLineups([value],{correct:{name:'Renamed Player',team:'Away',leagueKey:'mlb',athleteId:'new-player',participation:.8,participationSamples:12,sampleSize:12,impact:4,form:60}});
  assert.equal(value.autoPlayers[0].stats.historicalBoxscoreGames,12);
  assert.equal(value.autoPlayers[0].participationProjection.historySamples,12);
});

test('event roster confirmation cannot transfer between teams through a colliding athlete ID',()=>{
  const value=game();
  const parsed=parseEspnSummary({rosters:[{team:{displayName:'Home'},roster:[{athlete:{id:'shared',displayName:'Home Player'},starter:true}]}],
    header:{competitions:[{competitors:[{team:{displayName:'Away'},probables:[{athlete:{id:'shared',displayName:'Away Player'}}]}]}]}},value,
    {fetchedAt:new Date(now).toISOString(),cacheState:'network'});
  assert.equal(parsed.players[0].confirmedStarter,false);
  const unknownTeam=parseEspnSummary({rosters:[{roster:[{athlete:{id:'shared'},starter:true}]}],
    injuries:[{team:{displayName:'Away'},injuries:[{athlete:{id:'shared',displayName:'Away Player'},status:'Questionable'}]}]},value,
    {fetchedAt:new Date(now).toISOString(),cacheState:'network'});
  assert.equal(unknownTeam.players[0].confirmedStarter,false);
});

test('a separate unavailable player report defeats contradictory roster coverage and lineup bonuses',()=>{
  const value=game();value.leagueKey='nba';value.sportGroup='Basketball';
  value.autoLineups=Array.from({length:5},(_,i)=>({athleteId:String(i),name:`Player ${i}`,team:'Away',role:'Guard',starter:true,confirmedStarter:true,active:true}));
  value.autoPlayers=[{sourceAthleteId:'0',name:'Player 0',team:'Away',role:'Guard',starter:true,status:'Out',availability:0}];
  const original=structuredClone(value.autoLineups);
  applyPlayerProfilesAndLineups([value]);
  assert.equal(value.autoLineup.away.starterCount,4);
  assert.equal(value.autoLineup.away.confirmed,false);
  assert.equal(buildEvidenceCoverage(value,{now}).sides.away.confirmedStarters,4);
  assert.equal(value.autoPlayers[0].participationProjection.startProbability,0);
  assert.deepEqual(value.autoLineups,original);
});

test('duplicate or contradictory roster records cannot manufacture a complete starting lineup',()=>{
  for (const conflicting of [false,true]) {
    const value=game();value.leagueKey='nba';value.sportGroup='Basketball';
    const player={athleteId:'one',name:'One Player',team:'Away',starter:true,confirmedStarter:true,active:true};
    value.autoLineups=Array.from({length:5},()=>({...player}));
    if(conflicting)value.autoLineups.push({...player,confirmedStarter:false,starter:false});
    applyPlayerProfilesAndLineups([value]);
    assert.equal(value.autoLineup.away.starterCount,conflicting?0:1);
    assert.equal(value.autoLineup.away.confirmed,false);
    assert.equal(buildEvidenceCoverage(value,{now}).sides.away.confirmedStarters,conflicting?0:1);
  }
});

test('same-team injury contradictions cannot leave a critical starter confirmed',()=>{
  const value=game();
  value.autoLineups=[{athleteId:'p',name:'Pitcher',team:'Away',role:'Starting Pitcher',starter:true,confirmedStarter:true,active:true}];
  value.autoPlayers=[{sourceAthleteId:'p',name:'Pitcher',team:'Away',role:'Starting Pitcher',status:'Out'}];
  assert.equal(buildEvidenceCoverage(value,{now}).sides.away.criticalStarterStatus,'projected_or_unavailable');
  assert.ok(buildEvidenceCoverage(value,{now}).missing.includes('away:lineup_evidence_conflict'));
});

test('availability conflict handling is order independent and cannot cross teams or conflicting known IDs',()=>{
  const player={athleteId:'p',name:'Shared Name',team:'Away',role:'Starting Pitcher',starter:true,confirmedStarter:true,active:true};
  const out={...player,status:'Out',availability:0};
  for(const rows of [[player,out],[out,player]]) {
    const result=reconcilePlayerEvidence(rows);
    assert.equal(result.length,1);assert.equal(result[0].active,false);
    assert.equal(result[0].confirmedStarter,false);assert.equal(result[0].availabilityConflict,true);
  }
  for(const other of [{...out,team:'Home'},{...out,athleteId:'different'}]) {
    assert.equal(reconcilePlayerEvidence([player],[other])[0].confirmedStarter,true);
  }
  const distinct=reconcilePlayerEvidence([player,{...player,athleteId:'different'},
    {name:'Shared Name',team:'Away',starter:true,confirmedStarter:true}]);
  assert.equal(distinct.length,2);
  const unidentifiedOut={name:'Shared Name',team:'Away',status:'Out'};
  assert.equal(reconcilePlayerEvidence([player,unidentifiedOut])[0].active,false);
  assert.equal(reconcilePlayerEvidence([{team:'Away',starter:true,confirmedStarter:true}]).length,0);
});

test('a champion supported only by v6.0.1 evidence stays inactive after evidence-semantic repairs',()=>{
  const decision=modelDecisionForSport({sports:{baseball:{champion:'ml',championModelId:'old-champion',
    evaluation:{cohort:{prospectiveRecordsVerified:true,key:'production|OmniMod Evidence Ensemble v6.0.1|T-30'}}}}},'baseball');
  assert.equal(decision.champion,'evidence');
  assert.equal(decision.status,'provenance_revalidation_required');
});
