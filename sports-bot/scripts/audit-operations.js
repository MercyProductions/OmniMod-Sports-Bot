import {readPredictionJournal} from '../src/predictionJournal.js';
import {auditSportsOperations} from '../src/operationalAudit.js';
import {quoteTimeEpoch} from '../src/oddsPricing.js';
const journal=process.argv.slice(2).find(value=>value.startsWith('--journal='))?.slice(10);
const cutoffs=process.argv.slice(2).filter(value=>value.startsWith('--as-of='));
const cutoff=cutoffs[0]?.slice(8);
try{
 if(process.argv.includes('--as-of')||cutoffs.length>1)throw new Error('One explicit audit cutoff is required.');
 const asOf=cutoff===undefined?Date.now():quoteTimeEpoch(cutoff);
 if(!Number.isFinite(asOf))throw new Error('A valid explicit-zone audit cutoff is required.');
 console.log(JSON.stringify(auditSportsOperations(await readPredictionJournal(journal),{asOf}),null,2));
}
catch{console.error('Operational audit failed. Preserve private journal evidence for integrity review.');process.exitCode=1;}
