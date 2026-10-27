import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm,mkdir,open} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {promisify} from 'node:util';
import {execFile} from 'node:child_process';
const directory=await mkdtemp(join(tmpdir(),'sports-result-history-'));process.env.OMNIMOD_SPORTS_DATA_DIR=directory;
const {upsertIntelligence,importIntelligence,removeIntelligence,readIntelligenceStore,readManualResultHistory}=await import('../src/intelligenceStore.js');
const {applyManualResults}=await import('../src/manualResultMatching.js');
test.after(()=>rm(directory,{recursive:true,force:true}));
const row=(patch={})=>({id:'result',dateKey:'2026-10-20',league:'NBA',leagueKey:'nba',gameId:'event',startTime:'2026-10-20T17:00:00Z',awayTeam:'Away',homeTeam:'Home',awayScore:1,homeScore:2,...patch});
const file=guild=>join(directory,`intelligence-${guild}.json`),ledger=guild=>file(guild)+'.results.jsonl';

test('edits and deletions preserve immutable normalized records, actors and receipts',async()=>{
 const first=await upsertIntelligence('edits','results',row(),'first-admin'),prefix=await readFile(ledger('edits'),'utf8');
 const second=await upsertIntelligence('edits','results',row({awayScore:4}),'second-admin');await removeIntelligence('edits','results','result','third-admin');
 const records=await readManualResultHistory('edits');assert.equal(records.length,3);assert.equal(records[0].changes[0].after.awayScore,1);assert.equal(records[1].changes[0].before.recordedAt,first.recordedAt);assert.equal(records[1].changes[0].after.awayScore,4);
 assert.deepEqual(records.map(r=>r.actor),['first-admin','second-admin','third-admin']);assert.equal(records[2].changes[0].before.recordedAt,second.recordedAt);assert.equal(records[2].changes[0].after,null);
 assert.ok((await readFile(ledger('edits'),'utf8')).startsWith(prefix));assert.deepEqual((await readIntelligenceStore('edits')).results,{});assert.equal(second.manualRevision.sequence,2);
});

test('repeated IDs within one import preserve intermediate revisions and replay the last accepted row',async()=>{
 const result=await importIntelligence('batch',{results:[row(),row({awayScore:4}),row({awayScore:7})]},{actor:'importer'});assert.equal(result.counts.results,3);
 const history=await readManualResultHistory('batch');assert.equal(history.length,1);assert.deepEqual(history[0].changes.map(r=>r.after.awayScore),[1,4,7]);assert.equal(history[0].changes[1].before.awayScore,1);
 const stored=(await readIntelligenceStore('batch')).results.result;assert.equal(stored.awayScore,7);assert.equal(stored.manualRevision.index,2);
});

test('first mutation preserves legacy baseline without inventing historical import receipts',async()=>{
 const legacy=row({recordedAt:'2026-10-19T18:00:00Z',recordedBy:'legacy-admin'});await writeFile(file('legacy'),JSON.stringify({results:{result:legacy},teams:{untouched:{id:'untouched'}}}));
 await upsertIntelligence('legacy','results',row({awayScore:4}),'editor');const history=await readManualResultHistory('legacy');assert.deepEqual(history[0].legacyBaseline.result,legacy);assert.equal(history[0].changes[0].before.recordedAt,legacy.recordedAt);assert.match(history[0].baselineProvenance,/unverified/);
 assert.equal((await readIntelligenceStore('legacy')).teams.untouched.id,'untouched');
});

test('ledger replay repairs stale or missing result snapshots and survives a new process',async()=>{
 await upsertIntelligence('replay','results',row(),'admin');await writeFile(file('replay'),JSON.stringify({results:{result:row({awayScore:99})},teams:{keep:{id:'keep'}}}));
 assert.equal((await readIntelligenceStore('replay')).results.result.awayScore,1);assert.ok((await readIntelligenceStore('replay')).teams.keep);
 await rm(file('replay'));const script="const m=await import('./src/intelligenceStore.js');const s=await m.readIntelligenceStore('replay');console.log(JSON.stringify({score:s.results.result.awayScore,sequence:s.results.result.manualRevision.sequence}));";
 const output=await promisify(execFile)(process.execPath,['--input-type=module','-e',script],{cwd:resolve('.'),env:{...process.env,OMNIMOD_SPORTS_DATA_DIR:directory,OMNIMOD_DISABLE_DATA_MIGRATION:'true'}});assert.deepEqual(JSON.parse(output.stdout),{score:1,sequence:1});
});

test('malformed, truncated, altered and wrong-guild history fail closed without overwriting evidence',async()=>{
 for(const [guild,mutate] of [['truncated',v=>v.slice(0,-1)],['malformed',()=>'{private material\n'],['altered',v=>v.replace('"awayScore":1','"awayScore":9')],['wrongguild',v=>v.replace('"guildId":"wrongguild"','"guildId":"other"')]]){
  await upsertIntelligence(guild,'results',row(),'admin');const bad=mutate(await readFile(ledger(guild),'utf8'));await writeFile(ledger(guild),bad);const snapshot=await readFile(file(guild));
  await assert.rejects(readIntelligenceStore(guild),/history integrity/);await assert.rejects(upsertIntelligence(guild,'results',row({awayScore:4}),'editor'),/history integrity/);assert.equal(await readFile(ledger(guild),'utf8'),bad);assert.deepEqual(await readFile(file(guild)),snapshot);
 }
});

test('owner lock blocks mutations while read-only history does not create locks or stores',async()=>{
 assert.deepEqual(await readManualResultHistory('absent'),[]);await assert.rejects(readFile(file('absent')),{code:'ENOENT'});
 await mkdir(directory,{recursive:true});const handle=await open(file('locked')+'.lock','wx');try{await assert.rejects(upsertIntelligence('locked','results',row()),/locked/);await assert.rejects(readFile(ledger('locked')),{code:'ENOENT'});}finally{await handle.close();await rm(file('locked')+'.lock');}
});

test('concurrent child writers retain every accepted result under the shared store lock',async()=>{
 const run=promisify(execFile);const outputs=await Promise.all(Array.from({length:4},(_,index)=>run(process.execPath,['--input-type=module','-e',`const m=await import('./src/intelligenceStore.js');let done=false;for(let i=0;i<100;i++){try{await m.upsertIntelligence('children','results',${JSON.stringify(row({id:'child-'+index}))},'child-${index}');done=true;break;}catch(e){if(!/locked/.test(e.message))throw e;await new Promise(r=>setTimeout(r,10));}}if(!done)throw new Error('lock timeout');`],{cwd:resolve('.'),env:{...process.env,OMNIMOD_SPORTS_DATA_DIR:directory,OMNIMOD_DISABLE_DATA_MIGRATION:'true'}})));
 assert.equal(outputs.length,4);assert.equal(Object.keys((await readIntelligenceStore('children')).results).length,4);assert.equal((await readManualResultHistory('children')).length,4);
});

test('manual grading freezes the exact accepted ledger revision reference',async()=>{
 const accepted=await upsertIntelligence('binding','results',row(),'admin');const games=[{id:'event',leagueKey:'nba',startTime:row().startTime,away:{name:'Away'},home:{name:'Home'}}];applyManualResults(games,await readIntelligenceStore('binding'),row().dateKey);
 assert.deepEqual(games[0].manualResultEvidence.manualRevision,accepted.manualRevision);await upsertIntelligence('binding','results',row({awayScore:4}),'editor');assert.equal(games[0].manualResultEvidence.manualRevision.sequence,1);
});

test('queued writes freeze caller inputs before asynchronous locking',async()=>{
 const value=row(),payload={results:[row({id:'imported'})]};const first=upsertIntelligence('frozen','results',value,'admin'),second=importIntelligence('frozen',payload,{actor:'importer'});value.awayScore=99;payload.results[0].awayScore=88;await Promise.all([first,second]);
 const stored=await readIntelligenceStore('frozen');assert.equal(stored.results.result.awayScore,1);assert.equal(stored.results.imported.awayScore,1);
});

test('a process dying after durable history append cannot erase the accepted edit',async()=>{
 await upsertIntelligence('crash','results',row(),'before');
 const script=`const fs=await import('node:fs/promises');const m=await import('./src/intelligenceStore.js');fs.default.rename=async()=>process.exit(79);await m.upsertIntelligence('crash','results',${JSON.stringify(row({awayScore:4}))},'crashing-editor');`;
 await assert.rejects(promisify(execFile)(process.execPath,['--input-type=module','-e',script],{cwd:resolve('.'),env:{...process.env,OMNIMOD_SPORTS_DATA_DIR:directory,OMNIMOD_DISABLE_DATA_MIGRATION:'true'}}),error=>error.code===79);
 const snapshot=JSON.parse(await readFile(file('crash'),'utf8'));assert.equal(snapshot.results.result.awayScore,1);
 const history=await readManualResultHistory('crash');assert.equal(history.length,2);assert.equal(history[1].changes[0].after.awayScore,4);assert.equal((await readIntelligenceStore('crash')).results.result.awayScore,4);
 await assert.rejects(upsertIntelligence('crash','results',row()),/locked/);
});

test('missing or validly truncated ledgers cannot silently fall back to the current snapshot',async()=>{
 for(const guild of ['missing-history','rolled-back-history']){
  await upsertIntelligence(guild,'results',row(),'first');const prefix=await readFile(ledger(guild));await upsertIntelligence(guild,'results',row({awayScore:4}),'second');
  if(guild==='missing-history')await rm(ledger(guild));else await writeFile(ledger(guild),prefix);
  await assert.rejects(readIntelligenceStore(guild),/missing or rolled back/);await assert.rejects(upsertIntelligence(guild,'results',row()),/missing or rolled back/);
 }
});
