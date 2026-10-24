import {journalGameIndex,matchJournalGame} from './journalEventMatch.js';

const iso=value=>Number.isFinite(Date.parse(value||''))?new Date(value).toISOString():null;
export const eventReference=game=>({gameId:String(game.id??game.gameId),leagueKey:String(game.leagueKey||''),startTime:iso(game.startTime)});
export const scopedEventKey=row=>JSON.stringify([String(row.leagueKey||'').toLowerCase(),String(row.gameId??row.id),iso(row.startTime)]);
export const resolveSlateGame=(index,row)=>matchJournalGame(index,{gameId:row.gameId??row.id,leagueKey:row.leagueKey,startTime:row.startTime});

/** Predictions must resolve to one game and one immutable payload per event. Human league labels are not keys. */
export function scopedSlatePredictions(slate={}){
 const games=journalGameIndex(slate.games||[]),candidates=new Map(),resolved=new Map();
 for(const prediction of slate.predictions||[]){
  const game=resolveSlateGame(games,prediction).game;if(!game)continue;
  const key=scopedEventKey(eventReference(game));if(!candidates.has(key))candidates.set(key,[]);candidates.get(key).push(prediction);
 }
 for(const [key,rows] of candidates){
  const observations=rows.map(row=>({...row,id:row.gameId,leagueKey:JSON.parse(key)[0]}));
  if(matchJournalGame(journalGameIndex(observations),{gameId:rows[0].gameId}).game)resolved.set(key,rows[0]);
 }
 return resolved;
}

/** Legacy completion entries without bound league/start are retried rather than inferred as current evidence. */
export function scopedRefreshState(slate,game){
 const key=scopedEventKey(eventReference(game)),states=slate.pregameRefreshes||{};
 if(states['event:'+key])return states['event:'+key];
 const legacy=states[String(game.id)];
 return legacy?.eventKey===key?legacy:{windows:{}};
}
