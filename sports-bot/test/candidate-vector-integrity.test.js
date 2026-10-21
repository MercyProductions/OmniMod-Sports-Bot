import test from 'node:test';
import assert from 'node:assert/strict';
import {validCandidateVector,selectCandidateCohort} from '../src/candidateCohorts.js';
import {trainLocalMlModels} from '../src/localMl.js';
import {evaluateCandidateModels} from '../src/modelRegistry.js';
import {evaluateMatchedJournal} from '../src/matchedJournalEvaluation.js';
const issued='2026-10-20T18:00:00Z',start='2026-10-20T19:00:00Z',final='2026-10-20T22:00:00Z';
const base={forecastId:'f',gameId:'g',league:'nba',leagueKey:'nba',sport:'basketball',guildId:'guild',modelVersion:'fixture',horizon:'Daily',source:'frozen-production',
 snapshotPolicy:'first_issue_immutable_v1',recordedAt:issued,predictionGeneratedAt:issued,startTime:start,resolvedAt:final,actualSide:'home',
 lifecycleState:'ISSUED',recordEligibility:'observed_pregame',selectedSide:'home',outcomePercentages:{away:30,home:70,draw:0},mlFeatureVector:{elo:.1}};
const train=row=>trainLocalMlModels([row],{now:Date.parse('2026-10-21T00:00:00Z')});

test('candidate vectors reject coercion, arrays, unknown keys and invalid mass',()=>{
 for(const vector of [{away:'0.3',home:.7,draw:0},{away:.3,home:.7,draw:0,other:1},[.3,.7,0],{away:.7,home:.7,draw:0}])assert.equal(validCandidateVector(vector),false);
});
test('omitted or null draw requires valid frozen binary metadata',()=>{
 for(const vector of [{away:.3,home:.7},{away:.3,home:.7,draw:null}]){
  assert.equal(validCandidateVector(vector),false);assert.equal(validCandidateVector(vector,['away','home']),true);
  assert.equal(validCandidateVector(vector,['away','home','draw']),false);
 }
 assert.equal(validCandidateVector({away:.2,home:.7,draw:.1},['away','home']),false);
 assert.equal(validCandidateVector({away:.3,home:.7,draw:0},['away','home','home']),false);
});
test('registry counts malformed candidate vectors instead of coercing them into scores',()=>{
 const report=evaluateCandidateModels([{...base,candidateProbabilities:{evidence:{away:'0.3',home:.7,draw:0},hybrid:{away:.3,home:.7,draw:0}}}]);
 assert.equal(report.evidence.sampleSize,0);assert.equal(report.hybrid.sampleSize,1);
 assert.equal(report.comparisons.hybrid.sampleSize,0);assert.equal(report.invalidVectorsByModel.evidence,1);
});
test('training excludes unverified vectors but retains declared binary candidates without mutation',()=>{
 const row={...base,candidateProbabilities:{evidence:{away:.3,home:.7}}},before=JSON.stringify(row);
 const rejected=train(row);assert.equal(rejected.invalidEvidenceVectorsExcluded,1);assert.deepEqual(rejected.sports,{});
 assert.equal(JSON.stringify(row),before);
 const declared=train({...row,candidateModeledOutcomes:{evidence:['away','home']}});
 assert.equal(declared.invalidEvidenceVectorsExcluded,0);assert.equal(declared.sports.basketball.sampleSize,1);
});
test('registry honors candidate class declarations and rejects contradictory ones',()=>{
 const row={...base,candidateProbabilities:{evidence:{away:.3,home:.7}},candidateModeledOutcomes:{evidence:['away','home']}};
 assert.equal(evaluateCandidateModels([row]).evidence.sampleSize,1);
 assert.equal(evaluateCandidateModels([{...row,candidateModeledOutcomes:{evidence:['away','home','draw']}}]).evidence.sampleSize,0);
});
test('matched journal references require strict vectors and preserve explicit binary declarations',()=>{
 const evaluate=row=>evaluateMatchedJournal([{type:'forecast',recordedAt:issued,payload:row},
 {type:'result',recordedAt:final,payload:{forecastId:'f',actualSide:'home',observedAt:final}}],{asOf:Date.parse('2026-10-21T00:00:00Z'),repetitions:100}).byVersion.fixture.hybrid;
 const row={...base,candidateProbabilities:{hybrid:{away:.3,home:.7}}};
 assert.equal(evaluate(row).excluded.reference_missing_or_invalid,1);
 assert.equal(evaluate({...row,candidateModeledOutcomes:{hybrid:['away','home']}}).primary.games,1);
 assert.equal(evaluate({...row,candidateProbabilities:{hybrid:{away:'0.3',home:.7,draw:0}}}).excluded.reference_missing_or_invalid,1);
});
test('different simultaneous frozen candidate class declarations cannot be chosen by input order',()=>{
 const a={...base,candidateProbabilities:{evidence:{away:.3,home:.7,draw:0}}},b={...a,candidateModeledOutcomes:{evidence:['away','home']}};
 assert.equal(selectCandidateCohort([a,b]).cohort.ambiguousFirstForecastGamesExcluded,1);
 assert.equal(selectCandidateCohort([b,a]).rows.length,0);
});
