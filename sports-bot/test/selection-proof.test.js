import {predictGame} from '../src/predictionEngine.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {selectionFixture} from '../test-support/selection-fixture.mjs';
import {verifySelectionReviewEvidence,selectionReviewVerified,readVerifiedSelectionReview} from '../src/selectionProtocol.js';
import {modelDecisionForSport,applyCandidateDecision,readModelRegistry,modelRegistryFile} from '../src/modelRegistry.js';
import {CURRENT_MODEL_VERSION} from '../src/modelIdentity.js';
const fixture=await selectionFixture(),digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const copy=()=>structuredClone(fixture.bundle),now=fixture.bundle.now;
function entry(review){return {champion:'hybrid',championModelId:'sport-specialist-hybrid-v2',specialistWeight:.38,
 approvedArtifactId:review.artifactId,selectionReview:review,promotedAt:review.finalizedAt,evaluatedAt:review.finalizedAt,
 evaluation:{cohort:{prospectiveRecordsVerified:true,key:`production|${CURRENT_MODEL_VERSION}|Daily`}}};}
const decision=review=>modelDecisionForSport({updatedAt:review.finalizedAt,sports:{basketball:entry(review)}},'basketball',{now,league:'nba',horizon:'Daily'});
function reseal(bundle){delete bundle.review.reportHash;bundle.review.reportHash=digest(bundle.review);bundle.state.reports[bundle.review.planId]=structuredClone(bundle.review);delete bundle.state.stateHash;bundle.state.stateHash=digest(bundle.state);}

test('a real synthetic preregistered review verifies without altering supplied evidence',()=>{
 const bundle=copy(),before=structuredClone(bundle),review=verifySelectionReviewEvidence(bundle);
 assert.ok(selectionReviewVerified(review,now));assert.equal(decision(review).champion,'hybrid');assert.deepEqual(bundle,before);
});

test('serialized approval fields and a hash-shaped string cannot activate a champion',()=>{
 const review=structuredClone(fixture.bundle.review);review.reportHash='b'.repeat(64);
 assert.equal(decision(review).champion,'evidence');
});

test('even a valid serialized report needs freshly verified evidence in this process',()=>{
 assert.equal(decision(structuredClone(fixture.bundle.review)).champion,'evidence');
});

test('verification is bound to report bytes and its actual verification cutoff',()=>{
 const review=fixture.review();assert.equal(selectionReviewVerified(review,now-1),false);
 review.independentDates++;assert.equal(decision(review).champion,'evidence');
});

test('changing a plan identity or pinned artifact invalidates approval',()=>{
 for(const mutate of [b=>b.review.planHash='0'.repeat(64),b=>b.review.artifactId='0'.repeat(64),b=>b.artifactBytes+=' ']){
  const bundle=copy();mutate(bundle);reseal(bundle);assert.throws(()=>verifySelectionReviewEvidence(bundle));
 }
});

test('rehashed invented measurement and decision fields must match journal recomputation',()=>{
 for(const mutate of [b=>b.review.evaluation.byVersion[CURRENT_MODEL_VERSION].hybrid.primary.games=10000,
  b=>b.review.candidateImprovement.brier=.99,b=>b.review.independentDates=1000]){
  const bundle=copy();mutate(bundle);reseal(bundle);assert.throws(()=>verifySelectionReviewEvidence(bundle));
 }
});

test('modified, omitted and unresolved input records cannot reuse the old review',()=>{
 for(const mutate of [b=>b.records[0].payload.outcomePercentages.home=99,b=>b.records.pop(),b=>b.records[1].payload.actualSide='away']){
  const bundle=copy();mutate(bundle);assert.throws(()=>verifySelectionReviewEvidence(bundle),/input binding/);
 }
});

test('later conflicting evidence invalidates a review while future evidence is unavailable',()=>{
 const bundle=copy();bundle.records.push({type:'result_conflict',recordedAt:new Date(now+1000).toISOString(),payload:{forecastId:'f0',conflictId:'later'}});
 assert.ok(selectionReviewVerified(verifySelectionReviewEvidence(bundle),now));
 assert.throws(()=>verifySelectionReviewEvidence({...bundle,now:now+2000}),/changed after review/);
});

test('a rehashed report cannot waive independent game consumption',()=>{
 const bundle=copy();bundle.review.consumedGameKeys.pop();reseal(bundle);
 assert.throws(()=>verifySelectionReviewEvidence(bundle),/consumption/);
 const other=copy();other.state.consumedGames.pop();delete other.state.stateHash;other.state.stateHash=digest(other.state);
 assert.throws(()=>verifySelectionReviewEvidence(other),/ledger incomplete/);
});

test('promotion still requires explicit permission after evidence verification',()=>{
 const good={evidence:{sampleSize:100},hybrid:{sampleSize:100},brierImprovement:.01,logLossImprovement:.01};
 const options={now:new Date(now).toISOString(),selectionReview:fixture.review()};
 assert.equal(applyCandidateDecision({},'basketball',good,good,options).entry.champion,'evidence');
 assert.equal(applyCandidateDecision({},'basketball',good,good,{...options,allowPromotion:true}).entry.champion,'hybrid');
});

async function materialize(t){
 const directory=await mkdtemp(join(tmpdir(),'sports-selection-verify-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const bundle=copy(),stateFile=join(directory,'selection-state.json'),journal=join(directory,'journal.jsonl');
 await writeFile(stateFile,JSON.stringify(bundle.state));
 await writeFile(join(directory,bundle.state.plans[bundle.review.planId].artifactFile),bundle.artifactBytes);
 let previousHash=null;const rows=bundle.records.map((record,index)=>{
  const body={schemaVersion:1,sequence:index+1,previousHash,...record};const eventHash=digest(body);previousHash=eventHash;return {...body,eventHash};
 });
 await writeFile(journal,rows.map(row=>JSON.stringify(row)).join('\n')+'\n');
 // Review input hashes bind the exact journal envelopes, not just their payloads.
 bundle.records=rows;bundle.review.inputHash=digest(rows);reseal(bundle);
 await writeFile(stateFile,JSON.stringify(bundle.state));
 return {directory,journal,stateFile,bundle};
}

test('registry reload verifies configured local state and hash-chain journal without writing either',async t=>{
 const {directory,journal,stateFile,bundle}=await materialize(t);
 const registry={version:1,updatedAt:bundle.review.finalizedAt,sports:{basketball:entry(bundle.review)},audit:[]};
 await writeFile(modelRegistryFile,JSON.stringify(registry));const files=[modelRegistryFile,stateFile,journal],before=await Promise.all(files.map(file=>readFile(file)));
 const loaded=await readModelRegistry({selectionDirectory:directory,journalFile:journal,now});
 assert.equal(modelDecisionForSport(loaded,'basketball',{now,league:'nba',horizon:'Daily'}).champion,'hybrid');
 assert.equal(loaded.sports.basketball.selectionEvidenceStatus,'verified_local_research');
 for(let i=0;i<files.length;i++)assert.deepEqual(await readFile(files[i]),before[i]);
 const missing=await readModelRegistry({selectionDirectory:'',journalFile:'',now});
 assert.equal(modelDecisionForSport(missing,'basketball',{now,league:'nba',horizon:'Daily'}).champion,'evidence');
 await writeFile(journal,'malformed private fixture\n');
 const bad=await readModelRegistry({selectionDirectory:directory,journalFile:journal,now});
 assert.equal(modelDecisionForSport(bad,'basketball',{now,league:'nba',horizon:'Daily'}).champion,'evidence');
 assert.equal(bad.sports.basketball.selectionEvidenceStatus,'unverified_or_changed');
});

test('unsafe artifact paths and malformed JSON are rejected without disclosing contents',async t=>{
 const {directory,bundle}=await materialize(t);
 bundle.state.plans[bundle.review.planId].artifactFile='../private.json';await writeFile(join(directory,'selection-state.json'),JSON.stringify(bundle.state));
 await assert.rejects(readVerifiedSelectionReview(bundle.review,{directory,records:bundle.records,now}),/contract/);
 await writeFile(join(directory,'selection-state.json'),'sensitive-fixture-not-for-errors');
 await assert.rejects(readVerifiedSelectionReview(bundle.review,{directory,records:bundle.records,now}),error=>!error.message.includes('sensitive-fixture'));
});


test('verified trials authorize only their exact league and forecast horizon',()=>{
 const row=entry(fixture.review()),registry={updatedAt:row.selectionReview.finalizedAt,sports:{basketball:row}};
 for(const scope of [{},{league:'wnba',horizon:'Daily'},{league:'nba',horizon:'T-90'},{league:'nba',horizon:'T-10'}]){
  assert.equal(modelDecisionForSport(registry,'basketball',{now,...scope}).champion,'evidence');
 }
 assert.equal(modelDecisionForSport(registry,'basketball',{now,league:'nba',horizon:'Daily'}).champion,'hybrid');
});


test('actual inference passes league and requested horizon into approval selection',()=>{
 const review=fixture.review(),registry={updatedAt:review.finalizedAt,sports:{basketball:entry(review)}};
 const game={id:'scope-fixture',leagueKey:'nba',league:'NBA',sportGroup:'Basketball',statusKey:'scheduled',
  startTime:new Date(now+86400000).toISOString(),away:{name:'A'},home:{name:'H'}};
 const daily=predictGame(game,0,{now,modelRegistry:registry,forecastHorizon:'Daily'});
 assert.equal(daily.championModel,'sport-specialist-hybrid-v2');
 for(const change of [{game:{...game,leagueKey:'wnba'},horizon:'Daily'},{game,horizon:'T-90'}]){
  const rejected=predictGame(change.game,0,{now,modelRegistry:registry,forecastHorizon:change.horizon});
  assert.equal(rejected.championModel,'evidence-ensemble-v6');assert.equal(rejected.championStatus,'provenance_revalidation_required');
 }
});

test('legacy review schemas and rehashed result conflicts cannot acquire a verification proof',()=>{
 const legacy=copy();legacy.review.schema='sports-selection-review-v1';reseal(legacy);assert.throws(()=>verifySelectionReviewEvidence(legacy));
 const disputed=copy();disputed.records.push({type:'result_conflict',recordedAt:disputed.review.finalizedAt,payload:{forecastId:'f0',conflictId:'c'}});
 disputed.review.inputHash=digest(disputed.records);reseal(disputed);assert.throws(()=>verifySelectionReviewEvidence(disputed),/outcomes incomplete/);
});
