import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,appendFile,rm,open,unlink,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {recordForwardCapture,inspectForwardEvidence} from '../src/forwardEvidence.js';
async function fixture(t){
 const root=await mkdtemp(join(tmpdir(),'sports-evidence-'));t.after(()=>rm(root,{recursive:true,force:true}));
 await mkdir(join(root,'runtime','provider-cache'),{recursive:true});
 await writeFile(join(root,'CHECKPOINT.json'),JSON.stringify({sourceCommit:'fixture-source',artifactId:'fixture-artifact'}));
 await writeFile(join(root,'runtime','provider-cache','provider.json'),'{"value":1}\n');
 await writeFile(join(root,'runtime','prediction-journal.jsonl'),'original journal prefix\n');return root;
}
const capture=()=>({schema:'sports-forward-capture-v1',kind:'collection',capturedAt:new Date().toISOString(),sourceCommit:'fixture-source',artifactId:'fixture-artifact',liveOrders:false,discordPosts:0,slate:{predictions:[]}});

test('receipts freeze capture, provider inputs and append-only journal prefix',async t=>{
 const root=await fixture(t),receipt=await recordForwardCapture(root,capture());
 assert.equal(receipt.sequence,1);const state=await inspectForwardEvidence(root);assert.equal(state.receipts.length,1);assert.equal(state.providerBlobs,1);
 await appendFile(join(root,'runtime','prediction-journal.jsonl'),'later journal entry\n');assert.equal((await inspectForwardEvidence(root)).receipts.length,1);
});

test('provider refreshes retain the original response version and reuse identical blobs',async t=>{
 const root=await fixture(t),first=await recordForwardCapture(root,capture());await recordForwardCapture(root,capture());
 assert.equal((await readdir(join(root,'evidence-blobs'))).length,1);
 await writeFile(join(root,'runtime','provider-cache','provider.json'),'{"value":2}\n');const next=await recordForwardCapture(root,capture());
 assert.notEqual(first.providerFiles[0].sha256,next.providerFiles[0].sha256);assert.equal((await inspectForwardEvidence(root)).providerBlobs,2);
 assert.equal(await readFile(join(root,'evidence-blobs',first.providerFiles[0].sha256+'.json'),'utf8'),'{"value":1}\n');
});

test('capture or frozen provider tampering fails without rewriting the ledger',async t=>{
 for(const kind of ['capture','provider']){
  const root=await fixture(t),receipt=await recordForwardCapture(root,capture()),before=await readFile(join(root,'capture-ledger.jsonl'));
  const target=kind==='capture'?join(root,'captures',receipt.filename):join(root,'evidence-blobs',receipt.providerFiles[0].sha256+'.json');await writeFile(target,'changed');
  await assert.rejects(inspectForwardEvidence(root));await assert.rejects(recordForwardCapture(root,capture()));assert.deepEqual(await readFile(join(root,'capture-ledger.jsonl')),before);
 }
});

test('journal modification and valid tail rollback cannot silently pass receipt verification',async t=>{
 for(const kind of ['journal','ledger']){
  const root=await fixture(t);await recordForwardCapture(root,capture());const prefix=await readFile(join(root,'capture-ledger.jsonl'));await recordForwardCapture(root,capture());
  await writeFile(kind==='journal'?join(root,'runtime','prediction-journal.jsonl'):join(root,'capture-ledger.jsonl'),kind==='journal'?'changed':prefix);
  await assert.rejects(inspectForwardEvidence(root));
 }
});

test('orphan captures and interrupted receipt tails are preserved rather than adopted',async t=>{
 const root=await fixture(t);await mkdir(join(root,'captures'));await writeFile(join(root,'captures','unreceipted.json'),'{}');
 await assert.rejects(recordForwardCapture(root,capture()),/Unreceipted/);assert.equal(await readFile(join(root,'captures','unreceipted.json'),'utf8'),'{}');
 const other=await fixture(t);await recordForwardCapture(other,capture());await appendFile(join(other,'capture-ledger.jsonl'),'{');await assert.rejects(inspectForwardEvidence(other),/incomplete tail/);
});

test('evidence owner and original trial identities cannot be overwritten',async t=>{
 const root=await fixture(t),file=join(root,'capture-ledger.jsonl.lock'),owner=await open(file,'wx');
 try{await assert.rejects(recordForwardCapture(root,capture()),/locked/);assert.equal((await readFile(file)).length,0);}finally{await owner.close();await unlink(file);}
 await assert.rejects(recordForwardCapture(root,{...capture(),artifactId:'different'}),/identity/);
 assert.equal((await inspectForwardEvidence(root)).receipts.length,0);
});
