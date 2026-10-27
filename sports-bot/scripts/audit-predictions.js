import {readPredictionJournal} from '../src/predictionJournal.js';
import {summarizePredictionJournal} from '../src/journalEvaluation.js';
import {quoteTimeEpoch} from '../src/oddsPricing.js';
try {
  const args=process.argv.slice(2),cutoffs=args.filter(value=>value.startsWith('--as-of=')),journals=args.filter(value=>value.startsWith('--journal='));
  if(args.some(value=>!value.startsWith('--as-of=')&&!value.startsWith('--journal='))||cutoffs.length>1||journals.length>1)
    throw new Error('Invalid audit arguments');
  const asOf=cutoffs.length?quoteTimeEpoch(cutoffs[0].slice(8)):Date.now();
  if(!Number.isFinite(asOf)||journals.length&&!journals[0].slice(10))throw new Error('Invalid audit arguments');
  const records=await readPredictionJournal(journals[0]?.slice(10));
  console.log(JSON.stringify(summarizePredictionJournal(records,{asOf}),null,2));
} catch {
  console.error('Prediction audit failed. Preserve private journal evidence for integrity review.');
  process.exitCode=1;
}
