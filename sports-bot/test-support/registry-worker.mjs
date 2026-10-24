import fs from 'node:fs/promises';
import {once} from 'node:events';
import {join} from 'node:path';
const [directory,mode,sport]=process.argv.slice(2);
if(!directory||!['hold','write'].includes(mode)||!['basketball','football'].includes(sport))throw new Error('Invalid registry fixture');
process.env.NODE_ENV='test';process.env.OMNIMOD_DISABLE_DATA_MIGRATION='true';process.env.OMNIMOD_SPORTS_DATA_DIR=directory;
process.env.DOTENV_CONFIG_PATH=join(directory,'empty.env');process.env.DOTENV_CONFIG_QUIET='true';
const {refreshModelRegistry,modelRegistryFile}=await import('../src/modelRegistry.js');
const {CURRENT_MODEL_VERSION}=await import('../src/modelIdentity.js');
if(mode==='hold'){
 const original=fs.readFile;let held=false;
 fs.readFile=async(file,...args)=>{const result=await original(file,...args);if(String(file)===modelRegistryFile&&!held){held=true;process.stdout.write(JSON.stringify({status:'snapshot_read'})+'\n');await once(process.stdin,'data');}return result;};
}
const row={sport,leagueKey:sport==='basketball'?'nba':'nfl',gameId:sport,source:'frozen-production',modelVersion:CURRENT_MODEL_VERSION,horizon:'Daily',dateKey:'2026-01-01',snapshotPolicy:'first_issue_immutable_v1',
 predictionGeneratedAt:'2026-01-01T08:00:00Z',recordedAt:'2026-01-01T09:00:00Z',startTime:'2026-01-01T20:00:00Z',resolvedAt:'2026-01-01T23:00:00Z',actualSide:'home',candidateProbabilities:{evidence:{away:.4,home:.6,draw:0}}};
try{await refreshModelRegistry([row]);process.stdout.write(JSON.stringify({status:'accepted',sport})+'\n');}
catch(error){if(/locked/.test(error.message)){process.stdout.write(JSON.stringify({status:'owner_locked',sport})+'\n');process.exitCode=31;}else throw error;}
