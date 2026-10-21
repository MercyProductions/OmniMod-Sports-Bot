import {loadProspectiveCaptures,evaluateProspectiveCaptures} from '../src/prospectivePairs.js';
import {prepareProspectiveIsolation,runProspectiveIsolation,inspectProspectiveIsolation} from '../src/prospectiveIsolation.js';
const arg=name=>process.argv.slice(2).find(value=>value.startsWith(`--${name}=`))?.slice(name.length+3);
try{
 const directory=arg('directory'),action=arg('action');let result;
 if(action==='prepare')result=await prepareProspectiveIsolation({directory,repository:arg('repository'),baselineRef:arg('baseline'),challengerRef:arg('challenger')||'HEAD'});
 else if(action==='inspect')result=await inspectProspectiveIsolation(directory);
 else if(action==='report'){
  await inspectProspectiveIsolation(directory);
  const loaded=await loadProspectiveCaptures(directory);
  result={...evaluateProspectiveCaptures(loaded.captures),unindexedLegacyCapturesExcluded:loaded.unindexed};
 }
 else if(action==='collect')result=await runProspectiveIsolation(directory,{live:arg('data')==='live'});
 else throw new Error('Explicit prepare, inspect, collect or report required');
 console.log(JSON.stringify(result,null,2));
}catch{console.error('Isolated research operation failed. Preserve private source, manifest and worker evidence for inspection.');process.exitCode=1;}
