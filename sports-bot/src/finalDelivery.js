import {claimFinalResult,finishFinalResult,releaseFinalResultClaim} from './storage.js';
import {postFinalResult} from './discordPublisher.js';
import {finalResultKey,finalResultScope,finalReplyFor} from './finalResultIdentity.js';

/** Event-local failures remain pending and cannot starve the rest of a final batch. */
export async function deliverFinalBatch(client,slate,{reason='',post=postFinalResult}={}){
 const finalReplies={...(slate.finalReplies||{})},failures=[];let postedCount=0,recoveredCount=0;
 for(const final of slate.newFinals||[]){
  let key,claimed=false;
  try{
   key=finalResultKey(slate,final.prediction);
   if(finalReplyFor({...slate,finalReplies},final.prediction))continue;
   const result=await claimFinalResult(slate.dateKey,slate.guildId,key,{reason,eventKey:key,eventScope:finalResultScope(slate,final.prediction),originalGameId:final.prediction.gameId});
   claimed=result.claimed;
   if(!claimed){
    const reply=result.claim;
    if(reply?.state==='posted'&&reply.eventKey===key&&reply.messageId&&reply.channelId){finalReplies[key]=reply;recoveredCount++;}
    else failures.push({eventKey:key,reason:'claim_unavailable_retry_pending'});
    continue;
   }
   const message=await post(client,slate,final);
   if(!message?.id||!message.channelId)throw new Error('Final delivery acknowledgement is incomplete');
   const reply={eventKey:key,messageId:message.id,channelId:message.channelId,postedAt:new Date().toISOString(),correct:final.prediction.predictionCorrect};
   await finishFinalResult(slate.dateKey,slate.guildId,key,reply);finalReplies[key]=reply;postedCount++;
  }catch{
   if(claimed)await releaseFinalResultClaim(slate.dateKey,slate.guildId,key).catch(()=>{});
   failures.push({eventKey:key||null,gameId:String(final.prediction?.gameId||''),reason:'delivery_failed_retry_pending'});
  }
 }
 return {finalReplies,postedCount,recoveredCount,failures};
}
