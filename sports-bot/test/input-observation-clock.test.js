import test from 'node:test';
import assert from 'node:assert/strict';
import {observedInputState,predictionInputsAt} from '../src/inputChronology.js';
import {predictGame} from '../src/predictionEngine.js';
const now=Date.parse('2026-03-03T18:00:00Z'),before='2026-03-03T17:00:00Z';
const game=()=>({id:'clock',leagueKey:'nba',league:'NBA',sportGroup:'Basketball',statusKey:'scheduled',startTime:'2026-03-04T18:00:00Z',away:{name:'A',abbr:'A'},home:{name:'H',abbr:'H'}});

test('observation clocks reject inferred timezones and normalized impossible dates',()=>{
 for(const value of ['2026-03-03T17:00:00','2026-02-30T17:00:00Z','2026-02-30','03/03/2026 17:00:00',2026,true,{},'2026-03-03T24:00:00Z'])
  assert.equal(observedInputState({updatedAt:value},now),'invalid_observation_time',JSON.stringify(value));
});
test('date-only legacy observations remain unknown rather than precisely available',()=>{
 assert.equal(observedInputState({updatedAt:'2026-03-03'},now),'unknown');
 assert.equal(observedInputState({updatedAt:'2026-03-03',fetchedAt:before},now),'unknown');
 const input=game();input.autoPlayers=[{name:'legacy',team:'H',updatedAt:'2026-03-03'}];
 const result=predictionInputsAt(input,{},now);assert.equal(result.game.autoPlayers.length,1);assert.equal(result.audit.unknownAvailability.auto_player,1);
});
test('invalid nested receipt clocks invalidate inseparable aggregates',()=>{
 const input=game();input.autoHistory={fetchedAt:before,fetchedAtBySide:{home:'2026-02-30T17:00:00Z',away:before}};
 input.autoTeamMetrics={home:{powerRating:99}};input.advancedDataset={efficiencyDifference:30};
 const result=predictionInputsAt(input,{},now);assert.equal(result.game.autoHistory,null);assert.deepEqual(result.game.autoTeamMetrics,{});assert.equal(result.game.advancedDataset,null);
 assert.equal(result.audit.excluded['autoHistory:invalid_observation_time'],1);assert.ok(input.autoHistory);
});
test('invalid declared learning cutoffs cannot retain learned state',()=>{
 for(const cutoffAt of ['not-a-clock','2026-03-03T17:00:00','2026-02-30T17:00:00Z','2026-03-03',false,null]){
  const context={learningInputAudit:{cutoffAt},eloRatings:{a:1900},calibration:{a:[1]},outcomeValidation:{a:1},featureLearning:{a:1},drift:{a:1},history:{overall:{sampleSize:50}}};
  const result=predictionInputsAt(game(),context,now);
  for(const key of ['eloRatings','calibration','outcomeValidation','featureLearning','drift'])assert.deepEqual(result.context[key],{});
  assert.equal(result.context.history.overall.sampleSize,0);assert.equal(result.audit.excluded['learning_context:invalid_observation_time'],1);assert.equal(context.eloRatings.a,1900);
 }
});
test('invalid automatic clocks cannot change an earlier prediction',()=>{
 const base=game(),input=game();input.autoTeamMetrics={home:{name:'H',leagueKey:'nba',updatedAt:'2026-02-30T17:00:00Z',powerRating:99,offense:99,defense:99}};
 const actual=predictGame(input,0,{now}),expected=predictGame(base,0,{now});assert.deepEqual(actual.outcomeProbabilities,expected.outcomeProbabilities);assert.equal(actual.inputChronology.excluded['auto_team_home:invalid_observation_time'],1);
});
test('explicit offsets compare instants and leap days retain valid observations',()=>{
 assert.equal(observedInputState({updatedAt:'2026-03-03T19:00:00+02:00'},now),'observed_by_cutoff');
 assert.equal(observedInputState({updatedAt:'2026-03-03T17:30:00-01:00'},now),'after_information_cutoff');
 assert.equal(observedInputState({updatedAt:'2024-02-29T17:00:00Z'},now),'observed_by_cutoff');
 assert.equal(observedInputState({updatedAt:'2025-02-29T17:00:00Z'},now),'invalid_observation_time');
});
test('valid learning cutoff is preserved and absent legacy cutoff is disclosed',()=>{
 const valid={learningInputAudit:{cutoffAt:before},eloRatings:{a:1900}};
 assert.equal(predictionInputsAt(game(),valid,now).context.eloRatings.a,1900);
 const legacy=predictionInputsAt(game(),{eloRatings:{a:1900}},now);assert.equal(legacy.context.eloRatings.a,1900);assert.equal(legacy.audit.unknownAvailability.learning_context,1);
});
test('direct observation checks require a finite information cutoff',()=>{
 for(const cutoff of [NaN,Infinity,undefined,'2026-03-03'])assert.throws(()=>observedInputState({updatedAt:before},cutoff),/cutoff/);
});

test('day precision cannot erase a known future observation or create a final availability clock',()=>{
 assert.equal(observedInputState({updatedAt:'2026-03-04'},now),'after_information_cutoff');
 assert.equal(observedInputState({updatedAt:'2026-03-03',sourceFetchedAt:'2026-03-03T19:00:00Z'},now),'after_information_cutoff');
 const result=predictionInputsAt(game(),{externalResults:[{updatedAt:'2026-03-03',dateKey:'2026-03-02',awayScore:1,homeScore:2}]},now);
 assert.equal(result.context.externalResults.length,0);assert.equal(result.audit.excluded['head_to_head_result:availability_unknown'],1);
});
