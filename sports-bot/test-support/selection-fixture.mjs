import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {hybridArtifact} from '../src/hybridArtifact.js';
import {CURRENT_MODEL_VERSION} from '../src/modelIdentity.js';
import {registerSelectionPlan,finalizeSelectionPlan,verifySelectionReviewEvidence} from '../src/selectionProtocol.js';

// Synthetic journal evidence, generated through the real registration/finalization workflow.
// This proves test contracts, never market performance or source authenticity.
export async function selectionFixture({candidate='hybrid',artifact=hybridArtifact('basketball',.38),finalizedAt='2026-10-23T17:00:00Z'}={}){
 const now=Date.parse(finalizedAt),day=86400000,iso=value=>new Date(value).toISOString();
 const directory=await mkdtemp(join(tmpdir(),'sports-selection-proof-fixture-'));
 try{
  const spec={id:'synthetic-fixed-trial',sport:'basketball',league:'nba',horizon:'Daily',candidate,
   artifactId:artifact.artifactId,modelVersion:CURRENT_MODEL_VERSION,start:iso(now-20*day),end:iso(now-day),
   ...(candidate==='ml'?{trainedAt:artifact.trainedAt,lastTrainingOutcomeAt:artifact.lastTrainingOutcomeAt}:{})};
  await registerSelectionPlan(spec,{directory,model:artifact,now:now-30*day});
  const records=Array.from({length:75},(_,i)=>{
   const issue=now-20*day+(i%14)*day+12*3600000;
   const payload={forecastId:'f'+i,gameId:'g'+i,guildId:'synthetic',league:'nba',horizon:'Daily',modelVersion:CURRENT_MODEL_VERSION,
    lifecycleState:'ISSUED',recordEligibility:'observed_pregame',predictionGeneratedAt:iso(issue),startTime:iso(issue+3600000),
    eventContext:{sport:'basketball'},selectedSide:'home',outcomePercentages:{home:55,away:45,draw:0},
    candidateArtifactIds:{[candidate]:artifact.artifactId},candidateProbabilities:{[candidate]:{home:.8,away:.2,draw:0}}};
   return [{type:'forecast',recordedAt:iso(issue),payload},{type:'result',recordedAt:iso(issue+4*3600000),
    payload:{forecastId:payload.forecastId,actualSide:'home',observedAt:iso(issue+4*3600000)}}];
  }).flat();
  const review=await finalizeSelectionPlan(spec.id,{directory,records,now});
  if(review.status!=='review_ready')throw new Error('Synthetic selection fixture did not qualify');
  const state=JSON.parse(await readFile(join(directory,'selection-state.json'),'utf8'));
  const artifactBytes=await readFile(join(directory,state.plans[spec.id].artifactFile),'utf8');
  const bundle={state,artifactBytes,records,review,now};
  return {bundle,review:()=>verifySelectionReviewEvidence(structuredClone(bundle))};
 }finally{await rm(directory,{recursive:true,force:true});}
}
