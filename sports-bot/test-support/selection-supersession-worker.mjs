import {readFile} from 'node:fs/promises';
import {hybridArtifact} from '../src/hybridArtifact.js';
import {supersedeUnstartedSelectionPlan} from '../src/selectionProtocol.js';
try{
 const fixture=JSON.parse(await readFile(process.argv[2],'utf8'));
 const result=await supersedeUnstartedSelectionPlan('prior',fixture.spec,{...fixture.options,model:hybridArtifact('hockey',.38)});
 console.log(JSON.stringify({status:result.status}));
}catch{
 console.error('Pretrial transition did not acquire or verify its evidence.');process.exitCode=1;
}
