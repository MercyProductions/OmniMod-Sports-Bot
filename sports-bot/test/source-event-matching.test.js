import test from 'node:test';
import assert from 'node:assert/strict';
import {sourceEventsMatch,matchSourceEvent} from '../src/sourceEventMatching.js';
import {carryForwardOdds,mergeTargetedGames,mergeLocalGames} from '../src/sportsData.js';
const base={id:'same',league:'NBA',leagueKey:'nba',startTime:'2026-10-21T19:00:00Z',away:{name:'Away'},home:{name:'Home'}};

test('source identity requires league and canonical start even when native IDs or team names match',()=>{
 assert.equal(sourceEventsMatch(base,{...base,startTime:'2026-10-21T14:00:00-05:00'}),true);
 for(const change of [{leagueKey:'nhl'},{startTime:'2026-10-22T19:00:00Z'},{startTime:null},{leagueKey:''}])assert.equal(sourceEventsMatch(base,{...base,...change}),false);
 assert.equal(sourceEventsMatch(base,{...base,id:'new-provider-id'}),true);
 assert.equal(sourceEventsMatch({...base,id:''},{...base,id:'other',away:{},home:{}}),false);
 assert.equal(sourceEventsMatch(base,{...base,id:'other',away:base.home,home:base.away}),false);
});

test('source duplicates coalesce while conflicting payloads require explicit reconciliation',()=>{
 assert.equal(matchSourceEvent([base,structuredClone(base)],base).observations.length,1);
 const conflict=matchSourceEvent([base,{...base,statusKey:'postponed'}],base);assert.equal(conflict.game,null);assert.equal(conflict.reason,'ambiguous_source_observations');
});

test('carry-forward odds never cross leagues, dates or an ambiguous source cohort',()=>{
 const quote={h2h:{home:{price:-120},away:{price:110}}},cached={...base,odds:quote};
 for(const games of [[{...base,leagueKey:'nhl'}],[{...base,startTime:'2026-10-22T19:00:00Z'}]])assert.equal(carryForwardOdds(games,{games:[cached]})[0].odds,undefined);
 const games=[{...base}];carryForwardOdds(games,{games:[cached,{...cached,odds:{other:true}}]});assert.equal(games[0].odds,undefined);
 const eligible=[{...base,id:'alias'}];carryForwardOdds(eligible,{games:[cached]});assert.equal(eligible[0].odds.cacheState,'daily_snapshot');
});

test('targeted merges preserve separate events and retain conflicts instead of silently choosing a source',()=>{
 const cached={...base,statusKey:'scheduled',home:{name:'Home',score:0}},fresh={...base,leagueKey:'nhl',league:'NHL',statusKey:'final',home:{name:'Home',score:4}};
 const separate=mergeTargetedGames([fresh],{games:[cached]});assert.equal(separate.length,2);assert.equal(separate.find(row=>row.leagueKey==='nba').statusKey,'scheduled');
 const conflict=mergeTargetedGames([{...cached,statusKey:'final'},{...cached,statusKey:'postponed'}],{games:[cached]});assert.equal(conflict.length,3);assert.ok(conflict.some(row=>row.statusKey==='final'));assert.ok(conflict.some(row=>row.statusKey==='postponed'));
});

test('manual metadata retains precedence only for the matching event, including provider aliases',()=>{
 const local={id:'same',dateKey:'2026-10-21',startTime:base.startTime,league:'NBA',leagueKey:'nba',awayTeam:'Away',homeTeam:'Home',venue:'Manual arena',neutralSite:true};
 const other={...base,league:'NHL',leagueKey:'nhl',venue:'Hockey arena'};
 const rows=mergeLocalGames([other],{games:{local}},'2026-10-21');assert.equal(rows.length,2);assert.equal(rows[0].venue,'Hockey arena');
 const matched=mergeLocalGames([{...base,id:'provider-alias',venue:'Provider arena'}],{games:{local}},'2026-10-21');assert.equal(matched.length,1);assert.equal(matched[0].venue,'Manual arena');assert.equal(matched[0].neutralSite,true);
});
