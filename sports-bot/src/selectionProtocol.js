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
    const {planHash,...planBody}=plan;
    if(planHash!==hash(planBody))throw new Error('Selection plan integrity failed; preserve existing records');
    const registered=epoch(plan.registeredAt),start=epoch(plan.start),end=epoch(plan.end);
    const artifactReady=plan.candidate==='ml'
      ? [epoch(plan.lastTrainingOutcomeAt),epoch(plan.trainedAt)]
      : [epoch(plan.recipeFrozenAt),epoch(plan.recipeFrozenAt)];
    if(![registered,start,end,...artifactReady].every(Number.isFinite)||registered>=start
      ||end-start<14*86400000||artifactReady[0]>artifactReady[1]||artifactReady[1]>registered)
      throw new Error('Selection plan chronology is unverified; preserve existing records');

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
    const report={schema:'sports-selection-review-v1',planId:id,planHash:plan.planHash,artifactId:plan.artifactId,
      modelVersion:plan.modelVersion,candidate:plan.candidate,sport:plan.sport,league:plan.league,horizon:plan.horizon,finalizedAt:new Date(now).toISOString(),inputHash:hash(subset),
      status:overlap?'blocked_reused_games':!sufficient?'insufficient_independent_games':better?'review_ready':'challenger_not_supported',
      evaluation,independentDates,candidateImprovement,promotionAllowed:false,approvalRequired:true,
      limitations:['Preregistered research review, not an activation instruction.',
        'Day/team dependence, league calibration and later result corrections still require review.']};
    report.reportHash=hash(report);
    state.reports[id]=report;
    state.consumedGames=[...new Set([...used,...forecasts.map(event=>gameKey(event.payload))])].sort();
    return report;
  });
}
