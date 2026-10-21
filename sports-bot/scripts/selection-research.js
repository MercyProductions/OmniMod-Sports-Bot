import {hybridArtifact} from '../src/hybridArtifact.js';
import {readFile} from 'node:fs/promises';
import {registerSelectionPlan,finalizeSelectionPlan} from '../src/selectionProtocol.js';
import {readPredictionJournal} from '../src/predictionJournal.js';
import {localMlArtifactId} from '../src/localMl.js';
import {CURRENT_MODEL_VERSION} from '../src/modelIdentity.js';

const arg=name=>process.argv.slice(2).find(value=>value.startsWith(`--${name}=`))?.slice(name.length+3);
try{
  const action=arg('action'),directory=arg('directory');
  if(!directory)throw new Error('Explicit research directory required');
  if(action==='register'){
    const spec=JSON.parse(await readFile(arg('spec'),'utf8'));
    const candidate=spec.candidate || 'ml';
    let model,planSpec;
    if(candidate==='hybrid'){
      model=hybridArtifact(spec.sport,spec.specialistWeight ?? .38);
      if(!model)throw new Error('Hybrid source recipe unavailable');
      planSpec={...spec,candidate,artifactId:model.artifactId,modelVersion:CURRENT_MODEL_VERSION};
    }else{
      if(candidate!=='ml')throw new Error('Unsupported selection candidate');
      const store=JSON.parse(await readFile(arg('model-file'),'utf8'));model=store.sports?.[spec.sport];
      if(!model||model.artifactFormat!=='sports-local-ml-artifact-v2'||model.artifactId!==localMlArtifactId(model))
        throw new Error('Valid frozen research artifact required');
      planSpec={...spec,candidate,artifactId:model.artifactId,trainedAt:model.trainedAt,
        lastTrainingOutcomeAt:model.lastTrainingOutcomeAt,modelVersion:CURRENT_MODEL_VERSION};
    }
    const result=await registerSelectionPlan(planSpec,{directory,model});
    console.log(JSON.stringify({status:'research_plan_registered',planId:result.id,planHash:result.planHash,promotionAllowed:false}));
  }else if(action==='finalize'){
    if(!arg('journal'))throw new Error('Explicit isolated journal required');
    const result=await finalizeSelectionPlan(arg('id'),{directory,records:await readPredictionJournal(arg('journal'))});
    console.log(JSON.stringify(result,null,2));
  }else throw new Error('Explicit register/finalize action required');
}catch{
  console.error('Selection research operation failed. Preserve the state, plan, model and journal for private inspection.');
  process.exitCode=1;
}
