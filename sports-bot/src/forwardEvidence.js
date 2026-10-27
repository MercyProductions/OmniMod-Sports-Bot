import {readFile,writeFile,mkdir,readdir,open,rename} from 'node:fs/promises';
import {join,basename} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {withAuditFileLock} from './auditFileLock.js';
import {quoteTimeEpoch} from './oddsPricing.js';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex'),digest=value=>hash(JSON.stringify(value));
const validHash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const optional=async(file,fallback)=>{try{return await readFile(file);}catch(error){if(error.code==='ENOENT')return fallback;throw error;}};
const entries=async dir=>{try{return await readdir(dir);}catch(error){if(error.code==='ENOENT')return [];throw error;}};
const parse=bytes=>{try{return JSON.parse(bytes);}catch{throw new Error('Forward evidence JSON invalid; preserve original bytes');}};
const safeName=name=>typeof name==='string'&&name===basename(name)&&/^[0-9]+-[a-f0-9-]+\.json$/.test(name);

/** Local integrity proof, not source authentication or atomic cross-store durability. Read-only. */
export async function inspectForwardEvidence(root,{now=Date.now()}={}){
 const checkpoint=parse(await readFile(join(root,'CHECKPOINT.json'))),bytes=await optional(join(root,'capture-ledger.jsonl'),Buffer.alloc(0));
 if(bytes.length&&!bytes.toString('utf8').endsWith('\n'))throw new Error('Forward evidence ledger has an incomplete tail');
 const rows=bytes.toString('utf8').split('\n').filter(Boolean).map(parse),names=new Set(),blobs=new Set();let previousHash=null;
 const journal=await optional(join(root,'runtime','prediction-journal.jsonl'),Buffer.alloc(0)),prefixes=new Map();
 for(let index=0;index<rows.length;index++){
  const row=rows[index],{eventHash,...body}=row;
  if(body.schema!=='sports-forward-evidence-v1'||body.sequence!==index+1||body.previousHash!==previousHash||eventHash!==digest(body)
   ||!Number.isFinite(quoteTimeEpoch(body.receivedAt))||quoteTimeEpoch(body.receivedAt)>now
   ||body.sourceCommit!==checkpoint.sourceCommit||body.artifactId!==checkpoint.artifactId||!safeName(body.filename)||names.has(body.filename))throw new Error('Forward evidence receipt integrity failed');
  const captureBytes=await readFile(join(root,'captures',body.filename)),capture=parse(captureBytes);
  if(!validHash(body.captureHash)||hash(captureBytes)!==body.captureHash||capture.sourceCommit!==body.sourceCommit||capture.artifactId!==body.artifactId
   ||capture.capturedAt!==body.capturedAt||!Number.isFinite(quoteTimeEpoch(capture.capturedAt))||quoteTimeEpoch(capture.capturedAt)>quoteTimeEpoch(body.receivedAt)
   ||capture.liveOrders!==false||capture.discordPosts!==0)throw new Error('Forward frozen capture changed');
  const prefix=body.journalPrefix;
  if(!prefix||!Number.isSafeInteger(prefix.bytes)||prefix.bytes<0||prefix.bytes>journal.length||!validHash(prefix.sha256))throw new Error('Forward journal prefix is missing or truncated');
  if(!prefixes.has(prefix.bytes))prefixes.set(prefix.bytes,hash(journal.subarray(0,prefix.bytes)));
  if(prefixes.get(prefix.bytes)!==prefix.sha256)throw new Error('Forward journal prefix changed');
  if(!Array.isArray(body.providerFiles))throw new Error('Forward provider input manifest missing');
  for(const input of body.providerFiles){
   if(typeof input.name!=='string'||input.name!==basename(input.name)||!input.name.endsWith('.json')||!validHash(input.sha256)||!Number.isSafeInteger(input.bytes)||input.bytes<0)throw new Error('Invalid provider evidence reference');
   if(!blobs.has(input.sha256)){
    const blob=await readFile(join(root,'evidence-blobs',input.sha256+'.json'));
    if(blob.length!==input.bytes||hash(blob)!==input.sha256)throw new Error('Frozen provider input changed');blobs.add(input.sha256);
   }
  }
  previousHash=eventHash;names.add(body.filename);
 }
 const headBytes=await optional(join(root,'capture-ledger-head.json'),null),head=headBytes?parse(headBytes):null;
 if(rows.length&&(!head||head.schema!=='sports-forward-evidence-head-v1'||head.sequence!==rows.length||head.eventHash!==previousHash)
  ||!rows.length&&head)throw new Error('Forward evidence head mismatch; preserve interrupted append');
 const captureFiles=(await entries(join(root,'captures'))).filter(name=>name.endsWith('.json'));
 if(captureFiles.length!==names.size||captureFiles.some(name=>!names.has(name)))throw new Error('Unreceipted forward capture; do not certify it retroactively');
 return {receipts:rows,providerBlobs:blobs.size,journalBytes:journal.length};
}

async function freezeBlob(root,bytes){
 const sha256=hash(bytes),file=join(root,'evidence-blobs',sha256+'.json');await mkdir(join(root,'evidence-blobs'),{recursive:true});let handle;
 try{handle=await open(file,'wx',0o600);await handle.writeFile(bytes);await handle.sync();}
 catch(error){if(error.code!=='EEXIST'||hash(await readFile(file))!==sha256)throw error;}
 finally{if(handle)await handle.close();}
 return {sha256,bytes:bytes.length};
}

/** Append under an exclusive owner; never adopt old captures or alter forecast/source bytes. */
export async function recordForwardCapture(root,capture){
 const ledger=join(root,'capture-ledger.jsonl');
 return withAuditFileLock(ledger,async()=>{
  const prior=await inspectForwardEvidence(root),checkpoint=parse(await readFile(join(root,'CHECKPOINT.json'))),now=Date.now();
  if(capture.sourceCommit!==checkpoint.sourceCommit||capture.artifactId!==checkpoint.artifactId||capture.liveOrders!==false||capture.discordPosts!==0
   ||!Number.isFinite(quoteTimeEpoch(capture.capturedAt))||quoteTimeEpoch(capture.capturedAt)>now)throw new Error('Invalid forward capture identity or chronology');
  const providerFiles=[];
  for(const name of (await entries(join(root,'runtime','provider-cache'))).filter(name=>name.endsWith('.json')).sort()){
   const bytes=await readFile(join(root,'runtime','provider-cache',name));providerFiles.push({name,...await freezeBlob(root,bytes)});
  }
  const journal=await optional(join(root,'runtime','prediction-journal.jsonl'),Buffer.alloc(0));
  const filename=now+'-'+randomUUID()+'.json',captureBytes=Buffer.from(JSON.stringify(capture)+'\n');await mkdir(join(root,'captures'),{recursive:true});
  let handle=await open(join(root,'captures',filename),'wx',0o600);try{await handle.writeFile(captureBytes);await handle.sync();}finally{await handle.close();}
  const body={schema:'sports-forward-evidence-v1',sequence:prior.receipts.length+1,previousHash:prior.receipts.at(-1)?.eventHash||null,
   receivedAt:new Date(Date.now()).toISOString(),capturedAt:capture.capturedAt,sourceCommit:checkpoint.sourceCommit,artifactId:checkpoint.artifactId,
   filename,captureHash:hash(captureBytes),journalPrefix:{bytes:journal.length,sha256:hash(journal)},providerFiles};
  const receipt={...body,eventHash:digest(body)};handle=await open(ledger,'a',0o600);try{await handle.writeFile(JSON.stringify(receipt)+'\n');await handle.sync();}finally{await handle.close();}
  const head={schema:'sports-forward-evidence-head-v1',sequence:receipt.sequence,eventHash:receipt.eventHash},temporary=join(root,'capture-ledger-head.'+randomUUID()+'.pending');
  handle=await open(temporary,'wx',0o600);try{await handle.writeFile(JSON.stringify(head)+'\n');await handle.sync();}finally{await handle.close();}
  await rename(temporary,join(root,'capture-ledger-head.json'));return receipt;
 });
}
