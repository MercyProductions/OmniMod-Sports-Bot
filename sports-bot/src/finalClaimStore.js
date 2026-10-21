import fs from 'node:fs/promises';
import path from 'node:path';
import {hostname} from 'node:os';
import {randomUUID} from 'node:crypto';
const sessionId=randomUUID(),host=hostname();
const encode=value=>JSON.stringify(value);

async function read(file){
 try{return JSON.parse(await fs.readFile(file,'utf8'));}catch(error){if(error.code==='ENOENT')return null;throw new Error('Final-result claim record is unreadable; preserve it for review');}
}
/** Publish complete immutable content without replacing an existing record. Same-filesystem hard links are required. */
async function publish(file,value){
 await fs.mkdir(path.dirname(file),{recursive:true});
 const temporary=file+'.tmp-'+randomUUID();let handle;
 try{
  handle=await fs.open(temporary,'wx',0o600);await handle.writeFile(encode(value)+'\n');await handle.sync();await handle.close();handle=null;
  try{await fs.link(temporary,file);return true;}catch(error){if(error.code==='EEXIST')return false;throw error;}
 }finally{if(handle)await handle.close();await fs.unlink(temporary).catch(()=>{});}
}
const nodeFile=(file,generation)=>path.join(file+'.claims',`claim-${generation}.json`);
const decisionFile=(file,generation)=>path.join(file+'.claims',`decision-${generation}.json`);
const matchesIdentity=(record,identity)=>['dateKey','guildId','gameId'].every(key=>String(record?.[key]||'')===String(identity[key]||''));
function validateNode(node,identity,generation){
 if(node?.schemaVersion!==2||node.generation!==generation||!matchesIdentity(node,identity)||!node.claimId||!node.owner?.sessionId||!node.owner.host||!Number.isSafeInteger(node.owner.pid)||node.owner.pid<=0)throw new Error('Final-result claim identity is invalid; preserve it for review');
}
function validateDecision(decision,node){
 if(decision&&(decision.schemaVersion!==2||decision.claimId!==node.claimId||decision.generation!==node.generation||!['posted','released','recovered'].includes(decision.state)))throw new Error('Final-result decision identity is invalid; preserve it for review');
}
async function guard(file,identity){
 const current=await read(file);
 if(!current){await publish(file,{schemaVersion:2,state:'protocol_v2',...identity});return guard(file,identity);}
 if(!matchesIdentity(current,identity))throw new Error('Final-result store belongs to another identity');
 if(current.schemaVersion===2&&current.state==='protocol_v2'&&!current.migrationRequired)return null;
 return current;
}
function ownerDead(node){
 if(node.owner.host!==host)return false;
 try{process.kill(node.owner.pid,0);return false;}catch(error){return error.code==='ESRCH';}
}

export async function acquireFinalClaim(file,identity,details={}){
 details=structuredClone(details);
 const legacy=await guard(file,identity);
 if(legacy)return {claimed:false,claim:legacy,reason:legacy.state==='posted'?'legacy_posted':'legacy_owner_unverified'};
 for(let generation=0;generation<4096;generation++){
  let node=await read(nodeFile(file,generation));
  if(!node){
   const candidate={...details,...identity,schemaVersion:2,generation,claimId:randomUUID(),state:'claimed',claimedAt:new Date().toISOString(),owner:{host,pid:process.pid,sessionId}};
   if(await publish(nodeFile(file,generation),candidate))return {claimed:true,claim:candidate,lease:{claimId:candidate.claimId,generation,sessionId}};
   node=await read(nodeFile(file,generation));
  }
  validateNode(node,identity,generation);
  let decision=await read(decisionFile(file,generation));validateDecision(decision,node);
  if(decision?.state==='posted')return {claimed:false,claim:{...node,...decision},reason:'posted'};
  if(decision)continue;
  if(!ownerDead(node))return {claimed:false,claim:node,reason:'owner_live_or_unverified'};
  // One immutable terminal decision fences the former generation. Contenders cannot rename a successor's claim.
  await publish(decisionFile(file,generation),{schemaVersion:2,state:'recovered',generation,claimId:node.claimId,observedAt:new Date().toISOString(),recovery:'same_host_owner_pid_absent'});
  decision=await read(decisionFile(file,generation));validateDecision(decision,node);
  if(decision?.state==='posted')return {claimed:false,claim:{...node,...decision},reason:'posted'};
 }
 throw new Error('Final-result claim history exceeds its bound; preserve it for review');
}

async function owned(file,identity,lease){
 lease=lease?structuredClone(lease):lease;
 if(!lease||!Number.isSafeInteger(lease.generation)||lease.generation<0||!lease.claimId||lease.sessionId!==sessionId)throw new Error('Final-result ownership proof is required');
 if(await guard(file,identity))throw new Error('Legacy final-result claims cannot be completed without explicit reconciliation');
 const node=await read(nodeFile(file,lease.generation));validateNode(node,identity,lease.generation);
 if(node.claimId!==lease.claimId||node.owner.host!==host||node.owner.pid!==process.pid||node.owner.sessionId!==sessionId)throw new Error('Final-result claim is owned by another worker');
 const decision=await read(decisionFile(file,lease.generation));validateDecision(decision,node);
 return {node,decision};
}
export async function verifyFinalClaim(file,identity,lease){const {decision}=await owned(file,identity,lease);if(decision)throw new Error('Final-result claim is no longer active');return true;}
export async function completeFinalClaim(file,identity,patch,lease){
 patch=structuredClone(patch);
 const {node,decision}=await owned(file,identity,lease);
 const content={...patch,...identity,schemaVersion:2,state:'posted',generation:node.generation,claimId:node.claimId,owner:node.owner,claimedAt:node.claimedAt,postedAt:patch.postedAt||new Date().toISOString()};
 if(decision){
  if(decision.state==='posted'&&decision.messageId===patch.messageId&&decision.channelId===patch.channelId)return {...node,...decision};
  throw new Error('Final-result claim already has a different terminal decision');
 }
 if(!patch.messageId||!patch.channelId)throw new Error('A complete final-result message acknowledgement is required');
 if(!await publish(decisionFile(file,node.generation),content))throw new Error('Final-result claim already has a terminal decision');
 return {...node,...content};
}
export async function abandonFinalClaim(file,identity,lease){
 const {node,decision}=await owned(file,identity,lease);if(decision)return false;
 return publish(decisionFile(file,node.generation),{schemaVersion:2,state:'released',generation:node.generation,claimId:node.claimId,releasedAt:new Date().toISOString()});
}

/** The legacy migration copies JSON files only, so it cannot transfer a ledger's ownership proof. */
export async function preserveFinalClaimMigration(source,destination){
 const record=await read(source);
 if(record?.schemaVersion!==2||record.state!=='protocol_v2')return false;
 await publish(destination,{...record,migrationRequired:true,sourceDirectory:path.dirname(source)});
 return true;
}
