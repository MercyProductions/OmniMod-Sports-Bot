import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluatePredictionHorizons} from '../src/horizonEvaluation.js';
const base={guildId:'guild',gameId:'reused',leagueKey:'nba',modelVersion:'fixture',horizon:'Daily',predictionMode:'pregame',
 predictionGeneratedAt:'2026-10-20T18:00:00Z',startTime:'2026-10-20T19:00:00Z',predictedSide:'home',actualSide:'home',outcomeProbabilities:{away:30,home:70,draw:0}};
const quote={guildId:'guild',gameId:'reused',leagueKey:'nba',startTime:base.startTime,stage:'t-10',capturedAt:'2026-10-20T18:50:00Z',away:.4,home:.6,draw:0};
const report=(markets,forecasts=[base])=>evaluatePredictionHorizons(forecasts,markets);
const close=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-12,`${actual} != ${expected}`);

test('same canonical event snapshot remains comparable without mutating source rows',()=>{
 const row={...quote,leagueKey:' NBA ',startTime:'2026-10-20T14:00:00-05:00'},before=JSON.stringify(row);
 const result=report([row]);assert.equal(result.overall.closingSampleSize,1);close(result.overall.meanModelVsCloseEdge,.1);
 assert.equal(result.closingSnapshotStatuses.scoped_prestart_snapshot,1);assert.equal(JSON.stringify(row),before);
});
test('wrong league, reused start, guild or incomplete scope never supplies a closing benchmark',()=>{
 for(const patch of [{leagueKey:'nhl'},{startTime:'2026-10-21T19:00:00Z'},{startTime:undefined},{leagueKey:undefined},{guildId:'other'}]){
  const result=report([{...quote,...patch}]);assert.equal(result.overall.closingSampleSize,0);assert.equal(result.byFavoriteClass.unknown.sampleSize,1);
 }
});
test('latest snapshot is selected by actual receipt instant rather than string representation',()=>{
 const older={...quote,capturedAt:'2026-10-20T18:30:00Z',away:.1,home:.9};
 const later={...quote,capturedAt:'2026-10-20T14:50:00-04:00'};
 close(report([older,later]).overall.meanModelVsCloseEdge,.1);
});
test('conflicting snapshots at the same latest instant are quarantined in either input order',()=>{
 const conflict={...quote,capturedAt:'2026-10-20T14:50:00-04:00',away:.1,home:.9};
 for(const rows of [[quote,conflict],[conflict,quote]]){
  const result=report(rows);assert.equal(result.overall.closingSampleSize,0);assert.equal(result.closingSnapshotStatuses.latest_snapshot_conflict,1);
 }
});
test('invalid latest market mass cannot fall back to an older clean snapshot',()=>{
 const invalid={...quote,capturedAt:'2026-10-20T18:55:00Z',away:.7,home:.7};
 const result=report([quote,invalid]);assert.equal(result.overall.closingSampleSize,0);assert.equal(result.closingSnapshotStatuses.latest_vector_invalid,1);
});
test('different outcome spaces do not create model-versus-market edge',()=>{
 const result=report([{...quote,away:.2,home:.6,draw:.2}]);
 assert.equal(result.overall.closingSampleSize,0);assert.equal(result.closingSnapshotStatuses.outcome_space_mismatch,1);
});
test('reused native event IDs on different scheduled starts remain separate score populations',()=>{
 const tomorrow={...base,startTime:'2026-10-21T19:00:00Z',predictionGeneratedAt:'2026-10-21T18:00:00Z'};
 assert.equal(report([], [base,tomorrow]).overall.sampleSize,2);
});
test('latest frozen forecast within a horizon uses parsed instants rather than string order',()=>{
 const earlier={...base,predictionGeneratedAt:'2026-10-20T18:40:00Z',outcomeProbabilities:{away:40,home:60,draw:0}};
 const later={...base,predictionGeneratedAt:'2026-10-20T14:50:00-04:00',outcomeProbabilities:{away:10,home:90,draw:0}};
 close(report([], [earlier,later]).overall.brierScore,.01);
});
test('naive receipt and forecast clocks cannot attest prestart comparisons',()=>{
 const result=report([{...quote,capturedAt:'2026-10-20T18:50:00'}]);
 assert.equal(result.overall.closingSampleSize,0);assert.equal(result.closingSnapshotStatuses.no_valid_prestart_receipt,1);
 assert.equal(report([], [{...base,predictionGeneratedAt:'2026-10-20T18:00:00'}]).overall.sampleSize,0);
});
