import test from 'node:test';
import assert from 'node:assert/strict';
import {learningInputsBefore,collectGradedRows,loadModelContext,lookupElo} from '../src/modelEvaluation.js';
import {writeDailyCache} from '../src/storage.js';
import {CURRENT_MODEL_VERSION} from '../src/modelIdentity.js';
const cutoff=Date.parse('2099-01-03T00:00:00Z');
const start='2099-01-01T18:00:00Z',observed='2099-01-01T22:00:00Z';
function cache(){return {dateKey:'2099-01-01',slate:{guildId:'context-fixture',games:[{id:'g',leagueKey:'nba',statusKey:'final',startTime:start,away:{name:'A',score:90},home:{name:'H',score:100}}],
 predictions:[{gameId:'g',leagueKey:'nba',sportProfile:'basketball',modelVersion:CURRENT_MODEL_VERSION,predictionMode:'pregame',predictionGeneratedAt:'2099-01-01T10:00:00Z',startTime:start,
 resultObservedAt:observed,predictionCorrect:true,predictedSide:'home',predictionProbability:.6}]}};}
const result=()=>({dateKey:'2099-01-01',startTime:start,leagueKey:'nba',awayTeam:'A',homeTeam:'H',awayScore:90,homeScore:100});

test('schedule date does not establish when final evidence became available',()=>{
 const input=cache();input.slate.predictions[0].resultObservedAt='2099-01-04T00:00:00Z';
 assert.equal(collectGradedRows([input],{availableBefore:cutoff}).length,0);
 const selected=learningInputsBefore([input],{},[],{cutoff,dateKey:'2099-01-03'});
 assert.equal(selected.eloCaches[0].slate.games.length,0);
 assert.equal(selected.audit.excluded['cached_result:not_available_before_cutoff'],1);
});

test('calibration rejects unknown, pre-start and cutoff-equal result observations',()=>{
 for(const time of [null,'bad','2099-01-01T12:00:00Z','2099-01-03T00:00:00Z']){
  const row=cache();row.slate.predictions[0].resultObservedAt=time;
  assert.equal(collectGradedRows([row],{availableBefore:cutoff}).length,0);
 }
 assert.equal(collectGradedRows([cache()],{availableBefore:cutoff}).length,1);
});

test('manual seeds and imported final revisions require availability before the cutoff',()=>{
 const selected=learningInputsBefore([],{
  teams:{old:{updatedAt:observed,elo:1600},late:{updatedAt:'2099-01-04T00:00:00Z',elo:2000},unknown:{elo:1800}},
  results:{old:{...result(),recordedAt:observed},late:{...result(),recordedAt:'2099-01-04T00:00:00Z'},unknown:result()}
 },[{...result(),sourceMeta:{fetchedAt:observed}},{...result(),sourceMeta:{fetchedAt:observed},updatedAt:'2099-01-05T00:00:00Z'}],{cutoff,dateKey:'2099-01-03'});
 assert.deepEqual(Object.keys(selected.intelligence.teams),['old']);
 assert.deepEqual(Object.keys(selected.intelligence.results),['old']);assert.equal(selected.externalResults.length,1);
 assert.equal(selected.audit.pointInTimeComplete,false);
});

test('unattested schedule receipts cannot stand in for final-result availability',()=>{
 const input=cache();delete input.slate.predictions[0].resultObservedAt;
 input.slate.games[0].sourceMeta={fetchedAt:observed};
 const selected=learningInputsBefore([input],{},[],{cutoff});
 assert.equal(selected.eloCaches[0].slate.games.length,0);
 assert.equal(selected.audit.excluded['cached_result:availability_unknown_or_invalid'],1);
});

test('later updates cannot change an earlier loaded learning context',async()=>{
 const row=cache();await writeDailyCache(row.dateKey,row.slate,'chronology-context');
 const options={asOf:cutoff,asOfDateKey:'2099-01-03',intelligence:{teams:{},results:{}}};
 const before=await loadModelContext('chronology-context',365,options);
 const mutated={...options,intelligence:{teams:{future:{name:'H',league:'nba',elo:2200,updatedAt:'2099-01-04T00:00:00Z'}},results:{future:{...result(),recordedAt:'2099-01-04T00:00:00Z',homeScore:999}}}};
 const after=await loadModelContext('chronology-context',365,mutated);
 assert.deepEqual(before.eloRatings,after.eloRatings);assert.deepEqual(before.calibration,after.calibration);
 assert.equal(before.history.rows,1);assert.ok(lookupElo(before.eloRatings,'nba','H')>1500);
 row.slate.predictions[0].resultObservedAt='2099-01-04T00:00:00Z';await writeDailyCache(row.dateKey,row.slate,'chronology-context');
 const changed=await loadModelContext('chronology-context',365,options);
 assert.equal(changed.history.rows,0);assert.equal(lookupElo(changed.eloRatings,'nba','H'),1500);
 assert.equal(changed.learningInputAudit.calibrationRowsExcludedForAvailabilityOrDuplicateConflict,1);
});


test('learning calibration counts a game once across guilds and rejects contradictory grades',()=>{
 const a=cache(),b=structuredClone(a);b.slate.guildId='other-guild';
 b.slate.predictions[0].predictionGeneratedAt='2099-01-01T11:00:00Z';
 const rows=collectGradedRows([b,a],{availableBefore:cutoff,uniqueGames:true});
 assert.equal(rows.length,1);assert.equal(rows[0].prediction.predictionGeneratedAt,'2099-01-01T10:00:00Z');
 b.slate.predictions[0].predictionCorrect=false;
 assert.equal(collectGradedRows([a,b],{availableBefore:cutoff,uniqueGames:true}).length,0);
});
