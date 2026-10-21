import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {loadProspectiveCaptures,evaluateProspectiveCaptures} from '../src/prospectivePairs.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,readFile,appendFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {prepareProspectiveIsolation,runProspectiveIsolation,inspectProspectiveIsolation} from '../src/prospectiveIsolation.js';
const repository=fileURLToPath(new URL('../../',import.meta.url));
const baselineRef='baseline/pre-readme-sports-audit-2026-10-20';

test('archived baseline and challenger run independently without inherited credentials or production state',async t=>{
 const parent=await mkdtemp(join(tmpdir(),'sports-prospective-'));
 t.after(()=>rm(parent,{recursive:true,force:true}));const directory=join(parent,'study');
 const manifest=await prepareProspectiveIsolation({directory,repository,baselineRef});
 assert.notEqual(manifest.sources.baseline.commit,manifest.sources.challenger.commit);
 assert.equal(manifest.profile.liveOrders,false);assert.equal(manifest.profile.discord,false);
 const dateKey=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const game={id:'fixture',dateKey,startTime:new Date(Date.now()+3600000).toISOString(),league:'NBA',leagueKey:'nba',sportGroup:'Basketball',statusKey:'scheduled',awayTeam:'Fixture A',homeTeam:'Fixture H'};
 const store={version:2,teams:{},players:{},contexts:{},results:{},games:{fixture:game}};
 for(const name of ['baseline','challenger'])await writeFile(join(directory,'state',name,'intelligence-isolated-prospective.json'),JSON.stringify(store));
 const old=process.env.DISCORD_TOKEN;process.env.DISCORD_TOKEN='SENSITIVE_ISOLATION_TEST_VALUE';
 let result;try{result=await runProspectiveIsolation(directory);}finally{if(old===undefined)delete process.env.DISCORD_TOKEN;else process.env.DISCORD_TOKEN=old;}
 assert.equal(result.captures.length,2);assert.equal(result.productionChanged,false);
 for(const row of result.captures){
  assert.equal(row.games,1);assert.equal(row.pregameForecasts,1);
  const bytes=await readFile(join(directory,'captures',row.filename),'utf8');
  assert.equal(bytes.includes('SENSITIVE_ISOLATION_TEST_VALUE'),false);
  const capture=JSON.parse(bytes);assert.equal(capture.discordDelivered,false);assert.equal(capture.mode,'offline');
 }
 const loaded=await loadProspectiveCaptures(directory);assert.equal(loaded.captures.length,2);
 assert.equal(evaluateProspectiveCaptures(loaded.captures).pairedForecasts,0);
 await appendFile(join(directory,'captures',result.captures[0].filename),' ');
 await assert.rejects(loadProspectiveCaptures(directory),/Frozen capture changed/);
 await assert.rejects(prepareProspectiveIsolation({directory,repository,baselineRef}));
 await writeFile(join(directory,'run.lock'),'existing-owner');
 await assert.rejects(runProspectiveIsolation(directory));
 assert.equal(await readFile(join(directory,'run.lock'),'utf8'),'existing-owner');
 await rm(join(directory,'run.lock'));
 await appendFile(join(directory,'challenger','sports-bot','src','sportModels.js'),'\n// tampered fixture\n');
 await assert.rejects(inspectProspectiveIsolation(directory),/source changed/);
});

test('research preparation refuses repository-local paths',async()=>{
 await assert.rejects(prepareProspectiveIsolation({directory:join(resolve(repository),'unsafe-research'),repository,baselineRef}),/outside/);
});


test('a pinned isolated worker refreshes prior-date finals without changing original probability or issuance',async t=>{
 const parent=await mkdtemp(join(tmpdir(),'sports-final-worker-'));t.after(()=>rm(parent,{recursive:true,force:true}));
 const directory=join(parent,'study'),manifest=await prepareProspectiveIsolation({directory,repository,baselineRef});
 const date=new Date(Date.now()-26*3600000),parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date).map(row=>[row.type,row.value]));
 const dateKey=`${parts.year}-${parts.month}-${parts.day}`,startTime=date.toISOString();
 const game={id:'fixture-final',dateKey,startTime,league:'NBA',leagueKey:'nba',sportGroup:'Basketball',statusKey:'scheduled',away:{name:'Fixture A',abbr:'A'},home:{name:'Fixture H',abbr:'H'}};
 const prediction={gameId:game.id,predictionMode:'pregame',predictedSide:'home',predictionGeneratedAt:new Date(date.getTime()-3600000).toISOString(),startTime,outcomeProbabilities:{away:40,home:60,draw:0}};
 await mkdir(join(directory,'jobs'));
 for(const role of ['baseline','challenger']){
  const native={...game,awayTeam:game.away.name,homeTeam:game.home.name};
  const store={version:2,teams:{},players:{},contexts:{},games:{fixture:native},results:{fixture:{dateKey,league:'NBA',leagueKey:'nba',awayTeam:'Fixture A',homeTeam:'Fixture H',awayScore:90,homeScore:100,recordedAt:new Date(Date.now()-1000).toISOString()}}};
  await writeFile(join(directory,'state',role,'intelligence-isolated-prospective.json'),JSON.stringify(store));
  const filename='reconcile-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.json',bytes=JSON.stringify({schema:'sports-final-query-job-v1',role,sourceCommit:manifest.sources[role].commit,
   createdAt:new Date().toISOString(),slate:{dateKey,guildId:'isolated-prospective',games:[game],predictions:[prediction],finalReplies:{}}});
  await writeFile(join(directory,'jobs',filename),bytes);
  const env={};for(const key of ['PATH','Path','SystemRoot','WINDIR','TEMP','TMP'])if(process.env[key])env[key]=process.env[key];
  Object.assign(env,{NODE_ENV:'research',OMNIMOD_DISABLE_DATA_MIGRATION:'true',OMNIMOD_SPORTS_DATA_DIR:join(directory,'state',role),DOTENV_CONFIG_PATH:join(directory,'empty.env'),
   FEATURE_WAREHOUSE_ENABLED:'false',HISTORICAL_REPLAY_ENABLED:'false',LOCAL_ML_ENABLED:'false',LOCAL_ONLY:'true'});
  const response=await promisify(execFile)(process.execPath,[join(directory,'worker.mjs'),directory,role,'offline','reconcile',filename,createHash('sha256').update(bytes).digest('hex')],{cwd:directory,env,timeout:20000,windowsHide:true});
  const summary=JSON.parse(response.stdout.trim().split('\n').at(-1)),capture=JSON.parse(await readFile(join(directory,'captures',summary.filename),'utf8'));
  assert.equal(summary.pregameForecasts,0);assert.equal(capture.purpose,'final_reconciliation');
  assert.equal(capture.slate.games[0].statusKey,'final');assert.equal(capture.slate.predictions[0].predictionCorrect,true);
  assert.deepEqual(capture.slate.predictions[0].outcomeProbabilities,prediction.outcomeProbabilities);
  assert.equal(capture.slate.predictions[0].predictionGeneratedAt,prediction.predictionGeneratedAt);
  await assert.rejects(promisify(execFile)(process.execPath,[join(directory,'worker.mjs'),directory,role,'offline','reconcile',filename,'0'.repeat(64)],{cwd:directory,env,timeout:20000,windowsHide:true}));
 }
 const empty=await runProspectiveIsolation(directory,{operation:'reconcile'});
 assert.equal(empty.status,'no_pending_final_queries');assert.equal(empty.captures.length,0);
});


test('tomorrow sampling is pinned at preparation and does not move forecast issuance into the future',async t=>{
 const parent=await mkdtemp(join(tmpdir(),'sports-upcoming-'));t.after(()=>rm(parent,{recursive:true,force:true}));
 const directory=join(parent,'study'),manifest=await prepareProspectiveIsolation({directory,repository,baselineRef,dayOffset:1});
 assert.equal(manifest.profile.dayOffset,1);
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()).map(row=>[row.type,row.value]));
 const target=new Date(Date.UTC(Number(parts.year),Number(parts.month)-1,Number(parts.day)+1,20));
 const dateKey=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).format(target);
 const game={id:'fixture-tomorrow',dateKey,startTime:target.toISOString(),league:'NBA',leagueKey:'nba',sportGroup:'Basketball',statusKey:'scheduled',awayTeam:'Fixture A',homeTeam:'Fixture H'};
 for(const name of ['baseline','challenger'])await writeFile(join(directory,'state',name,'intelligence-isolated-prospective.json'),JSON.stringify({version:2,teams:{},players:{},contexts:{},results:{},games:{fixture:game}}));
 const result=await runProspectiveIsolation(directory);
 for(const summary of result.captures){
  assert.equal(summary.games,1);assert.equal(summary.pregameForecasts,1);
  const capture=JSON.parse(await readFile(join(directory,'captures',summary.filename),'utf8'));
  assert.equal(capture.sampling.dayOffset,1);assert.equal(capture.sampling.targetDateKey,dateKey);
  assert.ok(Date.parse(capture.slate.predictions[0].predictionGeneratedAt)<=Date.now());
  assert.ok(Date.parse(capture.completedAt)<target.getTime());
  if(capture.role==='challenger')assert.ok(Date.parse(capture.slate.predictions[0].inputChronology.cutoffAt)<=Date.now());
 }
 assert.equal((await loadProspectiveCaptures(directory)).captures.length,2);
 await assert.rejects(prepareProspectiveIsolation({directory:join(parent,'invalid'),repository,baselineRef,dayOffset:2}),/offset/);
});
