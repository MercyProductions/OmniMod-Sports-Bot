import {predictionHorizon} from './horizonEvaluation.js';
import {capturedEventTime} from './capturedEventTime.js';
import {quoteTimeEpoch} from './oddsPricing.js';
const horizons=new Set(['Daily','T-90','T-30','T-10']);
const origins=new Set(['declared_scope','information_lead_time','unknown_start_default']);

/** Choose once for both registry selection and permanent identity; never reclassify a new decision at publication. */
export function forecastHorizonScope(requested,game,cutoff){
 if(!Number.isFinite(cutoff)||!Number.isFinite(new Date(cutoff).getTime()))throw Error('Valid forecast horizon cutoff required');
 const declared=requested!==undefined&&requested!==null&&requested!=='';
 if(declared&&!horizons.has(requested))throw Error('Unsupported forecast decision horizon');
 const start=capturedEventTime(game?.startTime),known=Number.isFinite(start);
 const horizon=declared?requested:predictionHorizon({minutesToStart:known?(start-cutoff)/60000:null});
 return {schema:'sports-decision-horizon-v1',horizon,origin:declared?'declared_scope':known?'information_lead_time':'unknown_start_default',
  informationCutoffAt:new Date(cutoff).toISOString()};
}

/** Optional legacy evidence remains unknown; present evidence must match the selected scope and original input clocks. */
export function validForecastHorizonScope(prediction,generatedAt){
 const proof=prediction?.forecastHorizonEvidence,cutoff=quoteTimeEpoch(proof?.informationCutoffAt),generated=quoteTimeEpoch(generatedAt);
 return !!(proof?.schema==='sports-decision-horizon-v1'&&horizons.has(proof.horizon)&&origins.has(proof.origin)
  &&prediction.horizon===proof.horizon&&Number.isFinite(cutoff)&&Number.isFinite(generated)&&cutoff<=generated
  &&cutoff===quoteTimeEpoch(prediction.inputChronology?.cutoffAt)&&cutoff===quoteTimeEpoch(prediction.evidenceCoverage?.cutoffAt));
}
