import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateMatchedJournal} from '../src/matchedJournalEvaluation.js';

const issue='2026-10-20T18:00:00Z',start='2026-10-20T19:00:00Z',final='2026-10-20T22:00:00Z';
const options={asOf:Date.parse('2026-10-21T00:00:00Z'),repetitions:100};
function fixture(id='g',overrides={}){
  const row={forecastId:id,gameId:id,guildId:'guild',league:'nba',modelVersion:'fixture-model',horizon:'T-90',
    lifecycleState:'ISSUED',recordEligibility:'observed_pregame',predictionGeneratedAt:issue,startTime:start,
    selectedSide:'home',outcomePercentages:{home:70,away:30,draw:0},
    candidateProbabilities:{hybrid:{home:.6,away:.4,draw:0}},
    referenceBaselines:{elo:{probabilities:{home:.5,away:.5,draw:0}}},eventContext:{sport:'basketball',season:2026,seasonType:2},...overrides};
  return [{type:'forecast',recordedAt:issue,payload:row},
    {type:'result',recordedAt:final,payload:{forecastId:row.forecastId,actualSide:'home',observedAt:final}}];
}
const report=rows=>evaluateMatchedJournal(rows,options);
const hybrid=result=>result.byVersion['fixture-model'].hybrid;

test('paired forecasts use the exact same observations and exclude absent or malformed references',()=>{
  const rows=[...fixture('a'),...fixture('b',{candidateProbabilities:{hybrid:{home:null,away:1}}})];
  const matched=hybrid(report(rows));
  assert.equal(matched.primary.forecasts,1);assert.equal(matched.reference.forecasts,1);
  assert.equal(matched.primary.games,1);assert.equal(matched.excluded.reference_missing_or_invalid,1);
  assert.ok(Math.abs(matched.primary.brier-.09)<1e-12);
  assert.ok(Math.abs(matched.reference.brier-.16)<1e-12);
  assert.equal(matched.pairedGameBootstrap95.brierImprovement,null);
});

test('pregame issuance, resolution timestamps and schedule identity must be verifiable',()=>{
  const late=fixture('late');late[0].recordedAt=start;
  const invalid=fixture('future-result');invalid[1].payload.observedAt='2026-10-22T00:00:00Z';
  const moved=fixture('moved');moved[1].payload.scheduleChanged=true;
  const unresolved=fixture('unresolved').slice(0,1);
  const r=report([...late,...invalid,...moved,...unresolved]);
  assert.equal(r.rejections.invalid_issuance_chronology,1);
  assert.equal(r.rejections.result_chronology_or_schedule_invalid,2);
  assert.equal(r.rejections.unresolved,1);assert.deepEqual(Object.keys(r.byVersion),[]);
});

test('later same-horizon revisions cannot be selected by their eventual success',()=>{
  const rows=fixture('game');
  rows.splice(1,0,...fixture('revision',{gameId:'game',outcomePercentages:{home:99,away:1,draw:0}}).map(r=>r.type==='forecast'?{...r,recordedAt:'2026-10-20T18:10:00Z'}:r));
  const r=report(rows);
  assert.equal(r.rejections.later_same_horizon_revision_not_selected,1);
  assert.equal(hybrid(r).primary.forecasts,1);
  assert.ok(Math.abs(hybrid(r).primary.brier-.09)<1e-12);
});

test('horizons and guilds for the same game remain one bootstrap unit',()=>{
  const one=Array.from({length:8},(_,i)=>fixture(`g${i}`)).flat();
  const repeated=one.flatMap(event=>[event,{...event,payload:{...event.payload,
    forecastId:event.payload.forecastId+'-t30',horizon:'T-30',guildId:'other'}}]);
  const a=hybrid(report(one)),b=hybrid(report(repeated));
  assert.equal(a.primary.games,8);assert.equal(b.primary.games,8);
  assert.equal(b.primary.forecasts,16);
  assert.equal(a.primary.brier,b.primary.brier);
  assert.deepEqual(a.pairedGameBootstrap95,b.pairedGameBootstrap95);
});

test('conflicting outcomes exclude every horizon of the affected game',()=>{
  const rows=[...fixture('a',{gameId:'same'}),...fixture('b',{gameId:'same',horizon:'T-30'})];
  rows.at(-1).payload.actualSide='away';
  const r=hybrid(report(rows));assert.equal(r.primary.games,0);assert.equal(r.excluded.conflicting_game_results,2);
});

test('different outcome spaces and unverified offered-price timestamps never become matched market evidence',()=>{
  const rows=fixture('soccer',{league:'epl',outcomePercentages:{home:50,away:25,draw:25},
    referenceBaselines:{market:{probabilities:{home:.5,away:.25,draw:.25}}},odds:{status:'available'}});
  const r=report(rows).byVersion['fixture-model'];
  assert.equal(r.hybrid.excluded.outcome_space_mismatch,1);
  assert.equal(r.market.excluded.offered_price_timestamps_unverified,1);
});

test('version and actual frozen coverage strata remain separate and never imply promotion',()=>{
  const rows=[...fixture('a'),...fixture('b',{modelVersion:'other-model',eventContext:{}})];
  const r=report(rows);
  assert.deepEqual(Object.keys(r.byVersion).sort(),['fixture-model','other-model']);
  assert.equal(hybrid(r).strata.sport.basketball.primary.games,1);
  assert.equal(hybrid(r).strata.season['2026'].primary.games,1);
  assert.equal(r.byVersion['other-model'].hybrid.strata.season.unknown.primary.games,1);
  assert.equal(r.promotionAllowed,false);
});

test('as-of reports exclude future corrections and preserve originally available outcomes',()=>{
  const rows=fixture('a');rows.push({type:'result',recordedAt:'2026-10-22T00:00:00Z',payload:{forecastId:'a',actualSide:'away',observedAt:'2026-10-22T00:00:00Z'}});
  assert.equal(hybrid(report(rows)).primary.accuracy,1);
});

test('fresh frozen market quotes support matching without using closing prices',()=>{
  const odds={status:'available',outcomes:Object.fromEntries(['away','home'].map(side=>[side,{offeredQuotes:[{
    bookmaker:'Fixture',priceAmerican:side==='home'?-120:120,quotedAt:'2026-10-20T17:59:00Z'
  }]}]))};
  const rows=fixture('quoted',{odds,referenceBaselines:{market:{probabilities:{home:.55,away:.45,draw:0}}}});
  const matched=report(rows).byVersion['fixture-model'].market;
  assert.equal(matched.primary.games,1);
  assert.equal(matched.strata.favorite.favorite.primary.games,1);
  assert.equal(matched.strata.marketData.timestamp_verified_offered_quotes.primary.games,1);
  rows[0].payload.odds.outcomes.away.offeredQuotes[0].quotedAt='2026-10-20T18:01:00Z';
  assert.equal(report(rows).byVersion['fixture-model'].market.excluded.offered_price_timestamps_unverified,1);
});

test('three-way Brier uses all three coordinates and malformed primary mass abstains',()=>{
  const rows=fixture('three',{outcomePercentages:{home:50,away:25,draw:25},
    candidateProbabilities:{hybrid:{home:.4,away:.3,draw:.3}}});
  assert.equal(hybrid(report(rows)).primary.brier,.125);
  rows[0].payload.outcomePercentages={home:70,away:70,draw:0};
  assert.equal(report(rows).rejections.invalid_primary_probabilities_or_pick,1);
});
