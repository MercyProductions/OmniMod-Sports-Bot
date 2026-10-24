import test from 'node:test';
import assert from 'node:assert/strict';
import {predictGame} from '../src/predictionEngine.js';
const now=Date.parse('2099-02-01T18:00:00Z');
const game=()=>({id:'nhl-fixture',league:'NHL',leagueKey:'nhl',sportGroup:'Hockey',statusKey:'scheduled',startTime:'2099-02-02T18:00:00Z',away:{name:'Away',abbr:'AAA'},home:{name:'Home',abbr:'HHH'}});
const player=(change={})=>({id:'local-player',name:'Goalie A',team:'Away',league:'NHL',leagueKey:'nhl',role:'Goalie',impact:6,form:50,updatedAt:new Date(now-1000).toISOString(),...change});
const predict=change=>predictGame(game(),1,{now,intelligence:{players:{one:player(change)}}});
const factor=p=>p.factors.find(row=>row.label==='Player availability');
test('unknown manual health cannot receive the same evidence coverage as an explicit available assertion',()=>{
 const unknown=predict({availability:null,status:'unknown'}),known=predict({availability:100,status:'Available'});
 assert.ok(unknown.localDataConfidenceValue<known.localDataConfidenceValue);assert.equal(factor(unknown).present,false);assert.equal(factor(known).present,true);
});
test('workout text cannot be mistaken for an unavailable player in primary scoring',()=>{
 assert.equal(factor(predict({availability:100,status:'workout completed'})).value,factor(predict({availability:100,status:'Available'})).value);
});
test('unknown health is explicitly disclosed without a full-availability percentage',()=>{
 const p=predict({availability:null,status:'unknown',form:80});assert.ok(p.signals.some(text=>text.includes('availability unknown')));assert.ok(!p.signals.some(text=>text.includes('100% available')));
});
test('an explicit current negative assertion vetoes a contradictory stored participation projection',()=>{
 const p=predict({availability:0,status:'Out',active:false,participationProjection:{availabilityProbability:1,historicalShare:1,expectedShare:1}});assert.notEqual(factor(p).value,0);
});

test('a current partial-availability assertion bounds a contradictory full-workload projection',()=>{
 const p=predict({availability:52,status:'Questionable',participationProjection:{availabilityProbability:1,historicalShare:1,expectedShare:1}});assert.notEqual(factor(p).value,0);
});
