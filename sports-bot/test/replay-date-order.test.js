import test from 'node:test';
import assert from 'node:assert/strict';
import {replayHistoricalResults} from '../src/historicalReplay.js';
import {selectCandidateCohort} from '../src/candidateCohorts.js';
import {trainLocalMlModels} from '../src/localMl.js';

const row=(id,dateKey,startTime,awayScore=99,homeScore=101)=>({id,leagueKey:'nba',league:'NBA',sportGroup:'Basketball',awayTeam:'A',homeTeam:'B',dateKey,startTime,awayScore,homeScore});
const warmup=()=>[row('warm1','2099-10-18','2099-10-18T19:00:00Z'),row('warm2','2099-10-19','2099-10-19T19:00:00Z')];
const mixed=()=>[...warmup(),row('earlier','2099-10-20','2099-10-21T00:30:00Z'),row('later','2099-10-21','2099-10-21T00:30:00-05:00')];
const prediction=(report,id)=>report.predictions.find(p=>p.gameId===id);
const forecastInputs=p=>({priorAwayGames:p.priorAwayGames,priorHomeGames:p.priorHomeGames,candidateProbabilities:p.candidateProbabilities,mlFeatureVector:p.mlFeatureVector});

test('mixed explicit timezones cannot feed a later date result into an earlier forecast',()=>{
 const inputs=mixed(),before=structuredClone(inputs);
 const original=replayHistoricalResults(inputs),changed=replayHistoricalResults(inputs.map(r=>r.id==='later'?{...r,awayScore:150,homeScore:50}:r));
 assert.deepEqual(forecastInputs(prediction(original,'earlier')),forecastInputs(prediction(changed,'earlier')));
 assert.equal(prediction(original,'earlier').priorAwayGames,2);
 assert.deepEqual(original.predictions.map(p=>p.gameId),['earlier','later']);
 assert.deepEqual(inputs,before);
});

test('equivalent event instants cannot change replay features or probabilities through string representation',()=>{
 const inputs=mixed(),aliased=inputs.map(r=>r.id==='later'?{...r,startTime:'2099-10-21T05:30:00Z'}:r);
 const a=replayHistoricalResults(inputs),b=replayHistoricalResults(aliased);
 assert.deepEqual(a.predictions.map(p=>[p.gameId,forecastInputs(p)]),b.predictions.map(p=>[p.gameId,forecastInputs(p)]));
 assert.equal(prediction(a,'later').startTime,'2099-10-21T05:30:00.000Z');
});

test('same-date labels remain unavailable to all forecasts in that date batch',()=>{
 const inputs=[...warmup(),row('first','2099-10-20','2099-10-20T20:00:00Z'),row('second','2099-10-20','2099-10-20T23:00:00Z'),row('next','2099-10-21','2099-10-21T20:00:00Z')];
 const a=replayHistoricalResults(inputs),b=replayHistoricalResults(inputs.map(r=>r.id==='first'?{...r,awayScore:200,homeScore:20}:r));
 assert.deepEqual(forecastInputs(prediction(a,'second')),forecastInputs(prediction(b,'second')));
 assert.notDeepEqual(forecastInputs(prediction(a,'next')),forecastInputs(prediction(b,'next')));
});

test('invalid calendar cutoffs fail without echoing caller text',()=>{
 for(const value of ['2099-02-30','2099-13-01','2099-1-01','private-replay-cutoff-marker',true]){
  assert.throws(()=>replayHistoricalResults(mixed(),{asOfDateKey:value}),error=>error.message==='Historical replay requires a valid date cutoff');
 }
 assert.equal(replayHistoricalResults(mixed(),{asOfDateKey:'2099-10-21'}).predictionCount,1);
});

test('invalid source dates and naive or impossible event clocks are excluded before state updates',()=>{
 const bad=[row('bad-date','2099-02-30','2099-03-01T19:00:00Z'),row('missing-date',undefined,'2099-10-20T19:00:00Z'),row('bad-clock','2099-10-20','2099-10-20T19:00:00'),row('bad-calendar','2099-10-20','2099-02-30T19:00:00Z')];
 const good=[...warmup(),row('valid','2099-10-20','2099-10-20T19:00:00Z')];
 const report=replayHistoricalResults([...good,...bad]);
 assert.equal(report.resultCount,3);
 assert.deepEqual(forecastInputs(prediction(report,'valid')),forecastInputs(prediction(replayHistoricalResults(good),'valid')));
 assert.equal(report.inputAudit.rejections.invalid_result_date,2);
 assert.equal(report.inputAudit.rejections.invalid_event_start,2);
});

test('date-only research keeps missing starts explicit instead of inventing a noon event',()=>{
 const inputs=[...warmup(),row('date-only','2099-10-20',undefined)];
 const report=replayHistoricalResults(inputs),p=prediction(report,'date-only');
 assert.equal(report.predictionCount,1);
 assert.equal(p.startTime,null);
 assert.equal(p.eventStartStatus,'missing');
 assert.equal(report.inputAudit.dateOnlyRows,1);
 assert.equal(report.retrospectiveOnly,true);
 assert.equal(report.promotionAllowed,false);
});

test('explicit minute starts are normalized, while the row cap follows complete date order',()=>{
 const report=replayHistoricalResults([...warmup(),row('minute','2099-10-20','2099-10-20T14:00-05:00')]);
 assert.equal(prediction(report,'minute').startTime,'2099-10-20T19:00:00.000Z');
 const many=Array.from({length:60},(_,i)=>{const at=new Date(Date.UTC(2099,0,i+1,19));return row(String(i),at.toISOString().slice(0,10),at.toISOString());});
 const capped=replayHistoricalResults(many,{maxRows:50});
 assert.equal(capped.resultCount,50);
 assert.equal(capped.inputAudit.omittedByRowCap,10);
 assert.equal(capped.predictions[0].gameId,'12');
});

test('retrospective rows cannot become prospectively verified training or promotion evidence',()=>{
 const inputs=Array.from({length:90},(_,i)=>{const at=new Date(Date.UTC(2099,0,i+1,19));return row(String(i),at.toISOString().slice(0,10),at.toISOString(),90+i%7,100);});
 const report=replayHistoricalResults(inputs),selected=selectCandidateCohort(report.predictions);
 assert.equal(report.predictionCount,88);
 assert.equal(selected.cohort.prospectiveRecordsVerified,false);
 const trained=trainLocalMlModels(report.predictions,{now:Date.parse('2100-01-01T00:00:00Z'),minimum:60});
 assert.deepEqual(trained.sports,{});
 assert.deepEqual(trained.evaluationRows,[]);
 assert.equal(report.promotionAllowed,false);
});
