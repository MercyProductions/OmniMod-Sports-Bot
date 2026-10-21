import {recordCaptureReceipt,loadProspectiveCaptures,pendingProspectiveFinalQueries} from './prospectivePairs.js';
import {createHash,randomUUID} from 'node:crypto';
import {execFileSync,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,writeFile,mkdir,realpath,symlink} from 'node:fs/promises';
import {resolve,join,relative,dirname,basename,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const run=promisify(execFile);
const contains=(root,path)=>{const r=relative(root,path);return r===''||!r.startsWith('..')&&!isAbsolute(r);};
const git=(root,args)=>execFileSync('git',['-C',root,...args],{maxBuffer:25000000});
const workerSource=fileURLToPath(new URL('../scripts/prospective-worker.mjs',import.meta.url));

/** Archive tracked source only; a new explicitly isolated directory is mandatory. */
export async function prepareProspectiveIsolation({directory,repository,baselineRef,challengerRef='HEAD',dayOffset=0}={}){
 if(!Number.isInteger(dayOffset)||![0,1].includes(dayOffset))throw new Error('Research sampling day offset must be zero or one');
 if(!directory||!repository||!baselineRef)throw new Error('Explicit research directory, repository and baseline required');
 const root=await realpath(repository),parent=await realpath(dirname(resolve(directory))),target=join(parent,basename(directory));
 if(contains(root,target)||contains(target,root))throw new Error('Research state must be outside the source repository');
 const refs={baseline:baselineRef,challenger:challengerRef},pins={};
 const lock=await readFile(join(root,'sports-bot','package-lock.json'));
 // Resolve and validate both revisions before creating any research state.
 for(const [name,ref] of Object.entries(refs)){
  const commit=git(root,['rev-parse','--verify',ref+'^{commit}']).toString().trim();
  if(!/^[a-f0-9]{40}$/.test(commit))throw new Error('Unverified source revision');
  const tracked=git(root,['ls-tree','-r','--name-only',commit,'--','sports-bot/src','sports-bot/package.json','sports-bot/package-lock.json']).toString().trim().split('\n');
  const paths=tracked.filter(path=>/^sports-bot\/src\/[A-Za-z0-9_-]+\.js$/.test(path)||/^sports-bot\/package(?:-lock)?\.json$/.test(path));
  if(!paths.includes('sports-bot/src/sportsData.js')||hash(git(root,['show',commit+':sports-bot/package-lock.json']))!==hash(lock))throw new Error('Missing source or incompatible dependency lock');
  pins[name]={commit,paths};
 }
 await mkdir(target,{mode:0o700}); // Never reuse an existing directory, production or research.
 const manifest={schema:'sports-prospective-isolation-v1',createdAt:new Date().toISOString(),dependencyLockHash:hash(lock),
  workerCapabilities:['collect','reconcile'],
  dependencyDirectory:await realpath(join(root,'sports-bot','node_modules')),workerHash:hash(await readFile(workerSource)),emptyEnvHash:hash('# Intentionally empty research environment\n'),sources:{},
  profile:{dayOffset,timezone:'America/Chicago',leagues:['nba','nhl','nfl','mlb'],summaryMaxGames:6,historyMaxLeagues:4,historyDays:90,
   boxscoreMaxEvents:0,paidOdds:false,advancedDatasets:false,officialSources:false,
   historicalReplay:false,featureWarehouse:false,localMl:false,discord:false,liveOrders:false},
  limitations:['Controlled cold-start pipeline comparison, not a snapshot of the deployed learner or all market coverage.',
   'Installed dependencies are shared by path; workers have separate source, state and credential-free environments. This is not an OS security sandbox.']};
 for(const [name,pin] of Object.entries(pins)){
  const files={};
  for(const path of pin.paths){const bytes=git(root,['show',pin.commit+':'+path]);const output=join(target,name,path);await mkdir(dirname(output),{recursive:true});await writeFile(output,bytes,{flag:'wx'});files[path]=hash(bytes);}
  await symlink(manifest.dependencyDirectory,join(target,name,'sports-bot','node_modules'),process.platform==='win32'?'junction':'dir');
  await mkdir(join(target,'state',name),{recursive:true});
  manifest.sources[name]={commit:pin.commit,files};
 }
 await writeFile(join(target,'worker.mjs'),await readFile(workerSource),{flag:'wx'});
 await writeFile(join(target,'empty.env'),'# Intentionally empty research environment\n',{flag:'wx',mode:0o600});
 manifest.manifestHash=hash(JSON.stringify(manifest));
 await writeFile(join(target,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx',mode:0o600});
 return manifest;
}

export async function inspectProspectiveIsolation(directory){
 const root=await realpath(directory),manifest=JSON.parse(await readFile(join(root,'manifest.json'),'utf8'));
 const {manifestHash,...body}=manifest;
 if(body.schema!=='sports-prospective-isolation-v1'||hash(JSON.stringify(body))!==manifestHash||hash(await readFile(join(root,'worker.mjs')))!==body.workerHash)throw new Error('Research manifest or worker integrity failed');
 if(hash(await readFile(join(root,'empty.env')))!==body.emptyEnvHash)throw new Error('Research environment changed');
 for(const [name,pin] of Object.entries(body.sources)){
  if(!contains(root,await realpath(join(root,'state',name))) || await realpath(join(root,name,'sports-bot','node_modules'))!==body.dependencyDirectory)throw new Error('Research state or dependencies redirected');
  if(!['baseline','challenger'].includes(name))throw new Error('Invalid source role');
  for(const [path,expected] of Object.entries(pin.files)){
   if(!/^sports-bot\/(?:src\/[A-Za-z0-9_-]+\.js|package(?:-lock)?\.json)$/.test(path)||hash(await readFile(join(root,name,path)))!==expected)throw new Error('Pinned research source changed');
  }
 }
 return manifest;
}

export async function runProspectiveIsolation(directory,{live=false,timeout=120000,operation='collect'}={}){
 const root=await realpath(directory),manifest=await inspectProspectiveIsolation(root);
 if(!['collect','reconcile'].includes(operation))throw new Error('Invalid research worker operation');
 if(!Number.isInteger(timeout)||timeout<1000||timeout>300000)throw new Error('Bounded worker timeout required');
 // Exclusive owner lock prevents two collectors from writing the same learner at once.
 const {open,unlink}=await import('node:fs/promises');const owner=await open(join(root,'run.lock'),'wx',0o600);
 try{
  const captures=[];
  let jobs=['baseline','challenger'].map(role=>({role})),finalPlan=null;
  if(operation==='reconcile'){
   const loaded=await loadProspectiveCaptures(root);finalPlan=pendingProspectiveFinalQueries(loaded.captures);jobs=finalPlan.tasks;
   if(jobs.length&&!manifest.workerCapabilities?.includes('reconcile'))throw new Error('Pinned worker does not support reconciliation; preserve study and prepare a new compatible worker study');
  }
  for(const job of jobs){
   const name=job.role;
   await inspectProspectiveIsolation(root);
   const env={};for(const key of ['PATH','Path','SystemRoot','WINDIR','TEMP','TMP'])if(process.env[key])env[key]=process.env[key];
   Object.assign(env,{NODE_ENV:'research',OMNIMOD_DISABLE_DATA_MIGRATION:'true',OMNIMOD_SPORTS_DATA_DIR:join(root,'state',name),
    DOTENV_CONFIG_PATH:join(root,'empty.env'),DOTENV_CONFIG_QUIET:'true',POST_ON_START:'false',REGISTER_COMMANDS:'false',
    FEATURE_WAREHOUSE_ENABLED:'false',HISTORICAL_REPLAY_ENABLED:'false',LOCAL_ML_ENABLED:'false',ADVANCED_DATASETS_ENABLED:'false',
    AUTO_OFFICIAL_SOURCES:'false',AUTO_SUMMARY_MAX_GAMES:'6',AUTO_HISTORY_MAX_LEAGUES:'4',AUTO_HISTORY_MAX_DAYS:'90',AUTO_BOXSCORE_MAX_EVENTS:'0',LOCAL_ONLY:live?'false':'true'});
   const args=[join(root,'worker.mjs'),root,name,live?'live':'offline',operation];
   if(operation==='reconcile'){
    await mkdir(join(root,'jobs'),{recursive:true});
    const filename='reconcile-'+randomUUID()+'.json',bytes=JSON.stringify({schema:'sports-final-query-job-v1',role:name,
     sourceCommit:manifest.sources[name].commit,createdAt:new Date().toISOString(),slate:job.slate})+'\n';
    await writeFile(join(root,'jobs',filename),bytes,{flag:'wx',mode:0o600});args.push(filename,hash(bytes));
   }
   const response=await run(process.execPath,args,{cwd:root,env,timeout,maxBuffer:2000000,windowsHide:true});
   const summary=JSON.parse(response.stdout.trim().split('\n').at(-1));
   const receipt=await recordCaptureReceipt(root,{...summary,sourceCommit:manifest.sources[name].commit});
   captures.push({...summary,sourceCommit:manifest.sources[name].commit,receiptHash:receipt.eventHash});
  }
  return {status:operation==='collect'?'isolated_captures_completed':jobs.length?'isolated_final_queries_completed':'no_pending_final_queries',
   operation,liveDataRequested:live,captures,finalQueryPlan:finalPlan?{dates:jobs.length,deferred:finalPlan.deferred,excluded:finalPlan.excluded}:null,
   productionChanged:false,performanceEstablished:false};
 }finally{await owner.close();await unlink(join(root,'run.lock'));}
}
