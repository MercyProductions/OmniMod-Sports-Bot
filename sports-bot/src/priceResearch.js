import {bookmakerMargin,quotePrice,quoteTimestampVerified,costedPriceScenario,validateCostAssumptions} from './oddsPricing.js';
import {finiteNumber} from './dataValidation.js';

const epoch=value=>Date.parse(value||'');
const SIDES=['away','home','draw'];
const bookKey=quote=>quote.bookmakerKey||quote.bookmaker;
const average=values=>values.length?values.reduce((a,b)=>a+b,0)/values.length:null;

/** Original offered-price counterfactuals, never an assertion of executable fills or wagering P&L. */
export function evaluatePriceResearch(records=[],{costs,asOf=Date.now()}={}){
  costs=validateCostAssumptions(costs);
  if(!Number.isFinite(asOf))throw new Error('A valid price-research cutoff is required');
  const visible=records.filter(event=>Number.isFinite(epoch(event.recordedAt))&&epoch(event.recordedAt)<=asOf);
  const forecasts=new Map(),results=new Map(),decisions=[],rejections={};
  const reject=reason=>{rejections[reason]=(rejections[reason]||0)+1;};
  for(const event of visible){
    const row=event.payload;
    if(event.type==='forecast'&&row.lifecycleState==='ISSUED'&&row.recordEligibility==='observed_pregame')forecasts.set(row.forecastId,{...row,issuedAt:event.recordedAt});
    if(event.type==='result')results.set(row.forecastId,{...row,resultRecordedAt:event.recordedAt});
  }
  for(const event of visible){
    const payload=event.payload;
    if(event.type==='forecast'&&forecasts.has(payload.forecastId))decisions.push({row:forecasts.get(payload.forecastId),odds:payload.odds,decision:payload.valueDecision,at:event.recordedAt});
    if(event.type==='price_observation'){
      const row=forecasts.get(payload.sourceForecastId);
      if(!row||payload.gameId!==row.gameId||payload.league!==row.league||payload.guildId!==row.guildId){reject('quote_observation_identity_unverified');continue;}
      decisions.push({row,odds:payload.odds,decision:payload.valueDecision,at:event.recordedAt});
    }
  }
  decisions.sort((a,b)=>epoch(a.at)-epoch(b.at));
  const selected=new Set(),scenarios=[];
  for(const {row,odds,decision,at} of decisions){
    if(decision?.status!=='research_opportunity'){reject('no_frozen_qualified_price_decision');continue;}
    const generated=epoch(row.predictionGeneratedAt),issued=epoch(row.issuedAt),start=epoch(row.startTime),observed=epoch(at),evaluated=epoch(decision.evaluatedAt);
    if(![generated,issued,start,observed,evaluated].every(Number.isFinite)||generated>issued||issued>=start||observed<issued||observed>=start||evaluated<generated||evaluated>observed||observed-generated>6*3600000){reject('decision_chronology_or_model_age_invalid');continue;}
    const identity=odds?.identity;
    if(!identity?.providerEventId||identity.localGameId!==row.gameId||identity.league!==row.league
      ||identity.matchStatus!=='matched'||epoch(identity.providerStartTime)!==start){reject('provider_event_identity_or_start_unverified');continue;}
    if(odds.cacheState==='stale'){reject('stale_provider_cache');continue;}
    const sides=odds.rules==='regulation_3way'?SIDES:odds.rules==='full_game_2way'?SIDES.slice(0,2):null;
    if(!sides||!sides.includes(decision.side)||(sides.length===2&&finiteNumber(row.outcomePercentages?.draw,0)>0)){reject('settlement_scope_or_outcome_set_unmodeled');continue;}
    const probabilities=sides.map(side=>finiteNumber(row.outcomePercentages?.[side]));
    if(probabilities.some(p=>p===null||p<0||p>100)||Math.abs(probabilities.reduce((a,b)=>a+b,0)-100)>.5){reject('invalid_frozen_probability_vector');continue;}
    const chosen=decision.quote,book=chosen&&bookKey(chosen),offers={};
    if(!book||!quoteTimestampVerified(chosen)){reject('frozen_decision_quote_unverified');continue;}
    for(const side of sides){
      const quotes=odds.outcomes?.[side]?.offeredQuotes||[];
      offers[side]=quotes.filter(q=>bookKey(q)===book&&quotePrice(q)&&quoteTimestampVerified(q)
        &&Number.isFinite(epoch(q.quotedAt))&&epoch(q.quotedAt)===epoch(chosen.quotedAt)&&epoch(q.quotedAt)<=observed&&observed-epoch(q.quotedAt)<=15*60000)
        .sort((a,b)=>epoch(b.quotedAt)-epoch(a.quotedAt))[0];
    }
    const margin=bookmakerMargin(offers,sides),chosenPrice=quotePrice(chosen),offeredPrice=quotePrice(offers[decision.side]);
    if(!margin||!chosenPrice||!offeredPrice||epoch(chosen.quotedAt)!==epoch(offers[decision.side].quotedAt)
      ||Math.abs(chosenPrice.decimalOdds-offeredPrice.decimalOdds)>1e-7){reject('complete_same_book_original_prices_unavailable');continue;}
    const key=JSON.stringify([row.league,row.gameId,new Date(start).toISOString(),row.modelVersion]);
    if(selected.has(key)){reject('later_game_price_decision_not_selected');continue;}
    // Freeze first valid decision before inspecting its result; no line shopping after the outcome.
    selected.add(key);
    const probability=row.outcomePercentages[decision.side]/100;
    const modeled=costedPriceScenario(offeredPrice.decimalOdds,probability,costs);
    const result=results.get(row.forecastId);
    let outcome='unresolved',counterfactualReturn=null;
    if(result){
      if(!Number.isFinite(epoch(result.observedAt))||epoch(result.observedAt)<start||epoch(result.observedAt)>epoch(result.resultRecordedAt)||result.scheduleChanged||!sides.includes(result.actualSide))outcome='censored_or_unmodeled_settlement';
      else{outcome=result.actualSide===decision.side?'hypothetical_win':'hypothetical_loss';counterfactualReturn=outcome==='hypothetical_win'?modeled.winReturnPerUnit:modeled.lossReturnPerUnit;}
    }
    scenarios.push({forecastId:row.forecastId,gameId:row.gameId,league:row.league,modelVersion:row.modelVersion,horizon:row.horizon,
      selectedSide:decision.side,decisionAt:at,quoteAt:offers[decision.side].quotedAt,bookmaker:book,
      decimalOdds:offeredPrice.decimalOdds,probability,marketInformed:row.modelUsesMarket===true,
      modelVsSameBookFairProbability:probability-margin.fairProbabilities[decision.side],margin,modeled,
      outcome,counterfactualReturn,settlementVerified:odds.settlementVerified===true,executionVerified:false});
  }
  const byVersion={};
  for(const version of new Set(scenarios.map(row=>row.modelVersion))){
    const rows=scenarios.filter(row=>row.modelVersion===version),resolved=rows.filter(row=>row.counterfactualReturn!==null);
    byVersion[version]={selectedGames:rows.length,resolvedCounterfactuals:resolved.length,
      unresolved:rows.filter(row=>row.outcome==='unresolved').length,censored:rows.filter(row=>row.outcome==='censored_or_unmodeled_settlement').length,
      meanAssumedReturnPerUnit:average(resolved.map(row=>row.counterfactualReturn)),
      meanModeledExpectedReturnPerUnit:average(rows.map(row=>row.modeled.expectedReturnPerUnit)),actualPaperExpectancy:null};
  }
  return {schema:'sports-frozen-price-research-v1',asOf:new Date(asOf).toISOString(),costAssumptions:costs,
    methodology:'Retrospective cost sensitivity at the first frozen qualified price decision per game/version; original same-book prices only.',
    rejections,byVersion,scenarios,executedTradesVerified:0,realizedProfit:null,actualPaperPerformance:null,promotionAllowed:false,
    limitations:['Observed quotes do not prove acceptance, executable entry, stake limits, fills or paid returns.',
      'Costs are declared per-stake/per-profit assumptions, not verified bookmaker tariffs, taxes or portfolio-level commission.',
      'Counterfactuals assume recorded market settlement scope; book-specific void/overtime rules may remain unverified.',
      'Model-market dependence, retrospective cost selection, overlapping model versions and small samples prevent profitability claims.']};
}
