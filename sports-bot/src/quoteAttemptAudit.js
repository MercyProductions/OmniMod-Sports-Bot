import {readFile,readdir,mkdir,open,link,unlink} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {eventObservationHash} from './journalEventMatch.js';
import {eventReference,scopedEventKey} from './slateEventIdentity.js';
import {quoteTimeEpoch} from './oddsPricing.js';
const fail=()=>new Error('Quote-attempt audit integrity failed; preserve the audit files for review.');
const iso=value=>Number.isFinite(quoteTimeEpoch(value))?new Date(quoteTimeEpoch(value)).toISOString():null;
const count=value=>Number.isSafeInteger(value)&&value>=0?value:null;
const reason=value=>typeof value==='string'&&/^[a-z_]{1,80}$/.test(value)?value:null;
const keyFor=claim=>{
 if(!/^\d{4}-\d{2}-\d{2}$/.test(claim?.dateKey||'')||!Number.isSafeInteger(claim.slot)||claim.slot<1||claim.slot>100||!iso(claim.claimedAt))throw fail();
 return `${claim.dateKey}-${claim.slot}`;
};
async function read(file){try{const row=JSON.parse(await readFile(file,'utf8'));const {eventHash,...body}=row;if(body.schemaVersion!==1||eventHash!==eventObservationHash(body))throw fail();return row;}catch(error){if(error.code==='ENOENT')return null;throw fail();}}
async function publish(file,body){
 const row={...body,eventHash:eventObservationHash(body)};await mkdir(dirname(file),{recursive:true});const temporary=file+'.'+randomUUID()+'.tmp';
 const handle=await open(temporary,'wx',0o600);try{await handle.writeFile(JSON.stringify(row)+'\n');await handle.sync();}finally{await handle.close();}
 try{await link(temporary,file);}catch(error){if(error.code!=='EEXIST')throw error;const existing=await read(file);if(existing?.eventHash!==row.eventHash)throw fail();}
 finally{await unlink(temporary).catch(()=>{});}
 return row;
}
const claimView=claim=>({dateKey:claim.dateKey,slot:claim.slot,claimedAt:iso(claim.claimedAt),requests:1});

export async function beginQuoteAttempt(directory,claim,{slate,games,models,league,now=Date.now()}){
 const attemptKey=keyFor(claim),stored=JSON.parse(await readFile(join(directory,'value-refresh-claims',attemptKey+'.json'),'utf8'));
 if(eventObservationHash(claimView(stored))!==eventObservationHash(claimView(claim))||stored.requests!==1)throw fail();
 const events=games.map(game=>{
  const event=eventReference(game),prediction=models.get(scopedEventKey(event));
  return {...event,modelVersion:String(prediction?.modelVersion||'legacy-unversioned').slice(0,200),predictionGeneratedAt:iso(prediction?.predictionGeneratedAt),modelAsOf:iso(prediction?.modelAsOf||prediction?.predictionGeneratedAt),
   predictedSide:['away','home','draw'].includes(prediction?.predictedSide)?prediction.predictedSide:null,
   outcomeProbabilities:Object.fromEntries(['away','home','draw'].map(side=>[side,typeof prediction?.outcomeProbabilities?.[side]==='number'?prediction.outcomeProbabilities[side]:null])),forecastHash:eventObservationHash(prediction)};
 });
 const start=await publish(join(directory,'value-refresh-audits',attemptKey+'.start.json'),{schemaVersion:1,type:'quote_attempt_started',attemptKey,claim:claimView(claim),recordedAt:new Date(now).toISOString(),
  guildId:String(slate.guildId||'').slice(0,200),slateDateKey:String(slate.dateKey||'').slice(0,20),leagueKey:league,events,
  dispatch:'request intended; dispatch and provider charging are not attested'});
 return {attemptKey,startHash:start.eventHash};
}

export async function completeQuoteAttempt(directory,attempt,output,provider={},now=Date.now()){
 if(!/^\d{4}-\d{2}-\d{2}-(?:[1-9]\d?|100)$/.test(attempt?.attemptKey||'')||!/^[a-f0-9]{64}$/.test(attempt?.startHash||''))throw fail();
 output=structuredClone({status:output.status,externalCalls:output.externalCalls,oddsMatchAudit:output.oddsMatchAudit||[],preparedPriceSnapshots:output.issuedSlate?.predictions?.length||0});provider={status:provider?.status,fetchedAt:provider?.fetchedAt};
 const base=join(directory,'value-refresh-audits',attempt.attemptKey),start=await read(base+'.start.json');if(!start||start.eventHash!==attempt.startHash)throw fail();
 if(!Number.isFinite(now)||now<quoteTimeEpoch(start.recordedAt))throw fail();
 const statuses=['provider_failure','processing_failure','unmatched','fresh','provider_quotes_stale'];if(!statuses.includes(output.status))throw fail();
 const allowed=new Set(start.events.map(scopedEventKey));
 const evidence=(output.oddsMatchAudit||[]).filter(row=>allowed.has(scopedEventKey(row.event||{}))).slice(0,25).map(row=>({event:row.event,status:row.status==='matched'?'matched':'rejected',reason:reason(row.reason),candidateCount:count(row.candidateCount),rejectedCount:count(row.rejectedCount),
  observationHashes:(row.observations||[]).map(item=>item.observationHash).filter(value=>/^[a-f0-9]{64}$/.test(value)).slice(0,10),
  rejectionReasons:[...new Set((row.observations||[]).flatMap(item=>item.reasons||[]).map(reason).filter(Boolean))],
  bookmakerIntegrity:row.bookmakerIntegrity?{acceptedBooks:count(row.bookmakerIntegrity.acceptedBooks),rejectedBooks:count(row.bookmakerIntegrity.rejectedBooks),rejectionReasons:[...new Set((row.bookmakerIntegrity.observations||[]).map(item=>reason(item.reason)).filter(Boolean))]}:null}));
 const completed=await publish(base+'.complete.json',{schemaVersion:1,type:'quote_attempt_completed',attemptKey:attempt.attemptKey,startHash:start.eventHash,recordedAt:new Date(now).toISOString(),status:output.status,
  providerRequestAttempted:output.externalCalls===1,providerHttpStatus:Number.isInteger(provider?.status)&&provider.status>=100&&provider.status<=599?provider.status:null,
  providerReceiptAt:iso(provider?.fetchedAt),preparedPriceSnapshots:output.preparedPriceSnapshots,evidence,
  scope:'Bounded decision evidence; raw errors, URLs, credentials, headers and full provider payloads are excluded'});
 return {...attempt,completionHash:completed.eventHash};
}

/** Read-only. A reserved slot without an audit is legacy or interrupted, never proof of dispatch. */
export async function readQuoteAttemptAudits(directory){
 const listing=async name=>{try{return await readdir(join(directory,name));}catch(error){if(error.code==='ENOENT')return [];throw error;}};
 const [names,audits]=await Promise.all([listing('value-refresh-claims'),listing('value-refresh-audits')]);
 for(const file of audits.filter(name=>/\.(start|complete)\.json$/.test(name)))if(!names.includes(file.replace(/\.(start|complete)\.json$/,'.json')))throw fail();
 const rows=[];
 for(const name of names.filter(value=>/^\d{4}-\d{2}-\d{2}-\d+\.json$/.test(value)).sort()){
  let claim;try{claim=JSON.parse(await readFile(join(directory,'value-refresh-claims',name),'utf8'));}catch{throw fail();}
  const attemptKey=keyFor(claim);if(name!==attemptKey+'.json'||claim.requests!==1)throw fail();
  const base=join(directory,'value-refresh-audits',attemptKey),start=await read(base+'.start.json'),completion=await read(base+'.complete.json');
  if(start&&(!iso(start.recordedAt)||quoteTimeEpoch(start.recordedAt)<quoteTimeEpoch(claim.claimedAt)||start.type!=='quote_attempt_started'||start.attemptKey!==attemptKey||eventObservationHash(start.claim)!==eventObservationHash(claimView(claim))))throw fail();
  if(completion&&(!start||!iso(completion.recordedAt)||quoteTimeEpoch(completion.recordedAt)<quoteTimeEpoch(start.recordedAt)||completion.type!=='quote_attempt_completed'||completion.attemptKey!==attemptKey||completion.startHash!==start.eventHash))throw fail();
  rows.push({attemptKey,state:completion?'completed':start?'started_unfinished':'reserved_without_audit',claim:claimView(claim),start,completion});
 }
 return rows;
}
