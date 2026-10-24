import {quoteTimeEpoch} from './oddsPricing.js';
import {withAuditFileLock} from './auditFileLock.js';
import {journalResultState} from './journalResults.js';
import {hybridArtifact} from './hybridArtifact.js';
import {createHash} from 'node:crypto';
import {mkdir,open,readFile,rename} from 'node:fs/promises';
import {join} from 'node:path';
import {evaluateMatchedJournal} from './matchedJournalEvaluation.js';
import {localMlArtifactId} from './localMl.js';

const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const epoch=quoteTimeEpoch;
const gameKey=row=>JSON.stringify([row.league,row.gameId,Number.isFinite(epoch(row.startTime))?new Date(row.startTime).toISOString():String(row.startTime)]);
const verifiedReviews=new WeakMap();
const parseEvidence=value=>{try{return JSON.parse(value);}catch{throw new Error('Selection evidence JSON is malformed; preserve it for review');}};
const identifier=value=>typeof value==='string'&&/^[a-z0-9-]{1,80}$/i.test(value);

async function transaction(directory,action){
  if(!directory)throw new Error('Explicit isolated selection-research directory required');
  await mkdir(directory,{recursive:true,mode:0o700});
  const file=join(directory,'selection-state.json');
  return withAuditFileLock(file,async()=>{
    let state,created=false;
    try{state=JSON.parse(await readFile(file,'utf8'));}
    catch(error){if(error.code!=='ENOENT')throw error;created=true;state={schema:'sports-selection-state-v1',plans:{},reports:{},consumedGames:[]};}
    if(state.schema!=='sports-selection-state-v1'||!Array.isArray(state.consumedGames)||!state.plans||!state.reports)
      throw new Error('Invalid selection state; preserve it for investigation');
    if(!created){const {stateHash,...body}=state;if(stateHash!==hash(body))throw new Error('Selection state integrity failed; preserve existing records');}
    const result=await action(state);
    delete state.stateHash;state.stateHash=hash(state);
    const temp=file+'.pending';let handle;
    try{
      handle=await open(temp,'wx',0o600);await handle.writeFile(JSON.stringify(state,null,2)+'\n');await handle.sync();
      await handle.close();handle=null;await rename(temp,file);
    }catch(error){if(handle)await handle.close();throw error;}
    return result;
  });
}


function validatePlan(plan,id){
 if(!plan||plan.schema!=='sports-selection-plan-v1'||plan.id!==id||!identifier(id)
  ||!['ml','hybrid'].includes(plan.candidate)||plan.artifactFile!==id+'-model.json'
  ||!Number.isInteger(plan.minimumGames)||plan.minimumGames<75
  ||!Number.isInteger(plan.minimumDates)||plan.minimumDates<8)
  throw new Error('Invalid selection plan contract');
  const {planHash,...planBody}=plan;
  if(planHash!==hash(planBody))throw new Error('Selection plan integrity failed; preserve existing records');
  const registered=epoch(plan.registeredAt),start=epoch(plan.start),end=epoch(plan.end);
  const artifactReady=plan.candidate==='ml'
    ? [epoch(plan.lastTrainingOutcomeAt),epoch(plan.trainedAt)]
    : [epoch(plan.recipeFrozenAt),epoch(plan.recipeFrozenAt)];
  if(![registered,start,end,...artifactReady].every(Number.isFinite)||registered>=start
    ||end-start<14*86400000||artifactReady[0]>artifactReady[1]||artifactReady[1]>registered)
    throw new Error('Selection plan chronology is unverified; preserve existing records');

}

/** Predeclare one exact ML fit or fixed hybrid recipe before a disjoint prospective period. */
export async function registerSelectionPlan(spec,{directory,model,now=Date.now()}={}){
  if(!Number.isFinite(now)||!identifier(spec?.id)||!identifier(spec?.sport)||!identifier(spec?.league)
    ||!['Daily','T-90','T-30','T-10'].includes(spec?.horizon)||!['ml','hybrid'].includes(spec?.candidate)
    ||!/^\w[\w .-]{1,150}$/.test(spec?.modelVersion||'')||!/^[a-f0-9]{64}$/.test(spec?.artifactId||''))
    throw new Error('Invalid fixed model/league/horizon selection plan');
  const isMl=spec.candidate==='ml';
  if(isMl){
    if(!model || model.artifactFormat!=='sports-local-ml-artifact-v2' || model.artifactId!==localMlArtifactId(model)
      ||model.artifactId!==spec.artifactId||model.trainedAt!==spec.trainedAt||model.lastTrainingOutcomeAt!==spec.lastTrainingOutcomeAt)
      throw new Error('Exact verified research artifact required for preregistration');
  }else{
    const expected=hybridArtifact(spec.sport,model?.specialistWeight);
    if(!expected||JSON.stringify(model)!==JSON.stringify(expected)||model.artifactId!==spec.artifactId||spec.modelVersion!==expected.modelVersion)
      throw new Error('Exact current hybrid source recipe required for preregistration');
    if(spec.trainedAt||spec.lastTrainingOutcomeAt)throw new Error('Fixed hybrid recipes do not have fitted training timestamps');
  }
  const artifactBytes=JSON.stringify(model)+'\n';
  const start=epoch(spec.start),end=epoch(spec.end),trained=epoch(spec.trainedAt),labels=epoch(spec.lastTrainingOutcomeAt);
  if(![start,end].every(Number.isFinite)||now>=start||end-start<14*86400000
    ||isMl&&(![trained,labels].every(Number.isFinite)||labels>trained||trained>now))
    throw new Error('Declare after training or recipe freeze but before an evaluation period of at least 14 days');
  const minimumDates=spec.minimumDates??8;
  if(!Number.isInteger(minimumDates)||minimumDates<8||minimumDates>10000)throw new Error('At least 8 independent dates required');
  const minimum=spec.minimumGames??75;
  if(!Number.isInteger(minimum)||minimum<75||minimum>100000)throw new Error('At least 75 independent games required');
  const plan={schema:'sports-selection-plan-v1',id:spec.id,sport:spec.sport,league:spec.league,horizon:spec.horizon,
    candidate:spec.candidate,artifactId:spec.artifactId,modelVersion:spec.modelVersion,
    ...(isMl?{trainedAt:spec.trainedAt,lastTrainingOutcomeAt:spec.lastTrainingOutcomeAt}
      :{recipeFrozenAt:new Date(now).toISOString(),specialistWeight:model.specialistWeight}),start:new Date(start).toISOString(),end:new Date(end).toISOString(),
    registeredAt:new Date(now).toISOString(),minimumGames:minimum,minimumDates,
    decisionRule:'fixed artifact; matched game-cluster Brier difference lower bound > 0 and mean > .0025; log-loss lower bound >= -.003; no automatic promotion'};
  plan.artifactFile=plan.id+'-model.json';
  plan.artifactFileHash=createHash('sha256').update(artifactBytes).digest('hex');
  plan.planHash=hash(plan);
  return transaction(directory,async state=>{
    if(Object.hasOwn(state.plans,plan.id))throw new Error('Plan IDs are immutable and cannot be redeclared');
    if(Object.values(state.plans).some(old=>old.league===plan.league&&start<epoch(old.end)&&end>epoch(old.start)))
      throw new Error('League evaluation periods cannot overlap across model/horizon experiments');
    const file=join(directory,plan.artifactFile);
    let handle;
    try{handle=await open(file,'wx',0o600);await handle.writeFile(artifactBytes);await handle.sync();}
    catch(error){if(error.code!=='EEXIST'||createHash('sha256').update(await readFile(file)).digest('hex')!==plan.artifactFileHash)throw error;}
    finally{if(handle)await handle.close();}
    state.plans[plan.id]=plan;return plan;
  });
}

/** Finalized outcomes are consumed once; research review readiness never activates a model. */
export async function finalizeSelectionPlan(id,{directory,records,now=Date.now()}={}){
  if(!identifier(id)||!Number.isFinite(now)||!Array.isArray(records))throw new Error('Invalid selection review request');
  return transaction(directory,async state=>{
    const plan=state.plans[id];if(!plan)throw new Error('Selection plan not found');
    validatePlan(plan,id);
    if(createHash('sha256').update(await readFile(join(directory,plan.artifactFile))).digest('hex')!==plan.artifactFileHash)
      throw new Error('Pinned artifact changed; preserve existing evidence');
    if(Object.hasOwn(state.reports,id))return {status:'already_finalized',report:state.reports[id],newEvidenceIgnored:true};
    if(now<epoch(plan.end))return {status:'awaiting_predeclared_period_end',promotionAllowed:false};
    const forecasts=records.filter(event=>event.type==='forecast'&&event.payload.lifecycleState==='ISSUED'
      &&event.payload.modelVersion===plan.modelVersion&&event.payload.league===plan.league&&event.payload.horizon===plan.horizon
      &&event.payload.eventContext?.sport===plan.sport&&event.payload.candidateArtifactIds?.[plan.candidate]===plan.artifactId
      &&epoch(event.recordedAt)>=epoch(plan.start)&&epoch(event.recordedAt)<epoch(plan.end));
    const ids=new Set(forecasts.map(event=>event.payload.forecastId));
    const visible=records.filter(event=>epoch(event.recordedAt)<=now);
    const outcomes=new Map([...journalResultState(visible).eligible].filter(([id])=>ids.has(id)));
    if(forecasts.some(event=>!outcomes.has(event.payload.forecastId)))return {status:'awaiting_outcomes',pendingForecasts:forecasts.filter(event=>!outcomes.has(event.payload.forecastId)).length,promotionAllowed:false};
    const used=new Set(state.consumedGames),overlap=forecasts.some(event=>used.has(gameKey(event.payload)));
    const subset=visible.filter(event=>ids.has(event.payload.forecastId));
    const evaluation=evaluateMatchedJournal(subset,{asOf:now});
    const comparison=evaluation.byVersion[plan.modelVersion]?.[plan.candidate];
    const interval=comparison?.pairedGameBootstrap95;
    const independentDates=comparison?.distinctEventDates||0;
    const candidateImprovement={brier:comparison?.differences.brierImprovement==null?null:-comparison.differences.brierImprovement,
      brier95:interval?.brierImprovement?[-interval.brierImprovement[1],-interval.brierImprovement[0]]:null,
      logLoss95:interval?.logLossImprovement?[-interval.logLossImprovement[1],-interval.logLossImprovement[0]]:null};
    const sufficient=(comparison?.primary.games||0)>=plan.minimumGames&&independentDates>=plan.minimumDates;
    const better=sufficient&&candidateImprovement.brier95?.[0]>0
      &&candidateImprovement.brier>.0025&&candidateImprovement.logLoss95?.[0]>=-.003;
    const report={schema:'sports-selection-review-v2',planId:id,planHash:plan.planHash,artifactId:plan.artifactId,
      modelVersion:plan.modelVersion,candidate:plan.candidate,sport:plan.sport,league:plan.league,horizon:plan.horizon,finalizedAt:new Date(now).toISOString(),inputHash:hash(subset),
      status:overlap?'blocked_reused_games':!sufficient?'insufficient_independent_games':better?'review_ready':'challenger_not_supported',
      evaluation,independentDates,candidateImprovement,consumedGameKeys:[...new Set(forecasts.map(event=>gameKey(event.payload)))].sort(),promotionAllowed:false,approvalRequired:true,
      limitations:['Preregistered research review, not an activation instruction.',
        'Day/team dependence, league calibration and later result corrections still require review.']};
    report.reportHash=hash(report);
    state.reports[id]=report;
    state.consumedGames=[...new Set([...used,...forecasts.map(event=>gameKey(event.payload))])].sort();
    return report;
  });
}


/** Verify local evidence, not source truth or reviewer identity. Never writes or activates. */
export function verifySelectionReviewEvidence({state,artifactBytes,records,review,now=Date.now()}={}){
 if(!Number.isFinite(now)||!Number.isFinite(new Date(now).getTime())||!Array.isArray(records)||!review)throw new Error('Invalid selection evidence request');
 const {stateHash,...stateBody}=state||{};
 if(state?.schema!=='sports-selection-state-v1'||stateHash!==hash(stateBody))throw new Error('Selection state integrity failed');
 const {reportHash,...reportBody}=review;
 if(review.schema!=='sports-selection-review-v2'||reportHash!==hash(reportBody)
  ||review.status!=='review_ready'||review.promotionAllowed!==false||review.approvalRequired!==true||hash(state.reports?.[review.planId])!==hash(review))throw new Error('Selection review integrity or readiness unverified');
 const plan=state.plans?.[review.planId];validatePlan(plan,review.planId);
 if(review.planHash!==plan.planHash||['artifactId','modelVersion','candidate','sport','league','horizon'].some(key=>review[key]!==plan[key]))
  throw new Error('Selection review plan binding failed');
 const finalized=epoch(review.finalizedAt);
 if(!Number.isFinite(finalized)||finalized<epoch(plan.end)||finalized>now)throw new Error('Selection review availability unverified');
 if(typeof artifactBytes!=='string'||createHash('sha256').update(artifactBytes).digest('hex')!==plan.artifactFileHash)
  throw new Error('Pinned selection artifact changed');
 const artifact=parseEvidence(artifactBytes);
 if(plan.candidate==='ml'){
  if(artifact.artifactFormat!=='sports-local-ml-artifact-v2'||artifact.artifactId!==localMlArtifactId(artifact)
   ||artifact.artifactId!==plan.artifactId||artifact.trainedAt!==plan.trainedAt||artifact.lastTrainingOutcomeAt!==plan.lastTrainingOutcomeAt)
   throw new Error('Selection ML artifact binding failed');
 }else if(JSON.stringify(artifact)!==JSON.stringify(hybridArtifact(plan.sport,plan.specialistWeight))||artifact.artifactId!==plan.artifactId)
  throw new Error('Selection hybrid source binding failed');
 const forecasts=records.filter(event=>event.type==='forecast'&&event.payload?.lifecycleState==='ISSUED'
  &&event.payload.modelVersion===plan.modelVersion&&event.payload.league===plan.league&&event.payload.horizon===plan.horizon
  &&event.payload.eventContext?.sport===plan.sport&&event.payload.candidateArtifactIds?.[plan.candidate]===plan.artifactId
  &&epoch(event.recordedAt)>=epoch(plan.start)&&epoch(event.recordedAt)<epoch(plan.end));
 const ids=new Set(forecasts.map(event=>event.payload.forecastId));
 const subset=records.filter(event=>ids.has(event.payload?.forecastId)&&epoch(event.recordedAt)<=finalized);
 if(records.some(event=>ids.has(event.payload?.forecastId)&&!Number.isFinite(epoch(event.recordedAt))))throw new Error('Selection input receipt unverified');
 if(hash(subset)!==review.inputHash)throw new Error('Selection input binding failed');
 // Later revisions/conflicts are new evidence, never silently reuse the old review.
 if(records.some(event=>ids.has(event.payload?.forecastId)&&['forecast','result','result_conflict'].includes(event.type)
  &&epoch(event.recordedAt)>finalized&&epoch(event.recordedAt)<=now))throw new Error('Selection evidence changed after review');
 const outcomes=journalResultState(subset).eligible;
 if(forecasts.some(event=>!outcomes.has(event.payload.forecastId)))throw new Error('Selection outcomes incomplete');
 const keys=[...new Set(forecasts.map(event=>gameKey(event.payload)))].sort();
 if(hash(keys)!==hash(review.consumedGameKeys)||!Array.isArray(state.consumedGames))throw new Error('Selection game consumption binding failed');
 const all=[];
 for(const report of Object.values(state.reports||{})){
  const {reportHash:storedHash,...body}=report;
  if(report.schema!=='sports-selection-review-v2'||storedHash!==hash(body)||!Array.isArray(report.consumedGameKeys))throw new Error('Selection report ledger unverified');
  all.push(...report.consumedGameKeys);
 }
 if(new Set(all).size!==all.length||hash([...new Set(all)].sort())!==hash([...state.consumedGames].sort()))throw new Error('Selection games reused or ledger incomplete');
 const evaluation=evaluateMatchedJournal(subset,{asOf:finalized});
 if(hash(evaluation)!==hash(review.evaluation))throw new Error('Selection measurements cannot be reproduced');
 const comparison=evaluation.byVersion[plan.modelVersion]?.[plan.candidate],interval=comparison?.pairedGameBootstrap95;
 const improvement={brier:comparison?.differences.brierImprovement==null?null:-comparison.differences.brierImprovement,
  brier95:interval?.brierImprovement?[-interval.brierImprovement[1],-interval.brierImprovement[0]]:null,
  logLoss95:interval?.logLossImprovement?[-interval.logLossImprovement[1],-interval.logLossImprovement[0]]:null};
 if(hash(improvement)!==hash(review.candidateImprovement)||review.independentDates!==comparison?.distinctEventDates
  ||!(comparison?.primary.games>=plan.minimumGames&&comparison.distinctEventDates>=plan.minimumDates
   &&improvement.brier95?.[0]>0&&improvement.brier>.0025&&improvement.logLoss95?.[0]>=-.003))
  throw new Error('Selection decision rule not supported');
 const verified=structuredClone(review);verifiedReviews.set(verified,{hash:hash(verified),verifiedAt:now});return verified;
}

/** Nonserializable verification proof: JSON flags or hash-shaped strings cannot grant approval. */
export function selectionReviewVerified(review,cutoff=Date.now()){
 const proof=review&&verifiedReviews.get(review);
 return Boolean(proof&&Number.isFinite(cutoff)&&proof.verifiedAt<=cutoff&&proof.hash===hash(review));
}

export async function readVerifiedSelectionReview(review,{directory,records,now=Date.now()}={}){
 if(!directory||!identifier(review?.planId))throw new Error('Explicit selection evidence directory and valid plan required');
 const state=parseEvidence(await readFile(join(directory,'selection-state.json'),'utf8'));
 const plan=state.plans?.[review.planId];validatePlan(plan,review.planId);
 const artifactBytes=await readFile(join(directory,plan.artifactFile),'utf8');
 return verifySelectionReviewEvidence({state,artifactBytes,records,review,now});
}
