import { createHash } from 'node:crypto';

const iso=value=>Number.isFinite(Date.parse(value||''))?new Date(value).toISOString():null;
const league=value=>String(value||'').trim().toLowerCase();
const encoded=value=>JSON.stringify(value,(_,item)=>item&&typeof item==='object'&&!Array.isArray(item)
  ?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a.localeCompare(b))):item);
const signature=value=>createHash('sha256').update(encoded(value)).digest('hex');

export function journalGameIndex(games=[]){
  const index=new Map();
  for(const game of games){
    if(game.id===undefined||game.id===null||String(game.id)==='')continue;
    const id=String(game.id);if(!index.has(id))index.set(id,[]);index.get(id).push(game);
  }
  return index;
}

export function matchJournalGame(index,subject={}){
  const all=index.get(String(subject.gameId))||[],scope=league(subject.leagueKey||subject.league),start=iso(subject.startTime);
  let candidates=all,reason='game_identity_not_found';
  if(candidates.length&&scope){candidates=candidates.filter(game=>league(game.leagueKey||game.league)===scope);if(!candidates.length)reason='league_mismatch';}
  if(candidates.length&&start){candidates=candidates.filter(game=>iso(game.startTime)===start);if(!candidates.length)reason='scheduled_start_mismatch';}
  const unique=new Map(candidates.map(game=>[signature(game),game]));
  if(unique.size===1)return {game:unique.values().next().value,reason:null};
  if(unique.size>1)reason='ambiguous_game_observations';
  const observations=(candidates.length?candidates:all).slice(0,10).map(game=>({gameId:String(game.id),league:String(game.leagueKey||game.league||''),
    startTime:iso(game.startTime),statusKey:game.statusKey||'unknown',observationHash:signature(game)}));
  return {game:null,reason,candidateCount:(candidates.length?candidates:all).length,observations,
    observationsTruncated:(candidates.length?candidates:all).length>10};
}

export {signature as eventObservationHash};
