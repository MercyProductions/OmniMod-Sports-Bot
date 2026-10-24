import {readFile,realpath} from 'node:fs/promises';
import {join,resolve,isAbsolute} from 'node:path';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {inspectForwardCollector,collectForwardTrial,forwardWorkerEnvironment} from '../src/forwardTrialCollector.js';
import {supersededSelectionPlans} from '../src/selectionSupersession.js';

const sha=value=>createHash('sha256').update(value).digest('hex');
const digest=value=>sha(JSON.stringify(value));
const epoch=value=>typeof value==='string'&&value.trim()?Date.parse(value):NaN;
const identifier=value=>typeof value==='string'&&/^[a-z0-9-]{1,80}$/i.test(value);
const executeFile=promisify(execFile);

/** Local integrity/ownership checks, not authentication of a provider or statistical validation. */
export async function inspectForwardFamily(directory){
 const current=await inspectForwardCollector(directory),root=current.root;
 const bytes=await readFile(join(root,'family-binding.json'));
 const binding=JSON.parse(bytes),{bindingHash,...body}=binding;
 if(body.schema!=='sports-forward-family-v1'||digest(body)!==bindingHash
  ||current.manifest.files?.['family-binding.json']!==sha(bytes)
  ||!isAbsolute(body.selectionDirectory||'')||!Array.isArray(body.members)||body.members.length<2)
  throw new Error('Forward family binding is unverified');
 const selection=await realpath(body.selectionDirectory);
 if(selection!==resolve(body.selectionDirectory)||await realpath(join(root,'selection'))!==selection)
  throw new Error('Forward family selection directory redirected');
 const ids=new Set(),roots=new Set(),inspections=new Map();let own=false;
 for(const member of body.members){
  if(!identifier(member.planId)||!isAbsolute(member.directory||'')||ids.has(member.planId))
   throw new Error('Invalid forward family member');
  const memberRoot=await realpath(member.directory);
  if(memberRoot!==resolve(member.directory)||roots.has(memberRoot))throw new Error('Forward family member redirected or repeated');
  ids.add(member.planId);roots.add(memberRoot);
  const inspected=memberRoot===root?current:await inspectForwardCollector(memberRoot);
  inspections.set(member.planId,inspected);
  if(await realpath(join(memberRoot,'selection'))!==selection||inspected.plan.id!==member.planId
   ||inspected.plan.planHash!==member.planHash)throw new Error('Forward family member detached from shared selection ledger');
  if(memberRoot===root)own=true;
 }
 if(!own)throw new Error('Current trial missing from forward family');
 const state=JSON.parse(await readFile(join(selection,'selection-state.json'),'utf8'));
 const {stateHash,...stateBody}=state;
 if(state.schema!=='sports-selection-state-v1'||digest(stateBody)!==stateHash
  ||!state.plans||!state.reports||!Array.isArray(state.consumedGames))throw new Error('Forward family state integrity failed');
 const plans=Object.entries(state.plans);
 const retired=supersededSelectionPlans(state);
 for(const id of retired){
  const member=inspections.get(id);
  if(member&&(member.evidence.receipts.length||member.evidence.providerBlobs||member.evidence.journalBytes))
   throw Error('Superseded collector contains later evidence; preserve it for review');
 }
 for(const [id,plan] of plans){
  const {planHash,...planBody}=plan||{};
  const start=epoch(plan?.start),end=epoch(plan?.end),registered=epoch(plan?.registeredAt);
  if(!identifier(id)||plan.schema!=='sports-selection-plan-v1'||plan.id!==id||digest(planBody)!==planHash
   ||!identifier(plan.league)||!['hybrid','ml'].includes(plan.candidate)
   ||!['Daily','T-90','T-30','T-10'].includes(plan.horizon)
   ||plan.artifactFile!==id+'-model.json'||!Number.isInteger(plan.minimumGames)||plan.minimumGames<75
   ||!Number.isInteger(plan.minimumDates)||plan.minimumDates<8
   ||![start,end,registered].every(Number.isFinite)||registered>=start||end-start<14*86400000
   ||sha(await readFile(join(selection,plan.artifactFile)))!==plan.artifactFileHash)
   throw new Error('Forward family plan or artifact integrity failed');
 }
 for(let i=0;i<plans.length;i++)for(let j=i+1;j<plans.length;j++){
  const a=plans[i][1],b=plans[j][1];
  if(!retired.has(a.id)&&!retired.has(b.id)&&a.league===b.league&&epoch(a.start)<epoch(b.end)&&epoch(b.start)<epoch(a.end))
   throw new Error('Forward family selection windows overlap');
 }
 const consumed=[];
 for(const [id,report] of Object.entries(state.reports)){
  const {reportHash,...reportBody}=report||{},plan=state.plans[id];
  if(!plan||report.schema!=='sports-selection-review-v2'||report.planId!==id||report.planHash!==plan.planHash
   ||report.artifactId!==plan.artifactId||digest(reportBody)!==reportHash
   ||report.promotionAllowed!==false||report.approvalRequired!==true||!Array.isArray(report.consumedGameKeys))
   throw new Error('Forward family report integrity failed');
  for(const key of report.consumedGameKeys){
   let parsed;try{parsed=JSON.parse(key);}catch{throw new Error('Forward family game identity unverified');}
   if(!Array.isArray(parsed)||parsed.length!==3||parsed[0]!==plan.league||!parsed[1]||!Number.isFinite(epoch(parsed[2])))
    throw new Error('Forward family game identity unverified');
   consumed.push(key);
  }
 }
 if(new Set(consumed).size!==consumed.length||new Set(state.consumedGames).size!==state.consumedGames.length
  ||digest([...consumed].sort())!==digest([...state.consumedGames].sort()))
  throw new Error('Forward family games reused or consumption ledger incomplete');
 return {...current,family:{bindingHash,members:body.members.length,plans:plans.length,
  supersededPlans:retired.size,activePlans:plans.length-retired.size,currentPlanSuperseded:retired.has(current.plan.id),
  finalizedReports:Object.keys(state.reports).length,consumedGames:consumed.length}};
}

/** Uses the existing collector lock/window rules, then rechecks the family immediately before the worker. */
export async function collectForwardFamily(directory,{now=Date.now(),execute}={}){
 if(!Number.isFinite(now))throw new Error('Valid forward family clock required');
 const inspected=await inspectForwardFamily(directory);
 if(inspected.family.currentPlanSuperseded)return {status:'superseded_before_trial_start',providerRequests:0,liveOrders:false,discordPosts:0};
 return collectForwardTrial(directory,{now,execute:async root=>{
  await inspectForwardFamily(root);
  if(execute)return execute(root);
  const response=await executeFile(process.execPath,[join(root,'collector','worker.mjs'),root],{
   cwd:root,env:forwardWorkerEnvironment(root),windowsHide:true,timeout:240000,maxBuffer:1000000});
  return JSON.parse(response.stdout.trim().split('\n').at(-1));
 }});
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const directory=process.argv.slice(2).find(value=>value.startsWith('--directory='))?.slice(12);
 try{
  if(!directory)throw new Error('Explicit private family trial directory required');
  const result=process.argv.includes('--inspect-only')
   ? await inspectForwardFamily(directory).then(value=>({status:'forward_family_verified',...value.family,providerRequests:0,liveOrders:false,discordPosts:0}))
   : await collectForwardFamily(directory);
  console.log(JSON.stringify(result));
 }catch{
  console.error('Forward family verification failed. Preserve private source, bindings, selection state and owner evidence; no trading or Discord is enabled.');
  process.exitCode=1;
 }
}
