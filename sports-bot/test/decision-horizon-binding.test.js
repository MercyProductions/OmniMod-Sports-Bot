import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {predictGame} from '../src/predictionEngine.js';
import {recordPredictionJournal,readPredictionJournal,forecastIssuanceEvidence} from '../src/predictionJournal.js';
import {predictionHorizon} from '../src/horizonEvaluation.js';
import {config} from '../src/config.js';
import {buildDailySlate} from '../src/sportsData.js';
import {auditSportsOperations} from '../src/operationalAudit.js';
const now=Date.parse('2099-02-01T18:00:00Z'),iso=delta=>new Date(now+delta).toISOString();
const game=(lead=90)=>({id:'scope-game',leagueKey:'nba',league:'NBA',sportGroup:'Basketball',statusKey:'scheduled',
 startTime:iso(lead*60000),away:{name:'Away',abbr:'AW'},home:{name:'Home',abbr:'HM'}});
async function file(t){const dir=await mkdtemp(join(tmpdir(),'sports-decision-horizon-'));t.after(()=>rm(dir,{recursive:true,force:true}));return join(dir,'journal.jsonl');}
function prediction(g,horizon='Daily',cutoff=now){return {...predictGame(g,1,{now:cutoff,forecastHorizon:horizon}),
 predictionGeneratedAt:new Date(cutoff).toISOString(),snapshotStage:'daily'};}

test('a declared Daily decision cannot be relabeled as T-90 by its publication lead time',async t=>{
 const g=game(),p=prediction(g,'Daily'),journal=await file(t);
 await recordPredictionJournal({guildId:'decision-scope',games:[g],predictions:[p]},{file:journal,now:now+100});
 const issued=(await readPredictionJournal(journal)).find(row=>row.type==='forecast');
 assert.equal(issued.payload.horizon,'Daily');
});

test('default decisions use the information-time bucket and explicit scopes remain explicit',()=>{
 for(const [lead,expected] of [[240,'Daily'],[90,'T-90'],[30,'T-30'],[10,'T-10']]){
  const p=predictGame(game(lead),1,{now});assert.equal(p.horizon,expected);
  assert.equal(p.forecastHorizonEvidence.origin,'information_lead_time');
 }
 for(const horizon of ['Daily','T-90','T-30','T-10']){
  const p=prediction(game(),horizon);assert.equal(p.horizon,horizon);assert.equal(p.forecastHorizonEvidence.origin,'declared_scope');
 }
});

test('publication crossing a time-bucket boundary cannot change the model decision scope',async t=>{
 const g=game(15+1/60000),p={...predictGame(g,1,{now}),predictionGeneratedAt:iso(2),snapshotStage:'daily'},journal=await file(t);
 assert.equal(p.horizon,'T-30');
 assert.equal(predictionHorizon({minutesToStart:(Date.parse(g.startTime)-(now+2))/60000}),'T-10');
 await recordPredictionJournal({games:[g],predictions:[p]},{file:journal,now:now+3});
 assert.equal((await readPredictionJournal(journal)).find(row=>row.type==='forecast').payload.horizon,'T-30');
});

test('invalid requested scopes fail without silently selecting a Daily champion or echoing input',()=>{
 for(const value of [false,0,'T-5',{},['Daily'],'PRIVATE_SCOPE_FIXTURE'])
  assert.throws(()=>prediction(game(),value),error=>error.message==='Unsupported forecast decision horizon');
});

test('newly declared contradictory or future scope evidence cannot become an eligible forecast',async t=>{
 for(const mutate of [p=>p.horizon='T-10',p=>p.forecastHorizonEvidence.horizon='T-30',
  p=>p.forecastHorizonEvidence.informationCutoffAt=iso(100),p=>p.inputChronology.cutoffAt=iso(-100),
  p=>p.forecastHorizonEvidence.origin='unrecognized',p=>p.forecastHorizonEvidence=null]){
  const g=game(),p=prediction(g),journal=await file(t);mutate(p);
  assert.equal(forecastIssuanceEvidence(p,g,{},now+200).recordEligibility,'unverifiable_or_late_observation');
  await recordPredictionJournal({games:[g],predictions:[p]},{file:journal,now:now+200});
  assert.equal((await readPredictionJournal(journal)).filter(row=>row.type==='forecast').length,0);
 }
});

test('scope evidence is frozen and an invalid repeat cannot acknowledge the original forecast',async t=>{
 const g=game(),p=prediction(g),journal=await file(t),slate={games:[g],predictions:[p]};
 await recordPredictionJournal(slate,{file:journal,now:now+100});const before=await readFile(journal);
 p.forecastHorizonEvidence.origin='PRIVATE_CHANGED_SCOPE';
 const repeat=await recordPredictionJournal(slate,{file:journal,now:now+200});
 assert.equal(repeat.verifiedIssuedForecasts.length,0);assert.deepEqual(await readFile(journal),before);
 assert.equal((await readPredictionJournal(journal)).find(row=>row.type==='forecast').payload.forecastHorizonEvidence.origin,'declared_scope');
});

test('legacy minute-based identities and stored bytes are retained without backfilling decision evidence',async t=>{
 const g=game(),p={...prediction(g),modelVersion:'legacy-scope-fixture'},journal=await file(t);
 delete p.horizon;delete p.forecastHorizonEvidence;const slate={games:[g],predictions:[p]};
 await recordPredictionJournal(slate,{file:journal,now:now+100});
 const rows=await readPredictionJournal(journal);let previousHash=null;
 for(const row of rows){delete row.eventHash;delete row.payload.forecastHorizonEvidence;row.previousHash=previousHash;
  row.eventHash=createHash('sha256').update(JSON.stringify(row)).digest('hex');previousHash=row.eventHash;}
 await writeFile(journal,rows.map(row=>JSON.stringify(row)).join('\n')+'\n');const before=await readFile(journal);
 await recordPredictionJournal(slate,{file:journal,now:now+200});assert.deepEqual(await readFile(journal),before);
 const issued=(await readPredictionJournal(journal)).find(row=>row.type==='forecast');assert.equal(issued.payload.horizon,'T-90');
 assert.equal(issued.payload.forecastHorizonEvidence,undefined);
 const audit=auditSportsOperations(await readPredictionJournal(journal),{asOf:now+200});
 assert.equal(audit.evidence.horizonDecisionScope.legacyOrMissing,1);assert.equal(audit.evidence.horizonDecisionScope.bound,0);
});

test('operational reporting distinguishes bound scopes from contradictory declared evidence',async t=>{
 const g=game(),p=prediction(g),journal=await file(t);await recordPredictionJournal({games:[g],predictions:[p]},{file:journal,now:now+100});
 const rows=await readPredictionJournal(journal),audit=auditSportsOperations(rows,{asOf:now+200});assert.equal(audit.evidence.horizonDecisionScope.bound,1);
 const changed=structuredClone(rows);changed.find(row=>row.type==='forecast').payload.forecastHorizonEvidence.horizon='T-10';
 assert.equal(auditSportsOperations(changed,{asOf:now+200}).evidence.horizonDecisionScope.invalid,1);
});

test('the real late-opening slate builder chooses and journals one consistent decision scope',async t=>{
 const settings={autoEnrichEnabled:false,autoLearningEnabled:false,featureWarehouseEnabled:false,historicalReplayEnabled:false,
  localMlEnabled:false,advancedDatasetsEnabled:false,autoOfficialSources:false,localOnly:false};
 const prior=Object.fromEntries(Object.keys(settings).map(key=>[key,config[key]]));Object.assign(config,settings);t.after(()=>Object.assign(config,prior));
 const start=new Date(Date.now()+90*60000).toISOString(),id='late-opening-scope';
 t.mock.method(globalThis,'fetch',async input=>{assert.match(new URL(input).pathname,/scoreboard/);return Response.json({events:[{
  id,date:start,season:{year:new Date().getUTCFullYear(),type:2},status:{type:{name:'STATUS_SCHEDULED',state:'pre'}},
  competitions:[{competitors:[{homeAway:'away',team:{id:'away',displayName:'Away',abbreviation:'AW'}},
   {homeAway:'home',team:{id:'home',displayName:'Home',abbreviation:'HM'}}]}]}]});});
 const slate=await buildDailySlate(new Date(start),{guildId:'late-opening-scope',includeOdds:false,leagueKeys:['nba'],marketStage:'daily'});
 assert.equal(slate.predictions.length,1);const p=slate.predictions[0];
 assert.equal(p.horizon,'T-90');
 const issued=(await readPredictionJournal()).find(row=>row.type==='forecast'&&row.payload.gameId===id);
 assert.equal(issued.payload.horizon,predictionHorizon(p));
});
