import {readPredictionJournal} from '../src/predictionJournal.js';
import {auditSportsOperations} from '../src/operationalAudit.js';
const journal=process.argv.slice(2).find(value=>value.startsWith('--journal='))?.slice(10);
try{console.log(JSON.stringify(auditSportsOperations(await readPredictionJournal(journal)),null,2));}
catch{console.error('Operational audit failed. Preserve private journal evidence for integrity review.');process.exitCode=1;}
