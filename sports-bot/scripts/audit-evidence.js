import {readPredictionJournal} from '../src/predictionJournal.js';
import {summarizeEvidenceCoverage} from '../src/evidenceCoverage.js';

try {
  console.log(JSON.stringify(summarizeEvidenceCoverage(await readPredictionJournal()),null,2));
} catch {
  console.error('Evidence audit failed; preserve the journal and inspect its integrity privately.');
  process.exitCode=1;
}
