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
   ||p.sourceCommit!==manifest.sources?.[p.role]?.commit||epoch(capture.completedAt)>epoch(receipt.recordedAt))throw new Error('Capture receipt mismatch');
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
