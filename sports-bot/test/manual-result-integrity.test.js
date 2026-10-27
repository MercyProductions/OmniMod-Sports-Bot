import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {fakeDiscord} from '../test-support/discord-transport.mjs';
const directory=await mkdtemp(join(tmpdir(),'sports-manual-results-'));process.env.OMNIMOD_SPORTS_DATA_DIR=directory;
const {importIntelligence,upsertIntelligence,readIntelligenceStore}=await import('../src/intelligenceStore.js');
const {applyManualResults}=await import('../src/manualResultMatching.js');
const {attachFinalGrade,refreshFinalGrades}=await import('../src/sportsData.js');
const {correctionEvidence}=await import('../src/finalResultRevision.js');
const {finalOutcomeSide}=await import('../src/dataValidation.js');
const {selectEloResults}=await import('../src/modelEvaluation.js');
const {recordPredictionJournal,readPredictionJournal}=await import('../src/predictionJournal.js');
const {journalResultState}=await import('../src/journalResults.js');
const {recordSlateSnapshot,readFeatureWarehouse}=await import('../src/featureWarehouse.js');
const {deliverFinalBatch}=await import('../src/finalDelivery.js');
const {buildCommands}=await import('../src/commands.js');
const {handleSportsDataCommand}=await import('../src/dataCommandHandler.js');
test.after(()=>rm(directory,{recursive:true,force:true}));
const dateKey='2026-10-20',time='2026-10-20T17:00:00Z',later='2026-10-20T21:00:00Z';
function game(id='one',startTime=time){return {id,leagueKey:'nba',league:'NBA',sportGroup:'Basketball',startTime,dateKey,statusKey:'scheduled',source:'Fixture provider',sourceMeta:{provider:'fixture',fetchedAt:'2026-10-20T16:00:00Z',cacheState:'network'},away:{name:'Away',abbr:'AW',score:null},home:{name:'Home',abbr:'HM',score:null}};}
function row(patch={}){return {dateKey,league:'NBA',leagueKey:'nba',awayTeam:'Away',homeTeam:'Home',awayScore:1,homeScore:2,...patch};}
async function imported(rows,guild='manual-'+randomUUID()){
 const result=await importIntelligence(guild,{results:rows},{actor:'test-admin'});assert.equal(result.errors.length,0);return {guild,store:await readIntelligenceStore(guild),result};
}
function slate(games,guild='manual-'+randomUUID()){
 const prediction=games.map((g,i)=>({gameId:g.id,leagueKey:g.leagueKey,league:g.league,startTime:g.startTime,index:i+1,startTimeLocal:'Fixture',matchup:'Away @ Home',modelVersion:'manual-fixture',predictionGeneratedAt:'2026-10-20T16:00:00Z',predictionMode:'pregame',predictedSide:'home',predictedWinner:'Home',predictionConfidence:'65%',outcomeProbabilities:{away:35,home:65,draw:0},evidenceQuality:'60%'}));
 return {dateKey,guildId:guild,generatedAt:prediction[0].predictionGeneratedAt,games,predictions:prediction,finalReplies:{}};
}

test('normalized doubleheaders preserve distinct event scope even when scores and teams are identical',async()=>{
 const {store}=await imported([row({gameId:'one',startTime:time}),row({gameId:'two',startTime:later})]);const rows=Object.values(store.results);
 assert.equal(rows.length,2);assert.notEqual(rows[0].id,rows[1].id);assert.deepEqual(rows.map(r=>r.startTime),[time,later].map(v=>new Date(v).toISOString()));assert.equal(selectEloResults(rows).rows.length,2);assert.equal(rows[0].neutralSite,null);
});

test('invalid scores cannot become manual zeroes or negative outcomes; explicit zero remains valid',async()=>{
 for(const bad of [-1,true,false,' ',null,{},'not-a-score']){
  const result=await importIntelligence('bad-'+randomUUID(),{results:[row({awayScore:bad})]});assert.equal(result.counts.results,0);assert.equal(result.errors.length,1);
 }
 const {store}=await imported([row({awayScore:0,homeScore:0})]);assert.equal(Object.values(store.results)[0].awayScore,0);
});

test('explicit event IDs and starts bind only the intended doubleheader',async()=>{
 const {store}=await imported([row({gameId:'two',startTime:later,awayScore:4,homeScore:1})]),games=[game(),game('two',later)],audit=[];
 applyManualResults(games,store,dateKey,{audit});assert.equal(games[0].statusKey,'scheduled');assert.equal(games[1].away.score,4);assert.equal(games[1].manualResultEvidence.eventIdentityVerified,true);assert.equal(audit[0].status,'applied');
 assert.equal(games[1].manualResultEvidence.recordedAt,Object.values(store.results)[0].recordedAt);assert.notEqual(games[1].manualResultEvidence.recordedAt,games[1].sourceMeta.fetchedAt);
});

test('legacy unique matches work but ambiguous unscoped doubleheaders remain untouched',async()=>{
 const {store}=await imported([row()]),single=[game()];applyManualResults(single,store,dateKey);assert.equal(single[0].statusKey,'final');assert.equal(single[0].manualResultEvidence.eventIdentityVerified,false);
 const games=[game(),game('two',later)],audit=[];applyManualResults(games,store,dateKey,{audit});assert.ok(games.every(g=>g.statusKey==='scheduled'));assert.equal(audit[0].reason,'ambiguous_manual_event');
});

test('provided mismatched scope never falls back to a same-team event',async()=>{
 for(const patch of [{gameId:'wrong'},{startTime:later},{gameId:'one',startTime:later}]){
  const {store}=await imported([row(patch)]),games=[game()],audit=[];applyManualResults(games,store,dateKey,{audit});assert.equal(games[0].statusKey,'scheduled');assert.equal(audit[0].reason,'manual_scope_mismatch');
 }
 const {store}=await imported([row({startTime:later})]),games=[game(),game('two',later)];applyManualResults(games,store,dateKey);assert.equal(games[1].statusKey,'final');
});

test('bad receipt chronology and ambiguous source observations cannot be overridden',async()=>{
 const {store}=await imported([row({gameId:'one',startTime:time})]),original=Object.values(store.results)[0];
 for(const patch of [{recordedAt:'2026-10-20T15:00:00Z'},{recordedAt:'2099-01-01T00:00:00Z'},{observedAt:'2026-10-20T15:00:00Z'}]){
  const games=[game()],audit=[];applyManualResults(games,{results:{record:{...original,...patch}}},dateKey,{audit});assert.equal(games[0].statusKey,'scheduled');assert.equal(audit[0].reason,'manual_receipt_chronology_unverified');
 }
 const games=[game(),{...game(),detail:'conflicting source context'}],audit=[];applyManualResults(games,store,dateKey,{audit});assert.equal(audit[0].reason,'ambiguous_manual_event');
});

test('conflicting manual outcomes quarantine prior journal and warehouse grades without changing the forecast',async()=>{
 const value=slate([game()]);await recordPredictionJournal(value,{now:Date.parse(value.generatedAt)});await recordSlateSnapshot(value,{now:Date.parse(value.generatedAt)});
 Object.assign(value.games[0],{statusKey:'final'});value.games[0].away.score=1;value.games[0].home.score=2;value.games[0].sourceMeta.fetchedAt='2026-10-20T23:00:00Z';
 await recordPredictionJournal(value,{now:Date.parse('2026-10-20T23:00:01Z'),lifecycle:'results_only'});await recordSlateSnapshot(value,{now:Date.parse('2026-10-20T23:00:01Z')});
 const original=(await readPredictionJournal()).find(r=>r.type==='forecast'&&r.payload.guildId===value.guildId);assert.ok(journalResultState(await readPredictionJournal()).eligible.has(original.payload.forecastId));
 const {store}=await imported([row({id:'a',gameId:'one',startTime:time}),row({id:'b',gameId:'one',startTime:time,awayScore:4,homeScore:1})]);const audit=[];applyManualResults(value.games,store,dateKey,{audit});
 assert.equal(finalOutcomeSide(value.games[0]),'');assert.equal(attachFinalGrade(value.games[0],value.predictions[0]).predictionCorrect,null);
 await recordPredictionJournal(value,{lifecycle:'results_only'});await recordSlateSnapshot(value);const records=await readPredictionJournal();assert.equal(journalResultState(records).eligible.has(original.payload.forecastId),false);assert.deepEqual(records.find(r=>r.eventHash===original.eventHash),original);
 const rows=(await readFeatureWarehouse()).predictions.filter(r=>r.guildId===value.guildId);assert.equal(rows.length,1);assert.equal(rows[0].resultEvidenceStatus,'disputed');assert.equal(audit.filter(r=>r.reason==='conflicting_manual_results').length,2);
 const before=records.length;await recordPredictionJournal(value,{lifecycle:'results_only'});assert.equal((await readPredictionJournal()).length,before);
});

test('manual outcome provenance never borrows a provider fetch timestamp',async()=>{
 const value=slate([game()]);await recordPredictionJournal(value,{now:Date.parse(value.generatedAt)});const {store}=await imported([row({gameId:'one',startTime:time})]);applyManualResults(value.games,store,dateKey);
 await recordPredictionJournal(value,{lifecycle:'results_only'});const forecast=(await readPredictionJournal()).find(r=>r.type==='forecast'&&r.payload.guildId===value.guildId),result=journalResultState(await readPredictionJournal()).eligible.get(forecast.payload.forecastId).payload;
 assert.equal(result.providerFetchedAt,null);assert.equal(result.resultSource.kind,'manual_result');assert.equal(result.resultSource.recordedAt,Object.values(store.results)[0].recordedAt);
});

test('soccer manual scores require an explicit regulation basis and retain extra-time uncertainty',async()=>{
 for(const basis of ['unknown','full_game','regulation']){
  const {store}=await imported([row({league:'EPL',leagueKey:'epl',gameId:'soccer',startTime:time,scoreBasis:basis,awayScore:1,homeScore:1})]),target={...game('soccer'),leagueKey:'epl',league:'EPL',sportGroup:'Soccer',detail:'Final after extra time'};
  applyManualResults([target],store,dateKey);assert.equal(finalOutcomeSide(target),basis==='regulation'?'draw':'');
 }
});

test('source checks cannot be silently carried into an edited result, and malformed scope is rejected',async()=>{
 const {guild,store}=await imported([row({id:'checked',gameId:'one',startTime:time,sourceChecked:true,sourceReference:'https://example.invalid/score'})]);assert.equal(store.results.checked.sourceChecked,true);
 const updated=await upsertIntelligence(guild,'results',row({id:'checked',gameId:'one',startTime:time,awayScore:4}),'test-admin');assert.equal(updated.sourceChecked,false);assert.equal(updated.sourceReference,'https://example.invalid/score');
 for(const patch of [{startTime:'2026-10-20T17:00:00'},{scoreBasis:'penalties'},{observedAt:'2099-01-01T00:00:00Z'},{sourceReference:'https://user:password@example.invalid/score'}]){
  const result=await importIntelligence('invalid-'+randomUUID(),{results:[row(patch)]});assert.equal(result.counts.results,0);assert.equal(result.errors.length,1);
 }
});

test('reviewed and uniquely scoped manual corrections use local receipts while retaining original model probabilities',async t=>{
 const remotePath=await mkdtemp(join(tmpdir(),'sports-manual-correction-'));t.after(()=>rm(remotePath,{recursive:true,force:true}));const remote=await fakeDiscord(remotePath),value=slate([game()],'transport');
 value.games[0].statusKey='final';value.games[0].away.score=1;value.games[0].home.score=2;value.predictions[0]=attachFinalGrade(value.games[0],value.predictions[0],Date.now()-60000);value.newFinals=[{game:value.games[0],prediction:value.predictions[0]}];
 const first=await deliverFinalBatch(remote.client,value);assert.equal(first.postedCount,1);
 const {store}=await imported([row({gameId:'one',startTime:time,awayScore:4,homeScore:1,sourceChecked:true,sourceReference:'https://example.invalid/verified-score'})]);applyManualResults(value.games,store,dateKey);value.predictions[0]=attachFinalGrade(value.games[0],value.predictions[0]);value.finalReplies=first.finalReplies;value.newFinals=[{game:value.games[0],prediction:value.predictions[0]}];
 const corrected=await deliverFinalBatch(remote.client,value);assert.equal(corrected.failures.length,0);assert.equal(corrected.correctedCount,1);assert.equal(remote.rows.length,1);assert.equal(remote.counters.edits,1);assert.match(remote.rows[0].embeds[0].description,/Home.*65%/);
});

test('result command exposes scoped inputs and passes them through the admin-only handler',async()=>{
 const command=buildCommands().find(r=>r.name==='sportsdata').options.find(r=>r.name==='result-add');assert.ok(command.options.length<=25);for(const name of ['game_id','start_time','score_basis','source_reference','source_checked','observed_at','result_id'])assert.ok(command.options.some(r=>r.name===name));
 const values={date:dateKey,league:'nba',away:'Away',home:'Home',away_score:1,home_score:2,game_id:'command-event',start_time:time,score_basis:'full_game',source_reference:'https://example.invalid/command-score',source_checked:true,result_id:'command-record'};
 const guild='command-'+randomUUID(),messages=[];const interaction={guildId:guild,guild:{id:guild},member:{permissions:{has:()=>true}},user:{id:'command-admin'},options:{getSubcommand:()=> 'result-add',getString:name=>values[name]??null,getNumber:name=>values[name]??null,getBoolean:name=>values[name]??null},deferReply:async()=>{},editReply:async value=>messages.push(value),reply:async value=>messages.push(value)};
 await handleSportsDataCommand(interaction);const record=(await readIntelligenceStore(guild)).results['command-record'];assert.equal(record.gameId,'command-event');assert.equal(record.sourceChecked,true);assert.equal(record.recordedBy,'command-admin');assert.match(messages[0],/Event binding/);
});

test('actual final refresh binds an imported doubleheader result to the intended event',async t=>{
 const {guild}=await imported([row({gameId:'two',startTime:later,awayScore:4,homeScore:1})]),value=slate([game(),game('two',later)],guild);
 const originalFetch=globalThis.fetch;t.after(()=>globalThis.fetch=originalFetch);await rm(join(directory,'provider-cache'),{recursive:true,force:true});
 globalThis.fetch=async url=>{assert.match(String(url),/scoreboard/);return new Response(JSON.stringify({events:value.games.map(g=>({id:g.id,date:g.startTime,status:{type:{state:'post',completed:true,name:'STATUS_FINAL'}},competitions:[{competitors:[{homeAway:'away',score:'1',team:{id:'a',displayName:'Away',abbreviation:'AW'}},{homeAway:'home',score:'2',team:{id:'h',displayName:'Home',abbreviation:'HM'}}]}]}))}),{headers:{'content-type':'application/json'}});};
 const result=await refreshFinalGrades(value);assert.equal(result.games.find(g=>g.id==='one').away.score,1);assert.equal(result.games.find(g=>g.id==='two').away.score,4);assert.deepEqual(result.predictions.map(r=>r.predictionCorrect),[true,false]);assert.equal(result.manualResultAudit.filter(r=>r.status==='applied').length,1);
});


test('untrusted legacy source references cannot authorize a manual correction',async()=>{
 const now=Date.now(),receipt=new Date(now-1000).toISOString(),prior={resultObservedAt:new Date(now-5000).toISOString()},revision={observedAt:new Date(now).toISOString()};
 for(const sourceReference of ['file:///local/score','not-a-url','https://user:password@example.invalid/score']){
  const record=row({id:'legacy',gameId:'one',startTime:time,recordedAt:receipt,sourceChecked:true,sourceReference,recordedBy:'admin'}),games=[game()];
  applyManualResults(games,{results:{legacy:record}},dateKey,{now});assert.equal(games[0].manualResultEvidence.sourceChecked,false);
  assert.equal(correctionEvidence({...games[0],manualResultEvidence:{...games[0].manualResultEvidence,sourceChecked:true}},prior,revision),false);
 }
});
