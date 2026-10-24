import {createHash} from 'node:crypto';
import {readFileSync,readdirSync} from 'node:fs';
import {CURRENT_MODEL_VERSION} from './modelIdentity.js';

// Freeze source identity at module startup, alongside the running imported implementation.
// Hash source bytes only: never environment, account configuration, state or credentials.
let sourceManifest=null;
try{
  const root=new URL('./',import.meta.url);
  const names=readdirSync(root).filter(name=>name.endsWith('.js')).sort();
  if(['hybridArtifact.js','modelIdentity.js','predictionEngine.js','sportModels.js','sportProfiles.js'].some(name=>!names.includes(name)))throw new Error('Incomplete hybrid source');
  sourceManifest=names.map(name=>({name,
    sha256:createHash('sha256').update(readFileSync(new URL(name,root))).digest('hex')}));
}catch{ /* Missing source is unsupported for promotion; inference falls back to evidence. */ }
export function hybridArtifact(sport,specialistWeight=.38){
  if(!sourceManifest||typeof sport!=='string'||!sport||!Number.isFinite(specialistWeight)||specialistWeight<.15||specialistWeight>.55)return null;
  const recipe={schema:'sports-hybrid-recipe-v1',modelVersion:CURRENT_MODEL_VERSION,sport,specialistWeight,
    sourceManifest:sourceManifest.map(row=>({...row}))};
  return {...recipe,artifactId:createHash('sha256').update(JSON.stringify(recipe)).digest('hex')};
}
export function hybridArtifactId(sport,specialistWeight=.38){return hybridArtifact(sport,specialistWeight)?.artifactId || null;}
