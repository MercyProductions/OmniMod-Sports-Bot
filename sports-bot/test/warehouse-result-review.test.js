import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm,readFile,writeFile,open,mkdir,copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
const directory=await mkdtemp(join(tmpdir(),'sports-reviewed-results-'));
process.env.OMNIMOD_SPORTS_DATA_DIR=directory;process.env.LOCAL_ONLY='true';
const {recordSlateSnapshot,readFeatureWarehouse,warehouseFile,prepareWarehouseResultReview,applyWarehouseResultReview,warehouseCandidateRowsBefore,warehouseInventory}=await import('../src/featureWarehouse.js');
const {recordPredictionJournal,readPredictionJournal}=await import('../src/predictionJournal.js');
const {writeJson}=await import('../src/storage.js');
const journalFile=join(directory,'journal.jsonl'),base=Date.now()-3*3600000;
const iso=n=>new Date(n).toISOString(),reviewNow=base+2*3600000+60000;
const options={journalFile,now:reviewNow};
const applyOptions={...options,expectedDataDirectory:directory};
test.beforeEach(async()=>{await rm(warehouseFile,{force:true});await rm(journalFile,{force:true});});
test.after(()=>rm(directory,{recursive:true,force:true}));

async function fixture(kind='nba'){
 const soccer=kind==='soccer',leagueKey=soccer?'eng.1':'nba';
 const startTime=iso(base+3600000),generated=iso(base-1000);
 const slate={guildId:'fixture',dateKey:generated.slice(0,10),generatedAt:generated,
  games:[{id:'game',leagueKey,sportGroup:soccer?'Soccer':'Basketball',statusKey:'scheduled',startTime,away:{name:'Away',score:0},home:{name:'Home',score:0},sourceMeta:{provider:'ESPN',fetchedAt:iso(base-2000)}}],
  predictions:[{gameId:'game',leagueKey,modelVersion:'review-fixture-v1',startTime,predictionGeneratedAt:generated,horizon:'Daily',predictionMode:'pregame',predictedSide:'home',outcomeProbabilities:soccer?{away:20,home:50,draw:30}:{away:40,home:60,draw:0},candidateProbabilities:{evidence:{away:.4,home:.6,draw:0}}}]};
 await recordPredictionJournal(slate,{file:journalFile,now:base});await recordSlateSnapshot(slate,{now:base});
 const a={...slate.games[0],statusKey:'final',away:{name:'Away',score:soccer?1:90},home:{name:'Home',score:soccer?2:100},sourceMeta:{provider:'ESPN',fetchedAt:iso(base+2*3600000-1000)}},b={...a,home:{name:'Home',score:soccer?0:80}};
 await recordPredictionJournal({...slate,games:[a]},{file:journalFile,now:base+2*3600000,lifecycle:'results_only'});
 await recordSlateSnapshot({...slate,games:[a]},{now:base+2*3600000+10});await recordSlateSnapshot({...slate,predictions:[],games:[a,b]},{now:base+2*3600000+20});
 const records=await readPredictionJournal(journalFile),forecastId=records.find(row=>row.type==='forecast').payload.forecastId;
 const proposal=await prepareWarehouseResultReview(forecastId,options);
 const review={proposalId:proposal.proposalId,decision:'accept',sourceChecked:true,reviewer:'synthetic-reviewer',reason:'Synthetic independent score review',sourceReference:'https://example.invalid/synthetic-score',reviewedAt:proposal.createdAt};
 return {slate,a,b,forecastId,proposal,review};
}

test('preparation is read-only and exposes the exact event, original forecast and disputed observations',async()=>{
 const f=await fixture(),before=await readFile(warehouseFile,'utf8'),journal=await readFile(journalFile,'utf8');
 const proposal=await prepareWarehouseResultReview(f.forecastId,options);
 assert.equal(proposal.event.modelVersion,'review-fixture-v1');assert.equal(proposal.teams.home,'Home');assert.equal(proposal.originalOutcomePercentages.home,60);assert.equal(proposal.priorDispute.observations.length,2);
 assert.equal(await readFile(warehouseFile,'utf8'),before);assert.equal(await readFile(journalFile,'utf8'),journal);
});

test('accepted review restores only the matched outcome with an audit receipt and immutable forecast',async()=>{
 const f=await fixture(),before=(await readFeatureWarehouse()).predictions[0],journal=await readFile(journalFile,'utf8');
 assert.equal((await warehouseCandidateRowsBefore()).length,0);
 assert.equal((await applyWarehouseResultReview(f.proposal,f.review,applyOptions)).status,'applied');
 const after=(await readFeatureWarehouse()).predictions[0];assert.equal(after.actualSide,'home');assert.equal(after.resultEvidenceStatus,'adjudicated');assert.equal(after.resolvedAt,iso(reviewNow));assert.equal(after.adjudicatedResult.observedAt,f.proposal.result.observedAt);
 assert.deepEqual(after.inputSnapshot,before.inputSnapshot);assert.deepEqual(after.outcomeProbabilities,before.outcomeProbabilities);assert.equal(after.resultAdjudications.length,1);assert.equal(after.resultAdjudications[0].disputeEvidence.observations.length,2);assert.equal(after.resultAdjudications[0].independentSourceTruthVerified,false);
 assert.equal((await warehouseCandidateRowsBefore()).length,1);assert.equal(await readFile(journalFile,'utf8'),journal);
});

test('missing or rejected review fields never change the warehouse',async()=>{
 const f=await fixture(),before=await readFile(warehouseFile,'utf8');
 for(const patch of [{decision:'reject'},{sourceChecked:false},{reviewer:''},{reason:''},{sourceReference:''},{proposalId:'wrong'},{reviewedAt:iso(reviewNow+1000)},{reviewedAt:iso(reviewNow-1000)}]){
  await assert.rejects(applyWarehouseResultReview(f.proposal,{...f.review,...patch},applyOptions));assert.equal(await readFile(warehouseFile,'utf8'),before);
 }
 await assert.rejects(applyWarehouseResultReview(f.proposal,f.review,{...options,expectedDataDirectory:join(directory,'wrong')}),/directory/);
});

test('proposal tampering and a changed warehouse fingerprint are rejected',async()=>{
 const f=await fixture();await assert.rejects(applyWarehouseResultReview({...f.proposal,result:{...f.proposal.result,actualSide:'away'}},f.review,applyOptions),/digest/);
 const stored=await readFeatureWarehouse();stored.predictions[0].conflictingFinalObservations[0].homeScore=999;await writeJson(warehouseFile,stored);
 await assert.rejects(applyWarehouseResultReview(f.proposal,f.review,applyOptions),/changed/);
});

test('a corrected journal result invalidates an old review while unrelated appends do not',async()=>{
 const f=await fixture();const other=structuredClone(f.slate);other.games[0].id='other';other.predictions[0].gameId='other';other.games[0].startTime=iso(reviewNow+3600000);other.predictions[0].startTime=other.games[0].startTime;other.predictions[0].predictionGeneratedAt=iso(reviewNow-1000);
 await recordPredictionJournal(other,{file:journalFile,now:reviewNow});
 assert.equal((await applyWarehouseResultReview(f.proposal,f.review,applyOptions)).status,'applied');
 await recordSlateSnapshot({...f.slate,predictions:[],games:[f.a,f.b]},{now:reviewNow});
 const updated=await prepareWarehouseResultReview(f.forecastId,options);
 await recordPredictionJournal({...f.slate,games:[f.b]},{file:journalFile,now:reviewNow+1000,lifecycle:'results_only'});
 await assert.rejects(applyWarehouseResultReview(updated,{...f.review,proposalId:updated.proposalId},{...applyOptions,now:reviewNow+2000}),/Journal evidence changed/);
});

test('repeated application is idempotent and an old review cannot override another dispute',async()=>{
 const f=await fixture();await applyWarehouseResultReview(f.proposal,f.review,applyOptions);const bytes=await readFile(warehouseFile,'utf8');
 assert.equal((await applyWarehouseResultReview(f.proposal,f.review,{...applyOptions,now:reviewNow+1000})).status,'already_applied');assert.equal(await readFile(warehouseFile,'utf8'),bytes);
 await recordSlateSnapshot({...f.slate,predictions:[],games:[f.b]});const row=(await readFeatureWarehouse()).predictions[0];assert.equal(row.resultEvidenceStatus,'disputed');assert.equal(row.resultAdjudications.length,1);
 await assert.rejects(applyWarehouseResultReview(f.proposal,f.review,applyOptions),/earlier review/);assert.equal((await warehouseCandidateRowsBefore()).length,0);
});

test('receipt or forecast inconsistencies cannot create a proposal',async()=>{
 const f=await fixture();const final={...f.a,away:{name:'Away',score:110},sourceMeta:{provider:'ESPN',fetchedAt:iso(base-1000)}};
 await recordPredictionJournal({...f.slate,games:[final]},{file:journalFile,now:reviewNow,lifecycle:'results_only'});
 await assert.rejects(prepareWarehouseResultReview(f.forecastId,options),/post-start/);
});

test('journal corruption and active journal owner locks fail closed',async()=>{
 const f=await fixture(),original=await readFile(journalFile,'utf8'),before=await readFile(warehouseFile,'utf8');
 await writeFile(journalFile,original+'partial');await assert.rejects(applyWarehouseResultReview(f.proposal,f.review,applyOptions),/incomplete/);assert.equal(await readFile(warehouseFile,'utf8'),before);await writeFile(journalFile,original);
 const lock=await open(journalFile+'.lock','wx');try{await assert.rejects(applyWarehouseResultReview(f.proposal,f.review,applyOptions),/locked/);assert.equal(await readFile(warehouseFile,'utf8'),before);}finally{await lock.close();await rm(journalFile+'.lock');}
});

test('a real child-process warehouse owner prevents lost updates without its lock being removed',{timeout:10000},async t=>{
 const f=await fixture(),before=await readFile(warehouseFile,'utf8');
 const code=`import {open,unlink} from 'node:fs/promises';const file=${JSON.stringify(warehouseFile+'.lock')};const lock=await open(file,'wx');process.stdout.write('READY');process.stdin.once('data',async()=>{await lock.close();await unlink(file);process.exit(0);});`;
 const child=spawn(process.execPath,['--input-type=module','-e',code],{stdio:['pipe','pipe','pipe'],windowsHide:true});t.after(()=>{if(child.exitCode===null)child.kill();});
 await once(child.stdout,'data');await assert.rejects(recordSlateSnapshot(f.slate),/locked/);await assert.rejects(applyWarehouseResultReview(f.proposal,f.review,applyOptions),/locked/);assert.equal(await readFile(warehouseFile,'utf8'),before);
 const closed=once(child,'close');child.stdin.write('release');assert.equal((await closed)[0],0);await applyWarehouseResultReview(f.proposal,f.review,applyOptions);
});

async function command(args){
 const child=spawn(process.execPath,[fileURLToPath(new URL('../scripts/review-warehouse-results.js',import.meta.url)),...args],{env:{...process.env},stdio:['ignore','pipe','pipe'],windowsHide:true});let stdout='',stderr='';child.stdout.on('data',value=>stdout+=value);child.stderr.on('data',value=>stderr+=value);const [exit]=await once(child,'close');return {exit,stdout,stderr};
}
test('CLI prepares an exclusive proposal file and applies an explicit review to the intended directory',async()=>{
 const f=await fixture(),proposalFile=join(directory,'proposal.json'),reviewFile=join(directory,'review.json');
 const prepared=await command(['--action=prepare','--forecast-id='+f.forecastId,'--journal='+journalFile,'--output='+proposalFile]);assert.equal(prepared.exit,0,prepared.stderr);
 const proposal=JSON.parse(await readFile(proposalFile,'utf8'));await writeFile(reviewFile,JSON.stringify({...f.review,proposalId:proposal.proposalId,reviewedAt:new Date().toISOString()}));
 const duplicate=await command(['--forecast-id='+f.forecastId,'--journal='+journalFile,'--output='+proposalFile]);assert.equal(duplicate.exit,1);
 const applied=await command(['--action=apply','--journal='+journalFile,'--proposal='+proposalFile,'--review='+reviewFile,'--data-directory='+directory]);assert.equal(applied.exit,0,applied.stderr);assert.equal(JSON.parse(applied.stdout).status,'applied');
});


test('reviewed labels become learnable only when the adjudication was applied',async()=>{
 const f=await fixture();await applyWarehouseResultReview(f.proposal,f.review,applyOptions);
 const {trainLocalMlModels}=await import('../src/localMl.js');const rows=await warehouseCandidateRowsBefore();
 assert.equal(trainLocalMlModels(rows,{now:base+2*3600000+1}).temporalRowsExcluded,1);
 assert.equal(trainLocalMlModels(rows,{now:reviewNow+1}).temporalRowsExcluded,0);
});

test('another event, model, horizon, vector or late warehouse observation cannot be matched',async()=>{
 const f=await fixture(),original=await readFeatureWarehouse();
 for(const patch of [{guildId:'other'},{leagueKey:'nhl'},{gameId:'other'},{modelVersion:'other'},{horizon:'T-30'},{startTime:iso(base+3600001)},{predictionGeneratedAt:iso(base-2000)},{predictionMode:'live'},{recordedAt:iso(base+3600001)},{outcomeProbabilities:{away:30,home:70,draw:0}}]){
  const changed=structuredClone(original);Object.assign(changed.predictions[0],patch);await writeJson(warehouseFile,changed);
  await assert.rejects(prepareWarehouseResultReview(f.forecastId,options));
 }
});

test('unknown future or changed-schedule source evidence remains ineligible for adjudication',async()=>{
 for(const kind of ['missing_receipt','future_receipt','schedule_changed','declared_winner_without_scores']){
  await rm(warehouseFile,{force:true});await rm(journalFile,{force:true});const f=await fixture();
  const final=structuredClone(f.a);final.away.score=110;
  if(kind==='missing_receipt')delete final.sourceMeta.fetchedAt;
  if(kind==='future_receipt')final.sourceMeta.fetchedAt=iso(reviewNow+1000);
  if(kind==='schedule_changed')final.startTime=iso(base+3600001);
  if(kind==='declared_winner_without_scores'){final.sportGroup='Combat';final.away.score=0;final.home.score=0;final.home.winner=true;}
  await recordPredictionJournal({...f.slate,games:[final]},{file:journalFile,now:reviewNow,lifecycle:'results_only'});
  await assert.rejects(prepareWarehouseResultReview(f.forecastId,options));
 }
});


test('review arguments are frozen before asynchronous locks and writes',async()=>{
 const f=await fixture(),proposal=structuredClone(f.proposal),review=structuredClone(f.review);
 const pending=applyWarehouseResultReview(proposal,review,applyOptions);proposal.result.actualSide='away';review.reviewer='changed-after-call';
 await pending;const row=(await readFeatureWarehouse()).predictions[0];assert.equal(row.adjudicatedResult.actualSide,'home');assert.equal(row.resultAdjudications[0].reviewer,'synthetic-reviewer');
 const exported=(await warehouseCandidateRowsBefore())[0];assert.equal(exported.resultEvidenceStatus,'adjudicated');assert.equal(exported.outcomeSourceIndependentlyVerified,false);
});

test('a fresh review after another dispute preserves both reviewed histories',async()=>{
 const f=await fixture();await applyWarehouseResultReview(f.proposal,f.review,applyOptions);
 await recordSlateSnapshot({...f.slate,predictions:[],games:[f.b]},{now:reviewNow+1000});
 const proposal=await prepareWarehouseResultReview(f.forecastId,{...options,now:reviewNow+2000});
 const review={...f.review,proposalId:proposal.proposalId,reviewedAt:proposal.createdAt,reason:'Second synthetic source review'};
 await applyWarehouseResultReview(proposal,review,{...applyOptions,now:reviewNow+3000});
 const row=(await readFeatureWarehouse()).predictions[0];assert.equal(row.resultAdjudications.length,2);assert.equal(row.resultAdjudications[0].proposalId,f.proposal.proposalId);assert.equal(row.resultAdjudications[1].disputeEvidence.observations.length,2);
});


test('reviewed three-way draws preserve the original distribution and a missed selection',async()=>{
 const f=await fixture('soccer'),draw={...f.a,away:{name:'Away',score:1},home:{name:'Home',score:1},sourceMeta:{provider:'ESPN',fetchedAt:iso(reviewNow-1)}};
 await recordPredictionJournal({...f.slate,games:[draw]},{file:journalFile,now:reviewNow,lifecycle:'results_only'});
 const proposal=await prepareWarehouseResultReview(f.forecastId,{...options,now:reviewNow+1000});
 await applyWarehouseResultReview(proposal,{...f.review,proposalId:proposal.proposalId,reviewedAt:proposal.createdAt},{...applyOptions,now:reviewNow+2000});
 const row=(await readFeatureWarehouse()).predictions[0];assert.equal(row.actualSide,'draw');assert.equal(row.actualWinner,'Draw');assert.equal(row.predictionCorrect,false);assert.equal(row.outcomeProbabilities.draw,30);
});


test('malformed review files fail without echoing their content',async()=>{
 const f=await fixture(),proposalFile=join(directory,'malformed-case-proposal.json'),reviewFile=join(directory,'malformed-case-review.json'),marker='REVIEW_TEXT_MUST_NOT_APPEAR';
 await writeFile(proposalFile,JSON.stringify(f.proposal));await writeFile(reviewFile,'{'+marker);
 const result=await command(['--action=apply','--journal='+journalFile,'--proposal='+proposalFile,'--review='+reviewFile,'--data-directory='+directory]);assert.equal(result.exit,1);assert.match(result.stderr,/malformed/);assert.equal(result.stderr.includes(marker),false);assert.equal((await readFeatureWarehouse()).predictions[0].resultEvidenceStatus,'disputed');
});


test('a later journal correction makes an applied review stale for learning without rewriting its audit',async()=>{
 const f=await fixture();await applyWarehouseResultReview(f.proposal,f.review,applyOptions);const before=await readFile(warehouseFile,'utf8');
 await recordPredictionJournal({...f.slate,games:[f.b]},{file:journalFile,now:reviewNow+1000,lifecycle:'results_only'});
 assert.equal((await warehouseCandidateRowsBefore()).length,0);assert.equal((await warehouseInventory()).staleAdjudicatedPredictionRecords,1);assert.equal(await readFile(warehouseFile,'utf8'),before);
});

test('reviewed rows cannot detach a label, forecast vector or availability time from their source proof',async()=>{
 const f=await fixture();await applyWarehouseResultReview(f.proposal,f.review,applyOptions);const original=await readFeatureWarehouse();
 for(const patch of [{actualSide:'away'},{predictionCorrect:false},{outcomeProbabilities:{away:30,home:70,draw:0}},{resolvedAt:f.proposal.result.observedAt},{modelVersion:'other'},{adjudicatedResult:{...f.proposal.result,homeScore:999}}]){
  const changed=structuredClone(original);Object.assign(changed.predictions[0],patch);await writeJson(warehouseFile,changed);
  assert.equal((await warehouseCandidateRowsBefore()).length,0);assert.equal((await warehouseInventory()).staleAdjudicatedPredictionRecords,1);
 }
});


test('read-only preparation and review writes cannot trigger legacy data migration',{timeout:10000},async()=>{
 const root=join(directory,'migration-case'),legacy=join(root,'legacy'),target=join(root,'target'),modules=join(root,'modules');
 await mkdir(legacy,{recursive:true});await mkdir(modules,{recursive:true});await writeFile(join(legacy,'legacy-marker.json'),'{}');
 const migratedClaim='final-result-fixture-2026-10-21-migrated.json';await writeFile(join(legacy,migratedClaim),JSON.stringify({schemaVersion:2,state:'protocol_v2',dateKey:'2026-10-21',guildId:'fixture',gameId:'migrated'}));await mkdir(join(legacy,migratedClaim+'.claims'));await writeFile(join(legacy,migratedClaim+'.claims','claim-0.json'),JSON.stringify({state:'claimed'}));
 await copyFile(fileURLToPath(new URL('../src/auditFileLock.js',import.meta.url)),join(modules,'auditFileLock.js'));await copyFile(fileURLToPath(new URL('../src/storage.js',import.meta.url)),join(modules,'storage.js'));await copyFile(fileURLToPath(new URL('../src/finalClaimStore.js',import.meta.url)),join(modules,'finalClaimStore.js'));await writeFile(join(modules,'package.json'),' {"type":"module"}');
 await writeFile(join(modules,'config.js'),`export const dataDir=${JSON.stringify(target)};export const legacyDataDir=${JSON.stringify(legacy)};`);
 const code=`import {access} from 'node:fs/promises';import {pathToFileURL} from 'node:url';const {readJson,writeJson,claimFinalResult}=await import(pathToFileURL(${JSON.stringify(join(modules,'storage.js'))}).href);const exists=async p=>access(p).then(()=>true,()=>false);await readJson(${JSON.stringify(join(target,'missing.json'))},null,{readOnly:true});const readOnlyCreated=await exists(${JSON.stringify(target)});await writeJson(${JSON.stringify(join(target,'review.json'))},{ok:true},{skipDataMigration:true});const reviewMigrated=await exists(${JSON.stringify(join(target,'legacy-marker.json'))});await readJson(${JSON.stringify(join(target,'ordinary.json'))});console.log(JSON.stringify({readOnlyCreated,reviewMigrated,ordinaryMigrated:await exists(${JSON.stringify(join(target,'legacy-marker.json'))}),migratedClaimBlocked:!(await claimFinalResult('2026-10-21','fixture','migrated')).claimed,migrationRequired:(await readJson(${JSON.stringify(join(target,'final-result-fixture-2026-10-21-migrated.json'))},null,{readOnly:true})).migrationRequired}));`;
 const child=spawn(process.execPath,['--input-type=module','-e',code],{env:{...process.env,NODE_ENV:'production',OMNIMOD_DISABLE_DATA_MIGRATION:'false'},stdio:['ignore','pipe','pipe'],windowsHide:true});let output='',errors='';child.stdout.on('data',value=>output+=value);child.stderr.on('data',value=>errors+=value);const [exit]=await once(child,'close');assert.equal(exit,0,errors);assert.deepEqual(JSON.parse(output),{readOnlyCreated:false,reviewMigrated:false,ordinaryMigrated:true,migratedClaimBlocked:true,migrationRequired:true});
});

test('preparation errors preserve malformed warehouse bytes without echoing them',async()=>{
 const f=await fixture(),marker='WAREHOUSE_TEXT_MUST_NOT_APPEAR';await writeFile(warehouseFile,'{'+marker);
 const result=await command(['--forecast-id='+f.forecastId,'--journal='+journalFile]);assert.equal(result.exit,1);assert.equal(result.stderr.includes(marker),false);assert.equal(await readFile(warehouseFile,'utf8'),'{'+marker);
});

test('review journal references cannot escape the configured data directory',async()=>{
 const f=await fixture(),outside=join(directory,'..','unrelated-journal.jsonl');
 await assert.rejects(prepareWarehouseResultReview(f.forecastId,{...options,journalFile:outside}),/configured data directory/);
 await assert.rejects(applyWarehouseResultReview(f.proposal,f.review,{...applyOptions,journalFile:outside}),/configured data directory/);
});


test('journal ambiguity invalidates reviewed learning proof without rewriting the warehouse receipt',async()=>{
 const f=await fixture();await applyWarehouseResultReview(f.proposal,f.review,applyOptions);
 assert.equal((await warehouseCandidateRowsBefore()).length,1);const before=await readFile(warehouseFile,'utf8');
 await recordPredictionJournal({...f.slate,games:[f.a,f.b]},{file:journalFile,now:reviewNow,lifecycle:'results_only'});
 assert.equal((await warehouseCandidateRowsBefore()).length,0);assert.equal(await readFile(warehouseFile,'utf8'),before);
 await assert.rejects(prepareWarehouseResultReview(f.forecastId,options),/undisputed/);
});
