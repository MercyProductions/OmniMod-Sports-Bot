import {mkdtemp,mkdir,readFile,writeFile,rm,symlink,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {hybridArtifact} from '../src/hybridArtifact.js';
import {CURRENT_MODEL_VERSION} from '../src/modelIdentity.js';

export const sha=value=>createHash('sha256').update(value).digest('hex');
export const digest=value=>sha(JSON.stringify(value));
export const now=Date.parse('2100-12-20T00:00:00Z');
const rule='fixed artifact; matched game-cluster Brier difference lower bound > 0 and mean > .0025; log-loss lower bound >= -.003; no automatic promotion';
export async function saveState(f,mutate){const state=JSON.parse(await readFile(join(f.selection,'selection-state.json'),'utf8'));mutate(state);delete state.stateHash;state.stateHash=digest(state);await writeFile(join(f.selection,'selection-state.json'),JSON.stringify(state,null,2)+'\n');}
export async function pinBinding(root,selection,members){
 const binding={schema:'sports-forward-family-v1',selectionDirectory:selection,members};binding.bindingHash=digest(binding);
 const bytes=JSON.stringify(binding)+'\n';await writeFile(join(root,'family-binding.json'),bytes);
 const file=join(root,'collector-manifest.json'),manifest=JSON.parse(await readFile(file,'utf8'));manifest.files['family-binding.json']=sha(bytes);delete manifest.manifestHash;manifest.manifestHash=digest(manifest);await writeFile(file,JSON.stringify(manifest));
}
export async function install(root,selection,plan,number){
 await mkdir(root,{recursive:true});if(join(root,'selection')!==selection)await symlink(selection,join(root,'selection'),'junction');
 await mkdir(join(root,'frozen','sports-bot','node_modules'),{recursive:true});await writeFile(join(root,'empty.env'),'');
 const archive='fixture-archive-'+number;await writeFile(join(root,'source.zip'),archive);
 const checkpoint={planId:plan.id,planHash:plan.planHash,artifactId:plan.artifactId,modelVersion:plan.modelVersion,sourceCommit:String(number).repeat(40),sourceArchive:'source.zip',sourceArchiveSHA256:sha(archive)};
 await writeFile(join(root,'CHECKPOINT.json'),JSON.stringify(checkpoint));
 const manifest={schema:'sports-forward-collector-v1',planId:plan.id,planHash:plan.planHash,artifactId:plan.artifactId,sourceCommit:checkpoint.sourceCommit,files:{'empty.env':sha('')},dependencyDirectory:await realpath(join(root,'frozen','sports-bot','node_modules'))};manifest.manifestHash=digest(manifest);await writeFile(join(root,'collector-manifest.json'),JSON.stringify(manifest));
 return {directory:await realpath(root),planId:plan.id,planHash:plan.planHash};
}
export async function fixture(t){
 const root=await mkdtemp(join(tmpdir(),'sports-pretrial-supersession-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const prior=join(root,'prior'),baseline=join(root,'baseline'),selection=join(prior,'selection');await mkdir(selection,{recursive:true});
 const state={schema:'sports-selection-state-v1',plans:{},reports:{},consumedGames:[]},members=[];
 for(const [i,directory] of [baseline,prior].entries()){
  const id=i?'prior':'baseline',start=i?'2101-01-01T00:00:00Z':'2100-12-01T00:00:00Z',end=i?'2101-01-15T00:00:00Z':'2100-12-15T00:00:00Z',artifact=JSON.stringify({fixture:true,id})+'\n';
  const plan={schema:'sports-selection-plan-v1',id,sport:'hockey',league:'nhl',horizon:'Daily',candidate:'hybrid',artifactId:String(i+1).repeat(64),modelVersion:'fixture-'+id,recipeFrozenAt:'2020-01-01T00:00:00Z',specialistWeight:.38,start,end,registeredAt:'2020-01-01T00:00:00Z',minimumGames:75,minimumDates:8,decisionRule:rule,artifactFile:id+'-model.json',artifactFileHash:sha(artifact)};
  plan.planHash=digest(plan);state.plans[id]=plan;await writeFile(join(selection,plan.artifactFile),artifact);members.push(await install(directory,selection,plan,i+1));
 }
 state.stateHash=digest(state);await writeFile(join(selection,'selection-state.json'),JSON.stringify(state));await pinBinding(prior,await realpath(selection),members);
 const model=hybridArtifact('hockey',.38),spec={id:'replacement',sport:'hockey',league:'nhl',horizon:'Daily',candidate:'hybrid',artifactId:model.artifactId,modelVersion:CURRENT_MODEL_VERSION,start:state.plans.prior.start,end:state.plans.prior.end,minimumGames:75,minimumDates:8};
 return {root,prior,baseline,selection,model,spec,members,options:{directory:selection,model,priorTrialDirectory:prior,now}};
}
