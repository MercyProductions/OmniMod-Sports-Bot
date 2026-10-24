import {readPredictionJournal} from '../src/predictionJournal.js';
import {evaluatePriceResearch} from '../src/priceResearch.js';
import {quoteTimeEpoch} from '../src/oddsPricing.js';
const arg=name=>process.argv.slice(2).find(value=>value.startsWith(`--${name}=`))?.slice(name.length+3);
try{
  const costs={feePerStake:arg('fee-per-stake'),commissionOnProfit:arg('commission-on-profit'),profitHaircut:arg('profit-haircut')};
  const cutoff=arg('as-of'),asOf=cutoff===undefined?Date.now():quoteTimeEpoch(cutoff);
  const scope=Object.fromEntries([['league','league'],['horizon','horizon'],['modelVersion','model-version']].map(([key,flag])=>[key,arg(flag)??null]));
  console.log(JSON.stringify(evaluatePriceResearch(await readPredictionJournal(arg('journal')),{costs,asOf,...scope}),null,2));
}catch{
  console.error('Price audit failed. Supply explicit cost assumptions and preserve the journal for private integrity review.');
  process.exitCode=1;
}
