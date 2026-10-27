import {createHash} from 'node:crypto';
import {readFile,readdir,lstat,realpath} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {quoteTimeEpoch as epoch} from './oddsPricing.js';
import {withAuditFileLock} from './auditFileLock.js';
import {inspectForwardCollector} from './forwardTrialCollector.js';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const digest=value=>sha(JSON.stringify(value));
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const validPinnedPlan=(plan,id)=>{
 if(!plan||plan.id!==id||plan.schema!=='sports-selection-plan-v1'||!hash(plan.planHash)
  ||!Number.isInteger(plan.minimumGames)||plan.minimumGames<75||!Number.isInteger(plan.minimumDates)||plan.minimumDates<8)return false;
 const {planHash,...body}=plan;
 return digest(body)===planHash&&[plan.registeredAt,plan.start,plan.end].every(value=>Number.isFinite(epoch(value)))
  &&epoch(plan.registeredAt)<epoch(plan.start)&&epoch(plan.end)-epoch(plan.start)>=14*86400000;
};
const priorConsumptionSnapshot=(keys,plan)=>{
 if(!Array.isArray(keys)||new Set(keys).size!==keys.length)throw Error('Selection consumption identity unverified');
 for(const key of keys){
  let event;try{event=JSON.parse(key);}catch{throw Error('Selection consumption identity unverified');}
  if(!Array.isArray(event)||event.length!==3||!Number.isFinite(epoch(event[2])))throw Error('Selection consumption identity unverified');
  if(event[0]===plan.league&&epoch(event[2])>=epoch(plan.start)&&epoch(event[2])<epoch(plan.end))
   throw Error('Superseded selection period already contains consumed games');
 }
 return [...keys].sort();
};

/** Immutable plans remain in the ledger; only verified pre-start successors are active. */
export function supersededSelectionPlans(state){
 const records=state?.supersessions??[];
 if(!Array.isArray(records))throw Error('Invalid selection supersession ledger');
 const retired=new Set(),successors=new Set();let last=-Infinity;
 for(const record of records){
  const {recordHash,...body}=record||{},old=state.plans?.[record?.priorPlanId],next=state.plans?.[record?.replacementPlanId];
  const at=epoch(record?.recordedAt),proof=record?.emptyCollectorProof;
  if(record?.schema!=='sports-selection-supersession-v1'||recordHash!==digest(body)||!validPinnedPlan(old,record?.priorPlanId)||!validPinnedPlan(next,record?.replacementPlanId)||old.id===next.id
   ||retired.has(old.id)||successors.has(next.id)||!Number.isFinite(at)||at<last
   ||at<=epoch(old.registeredAt)||at>=epoch(old.start)||epoch(next.registeredAt)!==at
   ||record.priorPlanHash!==old.planHash||record.replacementPlanHash!==next.planHash
   ||old.artifactId===next.artifactId||record.reason!=='pretrial_source_integrity_repair'
   ||['sport','league','horizon','candidate','decisionRule'].some(key=>old[key]!==next[key])
   ||epoch(old.start)!==epoch(next.start)||epoch(old.end)!==epoch(next.end)
   ||next.minimumGames<old.minimumGames||next.minimumDates<old.minimumDates
   ||next.candidate!=='hybrid'||old.specialistWeight!==next.specialistWeight||state.reports?.[old.id]
   ||proof?.schema!=='sports-empty-collector-proof-v1'||proof.planId!==old.id||proof.planHash!==old.planHash
   ||proof.inspectedAt!==record.recordedAt||!hash(proof.collectorManifestSHA256)||!hash(proof.sourceArchiveSHA256)||!hash(proof.emptyInventoryHash)
   ||proof.captureReceipts!==0||proof.providerBlobs!==0||proof.journalBytes!==0||proof.runtimeDataFiles!==0)
   throw Error('Selection supersession proof unverified');
  const consumed=priorConsumptionSnapshot(record.consumedGameKeysAtTransition,old);
  if(consumed.some(key=>!state.consumedGames?.includes(key)))throw Error('Pretrial consumption snapshot was removed');
  retired.add(old.id);successors.add(next.id);last=at;
 }
 const active=Object.values(state?.plans||{}).filter(plan=>!retired.has(plan.id));
 for(let i=0;i<active.length;i++)for(let j=i+1;j<active.length;j++){
  const a=active[i],b=active[j];
  if(a.league===b.league&&epoch(a.start)<epoch(b.end)&&epoch(b.start)<epoch(a.end))
   throw Error('Active league evaluation windows overlap');
 }
 return retired;
}

async function emptyTree(root,directory,inventory,depth=0){
 if(depth>12||inventory.length>10000)throw Error('Unstarted collector inventory exceeds bound');
 let names;try{names=await readdir(directory);}catch(error){if(error.code==='ENOENT')return;throw error;}
 for(const name of names.sort()){
  const file=join(directory,name),info=await lstat(file);
  if(info.isSymbolicLink()||await realpath(file)!==resolve(file))throw Error('Unstarted collector evidence redirected');
  if(info.isDirectory()){inventory.push({path:file.slice(root.length+1),directory:true});await emptyTree(root,file,inventory,depth+1);}
  else{
   if(!info.isFile()||info.size!==0||/\.lock$|\.pending$/i.test(name))throw Error('Collector already contains data or an owner claim');
   inventory.push({path:file.slice(root.length+1),bytes:0});
  }
 }
}

/** Hold the same owner lock as collection; never reclaim a lock or infer emptiness from a checkpoint flag. */
export async function withUnstartedForwardCollector(directory,selectionDirectory,now,operation){
 if(!Number.isFinite(now)||typeof operation!=='function')throw Error('Invalid pretrial collector inspection');
 const root=await realpath(directory),selection=await realpath(selectionDirectory);
 if(root!==resolve(directory)||selection!==resolve(selectionDirectory)||await realpath(join(root,'selection'))!==selection)
  throw Error('Pretrial selection directory binding unverified');
 return withAuditFileLock(join(root,'collector'),async()=>{
  const inspect=async()=>{
   const current=await inspectForwardCollector(root),plan=current.plan;
   if(now<=epoch(plan.registeredAt)||now>=epoch(plan.start)||Date.now()>=epoch(plan.start))throw Error('Only an unstarted collector can be superseded');
   if(current.evidence.receipts.length||current.evidence.providerBlobs||current.evidence.journalBytes)
    throw Error('Collector already has captured observations');
   const checkpoint=current.checkpoint;
   if(checkpoint.firstActualRun||checkpoint.latestActualRun
    ||['currentObservedGames','resolvedForecasts','totalProviderRequests','providerRequests'].some(key=>checkpoint[key]!==undefined&&checkpoint[key]!==0))
    throw Error('Collector checkpoint records prior activity');
   for(const name of ['run.lock','capture-ledger.jsonl.lock']){
    try{await lstat(join(root,name));throw Error('Collector evidence owner is present');}catch(error){if(error.code!=='ENOENT')throw error;}
   }
   const inventory=[];
   for(const name of ['runtime','captures','evidence-blobs'])await emptyTree(root,join(root,name),inventory);
   const proof={schema:'sports-empty-collector-proof-v1',planId:plan.id,planHash:plan.planHash,inspectedAt:new Date(now).toISOString(),
    collectorManifestSHA256:sha(await readFile(join(root,'collector-manifest.json'))),sourceArchiveSHA256:current.checkpoint.sourceArchiveSHA256,
    emptyInventoryHash:digest(inventory),captureReceipts:0,providerBlobs:0,journalBytes:0,runtimeDataFiles:0};
   return {current,proof};
  };
  const first=await inspect();
  return operation({...first,recheck:async()=>{
   const latest=await inspect();
   if(digest(latest.proof)!==digest(first.proof))throw Error('Collector evidence changed during pretrial transition');
  }});
 });
}

export function selectionSupersessionRecord(prior,replacement,proof,now,consumedGames=[]){
 const record={schema:'sports-selection-supersession-v1',priorPlanId:prior.id,replacementPlanId:replacement.id,
  priorPlanHash:prior.planHash,replacementPlanHash:replacement.planHash,recordedAt:new Date(now).toISOString(),
  reason:'pretrial_source_integrity_repair',emptyCollectorProof:proof,consumedGameKeysAtTransition:priorConsumptionSnapshot(consumedGames,prior)};
 return {...record,recordHash:digest(record)};
}
