import {localDateKey,localParts} from './time.js';

const DEFAULT_RETRY_DELAYS = [60_000,300_000,900_000,1_800_000,3_600_000];
const errorCode = error => ['DAILY_HISTORY_CURSOR_INVALID','DAILY_HISTORY_LIMIT_REACHED','DAILY_HISTORY_UNAVAILABLE',
 'DAILY_PUBLICATION_BUSY','DAILY_CACHE_CONFLICT','DAILY_POST_NOT_ACKNOWLEDGED'].includes(error?.code) ? error.code : 'DAILY_POST_FAILED';

/** Retry a due daily delivery, using the publisher's durable cache and duplicate guards. */
export function createDailyPostScheduler({publish,timezone,clock=Date.now,retryDelays=DEFAULT_RETRY_DELAYS}={}){
 if(typeof publish!=='function'||typeof clock!=='function'||!retryDelays.length
  ||retryDelays.some(value=>!Number.isSafeInteger(value)||value<1000||value>86_400_000))throw Error('Invalid daily scheduler options');
 localParts(new Date(0),timezone);
 const states=new Map(),active=new Set();
 const snapshot=guildId=>states.has(guildId)?structuredClone(states.get(guildId)):null;
 async function tick(guildId,{hour,minute}){
  const at=clock();
  if(!guildId||!Number.isFinite(at)||!Number.isInteger(hour)||hour<0||hour>23||!Number.isInteger(minute)||minute<0||minute>59)
   throw Error('Invalid daily schedule');
  const date=new Date(at),dateKey=localDateKey(date,timezone),parts=localParts(date,timezone);
  if(parts.hour*60+parts.minute<hour*60+minute)return {status:'not_due'};
  if(active.has(guildId))return {status:'in_progress'};
  let state=states.get(guildId);
  if(state?.dateKey!==dateKey){
   state={dateKey,status:'pending',attempts:0,lastAttemptAt:null,deliveredAt:null,nextRetryAt:null,lastErrorCode:null};
   states.set(guildId,state);
  }
  if(state.status==='delivered')return {status:'already_delivered'};
  if(state.nextRetryAt&&at<Date.parse(state.nextRetryAt))return {status:'backoff'};
  active.add(guildId);state.status='publishing';state.attempts++;state.lastAttemptAt=new Date(at).toISOString();
  try{
   const published=await publish(guildId);
   if(!published?.messageId||!published?.channelId)throw Object.assign(Error('Daily delivery was not acknowledged'),{code:'DAILY_POST_NOT_ACKNOWLEDGED'});
   state.status='delivered';state.deliveredAt=new Date(Math.max(at,clock())).toISOString();
   state.nextRetryAt=null;state.lastErrorCode=null;
   return {status:'delivered'};
  }catch(error){
   state.status='retry_scheduled';state.lastErrorCode=errorCode(error);
   const delay=retryDelays[Math.min(state.attempts-1,retryDelays.length-1)];
   state.nextRetryAt=new Date(Math.max(at,clock())+delay).toISOString();
   return {status:'retry_scheduled',errorCode:state.lastErrorCode};
  }finally{active.delete(guildId);}
 }
 return {tick,snapshot};
}
