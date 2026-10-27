import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateMatchedJournal} from '../src/matchedJournalEvaluation.js';
const issue='2026-10-20T18:00:00Z',start='2026-10-20T19:00:00Z',final='2026-10-20T22:00:00Z',asOf=Date.parse('2026-10-21T00:00:00Z');
function fixture(id='a',patch={}){
 const payload={forecastId:id,gameId:'g',guildId:'guild',league:'nba',modelVersion:'fixture',horizon:'Daily',lifecycleState:'ISSUED',recordEligibility:'observed_pregame',
 predictionGeneratedAt:issue,startTime:start,selectedSide:'home',outcomePercentages:{away:30,home:70,draw:0},candidateProbabilities:{hybrid:{away:.4,home:.6,draw:0}},...patch};
 return [{type:'forecast',recordedAt:issue,payload},{type:'result',recordedAt:final,payload:{forecastId:id,actualSide:'home',observedAt:final}}];
}
const report=(rows,cutoff=asOf)=>evaluateMatchedJournal(rows,{asOf:cutoff,repetitions:100});
const hybrid=result=>result.byVersion.fixture.hybrid;
function revision(id='later',patch={}){const rows=fixture(id,patch);rows[0].recordedAt='2026-10-20T18:10:00Z';return rows;}

test('simultaneous distinct IDs cannot choose primary probabilities by lexical ID or array order',()=>{
 const a=fixture('a'),b=fixture('z',{outcomePercentages:{away:10,home:90,draw:0}});
 for(const rows of [[...a,...b],[...b,...a]]){
  const result=report(rows);assert.equal(result.schema,'sports-matched-journal-v2');assert.equal(result.selectedForecasts,0);assert.equal(result.ambiguousFirstCohorts,1);
  assert.equal(result.rejections.ambiguous_first_issue,1);assert.deepEqual(Object.keys(result.byVersion),[]);
 }
});
test('equal primary vectors cannot select a better reference from different simultaneous inputs',()=>{
 const result=report([...fixture('a'),...fixture('z',{candidateProbabilities:{hybrid:{away:.1,home:.9,draw:0}}})]);
 assert.equal(result.selectedForecasts,0);assert.equal(result.ambiguousFirstCohorts,1);
});
test('simultaneous evidence metadata conflicts are not hidden by identical numeric scores',()=>{
 const result=report([...fixture('a'),...fixture('z',{evidenceCoverage:{summary:{injuryCoverage:'incomplete'}}})]);
 assert.equal(result.selectedForecasts,0);assert.equal(result.ambiguousFirstCohorts,1);
});
test('semantically identical earliest inputs under distinct IDs retain one matched observation',()=>{
 const result=report([...fixture('a'),...fixture('z')]);
 assert.equal(result.selectedForecasts,1);assert.equal(hybrid(result).primary.forecasts,1);assert.equal(hybrid(result).primary.games,1);
});
test('contradictory final on a later unselected revision quarantines the original matched cohort',()=>{
 const later=revision();later[1].recordedAt='2026-10-20T23:00:00Z';later[1].payload.actualSide='away';later[1].payload.observedAt=later[1].recordedAt;
 const rows=[...fixture(),...later];
 assert.equal(hybrid(report(rows,Date.parse('2026-10-20T22:30:00Z'))).primary.games,1);
 const result=report(rows);assert.equal(result.conflictingGames,1);assert.equal(hybrid(result).primary.games,0);
 assert.equal(hybrid(result).excluded.conflicting_game_results,1);
});
test('invalid forecast vectors cannot hide otherwise timely contradictory final evidence',()=>{
 const later=fixture('other',{guildId:'other',outcomePercentages:{away:70,home:70,draw:0}});later[1].payload.actualSide='away';
 const result=report([...fixture(),...later]);assert.equal(result.conflictingGames,1);assert.equal(hybrid(result).primary.games,0);
});
test('active dispute on an unselected revision blocks the event until linked reconciliation',()=>{
 const rows=[...fixture(),...revision(),{type:'result_conflict',recordedAt:'2026-10-20T23:00:00Z',payload:{forecastId:'later',conflictId:'review'}}];
 const blocked=report(rows);assert.equal(blocked.disputedGames,1);assert.equal(hybrid(blocked).primary.games,0);
 assert.equal(hybrid(blocked).excluded.unresolved_game_result_dispute,1);
 rows.push({type:'result',recordedAt:'2026-10-20T23:30:00Z',payload:{forecastId:'later',actualSide:'home',observedAt:'2026-10-20T23:30:00Z',resolvesConflictId:'review'}});
 assert.equal(report(rows).disputedGames,0);assert.equal(hybrid(report(rows)).primary.games,1);
});
test('an ambiguous first cohort cannot fall back to a later unambiguous successful-looking revision',()=>{
 const rows=[...fixture('a'),...fixture('z',{outcomePercentages:{away:10,home:90,draw:0}}),...revision('new')];
 assert.equal(report(rows).selectedForecasts,0);assert.equal(report(rows).ambiguousFirstCohorts,1);
});
test('unselected result conflict does not quarantine a separate start sharing the same native event ID',()=>{
 const later=revision();later[1].payload.actualSide='away';
 const next=fixture('next',{startTime:'2026-10-21T19:00:00Z'});next[1].recordedAt='2026-10-21T22:00:00Z';next[1].payload.observedAt=next[1].recordedAt;
 const result=report([...fixture(),...later,...next],Date.parse('2026-10-22T00:00:00Z'));
 assert.equal(result.conflictingGames,1);assert.equal(hybrid(result).primary.games,1);
});
test('an unresolved original issue is never replaced by a later resolved revision and inputs stay immutable',()=>{
 const rows=[fixture()[0],...revision()],before=JSON.stringify(rows);
 assert.deepEqual(Object.keys(report(rows).byVersion),[]);assert.equal(JSON.stringify(rows),before);
});
