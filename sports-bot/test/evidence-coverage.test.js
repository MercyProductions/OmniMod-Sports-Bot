import test from 'node:test';
import assert from 'node:assert/strict';
import {parseEspnSummary} from '../src/autoEnrichment.js';
import {buildEvidenceCoverage, summaryEvidence, summarizeEvidenceCoverage} from '../src/evidenceCoverage.js';
import {attachParticipationProjections, projectPlayerParticipation} from '../src/participationProjection.js';
import {predictGame} from '../src/predictionEngine.js';
import {modelDecisionForSport} from '../src/modelRegistry.js';

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

test('a champion supported only by v6.0.1 evidence stays inactive after evidence-semantic repairs',()=>{
  const decision=modelDecisionForSport({sports:{baseball:{champion:'ml',championModelId:'old-champion',
    evaluation:{cohort:{prospectiveRecordsVerified:true,key:'production|OmniMod Evidence Ensemble v6.0.1|T-30'}}}}},'baseball');
  assert.equal(decision.champion,'evidence');
  assert.equal(decision.status,'provenance_revalidation_required');
});
