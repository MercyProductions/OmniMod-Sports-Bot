import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {forwardWorkerEnvironment} from '../src/forwardTrialCollector.js';
const execute=promisify(execFile),script=fileURLToPath(new URL('../scripts/audit-prices.js',import.meta.url));
async function fixture(t){
 const root=await mkdtemp(join(tmpdir(),'sports-price-cli-'));t.after(()=>rm(root,{recursive:true,force:true}));await writeFile(join(root,'empty.env'),'');
 const issue='2099-02-01T18:00:00Z',start='2099-02-01T19:00:00Z',final='2099-02-01T22:00:00Z',quote=price=>({originalPrice:price,originalFormat:'american',bookmakerKey:'a',bookmaker:'A',quotedAt:issue,timestampSource:'provider_update'});
 const payload={forecastId:'f',gameId:'g',guildId:'fixture',league:'nba',horizon:'T-90',modelVersion:'fixture',lifecycleState:'ISSUED',recordEligibility:'observed_pregame',predictionGeneratedAt:issue,startTime:start,modeledOutcomes:['away','home'],outcomePercentages:{away:45,home:55,draw:0},valueDecision:{side:'home',status:'research_opportunity',evaluatedAt:issue,quote:quote(150)},odds:{rules:'full_game_2way',cacheState:'network',sourceReceipt:{schema:'sports-local-odds-receipt-v1',fetchedAt:issue,timestampStatus:'explicit_zone',kind:'local_fetch_receipt_not_provider_publication'},identity:{localGameId:'g',league:'nba',providerEventId:'p',providerStartTime:start,matchStatus:'matched'},outcomes:{home:{offeredQuotes:[quote(150)]},away:{offeredQuotes:[quote(-180)]}}}};
 const records=[{type:'forecast',recordedAt:issue,payload},{type:'result',recordedAt:final,payload:{forecastId:'f',actualSide:'home',observedAt:final}}];let previousHash=null;
 const bytes=records.map((row,index)=>{const body={schemaVersion:1,sequence:index+1,previousHash,...row},eventHash=createHash('sha256').update(JSON.stringify(body)).digest('hex');previousHash=eventHash;return JSON.stringify({...body,eventHash});}).join('\n')+'\n';
 const file=join(root,'journal.jsonl');await writeFile(file,bytes);return {root,file,bytes};
}
const args=file=>[script,'--journal='+file,'--fee-per-stake=0.01','--commission-on-profit=0.02','--profit-haircut=0.01'];
test('actual read-only price CLI honors strict historical cutoff and cohort flags without modifying evidence',async t=>{
 const {root,file,bytes}=await fixture(t),env=forwardWorkerEnvironment(root);
 const report=JSON.parse((await execute(process.execPath,[...args(file),'--as-of=2099-02-01T18:30:00Z','--league=nba','--horizon=T-90','--model-version=fixture'],{env,windowsHide:true})).stdout);
 assert.equal(report.schema,'sports-frozen-price-research-v3');assert.equal(report.scenarios[0].outcome,'unresolved');assert.equal(report.byCohort[0].horizon,'T-90');assert.equal(report.executedTradesVerified,0);
 const excluded=JSON.parse((await execute(process.execPath,[...args(file),'--as-of=2099-02-02T00:00:00Z','--horizon=T-15'],{env,windowsHide:true})).stdout);assert.equal(excluded.scenarios.length,0);assert.equal(await readFile(file,'utf8'),bytes);
});
test('invalid CLI cutoff fails with a sanitized error and leaves the journal intact',async t=>{
 const {root,file,bytes}=await fixture(t);
 await assert.rejects(execute(process.execPath,[...args(file),'--as-of=private-invalid-clock-marker'],{env:forwardWorkerEnvironment(root),windowsHide:true}),error=>error.code===1&&!error.stderr.includes('private-invalid-clock-marker')&&error.stderr.includes('Price audit failed'));
 assert.equal(await readFile(file,'utf8'),bytes);
});
