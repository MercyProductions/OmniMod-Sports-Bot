import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluatePredictionHorizons} from '../src/horizonEvaluation.js';
const base={gameId:'g',leagueKey:'nba',modelVersion:'fixture',horizon:'Daily',predictionMode:'pregame',
 predictionGeneratedAt:'2026-10-20T18:00:00Z',startTime:'2026-10-20T19:00:00Z',predictedSide:'home',actualSide:'home',
 outcomeProbabilities:{away:30,home:70,draw:0}};
const report=overrides=>evaluatePredictionHorizons([{...base,...overrides}]);
const invalid=overrides=>{const result=report(overrides);assert.equal(result.overall.sampleSize,0);assert.equal(result.scoringExclusions.invalid_or_unverified_outcome_vector,1);};

test('arbitrary positive vector mass cannot be normalized into a legitimate horizon forecast',()=>{
 for(const outcomeProbabilities of [{away:70,home:70,draw:0},{away:.3,home:.7,draw:0},{away:0,home:0,draw:0}])invalid({outcomeProbabilities});
});
test('missing legacy draw is unknown until frozen binary classes are available',()=>{
 const outcomeProbabilities={away:30,home:70};invalid({outcomeProbabilities});
 const row={...base,outcomeProbabilities,modeledOutcomes:['away','home']},before=JSON.stringify(row);
 assert.equal(evaluatePredictionHorizons([row]).overall.sampleSize,1);assert.equal(JSON.stringify(row),before);
});
test('null draw padding requires an explicit binary declaration and contradictory classes reject',()=>{
 invalid({outcomeProbabilities:{away:30,home:70,draw:null}});
 assert.equal(report({outcomeProbabilities:{away:30,home:70,draw:null},modeledOutcomes:['away','home']}).overall.sampleSize,1);
 invalid({outcomeProbabilities:{away:25,home:70,draw:5},modeledOutcomes:['away','home']});
});
test('numeric strings, unknown classes and incomplete three-way declarations cannot be coerced',()=>{
 invalid({outcomeProbabilities:{away:'30',home:70,draw:0}});
 invalid({outcomeProbabilities:{away:30,home:70,draw:0,other:0}});
 invalid({outcomeProbabilities:{away:30,home:70},modeledOutcomes:['away','home','draw']});
});
test('candidate fallback keeps fractional scale and needs class evidence for omitted draws',()=>{
 const candidateProbabilities={evidence:{away:.3,home:.7}};
 invalid({outcomeProbabilities:undefined,candidateProbabilities});
 assert.equal(report({outcomeProbabilities:undefined,candidateProbabilities,candidateModeledOutcomes:{evidence:['away','home']}}).overall.sampleSize,1);
 invalid({outcomeProbabilities:undefined,candidateProbabilities:{evidence:{away:30,home:70,draw:0}}});
});
test('frozen winner must identify a maximum-probability modeled outcome',()=>{
 for(const predictedSide of ['away','unknown']){
  const result=report({predictedSide});assert.equal(result.overall.sampleSize,0);assert.equal(result.scoringExclusions.invalid_frozen_selection,1);
 }
 assert.equal(report({outcomeProbabilities:{away:50,home:50,draw:0},predictedSide:'away'}).overall.accuracy,0);
});
test('small display rounding and sub-one-percent outcomes remain supported within declared tolerance',()=>{
 const result=report({outcomeProbabilities:{away:.8,home:99.18,draw:0}});
 assert.equal(result.overall.sampleSize,1);assert.ok(Math.abs(result.overall.brierScore-(.8/99.98)**2)<1e-12);
});
