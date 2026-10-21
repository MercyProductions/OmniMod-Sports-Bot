import {createHash} from 'node:crypto';
import {readFile,open,mkdir} from 'node:fs/promises';
import {dirname} from 'node:path';

const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
const failure=()=>new Error('Manual result history integrity failed; preserve the ledger and snapshot for review.');

// The caller holds the intelligence store's cross-process write lock.
// This ledger is authoritative for results; JSON snapshots are projections.
export async function readManualResultLedger(file,guildId){
 let text;try{text=await readFile(file,'utf8');}catch(error){if(error.code==='ENOENT')return {records:[],results:null};throw error;}
 if(!text||!text.endsWith('\n'))throw failure();
 const records=[];let previousHash=null,results={};
 for(const line of text.slice(0,-1).split('\n')){
  let row;try{row=JSON.parse(line);}catch{throw failure();}
  if(!object(row))throw failure();
  const {eventHash,...body}=row;
  if(body.schemaVersion!==1||body.sequence!==records.length+1||body.previousHash!==previousHash||body.guildId!==String(guildId||'')
   ||eventHash!==hash(body)||!Number.isFinite(Date.parse(body.recordedAt))||!Array.isArray(body.changes)||!body.changes.length)throw failure();
  if(!records.length){if(!object(body.legacyBaseline))throw failure();results=structuredClone(body.legacyBaseline);}
  else if(body.legacyBaseline!==undefined)throw failure();
  const touched=new Map();
  for(let index=0;index<body.changes.length;index++){
   const change=body.changes[index];
   if(!object(change)||typeof change.id!=='string'||!change.id||['__proto__','constructor','prototype'].includes(change.id)
    ||(!object(change.before)&&change.before!==null)||hash(results[change.id]??null)!==hash(change.before)||!['set','delete'].includes(change.operation)
    ||(change.operation==='set'&&(!object(change.after)||change.after.id!==change.id))||(change.operation==='delete'&&change.after!==null))throw failure();
   if(change.operation==='delete')delete results[change.id];
   else results[change.id]=structuredClone(change.after);
   touched.set(change.id,index);
  }
  for(const [id,index] of touched)if(Object.hasOwn(results,id))results[id].manualRevision={sequence:body.sequence,eventHash,index};
  records.push(row);previousHash=eventHash;
 }
 return {records,results};
}

export async function appendManualResultChanges(file,guildId,legacyResults,changes,{actor='',operation='import'}={}){
 const frozen=structuredClone(changes),baseline=structuredClone(legacyResults);
 const current=await readManualResultLedger(file,guildId),sequence=current.records.length+1;
 let results=current.results??baseline;
 const body={schemaVersion:1,sequence,previousHash:current.records.at(-1)?.eventHash||null,guildId:String(guildId||''),recordedAt:new Date().toISOString(),actor:String(actor).slice(0,100),operation,
  ...(!current.records.length?{legacyBaseline:baseline,baselineProvenance:'first observed existing snapshot; prior edit history and original source publication are unverified'}:{}),changes:[]};
 for(const change of frozen){
  if(!change.id||['__proto__','constructor','prototype'].includes(change.id))throw new Error('Manual result record ID is reserved');
  body.changes.push({id:change.id,operation:change.after===null?'delete':'set',before:structuredClone(results[change.id]??null),after:change.after});
  results={...results};if(change.after===null)delete results[change.id];else results[change.id]=change.after;
 }
 if(!body.changes.length)throw new Error('Manual result history requires a mutation');
 const row={...body,eventHash:hash(body)};
 await mkdir(dirname(file),{recursive:true});const handle=await open(file,'a',0o600);
 try{await handle.writeFile(JSON.stringify(row)+'\n','utf8');await handle.sync();}finally{await handle.close();}
 return readManualResultLedger(file,guildId);
}
