import {collectForwardTrial} from '../src/forwardTrialCollector.js';
const directory=process.argv.slice(2).find(value=>value.startsWith('--directory='))?.slice(12);
try{if(!directory)throw new Error('Explicit private trial directory required');console.log(JSON.stringify(await collectForwardTrial(directory)));}
catch{console.error('Forward collector failed. Preserve private locks, manifest, journal and run evidence for inspection. No orders or Discord are enabled.');process.exitCode=1;}
