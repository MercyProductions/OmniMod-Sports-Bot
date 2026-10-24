import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {createProspectiveNetwork} from '../scripts/prospective-network.mjs';
async function setup(t,options={}){const directory=await mkdtemp(join(tmpdir(),'sports-request-proof-'));t.after(()=>rm(directory,{recursive:true,force:true}));return {directory,...await createProspectiveNetwork({directory,...options})};}
test('only public GET requests reach the fetcher and redirects/credentials are forced safe',async t=>{
 let seen;const n=await setup(t,{fetchImpl:async(input,options)=>{seen=options;return new Response('{}');}});
 await n.fetch('https://api-web.nhle.com/v1/score/2099-02-01',{redirect:'follow',credentials:'include'});assert.equal(seen.redirect,'error');assert.equal(seen.credentials,'omit');const s=await n.summary();assert.equal(s.requests,1);assert.equal(s.failures,0);
});
test('credentialed, nonpublic and non-GET requests are rejected before transport without leaking their values',async t=>{
 let calls=0;const n=await setup(t,{fetchImpl:async()=>{calls++;return new Response('{}');}});
 const marker='PRIVATE_SENTINEL_NOT_TO_CAPTURE';
 for(const [url,options] of [['https://example.org/'],['http://api-web.nhle.com/'],['https://api-web.nhle.com/?apiKey='+marker],['https://'+marker+'@api-web.nhle.com/'],['https://api-web.nhle.com/',{method:'POST'}],['https://api-web.nhle.com/',{headers:{Authorization:marker}}]])await assert.rejects(n.fetch(url,options),/blocked by policy/);
 const s=await n.summary(),bytes=await readFile(join(n.directory,s.file),'utf8');assert.equal(calls,0);assert.equal(s.blocked,6);assert.equal(bytes.includes(marker),false);
});
test('a durable start receipt exists before transport and final evidence seals exact audit bytes',async t=>{
 let started;const n=await setup(t,{fetchImpl:async()=>{const {readdir}=await import('node:fs/promises');const file=(await readdir(n.directory))[0];started=JSON.parse((await readFile(join(n.directory,file),'utf8')).trim());return new Response('{}');}});
 await n.fetch('https://api-web.nhle.com/v1/score/2099-02-01');assert.equal(started.type,'request_started');const s=await n.summary(),bytes=await readFile(join(n.directory,s.file));assert.equal(s.sha256,createHash('sha256').update(bytes).digest('hex'));assert.equal(s.bytes,bytes.length);await assert.rejects(n.fetch('https://api-web.nhle.com/'),/sealed/);assert.deepEqual(await n.summary(),s);
});
test('HTTP denials and network failures remain separately auditable with sanitized failure messages',async t=>{
 let calls=0,tick=1000;const n=await setup(t,{clock:()=>tick+=10,fetchImpl:async()=>{calls++;if(calls===1)return new Response('{}',{status:403});throw new TypeError('PRIVATE_SENTINEL_NOT_TO_CAPTURE');}});
 assert.equal((await n.fetch('https://site.api.espn.com/public')).status,403);await assert.rejects(n.fetch('https://site.api.espn.com/public'),/provider request failed/);const s=await n.summary(),bytes=await readFile(join(n.directory,s.file),'utf8');assert.equal(s.requests,2);assert.equal(s.failures,2);assert.ok(s.latencyMs>0);assert.equal(bytes.includes('PRIVATE_SENTINEL'),false);assert.ok(bytes.includes('request_failed'));
});
test('the per-worker request budget stops additional provider calls',async t=>{
 let calls=0;const n=await setup(t,{maxRequests:1,fetchImpl:async()=>{calls++;return new Response('{}');}});await n.fetch('https://cdn.espn.com/scoreboard');await assert.rejects(n.fetch('https://cdn.espn.com/scoreboard'),/blocked/);assert.equal(calls,1);const s=await n.summary();assert.equal(s.requests,1);assert.equal(s.blocked,1);
});
test('concurrent unfinished requests cannot be certified as a completed audit',async t=>{
 let finish;const n=await setup(t,{fetchImpl:()=>new Promise(resolve=>finish=resolve)});const work=n.fetch('https://api-web.nhle.com/v1/score/2099-02-01');await assert.rejects(n.summary(),/still running/);while(!finish)await new Promise(resolve=>setImmediate(resolve));finish(new Response('{}'));await work;assert.equal((await n.summary()).requests,1);
});
test('offline mode blocks provider transport even if archived source attempts a request',async t=>{
 let calls=0;const n=await setup(t,{allowNetwork:false,fetchImpl:async()=>{calls++;return new Response('{}');}});await assert.rejects(n.fetch('https://api-web.nhle.com/v1/score/2099-02-01'),/blocked/);const s=await n.summary();assert.equal(calls,0);assert.equal(s.requests,0);assert.equal(s.blocked,1);
});
test('starting an audit summary closes the request gate before asynchronous file reads finish',async t=>{
 let calls=0;const n=await setup(t,{fetchImpl:async()=>{calls++;return new Response('{}');}});const sealing=n.summary();await assert.rejects(n.fetch('https://api-web.nhle.com/v1/score/2099-02-01'),/sealed/);const s=await sealing;assert.equal(s.requests,0);assert.equal(calls,0);
});
