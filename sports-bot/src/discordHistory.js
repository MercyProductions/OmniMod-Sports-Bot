export const DISCORD_HISTORY_MAX_PAGES = 25;
const failure=(code,message,cause)=>Object.assign(new Error(message,cause?{cause}:undefined),{code});

/** Null means a complete history had no match; failures never establish absence. */
export async function findInChannelHistory(channel,matches,{maximumPages=DISCORD_HISTORY_MAX_PAGES}={}){
 if(typeof matches!=='function'||!Number.isSafeInteger(maximumPages)||maximumPages<1||maximumPages>50)
  throw Error('Invalid Discord history bounds');
 let before;const cursors=new Set();
 for(let page=0;page<maximumPages;page++){
  let messages;
  try{messages=await channel.messages.fetch({limit:100,before});}
  catch(error){throw failure('DISCORD_HISTORY_UNAVAILABLE','Discord channel history request failed',error);}
  if(!Number.isSafeInteger(messages?.size)||messages.size<0||messages.size>100)
   throw failure('DISCORD_HISTORY_UNAVAILABLE','Discord channel history response is invalid');
  const found=messages.find(matches);if(found)return found;
  if(messages.size<100)return null;
  const next=messages.last()?.id;
  if(!next||cursors.has(next))throw failure('DISCORD_HISTORY_CURSOR_INVALID','Discord channel history cursor did not advance');
  cursors.add(next);before=next;
 }
 throw failure('DISCORD_HISTORY_LIMIT_REACHED','Discord channel history search limit reached');
}
