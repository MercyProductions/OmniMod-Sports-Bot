import {readFile,writeFile,mkdir,readdir,rename} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
const root=resolve(process.argv[2]||'');
if(!process.argv[2]||process.env.OMNIMOD_SPORTS_DATA_DIR!==join(root,'runtime')||process.env.OMNIMOD_LIVE_TRADING_ENABLED!=='false'
 ||process.env.OMNIMOD_EMERGENCY_STOP!=='true'||process.env.DISCORD_TOKEN||process.env.ODDS_API_KEY)throw new Error('Unsafe forward worker environment');
const checkpoint=JSON.parse(await readFile(join(root,'CHECKPOINT.json'),'utf8'));
const state=JSON.parse(await readFile(join(root,'selection','selection-state.json'),'utf8')),plan=state.plans[checkpoint.planId];
const now=Date.now(),verifyOnly=process.argv[3]==='--verify-only';if(!verifyOnly&&(now<Date.parse(plan.start)||now>Date.parse(plan.end)+7*86400000))throw new Error('Worker outside real collection window');
const source=join(root,'frozen','sports-bot','src'),load=name=>import(pathToFileURL(join(source,name+'.js')));
const {config}=await load('config');
if(config.discordToken||config.oddsApiKey||config.localMlEnabled||config.featureWarehouseEnabled||config.historicalReplayEnabled||config.autoLearningEnabled)throw new Error('Worker isolation mismatch');
const {hybridArtifactId}=await load('hybridArtifact');
if(hybridArtifactId('hockey',.38)!==checkpoint.artifactId)throw new Error('Frozen hybrid identity mismatch');
if(verifyOnly){console.log(JSON.stringify({status:'frozen_worker_verified',sourceCommit:checkpoint.sourceCommit,modelVersion:checkpoint.modelVersion,providerRequests:0,liveOrders:false,discordPosts:0}));process.exit(0);}
let providerRequests=0,providerFailures=0;
const fetcher=globalThis.fetch;
globalThis.fetch=async(input,options={})=>{
 const url=new URL(typeof input==='string'?input:input.url||String(input));
 if(url.protocol!=='https:'||!['site.api.espn.com','cdn.espn.com','api-web.nhle.com'].includes(url.hostname)||url.username||url.password
  ||String(options.method||input?.method||'GET').toUpperCase()!=='GET'||[...url.searchParams.keys()].some(key=>/key|token|secret/i.test(key)))throw new Error('Research network policy rejected request');
 providerRequests++;const response=await fetcher(input,{...options,redirect:'error'});if(!response.ok&&response.status!==304)providerFailures++;return response;
};
const {buildDailySlate,refreshFinalGrades}=await load('sportsData');
const {readPredictionJournal,predictionJournalFile}=await load('predictionJournal');
const {journalResultState}=await load('journalResults');
const {localDateKey}=await load('time');
const {finalizeSelectionPlan}=await load('selectionProtocol');
const slates=join(root,'runtime','forward-slates'),captures=join(root,'captures');await mkdir(slates,{recursive:true});await mkdir(captures,{recursive:true});
const save=async(file,value)=>{const temp=file+'.'+randomUUID()+'.pending';await writeFile(temp,JSON.stringify(value)+'\n',{flag:'wx',mode:0o600});await rename(temp,file);};
const capture=async(kind,slate)=>writeFile(join(captures,Date.now()+'-'+randomUUID()+'.json'),JSON.stringify({schema:'sports-forward-capture-v1',kind,sourceCommit:checkpoint.sourceCommit,artifactId:checkpoint.artifactId,capturedAt:new Date().toISOString(),slate,liveOrders:false,discordPosts:0})+'\n',{flag:'wx',mode:0o600});
let collected=0,reconciled=0,omittedDates=0;
const today=localDateKey(new Date());
if(now+240000<Date.parse(plan.end)){
 const file=join(slates,today+'.json');let cached;try{cached=JSON.parse(await readFile(file,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
 const slate=await buildDailySlate(new Date(),{guildId:'isolated-forward',includeOdds:false,leagueKeys:['nhl'],cachedSlate:cached,refreshGameIds:['__freeze_existing_forward_issues__']});
 await capture('collection',slate);await save(file,slate);collected=slate.games.length;
}
const journal=await readPredictionJournal(predictionJournalFile),labels=journalResultState(journal).eligible;
const pending=new Set(journal.filter(row=>row.type==='forecast'&&!labels.has(row.payload.forecastId)&&Date.parse(row.payload.startTime)<=Date.now()).map(row=>row.payload.gameId));
const dates=(await readdir(slates)).filter(name=>/^\d{4}-\d{2}-\d{2}\.json$/.test(name)).sort();
const eligible=[];
for(const name of dates){const slate=JSON.parse(await readFile(join(slates,name),'utf8'));if(slate.games.some(game=>pending.has(String(game.id))))eligible.push({name,slate});}
const attemptsFile=join(root,'runtime','final-attempts.json');let attempts={};
try{attempts=JSON.parse(await readFile(attemptsFile,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
eligible.sort((a,b)=>(Date.parse(attempts[a.name]||'')||0)-(Date.parse(attempts[b.name]||'')||0)||a.name.localeCompare(b.name));
for(const {name,slate} of eligible.slice(0,3)){
 attempts[name]=new Date().toISOString();await save(attemptsFile,attempts);
 const final=await refreshFinalGrades(slate,{guildId:'isolated-forward',includeOdds:false});await capture('final_reconciliation',final);await save(join(slates,name),final);reconciled++;
}
omittedDates=Math.max(0,eligible.length-3);
const records=await readPredictionJournal(predictionJournalFile),outcomes=journalResultState(records).eligible;
const forecasts=records.filter(row=>row.type==='forecast'&&row.payload.horizon==='Daily'&&row.payload.modelVersion===checkpoint.modelVersion&&row.payload.candidateArtifactIds?.hybrid===checkpoint.artifactId
 &&Date.parse(row.recordedAt)>=Date.parse(plan.start)&&Date.parse(row.recordedAt)<Date.parse(plan.end));
const games=new Set(forecasts.map(row=>row.payload.gameId));
let reviewStatus='collecting';if(Date.now()>=Date.parse(plan.end)){const review=await finalizeSelectionPlan(plan.id,{directory:join(root,'selection'),records});reviewStatus=review.status==='already_finalized'?review.report.status:review.status;}
let previousCompleted=Date.parse(plan.start);
try{const lines=(await readFile(join(root,'runtime','runs.jsonl'),'utf8')).trim().split('\n');if(lines.at(-1))previousCompleted=Date.parse(JSON.parse(lines.at(-1)).completedAt);}catch(error){if(error.code!=='ENOENT')throw error;}
const missedScheduledIntervals=Number.isFinite(previousCompleted)?Math.max(0,Math.floor((now-previousCompleted)/3600000)-1):null;
const result={status:'forward_collection_completed',completedAt:new Date().toISOString(),modelVersion:checkpoint.modelVersion,sourceCommit:checkpoint.sourceCommit,
 missedScheduledIntervals,collectedGames:collected,reconciledDates:reconciled,deferredDates:omittedDates,eligibleForecasts:forecasts.length,distinctGames:games.size,
 resolvedForecasts:forecasts.filter(row=>outcomes.has(row.payload.forecastId)).length,providerRequests,providerFailures,reviewStatus,liveOrders:false,discordPosts:0,modelPromoted:false};
await writeFile(join(root,'runtime','runs.jsonl'),JSON.stringify(result)+'\n',{flag:'a',mode:0o600});console.log(JSON.stringify(result));
