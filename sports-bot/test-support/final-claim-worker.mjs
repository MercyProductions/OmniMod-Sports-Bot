import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
const [directory,mode,event='fixture']=process.argv.slice(2);
if(!directory||!['hold','claim-exit','batch-before-send','batch-after-send','batch-after-ack','batch-retry','finish-foreign','batch-after-edit'].includes(mode))throw new Error('Invalid final claim fixture');
process.env.NODE_ENV='test';process.env.OMNIMOD_DISABLE_DATA_MIGRATION='true';process.env.OMNIMOD_SPORTS_DATA_DIR=directory;
process.env.DOTENV_CONFIG_PATH=join(directory,'empty.env');process.env.DOTENV_CONFIG_QUIET='true';
const {claimFinalResult,releaseFinalResultClaim,finishFinalResult,writeDailyCache,readDailyCache}=await import('../src/storage.js');
if(mode==='finish-foreign'){
 const lease=JSON.parse(await readFile(join(directory,'borrowed-lease.json'),'utf8'));
 let rejected=false;try{await finishFinalResult('2026-10-21','fixture',event,{messageId:'foreign',channelId:'channel'},lease);}catch{rejected=true;}
 process.stdout.write(JSON.stringify({rejected})+'\n');
}else if(['hold','claim-exit'].includes(mode)){
 const result=await claimFinalResult('2026-10-21','fixture',event);process.stdout.write(JSON.stringify(result)+'\n');
 if(mode==='claim-exit')process.exit(23);
 process.stdin.once('data',async()=>{if(result.claimed)await releaseFinalResultClaim('2026-10-21','fixture',event,result.lease);process.exit(0);});
}else{
 const {deliverFinalBatch}=await import('../src/finalDelivery.js');const {postFinalResult}=await import('../src/discordPublisher.js');
 const {fakeDiscord}=await import('./discord-transport.mjs');
 const slate=JSON.parse(await readFile(join(directory,'slate.json'),'utf8'));
 const cached=await readDailyCache(slate.dateKey,slate.guildId);
 const remote=await fakeDiscord(directory,{crashAfterSend:mode==='batch-after-send',crashAfterEdit:mode==='batch-after-edit'});
 const result=await deliverFinalBatch(remote.client,slate,{post:mode==='batch-before-send'?async()=>process.exit(74):postFinalResult});
 if(mode==='batch-after-ack')process.exit(75);
 await writeDailyCache(slate.dateKey,{...slate,finalReplies:result.finalReplies,newFinals:[]},slate.guildId,{expectedRevision:cached?.cacheRevision??0});
 process.stdout.write(JSON.stringify({posted:result.postedCount,recovered:result.recoveredCount,failed:result.failures.length,sends:remote.counters.sends,edits:remote.counters.edits,acknowledgements:Object.keys(result.finalReplies).length})+'\n');
}
