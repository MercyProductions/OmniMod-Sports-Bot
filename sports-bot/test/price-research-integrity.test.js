import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluatePriceResearch} from '../src/priceResearch.js';
const issue='2099-02-01T18:00:00Z',start='2099-02-01T19:00:00Z',final='2099-02-01T22:00:00Z';
const options={costs:{feePerStake:.01,commissionOnProfit:.02,profitHaircut:.01},asOf:Date.parse('2099-02-02T00:00:00Z')};
function rows(){
 const quote=price=>({originalPrice:price,originalFormat:'american',bookmaker:'Book A',bookmakerKey:'a',quotedAt:issue,timestampSource:'provider_update'});
 const payload={forecastId:'f',gameId:'g',guildId:'guild',league:'nba',modelVersion:'fixture',horizon:'T-90',modeledOutcomes:['away','home'],lifecycleState:'ISSUED',recordEligibility:'observed_pregame',predictionGeneratedAt:issue,startTime:start,outcomePercentages:{away:45,home:55,draw:0},valueDecision:{side:'home',status:'research_opportunity',evaluatedAt:issue,quote:quote(150)},odds:{rules:'full_game_2way',cacheState:'network',sourceReceipt:{schema:'sports-local-odds-receipt-v1',fetchedAt:issue,timestampStatus:'explicit_zone',kind:'local_fetch_receipt_not_provider_publication'},identity:{localGameId:'g',league:'nba',providerEventId:'provider-g',providerStartTime:start,matchStatus:'matched'},outcomes:{home:{offeredQuotes:[quote(150)]},away:{offeredQuotes:[quote(-180)]}}}};
 return [{type:'forecast',recordedAt:issue,payload},{type:'result',recordedAt:final,payload:{forecastId:'f',actualSide:'home',observedAt:final}}];
}
const evaluate=data=>evaluatePriceResearch(data,options);
const observation=(forecast,change={})=>({type:'price_observation',recordedAt:'2099-02-01T18:05:00Z',payload:{sourceForecastId:forecast.forecastId,gameId:forecast.gameId,guildId:forecast.guildId,league:forecast.league,modelVersion:forecast.modelVersion,originalForecastGeneratedAt:forecast.predictionGeneratedAt,linkage:'exact_frozen_model_issue',odds:structuredClone(forecast.odds),valueDecision:structuredClone(forecast.valueDecision),...change}});

test('identical copied issues cannot retime the original qualified price decision',()=>{
 const data=rows();data.splice(1,0,{...structuredClone(data[0]),recordedAt:'2099-02-01T18:01:00Z'});assert.equal(evaluate(data).scenarios[0]?.decisionAt,issue);
});
test('conflicting copies of one forecast identity quarantine all of its price decisions',()=>{
 const data=rows(),copy=structuredClone(data[0]);copy.payload.outcomePercentages={away:20,home:80,draw:0};data.splice(1,0,copy);assert.equal(evaluate(data).scenarios.length,0);
});
test('non-issued copies cannot lend a qualified quote to an issued forecast',()=>{
 const data=rows(),copy=structuredClone(data[0]);data[0].payload.valueDecision=null;copy.payload.lifecycleState='PROVISIONAL';copy.recordedAt='2099-02-01T18:05:00Z';data.splice(1,0,copy);assert.equal(evaluate(data).scenarios.length,0);
});
test('price observations must match the exact original model and generated instant',()=>{
 for(const change of [{modelVersion:'other'},{originalForecastGeneratedAt:'2099-02-01T17:00:00Z'},{linkage:'unverified'}]){
  const data=rows(),obs=observation(data[0].payload,change);data[0].payload.valueDecision=null;data.splice(1,0,obs);assert.equal(evaluate(data).scenarios.length,0);
 }
});
test('a quote unavailable at the frozen evaluation instant cannot be borrowed from a later receipt',()=>{
 const data=rows(),obs=observation(data[0].payload);data[0].payload.valueDecision=null;
 for(const side of ['away','home'])obs.payload.odds.outcomes[side].offeredQuotes[0].quotedAt='2099-02-01T18:01:00Z';obs.payload.valueDecision.quote.quotedAt='2099-02-01T18:01:00Z';data.splice(1,0,obs);assert.equal(evaluate(data).scenarios.length,0);
});
test('explicit receipt, generation and decision clocks are never inferred from local or date-only text',()=>{
 const local=value=>{const d=new Date(value),pad=n=>String(n).padStart(2,'0');return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;};
 for(const mutate of [d=>d[0].recordedAt=local(issue),d=>d[0].payload.predictionGeneratedAt=local(issue),d=>d[0].payload.valueDecision.evaluatedAt=local(issue)]){const data=rows();mutate(data);assert.equal(evaluate(data).scenarios.length,0);}
});
test('unknown, malformed or nonconserved frozen class mass cannot enter economic scenarios',()=>{
 for(const mutate of [d=>delete d[0].payload.modeledOutcomes,d=>{d[0].payload.modeledOutcomes=['away','home','draw'];d[0].payload.outcomePercentages.draw=null;},d=>d[0].payload.outcomePercentages.home='55',d=>d[0].payload.outcomePercentages.home=55.4]){const data=rows();mutate(data);assert.equal(evaluate(data).scenarios.length,0);}
});
test('conflicting same-book original offers are quarantined rather than selected by array order',()=>{
 for(const reverse of [false,true]){const data=rows(),quotes=data[0].payload.odds.outcomes.home.offeredQuotes;quotes.push({...quotes[0],originalPrice:160});if(reverse)quotes.reverse();assert.equal(evaluate(data).scenarios.length,0);}
});
test('ambiguous equal-time first decisions cannot be resolved by guild or array order',()=>{
 const data=rows(),copy=structuredClone(data[0]);copy.payload.forecastId='copy';copy.payload.guildId='other';copy.payload.valueDecision.side='away';copy.payload.valueDecision.quote=copy.payload.odds.outcomes.away.offeredQuotes[0];data.splice(1,0,copy);assert.equal(evaluate(data).scenarios.length,0);
});
test('contradictory final labels for the same event cannot produce a chosen favorable return',()=>{
 const data=rows(),other=structuredClone(data[0]);other.payload.forecastId='other';other.payload.modelVersion='other-version';data.push(other,{type:'result',recordedAt:final,payload:{forecastId:'other',actualSide:'away',observedAt:final}});
 assert.ok(evaluate(data).scenarios.every(row=>row.counterfactualReturn===null));
});
test('an invalid later result cannot silently restore or preserve an earlier return',()=>{
 const data=rows();data.push({type:'result',recordedAt:'2099-02-01T22:01:00Z',payload:{forecastId:'f',actualSide:'invalid',observedAt:'2099-02-01T22:01:00Z'}});assert.equal(evaluate(data).scenarios[0].counterfactualReturn,null);
});
test('a contradictory provider-update alias cannot certify a different quoted instant',()=>{
 const data=rows();data[0].payload.valueDecision.quote.lastUpdate='2099-02-01T17:59:00Z';assert.equal(evaluate(data).scenarios.length,0);
});

test('equivalent original aliases and explicitly modeled structural draw zero remain valid',()=>{
 const data=rows(),quote=data[0].payload.odds.outcomes.home.offeredQuotes[0];quote.originalQuotedAt='2099-02-01T12:00:00-06:00';quote.lastUpdate=issue;
 delete data[0].payload.outcomePercentages.draw;assert.equal(evaluate(data).scenarios[0].outcome,'hypothetical_win');
});
test('earliest unresolved decision never falls back to a later resolved guild copy',()=>{
 const data=rows(),copy=structuredClone(data[0]);copy.payload.forecastId='other';copy.payload.guildId='other';copy.recordedAt='2099-02-01T18:01:00Z';data[1].payload.forecastId='other';data.splice(1,0,copy);
 assert.equal(evaluate(data).scenarios[0].forecastId,'f');assert.equal(evaluate(data).scenarios[0].counterfactualReturn,null);
});
test('historical cutoff hides later contradictory labels without changing the earlier price record',()=>{
 const data=rows(),before=structuredClone(data);const report=evaluatePriceResearch(data,{...options,asOf:Date.parse('2099-02-01T18:30:00Z')});assert.equal(report.scenarios[0].outcome,'unresolved');assert.deepEqual(data,before);
});
test('explicit model league and horizon scopes are applied before first-decision selection',()=>{
 const data=rows(),next=structuredClone(data[0]);next.payload.forecastId='later';next.payload.horizon='T-15';next.recordedAt='2099-02-01T18:05:00Z';data.splice(1,0,next);
 const scoped=evaluatePriceResearch(data,{...options,horizon:'T-15'});assert.equal(scoped.scenarios[0].forecastId,'later');assert.equal(scoped.byCohort[0].horizon,'T-15');assert.equal(evaluatePriceResearch(data,{...options,league:'nhl'}).scenarios.length,0);assert.equal(evaluatePriceResearch(data,{...options,modelVersion:'other'}).scenarios.length,0);
});
test('a valid correction must resolve an open conflict before restoring any assumed return',()=>{
 const data=rows();data.push({type:'result_conflict',recordedAt:'2099-02-01T22:01:00Z',payload:{forecastId:'f',conflictId:'c'}});
 data.push({type:'result',recordedAt:'2099-02-01T22:02:00Z',payload:{forecastId:'f',actualSide:'away',observedAt:'2099-02-01T22:02:00Z'}});assert.equal(evaluate(data).scenarios[0].counterfactualReturn,null);
 data.push({type:'result',recordedAt:'2099-02-01T22:03:00Z',payload:{forecastId:'f',actualSide:'away',observedAt:'2099-02-01T22:03:00Z',resolvesConflictId:'c'}});assert.equal(evaluate(data).scenarios[0].outcome,'hypothetical_loss');
});

test('missing chosen quote and malformed price observations yield exclusions without suppressing independent evidence',()=>{
 const data=rows();data[0].payload.valueDecision.quote=null;data.push({type:'price_observation',recordedAt:issue,payload:null});assert.doesNotThrow(()=>evaluate(data));assert.equal(evaluate(data).scenarios.length,0);
});
