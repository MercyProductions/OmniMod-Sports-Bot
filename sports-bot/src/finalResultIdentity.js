import {createHash} from 'node:crypto';
import {journalGameIndex} from './journalEventMatch.js';
import {resolveSlateGame,eventReference,scopedEventKey} from './slateEventIdentity.js';

export function finalResultScope(slate={},prediction={}){
 const game=resolveSlateGame(journalGameIndex(slate.games||[]),prediction).game;
 const scope=game?eventReference(game):{gameId:String(prediction.gameId||''),leagueKey:prediction.leagueKey||'',startTime:prediction.startTime};
 const time=Date.parse(scope.startTime||'');
 if((slate.games?.length&&!game)||!scope.gameId||!scope.leagueKey||!Number.isFinite(time)||!slate.guildId||!/^\d{4}-\d{2}-\d{2}$/.test(slate.dateKey||''))throw new Error('A unique league/start/guild/date event is required for final delivery');
 return {...scope,startTime:new Date(time).toISOString(),guildId:String(slate.guildId),dateKey:slate.dateKey};
}
export function finalResultKey(slate,prediction){
 const scope=finalResultScope(slate,prediction);
 return 'event-'+createHash('sha256').update(JSON.stringify([scope.guildId,scope.dateKey,scopedEventKey(scope)])).digest('hex');
}
export function finalReplyFor(slate,prediction){
 try{const key=finalResultKey(slate,prediction),reply=slate.finalReplies?.[key];return reply?.eventKey===key&&reply.messageId&&reply.channelId?reply:null;}catch{return null;}
}
export const finalResultFooter=(slate,prediction)=>`OmniMod Sports result | ${slate.dateKey} | ${finalResultKey(slate,prediction)}`;
export function matchesFinalResultFooter(text,slate,prediction){
 const base=finalResultFooter(slate,prediction),prefix=base+' | result: ';
 return text===base||(typeof text==='string'&&text.startsWith(prefix)&&/^[a-f0-9]{64}$/.test(text.slice(prefix.length)));
}


/** Legacy footer recovery requires scoped presentation evidence and a unique native-ID/league/displayed-start cohort in this slate. */
export function legacyFinalMessageMatches(message,embed,slate,prediction){
 const scope=finalResultScope(slate,prediction),games=(slate.games||[]).filter(game=>String(game.id)===scope.gameId&&String(game.leagueKey||'').toLowerCase()===String(scope.leagueKey).toLowerCase()
  &&(!game.startTimeLocal||game.startTimeLocal===prediction.startTimeLocal));
 if(!games.length||games.some(game=>scopedEventKey(eventReference(game))!==scopedEventKey(scope)))return false;
 const game=games[0],fields=embed.fields||[];
 const league=fields.find(row=>row.name==='League')?.value,started=fields.find(row=>row.name==='Started')?.value;
 const footer=`OmniMod Sports result | ${slate.dateKey} | ${scope.gameId}`;
 return embed.footer?.text===footer&&embed.title===`Final result #${prediction.index}: ${prediction.matchup}`
  &&league===game.league&&Boolean(prediction.startTimeLocal)&&started===prediction.startTimeLocal
  &&(!slate.messageId||message.reference?.messageId===slate.messageId);
}
