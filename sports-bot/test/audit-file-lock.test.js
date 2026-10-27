import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {withAuditFileLock} from '../src/auditFileLock.js';

async function fixture(t){
 const dir=await fs.mkdtemp(join(tmpdir(),'sports-audit-lock-'));
 t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 return join(dir,'audit.json');
}
const denied=()=>Object.assign(new Error('simulated Windows create denial'),{code:'EPERM'});

test('Windows transient create denial retries exclusively before executing once',{skip:process.platform!=='win32'},async t=>{
 const file=await fixture(t),original=fs.open;let attempts=0,runs=0;
 t.mock.method(fs,'open',async(...args)=>{assert.equal(args[1],'wx');if(++attempts<3)throw denied();return original(...args);});
 assert.equal(await withAuditFileLock(file,async()=>{runs++;return 42;}),42);
 assert.equal(attempts,3);assert.equal(runs,1);
 await assert.rejects(fs.stat(file+'.lock'),{code:'ENOENT'});
});

test('Windows retry discovering an existing owner preserves its bytes and never executes',{skip:process.platform!=='win32'},async t=>{
 const file=await fixture(t),original=fs.open;await fs.writeFile(file+'.lock','existing-owner');let attempts=0;
 t.mock.method(fs,'open',async(...args)=>{if(++attempts===1)throw denied();return original(...args);});
 await assert.rejects(withAuditFileLock(file,()=>assert.fail('must not execute')),/locked/);
 assert.equal(attempts,2);assert.equal(await fs.readFile(file+'.lock','utf8'),'existing-owner');
});

test('persistent Windows permission denial is bounded and preserves the underlying failure',{skip:process.platform!=='win32'},async t=>{
 const file=await fixture(t);let attempts=0;
 t.mock.method(fs,'open',async()=>{attempts++;throw denied();});
 await assert.rejects(withAuditFileLock(file,()=>assert.fail('must not execute')),{code:'EPERM'});
 assert.equal(attempts,5);await assert.rejects(fs.stat(file+'.lock'),{code:'ENOENT'});
});

test('other creation errors are not retried or relabeled as lock contention',async t=>{
 const file=await fixture(t);let attempts=0;
 t.mock.method(fs,'open',async()=>{attempts++;throw Object.assign(new Error('read-only fixture'),{code:'EROFS'});});
 await assert.rejects(withAuditFileLock(file,()=>assert.fail('must not execute')),{code:'EROFS'});
 assert.equal(attempts,1);
});

test('operation failure releases only the acquired owner lock',async t=>{
 const file=await fixture(t);
 await assert.rejects(withAuditFileLock(file,async()=>{throw new Error('operation fixture');}),/operation fixture/);
 await assert.rejects(fs.stat(file+'.lock'),{code:'ENOENT'});
 assert.equal(await withAuditFileLock(file,async()=>true),true);
});
