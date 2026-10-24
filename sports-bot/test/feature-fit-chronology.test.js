import test from 'node:test';
import assert from 'node:assert/strict';
import {buildWalkForwardFeatureModels} from '../src/modelEvaluation.js';
import {attachFinalGrade} from '../src/sportsData.js';
const at=(day,hour)=>new Date(Date.UTC(2026,0,day,hour)).toISOString();
const options={minSamples:20,asOf:Date.parse('2027-01-01T00:00:00Z')};
function rows(){return Array.from({length:100},(_,i)=>({gameId:'g'+i,league:'nba',sport:'basketball',dateKey:at(i+1,8).slice(0,10),
 predictionGeneratedAt:at(i+1,8),startTime:at(i+1,12),resolvedAt:at(i+1,16),outcome:i%2,
 factors:{useful:i%2?.35:-.35,misleading:i%2?-.75:.75}}));}

test('held-out outcome mutation cannot change feature fit or its artifact identity',()=>{
 const source=rows(),first=buildWalkForwardFeatureModels(source,options).basketball;
 const changed=structuredClone(source);for(const row of changed.slice(70))row.outcome=1-row.outcome;
 const second=buildWalkForwardFeatureModels(changed,options).basketball;
 assert.deepEqual(first.weights,second.weights);assert.equal(first.artifactId,second.artifactId);
 assert.notEqual(first.learnedBrier,second.learnedBrier);assert.equal(first.trainingSampleSize,70);
 assert.equal(first.evaluationSampleSize,30);assert.equal(first.accepted,false);assert.equal(first.productionEligible,false);
});

test('held-out factor mutation cannot introduce a feature into the fitted artifact',()=>{
 const source=rows(),first=buildWalkForwardFeatureModels(source,options).basketball;
 for(const row of source.slice(70))row.factors.onlyValidation=2;
 const second=buildWalkForwardFeatureModels(source,options).basketball;
 assert.equal(second.artifactId,first.artifactId);assert.equal(second.weights.onlyValidation,undefined);
});

test('unavailable or overlapping training outcomes are excluded rather than sorted by schedule date',()=>{
 const source=rows();source[0].resolvedAt=at(75,16);source[1].resolvedAt=null;
 const model=buildWalkForwardFeatureModels(source,options).basketball;
 assert.equal(model.excluded.outcome_chronology_unverified,1);
 assert.equal(model.excluded.training_label_overlaps_validation,1);
 assert.equal(model.trainingSampleSize,68);
 const early=buildWalkForwardFeatureModels(rows(),{...options,asOf:Date.parse(at(10,8))}).basketball;
 assert.equal(early.sampleSize,9);assert.equal(early.researchAccepted,false);
});

test('duplicate guild or horizon examples do not multiply a game in the feature fit',()=>{
 const source=rows(),first=buildWalkForwardFeatureModels(source,options).basketball;
 const duplicate=structuredClone(source[0]);duplicate.predictionGeneratedAt=at(1,9);
 const repeated=buildWalkForwardFeatureModels([...source,duplicate],options).basketball;
 assert.equal(repeated.sampleSize,100);assert.equal(repeated.artifactId,first.artifactId);
 duplicate.outcome=1-duplicate.outcome;
 const conflicting=buildWalkForwardFeatureModels([...source,duplicate],options).basketball;
 assert.equal(conflicting.excluded.conflicting_game_outcome,1);assert.equal(conflicting.sampleSize,99);
});

test('validation scores use the returned frozen shrunk weights exactly',()=>{
 const source=rows(),model=buildWalkForwardFeatureModels(source,options).basketball;
 const brier=source.slice(70).reduce((sum,row)=>{
  const logit=Object.entries(row.factors).reduce((total,[label,value])=>total+value*(model.weights[label]??1),0);
  return sum+(1/(1+Math.exp(-logit))-row.outcome)**2;
 },0)/30;
 assert.ok(Math.abs(model.learnedBrier-brier)<1e-12);
});

test('final observation timestamp is preserved on retries and revised only for changed results',()=>{
 const game={statusKey:'final',away:{name:'A',abbr:'A',score:1},home:{name:'H',abbr:'H',score:2}};
 const initial=attachFinalGrade(game,{predictionMode:'pregame',predictedSide:'home'},Date.parse(at(1,16)));
 const retry=attachFinalGrade(game,initial,Date.parse(at(2,16)));
 assert.equal(retry.resultObservedAt,at(1,16));
 game.away.score=3;
 const corrected=attachFinalGrade(game,retry,Date.parse(at(3,16)));
 assert.equal(corrected.resultObservedAt,at(3,16));assert.equal(corrected.actualSide,'away');
});
