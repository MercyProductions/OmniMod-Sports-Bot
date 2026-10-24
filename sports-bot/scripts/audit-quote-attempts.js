import {dataDir} from '../src/config.js';
import {readQuoteAttemptAudits} from '../src/quoteAttemptAudit.js';
try{
 const args=process.argv.slice(2);if(args.length&&!(args.length===1&&args[0].startsWith('--directory=')))throw new Error('Invalid arguments');
 const rows=await readQuoteAttemptAudits(args.length?args[0].slice('--directory='.length):dataDir),states={},statuses={};
 for(const row of rows){states[row.state]=(states[row.state]||0)+1;if(row.completion)statuses[row.completion.status]=(statuses[row.completion.status]||0)+1;}
 console.log(JSON.stringify({reservedSlots:rows.length,states,terminalStatuses:statuses,preparedPriceSnapshots:rows.reduce((sum,row)=>sum+(row.completion?.preparedPriceSnapshots||0),0),
  providerChargesVerified:false,discordDeliveryVerified:false,limitations:['Unfinished attempts do not prove dispatch, success, charging or failure.','Prepared snapshots do not attest journal persistence or Discord delivery.']},null,2));
}catch{console.error('Quote-attempt audit unavailable; preserve the claim and audit files for review.');process.exitCode=1;}
