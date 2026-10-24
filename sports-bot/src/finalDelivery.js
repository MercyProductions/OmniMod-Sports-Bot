import {claimFinalResult,finishFinalResult,releaseFinalResultClaim,verifyFinalResultClaim,readFinalResultClaim} from './storage.js';
import {postFinalResult} from './discordPublisher.js';
import {finalResultKey,finalResultScope,finalReplyFor} from './finalResultIdentity.js';
import {prepareFinalRevision,correctionEvidence,mergeFinalReplies} from './finalResultRevision.js';

/** Event-local failures remain pending; all revisions share the event's owner-fenced claim chain. */
export async function deliverFinalBatch(client,slate,{reason='',post=postFinalResult}={}){
 slate=structuredClone(slate);
 let finalReplies={...(slate.finalReplies||{})};const failures=[];let postedCount=0,recoveredCount=0,correctedCount=0;
 for(const final of slate.newFinals||[]){
  let key,claimed=false,lease,failureReason='delivery_or_correction_failed_retry_pending';
  try{
   key=finalResultKey(slate,final.prediction);
   const stored=await readFinalResultClaim(slate.dateKey,slate.guildId,key);
   const prior=stored?.state==='posted'?stored:stored?.previousPosted||finalReplyFor({...slate,finalReplies},final.prediction);
   let revision=prepareFinalRevision(slate,final,stored?.frozenForecast||prior?.frozenForecast||final.prediction);
   if(stored?.resultDigest===revision.digest&&stored.resultObservedAt)revision=prepareFinalRevision(slate,{...final,prediction:{...final.prediction,resultObservedAt:stored.resultObservedAt}},revision.frozenForecast);
   const restore=reply=>{
    const normalized={...reply,claimGeneration:reply.claimGeneration??reply.generation},cached=finalReplies[key];
    const same=cached?.messageId===reply.messageId&&cached?.channelId===reply.channelId&&cached?.resultDigest===reply.resultDigest&&cached?.claimGeneration===normalized.claimGeneration;
    finalReplies=mergeFinalReplies(finalReplies,{[key]:normalized});if(!same)recoveredCount++;
   };
   if(prior&&prior.resultDigest===revision.digest){restore(prior);continue;}
   if(prior&&(!prior.frozenForecast||!prior.resultDigest)){failureReason='correction_baseline_unverified';throw new Error('Correction baseline is unavailable');}
   if(prior&&!correctionEvidence(final.game,prior,revision)){failureReason='correction_source_evidence_unverified';throw new Error('Correction source evidence is unavailable');}
   const result=await claimFinalResult(slate.dateKey,slate.guildId,key,{reason,eventKey:key,eventScope:finalResultScope(slate,revision.final.prediction),originalGameId:final.prediction.gameId,
    resultDigest:revision.digest,resultObservedAt:revision.observedAt,frozenForecast:revision.frozenForecast},{allowRevision:true});
   claimed=result.claimed;lease=result.lease;
   if(!claimed){
    const reply=result.claim;
    if(reply?.state==='posted'&&reply.eventKey===key&&reply.resultDigest===revision.digest&&reply.messageId&&reply.channelId){restore(reply);}
    else failures.push({eventKey:key,reason:result.reason==='revision_order_unverified'?'correction_order_unverified':'claim_or_revision_unavailable_retry_pending'});
    continue;
   }
   await verifyFinalResultClaim(slate.dateKey,slate.guildId,key,lease);
   const item={...revision.final,deliveryRevision:{digest:revision.digest,previousMessageId:prior?.messageId,previousChannelId:prior?.channelId,previousResultDigest:prior?.resultDigest,editOnly:Boolean(prior)}};
   const message=await post(client,slate,item);
   if(!message?.id||!message.channelId)throw new Error('Final delivery acknowledgement is incomplete');
   const reply={eventKey:key,messageId:message.id,channelId:message.channelId,postedAt:new Date().toISOString(),correct:item.prediction.predictionCorrect,
    resultDigest:revision.digest,resultObservedAt:revision.observedAt,frozenForecast:revision.frozenForecast,claimGeneration:lease.generation};
   await finishFinalResult(slate.dateKey,slate.guildId,key,reply,lease);finalReplies=mergeFinalReplies(finalReplies,{[key]:reply});postedCount++;if(prior)correctedCount++;
  }catch(error){
   if(error?.code==='CORRECTION_BASELINE_UNVERIFIED')failureReason='correction_baseline_unverified';
   if(claimed)await releaseFinalResultClaim(slate.dateKey,slate.guildId,key,lease).catch(()=>{});
   failures.push({eventKey:key||null,gameId:String(final.prediction?.gameId||''),reason:error?.code===10008?'correction_target_missing':error?.code===50013?'delivery_access_denied':failureReason,retryable:failureReason!=='correction_baseline_unverified'});
  }
 }
 return {finalReplies,postedCount,recoveredCount,correctedCount,failures};
}
