import { readPredictionJournal } from '../src/predictionJournal.js';
import { summarizePredictionJournal } from '../src/journalEvaluation.js';

try {
  const records = await readPredictionJournal();
  console.log(JSON.stringify(summarizePredictionJournal(records), null, 2));
} catch (error) {
  console.error(`Prediction audit failed: ${error.message}`);
  process.exitCode = 1;
}
