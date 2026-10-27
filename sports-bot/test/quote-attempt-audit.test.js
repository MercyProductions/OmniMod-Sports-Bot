import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,mkdir,writeFile,readFile,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const directory=await mkdtemp(join(tmpdir(),'sports-quote-attempt-'));process.env.OMNIMOD_SPORTS_DATA_DIR=directory;
const {refreshValueQuotes,claimValueRefresh}=await import('../src/valueQuoteRefresh.js');
const {readQuoteAttemptAudits,completeQuoteAttempt}=await import('../src/quoteAttemptAudit.js');
test.after(()=>rm(directory,{recursive:true,force:true}));
const now=Date.parse('2026-10-20T18:00:00Z'),startTime='2026-10-20T19:00:00Z',generatedAt='2026-10-20T17:00:00Z';
function slate(){return {guildId:'audit-fixture',dateKey:'2026-10-20',generatedAt,games:[{id:'local',leagueKey:'nba',sportGroup:'Basketball',startTime,statusKey:'scheduled',away:{name:'Away',abbr:'A'},home:{name:'Home',abbr:'H'}}],predictions:[{gameId:'local',leagueKey:'nba',startTime,predictionGeneratedAt:generatedAt,predictionMode:'pregame',modelVersion:'audit-fixture',predictedSide:'home',outcomeProbabilities:{away:35,home:65},predictionUncertaintyPoints:4,evidenceQualityValue:85,calibrationSampleSize:100,outcomeValidationSamples:{away:80,home:80},outcomeCalibrationError:{away:.03,home:.03},recommendationStatus:'prediction'}]};}
function provider(){return {ok:true,status:200,cacheState:'network',fetchedAt:new Date(now).toISOString(),json:[{id:'provider',sport_key:'basketball_nba',commence_time:startTime,away_team:'Away',home_team:'Home',bookmakers:['one','two'].map(key=>({key,title:key,markets:[{key:'h2h',last_update:'2026-10-20T17:59:00Z',outcomes:[{name:'Away',price:250},{name:'Home',price:-250}]}]}))}]};}
const options=(name,extra={})=>({refresh:true,admin:true,localOnly:false,oddsApiKey:'synthetic-test-key',dailyCap:1,cooldownMinutes:5,directory:join(directory,name),now,fetchJson:async()=>provider(),...extra});
const auditPath=(args,suffix)=>join(args.directory,'value-refresh-audits','2026-10-20-1.'+suffix+'.json');

test('provider exceptions retain a bound immutable failure without raw errors or credentials',async()=>{
 const args=options('exception',{fetchJson:async()=>{throw new Error('private-error https://example.invalid?apiKey=synthetic-test-key');}}),value=slate(),result=await refreshValueQuotes(value,args),rows=await readQuoteAttemptAudits(args.directory);
 assert.equal(result.status,'provider_failure');assert.equal(rows.length,1);assert.equal(rows[0].state,'completed');assert.equal(rows[0].completion.status,'provider_failure');assert.equal(rows[0].start.events[0].modelVersion,'audit-fixture');assert.deepEqual(rows[0].start.events[0].outcomeProbabilities,{away:35,home:65,draw:null});assert.doesNotMatch(JSON.stringify(rows),/synthetic-test-key|private-error|example.invalid/);
 assert.equal((await refreshValueQuotes(value,{...args,now:now+360000})).status,'daily_cap');
});

test('HTTP failures persist only bounded response metadata and never body or headers',async()=>{
 const args=options('http',{fetchJson:async()=>({ok:false,status:403,cacheState:'network',json:{message:'private-body'},headers:{authorization:'private-header'}})});await refreshValueQuotes(slate(),args);const rows=await readQuoteAttemptAudits(args.directory);assert.equal(rows[0].completion.providerHttpStatus,403);assert.doesNotMatch(JSON.stringify(rows),/private-body|private-header/);
});

test('identity and bookmaker rejection evidence survives an unmatched response',async()=>{
 const args=options('unmatched',{fetchJson:async()=>{const result=provider();result.json.push({...result.json[0],id:'second'});return result;}});const result=await refreshValueQuotes(slate(),args),rows=await readQuoteAttemptAudits(args.directory);assert.equal(result.status,'unmatched');assert.equal(rows[0].completion.evidence[0].reason,'ambiguous_provider_events');assert.equal(rows[0].completion.evidence[0].observationHashes.length,2);assert.equal(rows[0].completion.preparedPriceSnapshots,0);
});

test('a successful completion records prepared prices without claiming journal or Discord delivery',async()=>{
 const value=slate(),args=options('success'),result=await refreshValueQuotes(value,args),rows=await readQuoteAttemptAudits(args.directory);assert.equal(result.status,'fresh');assert.equal(rows[0].completion.preparedPriceSnapshots,1);assert.equal(result.quoteAttemptAudit.completionHash,rows[0].completion.eventHash);assert.deepEqual(result.slate.predictions[0].outcomeProbabilities,value.predictions[0].outcomeProbabilities);
 const output=await promisify(execFile)(process.execPath,['scripts/audit-quote-attempts.js','--directory='+args.directory],{cwd:resolve('.')});const report=JSON.parse(output.stdout);assert.equal(report.states.completed,1);assert.equal(report.providerChargesVerified,false);assert.equal(report.discordDeliveryVerified,false);
});

test('start audit failure prevents the provider request while preserving the consumed reservation',async()=>{
 let calls=0;const args=options('start-failure',{fetchJson:async()=>{calls++;return provider();}});await mkdir(args.directory,{recursive:true});await writeFile(join(args.directory,'value-refresh-audits'),'blocked');const result=await refreshValueQuotes(slate(),args);assert.equal(result.status,'audit_error');assert.equal(result.externalCalls,0);assert.equal(calls,0);const claims=await readdir(join(args.directory,'value-refresh-claims'));assert.equal(claims.filter(name=>name.endsWith('.json')).length,1);
});

test('completion write failure suppresses price snapshots and does not overwrite conflicting evidence',async()=>{
 const args=options('completion-failure');args.fetchJson=async()=>{await writeFile(auditPath(args,'complete'),'preserve-this-invalid-record');return provider();};const result=await refreshValueQuotes(slate(),args);assert.equal(result.status,'audit_error');assert.equal(result.issuedSlate,null);assert.equal(result.externalCalls,1);assert.equal(await readFile(auditPath(args,'complete'),'utf8'),'preserve-this-invalid-record');await assert.rejects(readQuoteAttemptAudits(args.directory),/integrity/);
});

test('unexpected adapter processing failures still finish with a redacted terminal record',async()=>{
 const args=options('processing',{fetchJson:async()=>{const result=provider();result.json[0].self=result.json[0];return result;}});const result=await refreshValueQuotes(slate(),args),rows=await readQuoteAttemptAudits(args.directory);assert.equal(result.status,'processing_failure');assert.equal(rows[0].completion.status,'processing_failure');assert.equal(rows[0].completion.preparedPriceSnapshots,0);
});

async function crash(name,code){
 const args=options(name),script=`const {refreshValueQuotes}=await import('./src/valueQuoteRefresh.js');await refreshValueQuotes(${JSON.stringify(slate())},{...${JSON.stringify({...args,fetchJson:undefined})},fetchJson:async()=>{${code===71?'process.exit(71);':''}return ${JSON.stringify(provider())};}});process.exit(${code});`;
 await assert.rejects(promisify(execFile)(process.execPath,['--input-type=module','-e',script],{cwd:resolve('.'),env:{...process.env,OMNIMOD_SPORTS_DATA_DIR:directory,OMNIMOD_DISABLE_DATA_MIGRATION:'true'}}),error=>error.code===code);return args;
}

test('a real process exit during dispatch leaves an unfinished attempt and cannot reopen budget',async()=>{
 const args=await crash('crash-start',71),rows=await readQuoteAttemptAudits(args.directory);assert.equal(rows[0].state,'started_unfinished');assert.equal(rows[0].completion,null);assert.equal((await refreshValueQuotes(slate(),{...args,now:now+360000})).status,'daily_cap');
});

test('completion survives a real caller process exit before journal or Discord handling',async()=>{
 const args=await crash('crash-complete',72),rows=await readQuoteAttemptAudits(args.directory);assert.equal(rows[0].state,'completed');assert.equal(rows[0].completion.status,'fresh');assert.equal(rows[0].completion.preparedPriceSnapshots,1);await assert.rejects(readFile(join(args.directory,'prediction-journal.jsonl')),{code:'ENOENT'});
});

test('terminal records cannot be rewritten and damaged or detached audit evidence fails closed',async()=>{
 const args=options('immutable'),result=await refreshValueQuotes(slate(),args),before=await readFile(auditPath(args,'complete'));await assert.rejects(completeQuoteAttempt(args.directory,result.quoteAttemptAudit,{status:'unmatched',externalCalls:1},provider(),now),/integrity/);assert.deepEqual(await readFile(auditPath(args,'complete')),before);
 await assert.rejects(completeQuoteAttempt(args.directory,{attemptKey:'../outside',startHash:'a'.repeat(64)},{status:'fresh'}),/integrity/);
 await rm(join(args.directory,'value-refresh-claims','2026-10-20-1.json'));await assert.rejects(readQuoteAttemptAudits(args.directory),/integrity/);
});

test('read-only diagnostics preserve reserved legacy slots without inventing dispatch outcomes',async()=>{
 const args=options('legacy');await claimValueRefresh(args);const rows=await readQuoteAttemptAudits(args.directory);assert.equal(rows[0].state,'reserved_without_audit');assert.equal(rows[0].completion,null);await assert.rejects(readFile(auditPath(args,'start')),{code:'ENOENT'});assert.deepEqual(await readQuoteAttemptAudits(join(directory,'absent')),[]);
});

test('a backwards completion clock cannot certify a terminal outcome',async()=>{
 const original=Date.now;let clock=now;Date.now=()=>clock;
 try{const args=options('clock-backwards',{fetchJson:async()=>{clock=now-1;return provider();}});delete args.now;const result=await refreshValueQuotes(slate(),args);assert.equal(result.status,'audit_error');assert.equal(result.issuedSlate,null);assert.equal((await readQuoteAttemptAudits(args.directory))[0].state,'started_unfinished');}finally{Date.now=original;}
});
