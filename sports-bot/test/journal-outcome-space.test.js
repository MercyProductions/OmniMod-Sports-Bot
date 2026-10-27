import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizePredictionJournal} from '../src/journalEvaluation.js';

test('journal summary separates resolved from scorable outcome-space evidence',()=>{
 const payload={forecastId:'legacy',gameId:'g',league:'nhl',guildId:'guild',modelVersion:'test',horizon:'Daily',
 lifecycleState:'ISSUED',recordEligibility:'observed_pregame',predictionGeneratedAt:'2026-10-20T18:00:00Z',
 startTime:'2026-10-20T19:00:00Z',selectedSide:'home',outcomePercentages:{away:30,home:70,draw:null},odds:{status:'unavailable'}};
 const rows=[{type:'forecast',recordedAt:'2026-10-20T18:00:00Z',payload},
 {type:'result',recordedAt:'2026-10-20T22:00:00Z',payload:{forecastId:'legacy',actualSide:'home',observedAt:'2026-10-20T22:00:00Z'}}];
 const before=JSON.stringify(rows),legacy=summarizePredictionJournal(rows).byVersion.test;
 assert.equal(legacy.graded,1);assert.equal(legacy.unresolved,0);assert.equal(legacy.scorableForecasts,0);
 assert.equal(legacy.invalidOrUnverifiedOutcomeSpace,1);assert.equal(JSON.stringify(rows),before);
 payload.modeledOutcomes=['away','home'];
 const explicit=summarizePredictionJournal(rows).byVersion.test;
 assert.equal(explicit.scorableForecasts,1);assert.equal(explicit.invalidOrUnverifiedOutcomeSpace,0);
});
