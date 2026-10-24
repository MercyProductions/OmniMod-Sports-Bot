import test from 'node:test';
import assert from 'node:assert/strict';
import {modelDecisionForSport,applyCandidateDecision} from '../src/modelRegistry.js';
import {hybridArtifactId} from '../src/hybridArtifact.js';
import {CURRENT_MODEL_VERSION} from '../src/modelIdentity.js';
import {buildEvidenceCoverage} from '../src/evidenceCoverage.js';
import {predictGame} from '../src/predictionEngine.js';
import {predictLocalMlCandidate,localMlArtifactId,FEATURE_NAMES} from '../src/localMl.js';
const now=Date.parse('2026-10-23T18:00:00Z'),before='2026-10-23T17:00:00Z',after='2026-10-23T19:00:00Z';
function row(){const artifactId=hybridArtifactId('basketball',.38);return {champion:'hybrid',championModelId:'sport-specialist-hybrid-v2',specialistWeight:.38,promotedAt:before,evaluatedAt:before,approvedArtifactId:artifactId,selectionReview:{status:'review_ready',candidate:'hybrid',sport:'basketball',modelVersion:CURRENT_MODEL_VERSION,reportHash:'b'.repeat(64),artifactId,finalizedAt:before},evaluation:{cohort:{prospectiveRecordsVerified:true,key:`production|${CURRENT_MODEL_VERSION}|Daily`}}};}
const registry=r=>({updatedAt:before,sports:{basketball:r}});
test('future approval and promotion cannot activate a historical champion',()=>{
 for(const change of [{selectionReview:{...row().selectionReview,finalizedAt:after}},{promotedAt:after},{evaluatedAt:after}])assert.equal(modelDecisionForSport(registry({...row(),...change}),'basketball',{now}).champion,'evidence');
});
test('malformed or absent review chronology cannot qualify a champion',()=>{
 for(const value of [undefined,'2026-10-23T17:00:00','2026-02-30T17:00:00Z',false]){
  const r=row();r.selectionReview.finalizedAt=value;assert.equal(modelDecisionForSport(registry(r),'basketball',{now}).champion,'evidence');
 }
 const r=row();delete r.promotedAt;assert.equal(modelDecisionForSport(registry(r),'basketball',{now}).champion,'evidence');
});
test('registry revisions after cutoff cannot stand in for an earlier registry',()=>{
 assert.equal(modelDecisionForSport({...registry(row()),updatedAt:after},'basketball',{now}).champion,'evidence');
});
test('valid chronology preserves the approved champion without mutating registry',()=>{
 const r=registry(row()),original=structuredClone(r);assert.equal(modelDecisionForSport(r,'basketball',{now}).champion,'hybrid');assert.deepEqual(r,original);
 const reversed=row();reversed.selectionReview.finalizedAt='2026-10-23T17:30:00Z';assert.equal(modelDecisionForSport(registry(reversed),'basketball',{now}).champion,'evidence');
});
test('explicit promotions require a completed review available at the decision instant',()=>{
 const good={evidence:{sampleSize:100},hybrid:{sampleSize:100},brierImprovement:.01,logLossImprovement:.01};
 const review={...row().selectionReview,finalizedAt:after};assert.equal(applyCandidateDecision({},'basketball',good,good,{now:new Date(now).toISOString(),allowPromotion:true,selectionReview:review}).entry.champion,'evidence');
});
test('inference supplies its historical cutoff to the registry gate',()=>{
 const r=row();r.promotedAt=after;r.evaluatedAt=after;r.selectionReview.finalizedAt=after;
 const game={id:'registry-clock',leagueKey:'nba',league:'NBA',sportGroup:'Basketball',startTime:'2026-10-24T18:00:00Z',statusKey:'scheduled',away:{name:'A'},home:{name:'H'}};
 const result=predictGame(game,0,{now,modelRegistry:registry(r)});assert.equal(result.championModel,'evidence-ensemble-v6');assert.equal(result.sportModel.active,false);
});
test('registry APIs reject invalid decision cutoffs',()=>{
 assert.throws(()=>modelDecisionForSport({},'basketball',{now:NaN}),/cutoff/);assert.throws(()=>applyCandidateDecision({},'basketball',{}, {},{now:'invalid'}),/cutoff/);
});
test('local ML artifact clocks reject normalized dates and unzoned values',()=>{
 for(const trainedAt of ['2026-02-30T17:00:00Z','2026-10-23T17:00:00']){
  const model={artifactFormat:'sports-local-ml-artifact-v2',trainedAt,lastTrainingOutcomeAt:'2026-01-01T00:00:00Z',featureNames:FEATURE_NAMES,fitRounds:22,stumps:[{feature:FEATURE_NAMES[0],threshold:0,left:0,right:0}],accepted:true};model.artifactId=localMlArtifactId(model);
  assert.equal(predictLocalMlCandidate(model,{}, {away:.5,home:.5},{now}).reason,'model_not_available_at_forecast_cutoff');
 }
});

test('missing registry or evaluation availability cannot qualify as an active champion',()=>{
 const r=registry(row());delete r.updatedAt;assert.equal(modelDecisionForSport(r,'basketball',{now}).champion,'evidence');
 const candidate=row();delete candidate.evaluatedAt;assert.equal(modelDecisionForSport(registry(candidate),'basketball',{now}).champion,'evidence');
});

test('missing summaries expose a known provider-ID mapping blocker without inventing data',()=>{
 const game={id:'nhl-native',leagueKey:'nhl',away:{name:'A'},home:{name:'H'},summaryIdentity:{provider:'ESPN',status:'unavailable',reason:'provider_event_mapping_not_verified'}};
 const report=buildEvidenceCoverage(game,{now});assert.ok(report.missing.includes('summary:provider_event_mapping_not_verified'));assert.equal(report.summary.providerMapping?.status,'unavailable');assert.equal(report.summary.injuryCoverage,'unknown');
 const old=buildEvidenceCoverage({...game,summaryIdentity:undefined},{now});assert.equal(old.summary.providerMapping?.status,'unknown');assert.ok(!old.missing.includes('summary:provider_event_mapping_not_verified'));
});
test('a summary supplied independently is not described as missing just because another mapping failed',()=>{
 const report=buildEvidenceCoverage({summaryIdentity:{status:'unavailable',reason:'provider_event_mapping_not_verified'},autoEnrichment:{fetchedAt:before,cacheState:'network'}},{now});assert.ok(!report.missing.includes('summary:provider_event_mapping_not_verified'));assert.equal(report.summary.providerMapping?.status,'unavailable');assert.equal(report.summary.providerMapping?.verification,'provided_mapping_assertion_not_independently_timestamped');
});
