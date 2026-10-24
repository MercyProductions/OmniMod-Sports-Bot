import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {createProspectiveNetwork} from './prospective-network.mjs';
const [root,role,mode,operation='collect',jobFile,jobHash]=process.argv.slice(2);
if(!root||!['baseline','challenger'].includes(role)||!['offline','live'].includes(mode)||!['collect','reconcile'].includes(operation))throw new Error('Invalid isolated worker invocation');
const state=join(root,'state',role);
if(resolve(process.env.OMNIMOD_SPORTS_DATA_DIR||'')!==resolve(state)||process.env.DISCORD_TOKEN||process.env.ODDS_API_KEY
 ||process.env.OMNIMOD_LIVE_TRADING_ENABLED!=='false'||process.env.OMNIMOD_EMERGENCY_STOP!=='true'||process.env.AUTO_LEARNING_ENABLED!=='false')throw new Error('Invalid isolated environment');
const manifest=JSON.parse(await readFile(join(root,'manifest.json'),'utf8'));
if(manifest.profile?.networkPolicy!=='sports-prospective-network-v1'||manifest.profile.maximumRequestsPerWorker!==32)throw Error('Unverified public research network policy');
const startedAt=new Date().toISOString();
const network=await createProspectiveNetwork({directory:join(root,'network',role),maxRequests:manifest.profile.maximumRequestsPerWorker,allowNetwork:mode==='live'});globalThis.fetch=network.fetch;
const dayOffset=manifest.profile?.dayOffset??0;
if(![0,1].includes(dayOffset))throw new Error('Invalid pinned sampling day');
const source=join(root,role,'sports-bot','src');
const {config,dataDir}=await import(pathToFileURL(join(source,'config.js')));
if(resolve(dataDir)!==resolve(state)||config.discordToken||config.oddsApiKey||config.featureWarehouseEnabled||config.historicalReplayEnabled||config.localMlEnabled||config.autoLearningEnabled)throw new Error('Isolation configuration mismatch');
const {buildDailySlate,refreshFinalGrades}=await import(pathToFileURL(join(source,'sportsData.js')));
let slate;
if(operation==='collect'){
 let date=new Date();
 if(dayOffset){
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date).map(row=>[row.type,row.value]));
  date=new Date(Date.UTC(Number(parts.year),Number(parts.month)-1,Number(parts.day)+dayOffset,18));
 }
 slate=await buildDailySlate(date,{guildId:'isolated-prospective',localOnly:mode==='offline',includeOdds:false,leagueKeys:['nba','nhl','nfl','mlb']});
}else{
 if(!/^reconcile-[a-f0-9-]+\.json$/.test(jobFile||'')||!/^[a-f0-9]{64}$/.test(jobHash||''))throw new Error('Invalid final query job');
 const bytes=await readFile(join(root,'jobs',jobFile));
 if(createHash('sha256').update(bytes).digest('hex')!==jobHash)throw new Error('Final query job changed');
 const job=JSON.parse(bytes);
 if(job.schema!=='sports-final-query-job-v1'||job.role!==role||job.sourceCommit!==manifest.sources?.[role]?.commit
  ||!/^\d{4}-\d{2}-\d{2}$/.test(job.slate?.dateKey||'')||!Number.isFinite(Date.parse(job.createdAt))||Date.parse(job.createdAt)>Date.now()
  ||!Array.isArray(job.slate.games)||!Array.isArray(job.slate.predictions)||!job.slate.games.length)throw new Error('Unverified final query evidence');
 slate=await refreshFinalGrades(job.slate,{guildId:'isolated-prospective',localOnly:mode==='offline'});
}

const completedAt=new Date().toISOString();
const networkEvidence=await network.summary();
const capture={schema:'sports-isolated-capture-v1',role,mode,purpose:operation==='reconcile'?'final_reconciliation':'market_scan',sampling:{dayOffset,targetDateKey:slate.dateKey},startedAt,completedAt,slate,networkEvidence,discordDelivered:false,liveOrders:false,emergencyStop:true};
const bytes=JSON.stringify(capture)+'\n',captureHash=createHash('sha256').update(bytes).digest('hex');
await mkdir(join(root,'captures'),{recursive:true});
const filename=role+'-'+Date.now()+'-'+randomUUID()+'.json';
await writeFile(join(root,'captures',filename),bytes,{flag:'wx',mode:0o600});
console.log(JSON.stringify({role,mode,operation,filename,captureHash,startedAt,completedAt,games:slate.games.length,
 pregameForecasts:operation==='collect'?slate.predictions.filter(row=>row.predictionMode==='pregame').length:0,diagnosticCount:slate.diagnostics?.length||0}));
