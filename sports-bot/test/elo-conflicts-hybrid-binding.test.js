import {mkdtemp,cp,appendFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import test from 'node:test';
import assert from 'node:assert/strict';
import {selectEloResults,buildEloRatings,lookupElo} from '../src/modelEvaluation.js';
import {hybridArtifactId} from '../src/hybridArtifact.js';
import {modelDecisionForSport,applyCandidateDecision} from '../src/modelRegistry.js';
import {CURRENT_MODEL_VERSION} from '../src/modelIdentity.js';
function game(overrides={}){return {id:'event-1',dateKey:'2026-10-20',startTime:'2026-10-20T18:00:00Z',leagueKey:'nba',sportGroup:'Basketball',awayTeam:'A',homeTeam:'H',awayScore:90,homeScore:100,neutralSite:false,...overrides};}

test('identical cross-source results update Elo only once',()=>{
 const a=game(),b=game({id:'other-source'});
 assert.deepEqual(buildEloRatings({},[],[a,b]),buildEloRatings({},[],[a]));
 const selection=selectEloResults([a,b]);assert.equal(selection.audit.selectedEvents,1);assert.equal(selection.audit.duplicateRows,1);
});

test('conflicting scores or venue facts quarantine the event instead of updating twice',()=>{
 for(const other of [game({homeScore:80}),game({neutralSite:true})]){
  const rows=[game(),other],selection=selectEloResults(rows);
  assert.equal(selection.rows.length,0);assert.equal(selection.audit.conflictingEvents,1);
  assert.equal(lookupElo(buildEloRatings({},[],rows),'nba','H'),1500);
  assert.deepEqual(buildEloRatings({},[],rows),buildEloRatings({},[],rows.reverse()));
 }
});

test('distinct timed doubleheaders survive while ambiguous date-only copies stay excluded',()=>{
 const early=game({id:'first'}),late=game({id:'second',startTime:'2026-10-20T23:00:00Z',homeScore:80});
 const selection=selectEloResults([early,late,game({id:'untimed',startTime:null})]);
 assert.equal(selection.rows.length,2);assert.equal(selection.audit.ambiguousUntimedRows,1);
 assert.equal(selection.audit.conflictingEvents,0);
 const rescheduled=selectEloResults([early,{...early,startTime:late.startTime}]);
 assert.equal(rescheduled.rows.length,0);assert.equal(rescheduled.audit.conflictingEvents,1);
});

test('dated legacy results remain one explicitly limited event and deterministic across input order',()=>{
 const rows=[game({id:'z',startTime:null}),game({id:'a',startTime:null})];
 assert.equal(selectEloResults(rows).rows.length,1);
 assert.deepEqual(selectEloResults(rows).rows,selectEloResults(rows.reverse()).rows);
});

function approved(){const artifactId=hybridArtifactId('basketball',.38);return {champion:'hybrid',championModelId:'sport-specialist-hybrid-v2',specialistWeight:.38,
 approvedArtifactId:artifactId,selectionReview:{status:'review_ready',candidate:'hybrid',sport:'basketball',modelVersion:CURRENT_MODEL_VERSION,reportHash:'b'.repeat(64),artifactId},
 evaluation:{cohort:{prospectiveRecordsVerified:true,key:`production|${CURRENT_MODEL_VERSION}|Daily`},models:{hybrid:{sampleSize:100}}}};}

test('hybrid recipe artifact binds sport, source version and blend weight',()=>{
 const a=hybridArtifactId('basketball',.38);
 assert.match(a,/^[a-f0-9]{64}$/);assert.equal(a,hybridArtifactId('basketball',.38));
 assert.notEqual(a,hybridArtifactId('baseball',.38));assert.notEqual(a,hybridArtifactId('basketball',.4));
 assert.equal(hybridArtifactId('basketball',NaN),null);
});

test('hybrid registry read rejects stale artifact approval and changed blend weight',()=>{
 const row=approved();assert.equal(modelDecisionForSport({sports:{basketball:row}},'basketball').champion,'hybrid');
 for(const change of [{approvedArtifactId:'c'.repeat(64)}, {specialistWeight:.45},
   {selectionReview:{...row.selectionReview,artifactId:'c'.repeat(64)},approvedArtifactId:'c'.repeat(64)}]){
  const decision=modelDecisionForSport({sports:{basketball:{...row,...change}}},'basketball');
  assert.equal(decision.champion,'evidence');assert.equal(decision.status,'provenance_revalidation_required');
 }
});

test('explicit promotion request cannot approve arbitrary hybrid hashes',()=>{
 const good={evidence:{sampleSize:100},hybrid:{sampleSize:100},brierImprovement:.01,logLossImprovement:.01};
 const review={...approved().selectionReview,artifactId:'c'.repeat(64)};
 const decision=applyCandidateDecision({},'basketball',good,good,{allowPromotion:true,selectionReview:review});
 assert.equal(decision.entry.champion,'evidence');
});


test('a new process detects changed hybrid source bytes without touching the original repository',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'sports-hybrid-source-'));
 t.after(()=>rm(directory,{recursive:true,force:true}));
 await cp(new URL('../src/',import.meta.url),join(directory,'src'),{recursive:true});
 // No credentials, data or dependencies are copied.
 await writeFile(join(directory,'package.json'),JSON.stringify({type:'module'}));
 const url=pathToFileURL(join(directory,'src','hybridArtifact.js')).href;
 const code=`import {hybridArtifactId} from ${JSON.stringify(url)};process.stdout.write(String(hybridArtifactId('basketball',.38)))`;
 const before=execFileSync(process.execPath,['--input-type=module','-e',code],{encoding:'utf8'});
 await appendFile(join(directory,'src','sportModels.js'),'\n// isolated source mutation fixture\n');
 const after=execFileSync(process.execPath,['--input-type=module','-e',code],{encoding:'utf8'});
 assert.match(before,/^[a-f0-9]{64}$/);assert.notEqual(before,after);
 await rm(join(directory,'src','sportModels.js'));
 assert.equal(execFileSync(process.execPath,['--input-type=module','-e',code],{encoding:'utf8'}),'null');
});
