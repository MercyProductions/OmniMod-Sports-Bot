import {availabilityProviderInputState} from './availabilityProviderScope.js';
import {availabilitySourceRows} from './availabilityReconciliation.js';
import {quoteTimeEpoch as epoch} from './oddsPricing.js';
import {createHash} from 'node:crypto';
import {predictionHorizon} from './horizonEvaluation.js';
const iso=value=>new Date(value).toISOString();
const sha=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const scopeKey=value=>JSON.stringify(['schema','eventId','leagueKey','startTime','side','teamAbbr','awayAbbr','homeAbbr','playerId','playerIdNamespace'].map(key=>value?.[key]));
const scopeHash=value=>createHash('sha256').update(scopeKey(value)).digest('hex');
const MAX_AGE=15*60000;

/** A new selected availability observation can refresh a forecast, never certify complete health or approve a wager. */
export function availabilityRefreshEvidence(game,prediction,{previousGame,previousPrediction,began,ended,expectedHorizon}={}){
 const inputs=availabilitySourceRows(game?.autoPlayers||[]).filter(row=>row.availabilityProvider);
 const reject=reason=>({accepted:false,reason,proof:null,receivedAt:null});
 if(!inputs.length)return reject(null);
 const previous=epoch(previousPrediction?.predictionGeneratedAt),generated=epoch(prediction?.predictionGeneratedAt);
 if(![began,ended,previous,generated].every(Number.isFinite)||began>ended||previous>began
  ||previousPrediction?.gameId!==game?.id||previousPrediction?.leagueKey!==game?.leagueKey
  ||previousGame?.id!==game?.id||epoch(previousGame?.startTime)!==epoch(game?.startTime)
  ||['away','home'].some(side=>!game?.[side]?.abbr||previousGame?.[side]?.abbr!==game?.[side]?.abbr))
  return reject('availability_refresh_previous_forecast_unverified');
 if(!['Daily','T-90','T-30','T-10'].includes(expectedHorizon)||predictionHorizon(prediction)!==expectedHorizon)
  return reject('availability_refresh_horizon_unverified');
 const evidence=prediction?.evidenceCoverage,cutoff=epoch(evidence?.cutoffAt);
 if(evidence?.schema!=='sports-evidence-coverage-v2'||evidence.gameId!==game.id||evidence.league!==game.leagueKey
  ||!Number.isFinite(cutoff)||cutoff!==epoch(prediction?.inputChronology?.cutoffAt)||cutoff<began||cutoff>generated||generated>ended)
  return reject('availability_refresh_cutoff_unverified');
 const selected=[],seen=new Set();let current=0;
 for(const row of inputs){
  if(!['goalie_starter','goalie_projection','injury'].includes(row.availabilityObservationType)
   ||availabilityProviderInputState(row,game,ended))continue;
  const observed=epoch(row.sourceObservationAt),received=epoch(row.updatedAt),expires=epoch(row.availabilityExpiresAt);
  if(observed<=previous||ended-observed>MAX_AGE||received<began||received>cutoff||expires<=ended)continue;
  current++;
  const side=row.availabilityEventIdentity.side;
  const used=evidence.sides?.[side]?.modelInputs?.players?.some(player=>player.playerId===row.sourceAthleteId
   &&player.availabilityProviderSources?.some(input=>input.inputState==='current_bound_assertion'
    &&input.provider===row.availabilityProvider&&input.snapshotHash===row.availabilitySnapshotHash
    &&scopeKey(input.eventIdentity)===scopeKey(row.availabilityEventIdentity)
    &&epoch(input.sourceObservationAt)===observed&&epoch(input.receivedAt)===received&&epoch(input.expiresAt)===expires));
  if(!used)continue;
  const key=JSON.stringify([side,row.sourceAthleteId,row.availabilitySnapshotHash]);if(seen.has(key))continue;seen.add(key);
  selected.push({side,playerId:row.sourceAthleteId,snapshotHash:row.availabilitySnapshotHash,eventBindingHash:scopeHash(row.availabilityEventIdentity),observedAt:iso(observed),receivedAt:iso(received),expiresAt:iso(expires)});
 }
 if(!selected.length)return reject(current?'availability_refresh_selected_input_not_verified':'availability_refresh_input_not_new_or_current');
 const witnesses=selected.slice(0,64);
 return {accepted:true,reason:null,receivedAt:Math.max(...witnesses.map(row=>epoch(row.receivedAt))),proof:{
  schema:'sports-availability-refresh-v1',kind:'selected_provider_snapshot',horizon:expectedHorizon,previousForecastAt:iso(previous),
  informationCutoffAt:iso(cutoff),forecastGeneratedAt:iso(generated),inputs:witnesses}};
}

/** Persist fixed fields/clocks/hashes only. The caller supplies the actual durable forecast acknowledgement. */
export function serializeAvailabilityRefreshProof(proof,subject,{began,ended,frozenForecast,issuedOnly=true}={}){
 const previous=epoch(proof?.previousForecastAt),cutoff=epoch(proof?.informationCutoffAt),generated=epoch(proof?.forecastGeneratedAt),start=epoch(subject?.startTime);
 if(proof?.schema!=='sports-availability-refresh-v1'||proof.kind!=='selected_provider_snapshot'||!sha(proof.forecastId)
  ||subject?.leagueKey!=='nhl'||subject?.status!=='completed'||![began,ended,previous,cutoff,generated,start].every(Number.isFinite)
  ||previous>began||began>cutoff||cutoff>generated||generated>ended||ended>=start
  ||!['Daily','T-90','T-30','T-10'].includes(proof.horizon)||!Array.isArray(proof.inputs)||!proof.inputs.length||proof.inputs.length>64)throw Error('Invalid availability refresh acceptance proof');
 if(!frozenForecast||issuedOnly&&frozenForecast.lifecycleState!=='ISSUED'||frozenForecast.recordEligibility!=='observed_pregame'
  ||frozenForecast.forecastId!==proof.forecastId||frozenForecast.gameId!==String(subject.gameId)||frozenForecast.league!==subject.leagueKey
  ||frozenForecast.horizon!==proof.horizon
  ||epoch(frozenForecast.startTime)!==start||epoch(frozenForecast.predictionGeneratedAt)!==generated
  ||epoch(frozenForecast.evidenceCoverage?.cutoffAt)!==cutoff||epoch(frozenForecast.inputChronology?.cutoffAt)!==cutoff)
  throw Error('Availability refresh forecast binding unverified');
 const seen=new Set(),inputs=proof.inputs.map(input=>{
  const observed=epoch(input?.observedAt),received=epoch(input?.receivedAt),expires=epoch(input?.expiresAt);
  if(!['away','home'].includes(input?.side)||!/^nhl:\d+$/.test(input?.playerId||'')||!sha(input?.snapshotHash)||!sha(input?.eventBindingHash)
   ||![observed,received,expires].every(Number.isFinite)||observed<=previous||observed>received||received<began||received>cutoff
   ||ended-observed>MAX_AGE||expires<=ended||expires>observed+30*60000)throw Error('Invalid availability refresh acceptance input');
  const key=JSON.stringify([input.side,input.playerId,input.snapshotHash]);if(seen.has(key))throw Error('Repeated availability refresh acceptance input');seen.add(key);
  const selected=frozenForecast.evidenceCoverage?.sides?.[input.side]?.modelInputs?.players?.some(player=>player.playerId===input.playerId
   &&player.availabilityProviderSources?.some(source=>source.inputState==='current_bound_assertion'&&source.snapshotHash===input.snapshotHash
    &&scopeHash(source.eventIdentity)===input.eventBindingHash&&epoch(source.sourceObservationAt)===observed
    &&epoch(source.receivedAt)===received&&epoch(source.expiresAt)===expires));
  if(!selected)throw Error('Availability refresh frozen input unverified');
  return {side:input.side,playerId:input.playerId,snapshotHash:input.snapshotHash,eventBindingHash:input.eventBindingHash,observedAt:iso(observed),receivedAt:iso(received),expiresAt:iso(expires)};
 });
 return {schema:proof.schema,kind:proof.kind,horizon:proof.horizon,forecastId:proof.forecastId,previousForecastAt:iso(previous),informationCutoffAt:iso(cutoff),forecastGeneratedAt:iso(generated),inputs};
}
