import {validCandidateVector} from './candidateCohorts.js';
import {createHash} from 'node:crypto';
import {open,readFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {finalOutcomeSide} from './dataValidation.js';
import {predictionHorizon} from './horizonEvaluation.js';
import {evaluateMatchedJournal} from './matchedJournalEvaluation.js';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const digest=row=>hash(JSON.stringify(row));
const epoch=value=>Date.parse(value||'');
const identity=game=>JSON.stringify([game.leagueKey,String(game.id),epoch(game.startTime),game.away?.name,game.home?.name]);
const probabilityVector=prediction=>{
 const raw=prediction.outcomeProbabilities;
 if(!raw||!['away','home'].every(side=>typeof raw[side]==='number'&&Number.isFinite(raw[side]))
  ||Object.entries(raw).some(([side,value])=>!['away','home','draw'].includes(side)||typeof value!=='number'||!Number.isFinite(value)))return null;
 const normalized={away:raw.away/100,home:raw.home/100,draw:raw.draw===undefined?0:raw.draw/100};
 return validCandidateVector(normalized)?normalized:null;
};
const nameValid=value=>typeof value==='string'&&/^(baseline|challenger)-[a-z0-9-]+\.json$/.test(value);

export async function readCaptureLedger(directory){
 let bytes;try{bytes=await readFile(join(directory,'capture-ledger.jsonl'),'utf8');}catch(error){if(error.code==='ENOENT')return [];throw error;}
 if(bytes&&!bytes.endsWith('\n'))throw new Error('Incomplete capture receipt');
 const rows=[];let previousHash=null;
 for(const line of bytes.split('\n').filter(Boolean)){
  const row=JSON.parse(line),{eventHash,...body}=row;
  if(body.schema!=='sports-capture-receipt-v1'||body.sequence!==rows.length+1||body.previousHash!==previousHash||digest(body)!==eventHash)throw new Error('Capture receipt integrity failed');
  rows.push(row);previousHash=eventHash;
 }
 return rows;
}

/** Called only under the collector's exclusive run lock; never imports legacy files as pregame evidence. */
export async function recordCaptureReceipt(directory,summary){
 if(!nameValid(summary.filename)||!['baseline','challenger'].includes(summary.role)||!summary.filename.startsWith(summary.role+'-'))throw new Error('Invalid capture identity');
 const bytes=await readFile(join(directory,'captures',summary.filename));
 if(hash(bytes)!==summary.captureHash)throw new Error('Worker capture hash mismatch');
 const capture=JSON.parse(bytes),now=Date.now();
 if(capture.role!==summary.role||capture.startedAt!==summary.startedAt||capture.completedAt!==summary.completedAt
  ||!Number.isFinite(epoch(capture.startedAt))||epoch(capture.startedAt)>epoch(capture.completedAt)||epoch(capture.completedAt)>now)throw new Error('Invalid capture chronology');
 const records=await readCaptureLedger(directory);
 if(records.some(row=>row.payload.filename===summary.filename))throw new Error('Capture already has a receipt');
 const body={schema:'sports-capture-receipt-v1',sequence:records.length+1,previousHash:records.at(-1)?.eventHash||null,
  recordedAt:new Date(now).toISOString(),payload:{filename:summary.filename,captureHash:summary.captureHash,role:summary.role,sourceCommit:summary.sourceCommit}};
 const row={...body,eventHash:digest(body)},handle=await open(join(directory,'capture-ledger.jsonl'),'a',0o600);
 try{await handle.writeFile(JSON.stringify(row)+'\n');await handle.sync();}finally{await handle.close();}
 return row;
}

/** Verify receipt-linked bytes before any forecast/outcome interpretation. */
export async function loadProspectiveCaptures(directory){
 const manifest=JSON.parse(await readFile(join(directory,'manifest.json'),'utf8'));
 const {manifestHash,...body}=manifest;if(digest(body)!==manifestHash)throw new Error('Research manifest changed');
 const records=await readCaptureLedger(directory),captures=[];
 for(const receipt of records){
  const p=receipt.payload;if(!nameValid(p.filename))throw new Error('Invalid receipt filename');
  const bytes=await readFile(join(directory,'captures',p.filename));if(hash(bytes)!==p.captureHash)throw new Error('Frozen capture changed');
  const capture=JSON.parse(bytes);
  if(capture.schema!=='sports-isolated-capture-v1'||capture.role!==p.role||!['baseline','challenger'].includes(capture.role)
   ||p.sourceCommit!==manifest.sources?.[p.role]?.commit||(capture.sampling?.dayOffset??0)!==(manifest.profile?.dayOffset??0)||epoch(capture.completedAt)>epoch(receipt.recordedAt))throw new Error('Capture receipt mismatch');
  captures.push({receipt,capture});
 }
 const indexed=new Set(records.map(row=>row.payload.filename));
 const unindexed=(await readdir(join(directory,'captures')).catch(()=>[])).filter(name=>nameValid(name)&&!indexed.has(name)).length;
 return {captures,unindexed};
}

export function evaluateProspectiveCaptures(entries=[],{asOf=Date.now(),maximumPairGapMs=120000}={}){
 if(!Number.isFinite(asOf)||!Number.isInteger(maximumPairGapMs)||maximumPairGapMs<1||maximumPairGapMs>300000)throw new Error('Invalid pairing cutoff');
 const ordered=entries.filter(row=>Number.isFinite(epoch(row.receipt.recordedAt))&&epoch(row.receipt.recordedAt)<=asOf)
  .sort((a,b)=>epoch(a.receipt.recordedAt)-epoch(b.receipt.recordedAt));
 const first=new Map(),finals=new Map(),rejections={};
 const reject=reason=>{rejections[reason]=(rejections[reason]||0)+1;};
 for(const {receipt,capture} of ordered){
  const issued=epoch(receipt.recordedAt),completed=epoch(capture.completedAt),began=epoch(capture.startedAt);
  if(capture.mode!=='live'){reject('not_live_market_capture');continue;}
  if(!['baseline','challenger'].includes(capture.role)||![issued,completed,began].every(Number.isFinite)||began>completed||completed>issued){reject('capture_chronology_invalid');continue;}
  const games=new Map((capture.slate?.games||[]).map(game=>[String(game.id),game]));
  for(const game of games.values()){
   const actualSide=finalOutcomeSide(game),start=epoch(game.startTime);
   if(actualSide&&Number.isFinite(start)&&issued>=start){
    const key=identity(game),versions=finals.get(key)||{};
    versions[capture.role]={actualSide,awayScore:game.away?.score,homeScore:game.home?.score,observedAt:receipt.recordedAt};finals.set(key,versions);
   }
  }
  if(capture.purpose==='final_reconciliation')continue;
  for(const prediction of capture.slate?.predictions||[]){
   const game=games.get(String(prediction.gameId)),generated=epoch(prediction.predictionGeneratedAt),start=epoch(game?.startTime);
   if(!game||prediction.predictionMode!=='pregame'||game.statusKey!=='scheduled'){reject('not_observed_pregame');continue;}
   if(![generated,start].every(Number.isFinite)||generated<began||generated>completed||issued>=start){reject('forecast_chronology_invalid');continue;}
   if(!game.leagueKey||!game.id||!game.away?.name||!game.home?.name||!prediction.modelVersion){reject('event_identity_incomplete');continue;}
   if(!probabilityVector(prediction)){reject('invalid_frozen_probability_vector');continue;}
   const horizon=predictionHorizon({...prediction,minutesToStart:(start-generated)/60000}),eventKey=identity(game),key=JSON.stringify([eventKey,horizon]);
   if(!first.has(key))first.set(key,{});
   const pair=first.get(key);
   if(pair[capture.role]){reject('later_same_horizon_not_selected');continue;}
   pair[capture.role]={prediction,game,issued,receipt,horizon,eventKey};
  }
 }
 const rows=[],pairs=[];
 for(const pair of first.values()){
  const a=pair.baseline,b=pair.challenger;
  if(!a||!b){reject('missing_counterpart');continue;}
  if(Math.abs(a.issued-b.issued)>maximumPairGapMs){reject('counterpart_time_gap_exceeded');continue;}
  const id=digest([a.receipt.eventHash,b.receipt.eventHash,b.eventKey,b.horizon]);
  const payload={forecastId:id,guildId:'isolated-comparison',gameId:b.game.id,league:b.game.leagueKey,modelVersion:b.prediction.modelVersion,horizon:b.horizon,
   lifecycleState:'ISSUED',recordEligibility:'observed_pregame',predictionGeneratedAt:b.prediction.predictionGeneratedAt,startTime:b.game.startTime,
   selectedSide:b.prediction.predictedSide,outcomePercentages:b.prediction.outcomeProbabilities,
   evidenceCoverage:b.prediction.evidenceCoverage||null,eventContext:{sport:b.prediction.sportProfile||b.game.sportGroup||'unknown'},
   referenceBaselines:{evidence:{id:a.prediction.modelVersion,probabilities:probabilityVector(a.prediction)}}};
  rows.push({type:'forecast',recordedAt:new Date(Math.max(a.issued,b.issued)).toISOString(),payload});
  pairs.push({gameId:b.game.id,league:b.game.leagueKey,horizon:b.horizon,baselineVersion:a.prediction.modelVersion,challengerVersion:b.prediction.modelVersion,
   baselineCommit:a.receipt.payload.sourceCommit,challengerCommit:b.receipt.payload.sourceCommit,issuanceGapMs:Math.abs(a.issued-b.issued)});
  const observed=Object.values(finals.get(b.eventKey)||{});
  if(!observed.length)continue;
  if(new Set(observed.map(row=>JSON.stringify([row.actualSide,row.awayScore,row.homeScore]))).size>1){reject('conflicting_final_observations');continue;}
  const final=observed.sort((x,y)=>epoch(y.observedAt)-epoch(x.observedAt))[0];
  rows.push({type:'result',recordedAt:final.observedAt,payload:{forecastId:id,actualSide:final.actualSide,observedAt:final.observedAt,scheduleChanged:false}});
 }
 return {schema:'sports-isolated-paired-report-v1',asOf:new Date(asOf).toISOString(),maximumPairGapMs,visibleCaptures:ordered.length,pairedForecasts:pairs.length,pairs,rejections,
  matched:evaluateMatchedJournal(rows,{asOf}),performanceEstablished:false,promotionAllowed:false,
  methodology:'First receipted pregame forecast per role/event/horizon, bounded sequential issuance gap, original frozen probabilities; latest agreeing observed finals.',
  limitations:['The evidence comparator is the archived baseline executable, not a same-issuance simple model.',
   'Paired rows are derived read-only from pregame capture receipts, not reconstructed production Discord forecasts.',
   'Provider observations were collected sequentially and can differ. This is not identical-input inference or a preregistered trial.',
   'Source outages, cold-start state, unresolved finals, team/day dependence and small samples limit conclusions.']};
}


/** Bounded cross-date work plan only; never turns an unavailable final into a loss. */
export function pendingProspectiveFinalQueries(entries=[],{asOf=Date.now(),lookbackDays=7,maximumDatesPerRole=3,timezone='America/Chicago'}={}){
 if(!Number.isFinite(asOf)||!Number.isInteger(lookbackDays)||lookbackDays<1||lookbackDays>30
  ||!Number.isInteger(maximumDatesPerRole)||maximumDatesPerRole<1||maximumDatesPerRole>7)throw new Error('Invalid final-query limits');
 const dateKey=ms=>{
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(ms)).map(row=>[row.type,row.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
 };
 const today=dateKey(asOf),day=Date.parse(today+'T00:00:00Z'),pending=new Map(),resolved=new Map(),excluded={};
 const reject=reason=>{excluded[reason]=(excluded[reason]||0)+1;};
 for(const {receipt,capture} of entries){
  const issued=epoch(receipt.recordedAt),began=epoch(capture.startedAt),completed=epoch(capture.completedAt);
  if(capture.mode!=='live'||!['baseline','challenger'].includes(capture.role)||![issued,began,completed].every(Number.isFinite)
   ||issued>asOf||began>completed||completed>issued)continue;
  const games=new Map((capture.slate?.games||[]).map(row=>[String(row.id),row]));
  for(const game of games.values())if(finalOutcomeSide(game)&&Number.isFinite(epoch(game.startTime))&&issued>=epoch(game.startTime)){
   const eventKey=identity(game),key=capture.role+':'+eventKey,prior=resolved.get(key);
   if(!prior||issued>=prior.issued)resolved.set(key,{eventKey,issued,signature:JSON.stringify([finalOutcomeSide(game),game.away?.score,game.home?.score])});
  }
  if(capture.purpose==='final_reconciliation')continue;
  for(const prediction of capture.slate?.predictions||[]){
   const game=games.get(String(prediction.gameId)),start=epoch(game?.startTime),generated=epoch(prediction.predictionGeneratedAt);
   if(!game||game.statusKey!=='scheduled'||prediction.predictionMode!=='pregame'||!probabilityVector(prediction)
    ||![start,generated].every(Number.isFinite)||generated<began||generated>completed||issued>=start)continue;
   if(start>asOf){reject('not_started');continue;}
   const date=dateKey(start),age=(day-Date.parse(date+'T00:00:00Z'))/86400000;
   if(age<0||age>lookbackDays){reject('outside_lookback');continue;}
   const key=capture.role+':'+identity(game),previous=pending.get(key);
   if(!previous||issued<previous.issued)pending.set(key,{role:capture.role,dateKey:date,issued,game,prediction});
  }
 }
 const signatures=new Map();
 for(const row of resolved.values()){const values=signatures.get(row.eventKey)||new Set();values.add(row.signature);signatures.set(row.eventKey,values);}
 const conflicts=new Set([...signatures].filter(([,values])=>values.size>1).map(([key])=>key));
 const grouped=new Map();
 for(const [key,row] of pending){
  if(resolved.has(key)&&!conflicts.has(identity(row.game)))continue;
  const groupKey=row.role+':'+row.dateKey;
  if(!grouped.has(groupKey))grouped.set(groupKey,{role:row.role,dateKey:row.dateKey,games:[],predictions:[]});
  grouped.get(groupKey).games.push(row.game);grouped.get(groupKey).predictions.push(row.prediction);
 }
 const used={},tasks=[],deferred=[];
 for(const task of [...grouped.values()].sort((a,b)=>a.dateKey.localeCompare(b.dateKey)||a.role.localeCompare(b.role))){
  if((used[task.role]||0)>=maximumDatesPerRole){deferred.push({role:task.role,dateKey:task.dateKey,games:task.games.length});continue;}
  used[task.role]=(used[task.role]||0)+1;
  tasks.push({...task,slate:{guildId:'isolated-prospective',dateKey:task.dateKey,games:task.games,predictions:task.predictions,finalReplies:{}}});
 }
 return {asOf:new Date(asOf).toISOString(),today,lookbackDays,maximumDatesPerRole,tasks,deferred,excluded,
  conflictingFinalEvents:conflicts.size,requestsPerformed:0,productionChanged:false};
}
