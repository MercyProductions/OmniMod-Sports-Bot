import {createHash} from 'node:crypto';
import {finalOutcomeSide,validScore} from './dataValidation.js';
import {finalResultKey,finalReplyFor,finalResultScope} from './finalResultIdentity.js';
import {journalGameIndex} from './journalEventMatch.js';
import {resolveSlateGame} from './slateEventIdentity.js';
const iso=value=>Number.isFinite(Date.parse(value||''))?new Date(value).toISOString():null;
export function frozenFinalForecast(prediction){
 const frozen=structuredClone(prediction);
 for(const field of ['actualSide','actualWinner','predictionCorrect','finalScore','resultObservedAt','deliveryRevision'])delete frozen[field];
 return frozen;
}
export function prepareFinalRevision(slate,final,anchor=final.prediction){
 const game=final.game,side=finalOutcomeSide(game),away=validScore(game.away?.score),home=validScore(game.home?.score);
 const scope=finalResultScope(slate,anchor),bound=resolveSlateGame(journalGameIndex(slate.games||[]),anchor).game;
 if(String(game.leagueKey||'').toLowerCase()!==String(scope.leagueKey).toLowerCase()||Date.parse(game.startTime)!==Date.parse(scope.startTime)
  ||(String(game.id)!==scope.gameId&&String(bound?.upstreamEventId||'')!==String(game.id)))throw new Error('Final source does not match the frozen event');
 if(game.statusKey!=='final'||!side||away===null||home===null||!['away','home','draw'].includes(anchor.predictedSide))throw new Error('A valid final and frozen selection are required');
 const observedAt=iso(final.prediction.resultObservedAt)||new Date().toISOString();
 if(Date.parse(observedAt)<Date.parse(game.startTime)||Date.parse(observedAt)>Date.now())throw new Error('Final observation chronology is invalid');
 const frozen=frozenFinalForecast(anchor),prediction={...frozen,actualSide:side,actualWinner:side==='draw'?'Draw':game[side].name,predictionCorrect:side===frozen.predictedSide,
  finalScore:`${game.away.abbr} ${away} - ${game.home.abbr} ${home}`,resultObservedAt:observedAt};
 const eventKey=finalResultKey(slate,prediction),vector=['away','home','draw'].map(key=>frozen.outcomeProbabilities?.[key]??null);
 const digest=createHash('sha256').update(JSON.stringify([eventKey,away,home,side,frozen.predictedSide,frozen.modelVersion||null,frozen.predictionGeneratedAt||null,vector])).digest('hex');
 return {final:{game,prediction},digest,observedAt,frozenForecast:frozen};
}
export function finalReplyMatches(slate,prediction){
 try{
  const reply=finalReplyFor(slate,prediction),game=resolveSlateGame(journalGameIndex(slate.games||[]),prediction).game;
  return Boolean(reply?.resultDigest&&game&&reply.resultDigest===prepareFinalRevision(slate,{game,prediction},reply.frozenForecast||prediction).digest);
 }catch{return false;}
}
export function correctionEvidence(game,prior,revision){
 if(game.manualResultEvidence){
  const evidence=game.manualResultEvidence,receipt=Date.parse(evidence.recordedAt||''),observed=Date.parse(evidence.observedAt||''),before=Date.parse(prior.resultObservedAt||''),after=Date.parse(revision.observedAt);
  let publicReference=false;try{const url=new URL(evidence.sourceReference);publicReference=['http:','https:'].includes(url.protocol)&&!url.username&&!url.password;}catch{}
  return evidence.eventIdentityVerified===true&&evidence.sourceChecked===true&&publicReference&&Boolean(evidence.recordedBy)
   &&Number.isFinite(receipt)&&Number.isFinite(observed)&&observed>before&&receipt>=observed&&receipt<=after;
 }
 if(game.sourceMeta?.provider==='local')return false;
 const fetched=Date.parse(game.sourceMeta?.fetchedAt||''),observed=Date.parse(revision.observedAt),previous=Date.parse(prior.resultObservedAt||'');
 return ['network','revalidated','fresh'].includes(game.sourceMeta?.cacheState)&&Number.isFinite(fetched)&&Number.isFinite(previous)&&fetched>previous&&fetched<=observed;
}
export function mergeFinalReplies(existing={},incoming={}){
 const result={...existing};
 for(const [key,reply] of Object.entries(incoming)){
  const prior=result[key];
  if(Number.isSafeInteger(prior?.claimGeneration)&&(!Number.isSafeInteger(reply?.claimGeneration)||reply.claimGeneration<prior.claimGeneration))continue;
  result[key]=reply;
 }
 return result;
}
