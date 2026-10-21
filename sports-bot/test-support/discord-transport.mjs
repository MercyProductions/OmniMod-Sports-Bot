import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Collection,ChannelType} from 'discord.js';

// Local fake Discord boundary: actual publisher/builders/storage, no Discord login or HTTP.
export async function fakeDiscord(directory,options={}) {
 const file=join(directory,'fake-discord.json');
 let rows=[];try{rows=JSON.parse(await readFile(file,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
 const counters={sends:0,edits:0};
 const persist=()=>writeFile(file,JSON.stringify(rows)+'\n');
 const payloadData=payload=>({...payload,embeds:payload.embeds.map(embed=>embed.toJSON())});
 const wrap=row=>({...row,reply:async payload=>{
  if(options.replyFails)throw new Error('Synthetic reply unavailable');
  return channel.send({...payload,reference:{messageId:row.id}});
 },edit:async payload=>{
  counters.edits++;if(options.editFails)throw Object.assign(new Error('Synthetic edit denied'),{code:50013});
  Object.assign(row,payloadData(payload));await persist();if(options.crashAfterEdit)process.exit(76);if(options.ambiguousEdit)throw new Error('Synthetic timeout after edit acceptance');return wrap(row);
 }});
 const channel={id:'channel',guildId:'transport',type:ChannelType.GuildText,name:'omnimod-sports',isTextBased:()=>true,
  messages:{fetch:async request=>{
   if(typeof request==='string'){
    if(options.messageFetchFails)throw Object.assign(new Error('Synthetic message access denied'),{code:50013});
    const row=rows.find(row=>row.id===request);if(!row)throw Object.assign(new Error('Synthetic unknown message'),{code:10008});return wrap(row);
   }
   if(options.historyFails)throw Object.assign(new Error('Synthetic history denied'),{code:50013});
   if(options.historyFull)return new Collection(Array.from({length:100},(_,i)=>[`other-${i}`,{id:`other-${i}`,author:{id:'bot'},embeds:[]}]));
   return new Collection(rows.map(row=>[row.id,wrap(row)]));
  }},send:async payload=>{
   counters.sends++;if(options.sendFails)throw new Error('Synthetic send unavailable');
   const row={id:`message-${rows.length+1}`,channelId:'channel',author:{id:'bot'},...payloadData(payload)};
   rows.push(row);await persist();
   if(options.crashAfterSend)process.exit(73);
   if(options.ambiguousSend)throw new Error('Synthetic timeout after server acceptance');
   return wrap(row);
  }};
 const guild={id:'transport',channels:{fetch:async()=>new Collection([['channel',channel]])},roles:{fetch:async()=>new Collection()}};
 const client={user:{id:'bot'},guilds:{fetch:async()=>guild},channels:{fetch:async()=>{
  if(options.cachedFetchFails)throw Object.assign(new Error('Synthetic message access denied'),{code:50013});
  return channel;
 }}};
 return {client,counters,rows,channel};
}

if(process.argv[1]===fileURLToPath(import.meta.url)){
 const [directory,mode]=process.argv.slice(2);
 if(!directory||!['crash','retry','final-crash','final-retry'].includes(mode))throw new Error('Invalid synthetic transport worker');
 const {postDailySlate,postFinalResult}=await import('../src/discordPublisher.js');
 const {recordPredictionJournal}=await import('../src/predictionJournal.js');
 const {readDailyCache}=await import('../src/storage.js');
 const slate=JSON.parse(await readFile(join(directory,'slate.json'),'utf8'));
 await recordPredictionJournal(slate);
 const remote=await fakeDiscord(directory,{crashAfterSend:['crash','final-crash'].includes(mode)});
 if(mode.startsWith('final-'))await postFinalResult(remote.client,slate,{game:slate.games[0],prediction:slate.predictions[0]});
 else { const cached=await readDailyCache(slate.dateKey,'transport');await postDailySlate(remote.client,{...slate,cacheRevision:cached?.cacheRevision??0},{guildId:'transport',reuseExisting:false}); }
 console.log(JSON.stringify({messages:remote.rows.length,...remote.counters}));
}
