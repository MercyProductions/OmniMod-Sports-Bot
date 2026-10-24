import {readFile,mkdir,open,unlink,realpath} from 'node:fs/promises';
import {join,resolve,relative,isAbsolute} from 'node:path';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const run=promisify(execFile);

export function forwardWorkerEnvironment(directory,source=process.env){
 const env={};for(const key of ['PATH','Path','SystemRoot','WINDIR','TEMP','TMP'])if(source[key])env[key]=source[key];
 return Object.assign(env,{NODE_ENV:'research',OMNIMOD_DISABLE_DATA_MIGRATION:'true',OMNIMOD_SPORTS_DATA_DIR:join(directory,'runtime'),
  DOTENV_CONFIG_PATH:join(directory,'empty.env'),DOTENV_CONFIG_QUIET:'true',OMNIMOD_LIVE_TRADING_ENABLED:'false',OMNIMOD_EMERGENCY_STOP:'true',
  POST_ON_START:'false',REGISTER_COMMANDS:'false',FEATURE_WAREHOUSE_ENABLED:'false',HISTORICAL_REPLAY_ENABLED:'false',LOCAL_ML_ENABLED:'false',
  AUTO_LEARNING_ENABLED:'false',ADVANCED_DATASETS_ENABLED:'false',AUTO_OFFICIAL_SOURCES:'false',AUTO_BOXSCORE_MAX_EVENTS:'0',
  AUTO_HISTORY_MAX_LEAGUES:'1',AUTO_HISTORY_MAX_DAYS:'90',AUTO_SUMMARY_MAX_GAMES:'6',LOCAL_ONLY:'false'});
}

export async function inspectForwardCollector(directory){
 const root=await realpath(directory),checkpoint=JSON.parse(await readFile(join(root,'CHECKPOINT.json'),'utf8'));
 const manifest=JSON.parse(await readFile(join(root,'collector-manifest.json'),'utf8')),{manifestHash,...body}=manifest;
 if(body.schema!=='sports-forward-collector-v1'||hash(JSON.stringify(body))!==manifestHash||body.planId!==checkpoint.planId
  ||body.planHash!==checkpoint.planHash||body.artifactId!==checkpoint.artifactId||body.sourceCommit!==checkpoint.sourceCommit)
  throw new Error('Forward collector manifest binding failed');
 if(hash(await readFile(join(root,checkpoint.sourceArchive)))!==checkpoint.sourceArchiveSHA256)throw new Error('Frozen source archive changed');
 for(const [name,digest] of Object.entries(body.files||{})){
  const rel=relative(root,resolve(root,name));if(!rel||isAbsolute(rel)||rel==='..'||rel.startsWith('..\\')||rel.startsWith('../'))throw new Error('Unsafe collector manifest path');
  if(await realpath(join(root,name))!==resolve(root,name)||hash(await readFile(join(root,name)))!==digest)throw new Error('Frozen collector/source file changed');
 }
 if(await realpath(join(root,'frozen','sports-bot','node_modules'))!==body.dependencyDirectory)throw new Error('Collector dependencies redirected');
 const selection=JSON.parse(await readFile(join(root,'selection','selection-state.json'),'utf8'));
 const {stateHash,...stateBody}=selection;if(hash(JSON.stringify(stateBody))!==stateHash)throw new Error('Forward selection state changed');
 const plan=selection.plans?.[body.planId],{planHash,...planBody}=plan||{};
 if(planHash!==body.planHash||hash(JSON.stringify(planBody))!==planHash||plan.artifactId!==body.artifactId
  ||plan.modelVersion!==checkpoint.modelVersion||plan.league!=='nhl'||plan.horizon!=='Daily'||plan.candidate!=='hybrid')throw new Error('Forward plan changed');
 if(plan.artifactFile!==plan.id+'-model.json'||hash(await readFile(join(root,'selection',plan.artifactFile)))!==plan.artifactFileHash)throw new Error('Forward artifact changed');
 return {root,checkpoint,manifest,plan};
}

/** One bounded collector invocation. No broker, Discord client, credentials or model activation. */
export async function collectForwardTrial(directory,{now=Date.now(),execute=async(root)=>{
 const response=await run(process.execPath,[join(root,'collector','worker.mjs'),root],{cwd:root,env:forwardWorkerEnvironment(root),windowsHide:true,timeout:240000,maxBuffer:1000000});
 return JSON.parse(response.stdout.trim().split('\n').at(-1));
}}={}){
 if(!Number.isFinite(now))throw new Error('Valid forward collection clock required');
 const {root,plan}=await inspectForwardCollector(directory),start=Date.parse(plan.start),end=Date.parse(plan.end);
 if(!Number.isFinite(start)||!Number.isFinite(end)||start>=end)throw new Error('Invalid forward trial window');
 if(now<start)return {status:'awaiting_trial_start',start:plan.start,providerRequests:0,liveOrders:false,discordPosts:0};
 if(now>end+7*86400000)return {status:'collection_window_ended',providerRequests:0,liveOrders:false,discordPosts:0};
 await mkdir(join(root,'runtime'),{recursive:true});let owner;
 try{owner=await open(join(root,'collector.lock'),'wx',0o600);}catch(error){if(error.code==='EEXIST')return {status:'owner_lock_present',providerRequests:0,liveOrders:false,discordPosts:0};throw error;}
 try{
  await owner.writeFile(JSON.stringify({pid:process.pid,startedAt:new Date().toISOString()})+'\n');
  await inspectForwardCollector(root);return await execute(root);
 }finally{await owner.close();await unlink(join(root,'collector.lock'));}
}
