import { readFile, writeFile } from 'node:fs/promises';
import { prepareWarehouseResultReview, applyWarehouseResultReview } from '../src/featureWarehouse.js';

const args=Object.fromEntries(process.argv.slice(2).map(argument=>{
  const index=argument.indexOf('=');
  return index<0?[argument.replace(/^--/,''),true]:[argument.slice(0,index).replace(/^--/,''),argument.slice(index+1)];
}));
async function readReviewJson(file){
  const text=await readFile(file,'utf8');
  try{return JSON.parse(text);}catch{throw new Error('Proposal or review JSON is malformed; preserve the original file.');}
}
try {
  const action=args.action||'prepare';
  if(action==='prepare'){
    if(!args['forecast-id'])throw new Error('--forecast-id is required');
    const proposal=await prepareWarehouseResultReview(args['forecast-id'],args.journal?{journalFile:args.journal}:{});
    if(args.output){
      await writeFile(args.output,JSON.stringify(proposal,null,2)+'\n',{flag:'wx',mode:0o600});
      console.log(JSON.stringify({status:'prepared',proposalId:proposal.proposalId,dataDirectory:proposal.dataDirectory}));
    }else console.log(JSON.stringify(proposal,null,2));
  }else if(action==='apply'){
    if(!args.proposal||!args.review||!args['data-directory'])throw new Error('--proposal, --review and --data-directory are required');
    const proposal=await readReviewJson(args.proposal),review=await readReviewJson(args.review);
    console.log(JSON.stringify(await applyWarehouseResultReview(proposal,review,{expectedDataDirectory:args['data-directory'],...(args.journal?{journalFile:args.journal}:{})})));
  }else throw new Error('Unknown warehouse review action');
}catch(error){console.error(`Warehouse result review failed: ${error.message}`);process.exitCode=1;}
