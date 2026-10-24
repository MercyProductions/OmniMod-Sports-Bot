import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeOddsPrice,quotePrice,bookmakerMargin,costedPriceScenario} from '../src/oddsPricing.js';
import {evaluatePriceResearch} from '../src/priceResearch.js';

const issue='2026-10-20T18:00:00Z',start='2026-10-20T19:00:00Z',final='2026-10-20T22:00:00Z';
const costs={feePerStake:.01,commissionOnProfit:.02,profitHaircut:.01};
const options={costs,asOf:Date.parse('2026-10-21T00:00:00Z')};
function rows(){
  const quote=price=>({priceAmerican:price,originalPrice:price,originalFormat:'american',bookmaker:'A',bookmakerKey:'a',quotedAt:issue,timestampSource:'provider_update'});
  const chosen={...quote(150),price:150,decimalOdds:2.5};
  const row={forecastId:'f',gameId:'g',guildId:'guild',league:'nba',modelVersion:'fixture',horizon:'T-90',
    modeledOutcomes:['away','home'],lifecycleState:'ISSUED',recordEligibility:'observed_pregame',predictionGeneratedAt:issue,startTime:start,
    outcomePercentages:{away:45,home:55,draw:0},modelUsesMarket:true,
    valueDecision:{side:'home',status:'research_opportunity',evaluatedAt:issue,quote:chosen},
    odds:{rules:'full_game_2way',cacheState:'network',sourceReceipt:{schema:'sports-local-odds-receipt-v1',fetchedAt:issue,timestampStatus:'explicit_zone',kind:'local_fetch_receipt_not_provider_publication'},identity:{localGameId:'g',league:'nba',providerEventId:'provider-g',providerStartTime:start,matchStatus:'matched'},
      outcomes:{home:{offeredQuotes:[quote(150)]},away:{offeredQuotes:[quote(-180)]}}}};
  return [{type:'forecast',recordedAt:issue,payload:row},{type:'result',recordedAt:final,payload:{forecastId:'f',actualSide:'home',observedAt:final}}];
}

test('American and explicitly declared decimal prices agree without format guessing',()=>{
  assert.equal(normalizeOddsPrice(150).decimalOdds,2.5);
  assert.equal(normalizeOddsPrice(-200).decimalOdds,1.5);
  assert.equal(normalizeOddsPrice(2.5,'decimal').americanOdds,150);
  assert.equal(normalizeOddsPrice(1.5,'decimal').americanOdds,-200);
  assert.equal(normalizeOddsPrice(1.91),null);assert.equal(normalizeOddsPrice(1,'decimal'),null);
  assert.equal(quotePrice({price:150,decimalOdds:4}),null);
});

test('margin removal uses one complete bookmaker and execution costs are not counted twice as vig',()=>{
  const margin=bookmakerMargin({home:{price:-110},away:{price:-110}},['away','home']);
  assert.ok(Math.abs(margin.overround-.04761904761904767)<1e-12);
  assert.equal(margin.fairProbabilities.home,.5);
  assert.equal(bookmakerMargin({home:{price:-110}},['away','home']),null);
  const result=costedPriceScenario(2.5,.55,costs);
  assert.ok(Math.abs(result.winReturnPerUnit-(1.5*.99*.98-.01))<1e-12);
  assert.equal(result.lossReturnPerUnit,-1.01);
  assert.ok(Math.abs(result.expectedReturnPerUnit-(.55*result.winReturnPerUnit+.45*result.lossReturnPerUnit))<1e-12);
  assert.throws(()=>evaluatePriceResearch(rows(),{}),/Explicit cost/);
});

test('frozen qualified original prices yield labeled counterfactuals, never verified paper profit',()=>{
  const result=evaluatePriceResearch(rows(),options);
  assert.equal(result.scenarios.length,1);assert.equal(result.scenarios[0].outcome,'hypothetical_win');
  assert.equal(result.scenarios[0].marketInformed,true);
  assert.equal(result.scenarios[0].executionVerified,false);assert.equal(result.scenarios[0].settlementVerified,false);
  assert.equal(result.realizedProfit,null);assert.equal(result.actualPaperPerformance,null);assert.equal(result.executedTradesVerified,0);
});

test('stale, missing-provenance and wrong-event quotes cannot enter price scenarios',()=>{
  for(const mutation of [data=>data[0].payload.odds.identity.providerEventId='',
    data=>data[0].payload.odds.outcomes.away.offeredQuotes[0].timestampSource='unknown',
    data=>data[0].payload.odds.outcomes.home.offeredQuotes[0].quotedAt='2026-10-20T17:00:00Z']){
    const data=rows();mutation(data);assert.equal(evaluatePriceResearch(data,options).scenarios.length,0);
  }
});

test('missing results and two-way ties remain unresolved or censored instead of losses',()=>{
  const data=rows();
  assert.equal(evaluatePriceResearch(data.slice(0,1),options).scenarios[0].outcome,'unresolved');
  data[1].payload.actualSide='draw';
  const result=evaluatePriceResearch(data,options).scenarios[0];
  assert.equal(result.outcome,'censored_or_unmodeled_settlement');assert.equal(result.counterfactualReturn,null);
});

test('later prices cannot replace an earlier selected decision or improve its reported outcome',()=>{
  const data=rows(),snapshot=data[0].payload;
  data.splice(1,0,{type:'price_observation',recordedAt:'2026-10-20T18:05:00Z',payload:{sourceForecastId:'f',
    gameId:'g',guildId:'guild',league:'nba',modelVersion:'fixture',originalForecastGeneratedAt:issue,linkage:'exact_frozen_model_issue',odds:structuredClone(snapshot.odds),valueDecision:structuredClone(snapshot.valueDecision)}});
  const result=evaluatePriceResearch(data,options);
  assert.equal(result.scenarios.length,1);assert.equal(result.rejections.later_game_price_decision_not_selected,1);
  assert.equal(result.scenarios[0].decisionAt,issue);
});


test('complete three-way markets grade draws and reject asynchronous same-book outcomes',()=>{
  const data=rows(),row=data[0].payload;
  row.odds.rules='regulation_3way';row.modeledOutcomes=['away','home','draw'];row.outcomePercentages={away:30,home:45,draw:25};
  const draw={...row.odds.outcomes.home.offeredQuotes[0],priceAmerican:250,originalPrice:250};
  row.odds.outcomes.draw={offeredQuotes:[draw]};
  row.valueDecision.side='draw';row.valueDecision.quote={...draw,decimalOdds:3.5};
  data[1].payload.actualSide='draw';
  const result=evaluatePriceResearch(data,options);
  assert.equal(result.scenarios.length,1);
  assert.equal(result.scenarios[0].outcome,'hypothetical_win');
  row.odds.outcomes.away.offeredQuotes[0].quotedAt='2026-10-20T17:59:00Z';
  const asynchronous=evaluatePriceResearch(data,options);
  assert.equal(asynchronous.scenarios.length,0);
  assert.equal(asynchronous.rejections.complete_same_book_original_prices_unavailable,1);
});


test('conflict quarantine removes outcome returns without removing original offered prices',()=>{
 const data=rows();data.push({type:'result_conflict',recordedAt:'2026-10-20T23:00:00Z',payload:{forecastId:'f',conflictId:'c'}});
 assert.equal(evaluatePriceResearch(data,{...options,asOf:Date.parse('2026-10-20T22:30:00Z')}).scenarios[0].outcome,'hypothetical_win');
 const scenario=evaluatePriceResearch(data,options).scenarios[0];assert.equal(scenario.outcome,'unresolved');assert.equal(scenario.counterfactualReturn,null);
});
