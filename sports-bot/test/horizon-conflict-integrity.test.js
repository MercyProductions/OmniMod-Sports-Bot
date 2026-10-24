import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluatePredictionHorizons} from '../src/horizonEvaluation.js';
const base={guildId:'guild',gameId:'g',leagueKey:'nba',modelVersion:'fixture',horizon:'Daily',predictionMode:'pregame',
 predictionGeneratedAt:'2026-10-20T18:00:00Z',startTime:'2026-10-20T19:00:00Z',predictedSide:'home',actualSide:'home',
 outcomeProbabilities:{away:30,home:70,draw:0}};
const report=rows=>evaluatePredictionHorizons(rows,[],{modelVersion:'fixture'});

test('conflicting latest forecasts at one horizon cannot be chosen by array order',()=>{
 const other={...base,outcomeProbabilities:{away:10,home:90,draw:0}};
 for(const rows of [[base,other],[other,base]]){
  const result=report(rows);assert.equal(result.overall.sampleSize,0);assert.equal(result.scoringExclusions.simultaneous_forecast_conflict,1);
 }
});
test('identical duplicate forecasts retain one descriptive event weight',()=>{
 const result=report([base,structuredClone(base)]);
 assert.equal(result.overall.sampleSize,1);assert.ok(Math.abs(result.overall.brierScore-.09)<1e-12);
});
test('contradictory actual outcomes quarantine every horizon of the event',()=>{
 const result=report([base,{...base,horizon:'T-30',actualSide:'away'}]);
 assert.equal(result.overall.sampleSize,0);assert.deepEqual(result.byHorizon,{});
 assert.equal(result.conflictingResultEvents,1);assert.equal(result.scoringExclusions.conflicting_event_results,2);
});
test('cross-guild and other-version result contradictions cannot disappear through version selection',()=>{
 const result=report([base,{...base,guildId:'other',modelVersion:'older',actualSide:'away'}]);
 assert.equal(result.overall.sampleSize,0);assert.equal(result.conflictingResultEvents,1);
});
test('a declared disputed result blocks another clean-looking copy until reconciliation',()=>{
 const result=report([base,{...base,guildId:'other',actualSide:'',resultEvidenceStatus:'disputed'}]);
 assert.equal(result.overall.sampleSize,0);assert.equal(result.disputedResultEvents,1);
 assert.equal(result.scoringExclusions.disputed_event_result,1);
});
test('different simultaneous horizon forecasts remain separate but cannot pick an overall winner',()=>{
 const result=report([base,{...base,horizon:'T-30',outcomeProbabilities:{away:10,home:90,draw:0}}]);
 assert.equal(result.byHorizon.Daily.sampleSize,1);assert.equal(result.byHorizon['T-30'].sampleSize,1);
 assert.equal(result.overall.sampleSize,0);assert.equal(result.overallSimultaneousForecastConflicts,1);
});
test('quarantine does not cross into another start date sharing a native event ID',()=>{
 const other={...base,startTime:'2026-10-21T19:00:00Z',predictionGeneratedAt:'2026-10-21T18:00:00Z'};
 const result=report([base,{...base,horizon:'T-30',actualSide:'away'},other]);
 assert.equal(result.overall.sampleSize,1);assert.equal(result.conflictingResultEvents,1);
});
test('an invalid latest horizon cannot make overall silently fall back to an older clean forecast',()=>{
 const result=report([base,{...base,horizon:'T-30',predictionGeneratedAt:'2026-10-20T18:30:00Z',outcomeProbabilities:{away:70,home:70,draw:0}}]);
 assert.equal(result.byHorizon.Daily.sampleSize,1);assert.equal(result.overall.sampleSize,0);
 assert.equal(result.overallLatestForecastNotScorable,1);
});
test('a conflicted latest issue cannot be replaced by an earlier successful-looking issue',()=>{
 const older={...base,predictionGeneratedAt:'2026-10-20T17:30:00Z'};
 const result=report([older,base,{...base,outcomeProbabilities:{away:10,home:90,draw:0}}]);
 assert.equal(result.overall.sampleSize,0);assert.equal(result.scoringExclusions.simultaneous_forecast_conflict,1);
});
test('equivalent issue offsets and league aliases preserve consistent copies without mutating them',()=>{
 const rows=[base,{...base,leagueKey:' NBA ',predictionGeneratedAt:'2026-10-20T14:00:00-04:00',startTime:'2026-10-20T15:00:00-04:00'}];
 const before=JSON.stringify(rows),result=report(rows);
 assert.equal(result.overall.sampleSize,1);assert.equal(JSON.stringify(rows),before);
});
