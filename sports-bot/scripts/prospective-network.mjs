import {mkdir,open,appendFile,readFile} from 'node:fs/promises';
import {join,basename} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
const hosts=new Set(['site.api.espn.com','cdn.espn.com','api-web.nhle.com']);
const secret=/authorization|cookie|api.?key|token|secret|password/i;
export async function createProspectiveNetwork({directory,fetchImpl=globalThis.fetch,maxRequests=32,allowNetwork=true,clock=()=>Date.now()}={}){
 if(!directory||!Number.isInteger(maxRequests)||maxRequests<1||maxRequests>64)throw Error('Bounded private research network configuration required');
 await mkdir(directory,{recursive:true});const file=join(directory,'network-'+randomUUID()+'.jsonl');await (await open(file,'wx',0o600)).close();
 let queue=Promise.resolve(),requests=0,failures=0,blocked=0,inFlight=0,latencyMs=0,sealed=null,sealing=false;
 const record=value=>{const next=queue.then(()=>appendFile(file,JSON.stringify(value)+'\n'));queue=next;return next;};
 const time=()=>{const value=clock();if(!Number.isFinite(value))throw Error('Research request clock unavailable');return value;};
 const deny=async reason=>{blocked++;await record({type:'request_blocked',at:new Date(time()).toISOString(),reason});throw Error('Public research request blocked by policy');};
 const fetch=async(input,options={})=>{
  if(sealed||sealing)throw Error('Research request evidence is sealed');
  if(!allowNetwork)return deny('offline_network_disabled');
  let url,headers;try{url=new URL(typeof input==='string'?input:input.url||String(input));headers=new Headers(options.headers||input?.headers);}catch{return deny('invalid_request');}
  const method=String(options.method||input?.method||'GET').toUpperCase();
  if(url.protocol!=='https:'||url.port||!hosts.has(url.hostname)||url.username||url.password||method!=='GET'
   ||[...url.searchParams.keys()].some(key=>secret.test(key))||[...headers.keys()].some(key=>secret.test(key)))return deny('nonpublic_or_credentialed_request');
  if(requests>=maxRequests)return deny('request_budget_exhausted');
  const id=randomUUID(),started=time();requests++;inFlight++;
  try{
   await record({type:'request_started',id,url:url.href,startedAt:new Date(started).toISOString()});
   const response=await fetchImpl(input,{...options,headers,redirect:'error',credentials:'omit'});
   const completed=time(),elapsed=Math.max(0,completed-started);latencyMs+=elapsed;
   if(!response.ok&&response.status!==304)failures++;
   await record({type:'response_received',id,status:response.status,receivedAt:new Date(completed).toISOString(),latencyMs:elapsed});return response;
  }catch(error){
   failures++;const completed=time(),elapsed=Math.max(0,completed-started);latencyMs+=elapsed;
   await record({type:'request_failed',id,failedAt:new Date(completed).toISOString(),latencyMs:elapsed,errorClass:['AbortError','TimeoutError','TypeError'].includes(error?.name)?error.name:'Error'});
   throw Error('Public research provider request failed');
  }finally{inFlight--;}
 };
 const summary=async()=>{
  if(sealed)return structuredClone(sealed);
  if(inFlight)throw Error('Research provider requests are still running');
  sealing=true;
  await queue;const bytes=await readFile(file);
  sealed={schema:'sports-prospective-network-v1',file:basename(file),sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length,
   requests,failures,blocked,latencyMs,maxRequests,liveTradingEnabled:false,emergencyStop:true,
   scope:'Local HTTP request/response receipts only; response bodies and underlying publication times are not captured or authenticated.'};
  return structuredClone(sealed);
 };
 return {fetch,summary};
}
