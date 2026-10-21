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
