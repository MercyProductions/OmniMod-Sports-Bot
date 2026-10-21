import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {registerSelectionPlan,finalizeSelectionPlan} from '../src/selectionProtocol.js';
import {trainLocalMlModels,predictLocalMlCandidate} from '../src/localMl.js';
import {selectCandidateCohort} from '../src/candidateCohorts.js';
import {CURRENT_MODEL_VERSION} from '../src/modelIdentity.js';

const iso=ms=>new Date(ms).toISOString();
function trainingRows(){
  const base=Date.parse('2090-01-01T00:00:00Z');
  return Array.from({length:160},(_,i)=>{
    const day=base+i*86400000,home=i%4<2;
    return {gameId:`train-${i}`,dateKey:iso(day).slice(0,10),leagueKey:'nba',sport:'basketball',
      modelVersion:CURRENT_MODEL_VERSION,source:'frozen-production',snapshotPolicy:'first_issue_immutable_v1',horizon:'Daily',
      startTime:iso(day+20*3600000),predictionGeneratedAt:iso(day+8*3600000),recordedAt:iso(day+9*3600000),
      resolvedAt:iso(day+23*3600000),actualSide:home?'home':'away',
      candidateProbabilities:{evidence:{home:.5,away:.5,draw:0}},mlFeatureVector:{playByPlay:home?1:-1}};
  });
}
const trainingNow=Date.parse('2100-01-01T00:00:00Z');
const model=rows=>trainLocalMlModels(rows,{minimum:100,now:trainingNow});
const pinnedModel=model(trainingRows()).sports.basketball;

test('held-out label mutation cannot change the exact evaluated/stored artifact',()=>{
  const rows=trainingRows(),a=model(rows),changed=structuredClone(rows);
  for(const row of changed.slice(112))row.actualSide=row.actualSide==='home'?'away':'home';
  const b=model(changed);
  assert.equal(a.sports.basketball.artifactId,b.sports.basketball.artifactId);
  assert.deepEqual(a.sports.basketball.stumps,b.sports.basketball.stumps);
  assert.equal(a.sports.basketball.fitRounds,22);
  assert.ok(a.evaluationRows.length>0);
  assert.equal(selectCandidateCohort(a.evaluationRows).cohort.prospectiveRecordsVerified,false);
  assert.ok(a.evaluationRows.every(row=>row.source==='retrospective-ml-validation'));
});

test('late training labels are purged and outcomes unavailable at the training cutoff are excluded',()=>{
  const rows=trainingRows();rows[111].resolvedAt=rows[113].resolvedAt;
  const trained=model(rows).sports.basketball;
  assert.equal(trained.purgedTrainingRows,1);
  assert.ok(Date.parse(trained.lastTrainingOutcomeAt)<Date.parse(rows[112].predictionGeneratedAt));
  const unavailable=trainLocalMlModels(rows,{now:Date.parse('2080-01-01T00:00:00Z')});
  assert.equal(unavailable.temporalRowsExcluded,160);assert.deepEqual(unavailable.sports,{});
});

test('inference rejects future-trained and altered artifacts',()=>{
  const trained=model(trainingRows()).sports.basketball,evidence={home:.5,away:.5,draw:0};
  const future=predictLocalMlCandidate(trained,{},evidence,{now:trainingNow-1});
  assert.equal(future.available,false);assert.equal(future.reason,'model_not_available_at_forecast_cutoff');
  assert.equal(predictLocalMlCandidate(trained,{},evidence,{now:NaN}).available,false);
  assert.equal(predictLocalMlCandidate(null,{},evidence,{now:NaN}).available,false);
  const altered=structuredClone(trained);altered.stumps[0].left+=.01;
  const invalid=predictLocalMlCandidate(altered,{},evidence,{now:trainingNow});
  assert.equal(invalid.available,false);assert.equal(invalid.reason,'model_artifact_integrity_unverified');
});

async function directory(t){const p=await mkdtemp(join(tmpdir(),'sports-selection-'));t.after(()=>rm(p,{recursive:true,force:true}));return p;}
const registeredAt=Date.parse('2100-12-31T00:00:00Z');
const spec=()=>({id:'fixed-artifact',sport:'basketball',league:'nba',horizon:'T-90',candidate:'ml',
  artifactId:pinnedModel.artifactId,modelVersion:CURRENT_MODEL_VERSION,trainedAt:pinnedModel.trainedAt,
  lastTrainingOutcomeAt:pinnedModel.lastTrainingOutcomeAt,start:'2101-01-01T00:00:00Z',end:'2101-01-15T00:00:00Z'});
function prospectiveRows(){
  const base=Date.parse(spec().start);
  return Array.from({length:75},(_,i)=>{
    const issue=base+(i%14)*86400000+12*3600000;
    const payload={forecastId:`f${i}`,gameId:`g${i}`,guildId:'fixture',league:'nba',horizon:'T-90',
      modelVersion:CURRENT_MODEL_VERSION,lifecycleState:'ISSUED',recordEligibility:'observed_pregame',
      predictionGeneratedAt:iso(issue),startTime:iso(issue+3600000),eventContext:{sport:'basketball'},
      selectedSide:'home',outcomePercentages:{home:55,away:45,draw:0},candidateArtifactIds:{ml:pinnedModel.artifactId},
      candidateProbabilities:{ml:{home:.8,away:.2,draw:0}}};
    return [{type:'forecast',recordedAt:iso(issue),payload},{type:'result',recordedAt:iso(issue+4*3600000),
      payload:{forecastId:payload.forecastId,actualSide:'home',observedAt:iso(issue+4*3600000)}}];
  }).flat();
}

test('plans must be preregistered, immutable, long enough and disjoint',async t=>{
  const dir=await directory(t),options={directory:dir,model:pinnedModel,now:registeredAt};
  await assert.rejects(registerSelectionPlan({...spec(),start:'2100-01-01T00:00:00Z'},options));
  await registerSelectionPlan(spec(),options);
  await assert.rejects(registerSelectionPlan(spec(),options),/immutable/);
  await assert.rejects(registerSelectionPlan({...spec(),id:'another-artifact'},options),/overlap/);
  await assert.rejects(registerSelectionPlan({...spec(),id:'too-small',minimumGames:10},options));
});

test('a prospective fixed-artifact review is finalized once and never promotes automatically',async t=>{
  const dir=await directory(t);await registerSelectionPlan(spec(),{directory:dir,model:pinnedModel,now:registeredAt});
  const early=await finalizeSelectionPlan(spec().id,{directory:dir,records:[],now:Date.parse(spec().start)});
  assert.equal(early.status,'awaiting_predeclared_period_end');
  const records=prospectiveRows(),now=Date.parse('2101-01-16T00:00:00Z');
  const result=await finalizeSelectionPlan(spec().id,{directory:dir,records,now});
  assert.equal(result.status,'review_ready');assert.equal(result.independentDates,14);
  assert.ok(result.candidateImprovement.brier>0);assert.equal(result.promotionAllowed,false);
  assert.equal(result.approvalRequired,true);
  const after=await finalizeSelectionPlan(spec().id,{directory:dir,records:[],now:now+1000});
  assert.equal(after.status,'already_finalized');assert.equal(after.report.reportHash,result.reportHash);
  assert.equal(after.newEvidenceIgnored,true);
});

test('pending outcomes are not consumed as losses, and a changed artifact does not enter the plan',async t=>{
  const dir=await directory(t);await registerSelectionPlan(spec(),{directory:dir,model:pinnedModel,now:registeredAt});
  const records=prospectiveRows().filter(row=>row.type==='forecast');
  const now=Date.parse('2101-01-16T00:00:00Z');
  const pending=await finalizeSelectionPlan(spec().id,{directory:dir,records,now});
  assert.equal(pending.status,'awaiting_outcomes');assert.equal(pending.pendingForecasts,75);
  for(const row of records)row.payload.candidateArtifactIds.ml='b'.repeat(64);
  const none=await finalizeSelectionPlan(spec().id,{directory:dir,records,now});
  assert.equal(none.status,'insufficient_independent_games');
});

test('corrupt state and existing owner locks are preserved rather than overwritten',async t=>{
  const dir=await directory(t),file=join(dir,'selection-state.json');
  await writeFile(file,'corrupt');
  await assert.rejects(registerSelectionPlan(spec(),{directory:dir,model:pinnedModel,now:registeredAt}));
  assert.equal(await readFile(file,'utf8'),'corrupt');
  await writeFile(file+'.lock','active-owner');
  await assert.rejects(registerSelectionPlan(spec(),{directory:dir,model:pinnedModel,now:registeredAt}));
  assert.equal(await readFile(file+'.lock','utf8'),'active-owner');
});


test('a later horizon of an already consumed game cannot support another selection review',async t=>{
  const dir=await directory(t),options={directory:dir,model:pinnedModel,now:registeredAt};
  await registerSelectionPlan(spec(),options);
  await registerSelectionPlan({...spec(),id:'next-period',horizon:'T-10',start:'2101-01-15T00:00:00Z',end:'2101-01-29T00:00:00Z'},options);
  const first=prospectiveRows();
  const shared={...first[0].payload,forecastId:'shared-first',gameId:'shared',
    predictionGeneratedAt:'2101-01-14T23:20:00Z',startTime:'2101-01-15T00:20:00Z'};
  first.push({type:'forecast',recordedAt:shared.predictionGeneratedAt,payload:shared},
    {type:'result',recordedAt:'2101-01-15T02:00:00Z',payload:{forecastId:shared.forecastId,actualSide:'home',observedAt:'2101-01-15T02:00:00Z'}});
  await finalizeSelectionPlan(spec().id,{directory:dir,records:first,now:Date.parse('2101-01-16T00:00:00Z')});
  const later={...shared,forecastId:'shared-later',horizon:'T-10',predictionGeneratedAt:'2101-01-15T00:10:00Z'};
  const records=[{type:'forecast',recordedAt:later.predictionGeneratedAt,payload:later},
    {type:'result',recordedAt:'2101-01-15T02:00:00Z',payload:{forecastId:later.forecastId,actualSide:'home',observedAt:'2101-01-15T02:00:00Z'}}];
  const review=await finalizeSelectionPlan('next-period',{directory:dir,records,now:Date.parse('2101-01-30T00:00:00Z')});
  assert.equal(review.status,'blocked_reused_games');assert.equal(review.promotionAllowed,false);
});

test('pinned model bytes and the complete selection ledger detect changes',async t=>{
  const dir=await directory(t),plan=await registerSelectionPlan(spec(),{directory:dir,model:pinnedModel,now:registeredAt});
  const pinned=join(dir,plan.artifactFile),modelBytes=await readFile(pinned,'utf8');
  assert.equal(JSON.parse(modelBytes).artifactId,pinnedModel.artifactId);
  await writeFile(pinned,modelBytes+' ');
  await assert.rejects(finalizeSelectionPlan(plan.id,{directory:dir,records:[],now:Date.parse('2101-01-16T00:00:00Z')}),/Pinned artifact changed/);
  await writeFile(pinned,modelBytes);
  const stateFile=join(dir,'selection-state.json'),state=JSON.parse(await readFile(stateFile,'utf8'));
  state.consumedGames.push('unrecorded-change');await writeFile(stateFile,JSON.stringify(state));
  await assert.rejects(finalizeSelectionPlan(plan.id,{directory:dir,records:[],now:Date.parse('2101-01-16T00:00:00Z')}),/integrity/);
});

test('the research CLI pins a model and reads an explicit journal without activating or contacting providers',async t=>{
  const dir=await directory(t),rows=trainingRows();
  const shift=Date.parse('2020-01-01T00:00:00Z')-Date.parse('2090-01-01T00:00:00Z');
  for(const row of rows){
    for(const key of ['startTime','predictionGeneratedAt','recordedAt','resolvedAt'])row[key]=iso(Date.parse(row[key])+shift);
    row.dateKey=row.startTime.slice(0,10);
  }
  const store=trainLocalMlModels(rows,{minimum:100,now:Date.parse('2025-01-01T00:00:00Z')});
  const modelFile=join(dir,'model.json'),specFile=join(dir,'plan.json'),journal=join(dir,'journal.jsonl');
  const start=Date.now()+86400000,end=start+15*86400000;
  await writeFile(modelFile,JSON.stringify(store));
  await writeFile(specFile,JSON.stringify({...spec(),id:'cli-smoke',start:iso(start),end:iso(end)}));
  await writeFile(journal,'');
  const script=fileURLToPath(new URL('../scripts/selection-research.js',import.meta.url));
  const run=promisify(execFile);
  const registered=await run(process.execPath,[script,'--action=register',`--directory=${dir}`,`--model-file=${modelFile}`,`--spec=${specFile}`]);
  const result=JSON.parse(registered.stdout);assert.equal(result.status,'research_plan_registered');assert.equal(result.promotionAllowed,false);
  const review=await run(process.execPath,[script,'--action=finalize',`--directory=${dir}`,'--id=cli-smoke',`--journal=${journal}`]);
  assert.equal(JSON.parse(review.stdout).status,'awaiting_predeclared_period_end');
  assert.equal(JSON.parse(await readFile(join(dir,'cli-smoke-model.json'),'utf8')).artifactId,store.sports.basketball.artifactId);
});
