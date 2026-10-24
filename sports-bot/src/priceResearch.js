import {auditJournalForecastIdentities} from './journalForecastIdentity.js';
import {journalOutcomeVector} from './journalOutcomeSpace.js';
import {eventObservationHash} from './journalEventMatch.js';
import {capturedEventTime} from './capturedEventTime.js';
import {quoteTimeEpoch} from './oddsPricing.js';
import {journalResultState} from './journalResults.js';
import {bookmakerMargin,quotePrice,quoteTimestampVerified,costedPriceScenario,validateCostAssumptions,verifiedOddsReceipt} from './oddsPricing.js';

const epoch=quoteTimeEpoch,eventKey=row=>JSON.stringify([row.league,row.gameId,capturedEventTime(row.startTime)]);
const quoteInstant=quote=>{
 if(!quote||typeof quote!=='object'||Array.isArray(quote))return NaN;
 const at=epoch(quote?.quotedAt);
 if(!quoteTimestampVerified(quote)||!Number.isFinite(at))return NaN;
 for(const key of ['lastUpdate','originalQuotedAt'])if(quote[key]!==undefined&&quote[key]!==null&&quote[key]!==''&&epoch(quote[key])!==at)return NaN;
 return at;
};
const SIDES=['away','home','draw'];
const bookKey=quote=>typeof quote?.bookmakerKey==='string'?quote.bookmakerKey.trim().toLowerCase():'';
const average=values=>values.length?values.reduce((a,b)=>a+b,0)/values.length:null;

/** Original offered-price counterfactuals, never an assertion of executable fills or wagering P&L. */
export function evaluatePriceResearch(records=[],{costs,asOf=Date.now(),league=null,horizon=null,modelVersion=null}={}){
  costs=validateCostAssumptions(costs);
  if(!Number.isFinite(asOf)||!Number.isFinite(new Date(asOf).getTime()))throw new Error('A valid price-research cutoff is required');
  const visible=records.filter(event=>Number.isFinite(epoch(event.recordedAt))&&epoch(event.recordedAt)<=asOf);
  for(const value of [league,horizon,modelVersion])if(value!==null&&(typeof value!=='string'||!value.trim()))throw new Error('Invalid price-research scope');
  const forecasts=new Map(),results=new Map(),decisions=[],rejections={},candidates=[];
  const identities=auditJournalForecastIdentities(visible);
  const inScope=row=>(league===null||row.league===league)&&(horizon===null||row.horizon===horizon)&&(modelVersion===null||row.modelVersion===modelVersion);
  const reject=reason=>{rejections[reason]=(rejections[reason]||0)+1;};
  for(const event of identities.events){
    const row=event.payload;
    if(row.lifecycleState==='ISSUED'&&row.recordEligibility==='observed_pregame')forecasts.set(row.forecastId,{...row,issuedAt:event.recordedAt});
  }
  const qualified=[],invalidResults=new Set();
  for(const event of visible){
    if(event.type!=='result'){qualified.push(event);continue;}
    const row=forecasts.get(event.payload?.forecastId),result=event.payload,start=capturedEventTime(row?.startTime),observed=epoch(result?.observedAt);
    if(!row){reject('result_forecast_identity_unverified');continue;}
    if(!Number.isFinite(start)||!Number.isFinite(observed)||start>observed||observed>epoch(event.recordedAt)||result.scheduleChanged
      ||!SIDES.includes(result.actualSide)||result.gameId!==undefined&&result.gameId!==row.gameId||result.league!==undefined&&result.league!==row.league){
      invalidResults.add(row.forecastId);reject('result_chronology_or_identity_unverified');continue;
    }
    invalidResults.delete(row.forecastId);qualified.push(event);
  }
  const resultState=journalResultState(qualified),eventLabels=new Map(),disputedEvents=new Set();
  for(const [id,event] of resultState.eligible)if(!invalidResults.has(id))results.set(id,{...event.payload,resultRecordedAt:event.recordedAt});
  for(const row of forecasts.values()){
    const generated=epoch(row.predictionGeneratedAt),issued=epoch(row.issuedAt),start=capturedEventTime(row.startTime);
    if(!row.gameId||!row.league||!row.modelVersion||!row.horizon||![generated,issued,start].every(Number.isFinite)||generated>issued||issued>=start)continue;
    const key=eventKey(row);
    if(resultState.conflicts.has(row.forecastId)||invalidResults.has(row.forecastId))disputedEvents.add(key);
    if(results.has(row.forecastId)){if(!eventLabels.has(key))eventLabels.set(key,new Set());eventLabels.get(key).add(results.get(row.forecastId).actualSide);}
  }
  const conflictingEvents=new Set([...eventLabels].filter(([,labels])=>labels.size>1).map(([key])=>key));
  for(const event of identities.events){
    const row=forecasts.get(event.payload.forecastId);if(row&&inScope(row))decisions.push({row,odds:row.odds,decision:row.valueDecision,at:row.issuedAt});
  }
  for(const event of visible.filter(event=>event.type==='price_observation')){
    const payload=event.payload||{},row=forecasts.get(payload.sourceForecastId);
    if(!row||payload.gameId!==row.gameId||payload.league!==row.league||payload.guildId!==row.guildId||payload.modelVersion!==row.modelVersion
      ||payload.linkage!=='exact_frozen_model_issue'||!Number.isFinite(epoch(payload.originalForecastGeneratedAt))||epoch(payload.originalForecastGeneratedAt)!==epoch(row.predictionGeneratedAt)){
      reject('quote_observation_identity_unverified');continue;
    }
    if(inScope(row))decisions.push({row,odds:payload.odds,decision:payload.valueDecision,at:event.recordedAt});
  }
  decisions.sort((a,b)=>epoch(a.at)-epoch(b.at));
  const scenarios=[];
  for(const {row,odds,decision,at} of decisions){
    if(decision?.status!=='research_opportunity'){reject('no_frozen_qualified_price_decision');continue;}
    const generated=epoch(row.predictionGeneratedAt),issued=epoch(row.issuedAt),start=capturedEventTime(row.startTime),observed=epoch(at),evaluated=epoch(decision.evaluatedAt);
    if(!row.gameId||!row.league||!row.modelVersion||!row.horizon||![generated,issued,start,observed,evaluated].every(Number.isFinite)||generated>issued||issued>=start||observed<issued||observed>=start||evaluated<generated||evaluated>observed||observed-generated>6*3600000){reject('decision_chronology_or_model_age_invalid');continue;}
    const sourceReceipt=verifiedOddsReceipt(odds?.sourceReceipt),received=epoch(sourceReceipt?.fetchedAt);
    if(!sourceReceipt){reject('provider_receipt_unverified');continue;}
    if(received>evaluated){reject('provider_receipt_after_decision');continue;}
    const identity=odds?.identity;
    if(!identity?.providerEventId||identity.localGameId!==row.gameId||identity.league!==row.league
      ||identity.matchStatus!=='matched'||capturedEventTime(identity.providerStartTime)!==start){reject('provider_event_identity_or_start_unverified');continue;}
    if(odds.cacheState==='stale'){reject('stale_provider_cache');continue;}
    const sides=odds.rules==='regulation_3way'?SIDES:odds.rules==='full_game_2way'?SIDES.slice(0,2):null;
    if(!sides||!sides.includes(decision.side)){reject('settlement_scope_or_outcome_set_unmodeled');continue;}
    const vector=journalOutcomeVector(row);
    if(!Array.isArray(row.modeledOutcomes)||!vector||(sides.length===2&&vector.draw!==0)||(sides.length===3&&!row.modeledOutcomes.includes('draw'))){reject('invalid_frozen_probability_vector');continue;}
    const chosen=decision.quote,book=bookKey(chosen),chosenAt=quoteInstant(chosen),offers={};
    if(!book||!Number.isFinite(chosenAt)||chosenAt>evaluated){reject('frozen_decision_quote_unverified');continue;}
    if(chosenAt>received){reject('quote_update_after_provider_receipt');continue;}
    for(const side of sides){
      const quotes=odds.outcomes?.[side]?.offeredQuotes;
      if(!Array.isArray(quotes))continue;
      const matching=quotes.filter(q=>bookKey(q)===book&&epoch(q?.quotedAt)===chosenAt);
      if(!matching.length||matching.some(q=>!quotePrice(q)||quoteInstant(q)!==chosenAt||chosenAt>evaluated||observed-chosenAt>15*60000))continue;
      if(new Set(matching.map(q=>quotePrice(q).decimalOdds)).size!==1)continue;
      offers[side]=matching[0];
    }
    const margin=bookmakerMargin(offers,sides),chosenPrice=quotePrice(chosen),offeredPrice=quotePrice(offers[decision.side]);
    if(!margin||!chosenPrice||!offeredPrice||epoch(chosen.quotedAt)!==epoch(offers[decision.side].quotedAt)
      ||Math.abs(chosenPrice.decimalOdds-offeredPrice.decimalOdds)>1e-7){reject('complete_same_book_original_prices_unavailable');continue;}
    candidates.push({row,odds,decision,at,offers,margin,offeredPrice,start,vector,sides,book,sourceReceipt});
  }
  const groups=new Map();
  for(const candidate of candidates){const key=JSON.stringify([eventKey(candidate.row),candidate.row.modelVersion]);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(candidate);}
  for(const copies of groups.values()){
    const earliest=copies.filter(copy=>epoch(copy.at)===epoch(copies[0].at));
    const signature=copy=>eventObservationHash({side:copy.decision.side,book:bookKey(copy.offers[copy.decision.side]),at:quoteInstant(copy.offers[copy.decision.side]),price:copy.offeredPrice.decimalOdds,
      probabilities:copy.vector,horizon:copy.row.horizon,generatedAt:epoch(copy.row.predictionGeneratedAt)});
    if(new Set(earliest.map(signature)).size>1){reject('ambiguous_first_game_price_decision');continue;}
    for(const copy of copies.slice(1))reject('later_game_price_decision_not_selected');
    // Freeze the first unambiguous valid decision before looking at labels.
    const {row,odds,decision,at,offers,margin,offeredPrice,start,vector,sides,book,sourceReceipt}=copies[0];
    const probability=vector[decision.side];
    const modeled=costedPriceScenario(offeredPrice.decimalOdds,probability,costs);
    const result=results.get(row.forecastId);
    let outcome='unresolved',counterfactualReturn=null;
    const resultExclusionReason=conflictingEvents.has(eventKey(row))?'conflicting_event_labels':disputedEvents.has(eventKey(row))?'disputed_or_invalid_event_result':null;
    if(result&&!resultExclusionReason){
      if(!Number.isFinite(epoch(result.observedAt))||epoch(result.observedAt)<start||epoch(result.observedAt)>epoch(result.resultRecordedAt)||result.scheduleChanged||!sides.includes(result.actualSide))outcome='censored_or_unmodeled_settlement';
      else{outcome=result.actualSide===decision.side?'hypothetical_win':'hypothetical_loss';counterfactualReturn=outcome==='hypothetical_win'?modeled.winReturnPerUnit:modeled.lossReturnPerUnit;}
    }
    scenarios.push({forecastId:row.forecastId,gameId:row.gameId,league:row.league,modelVersion:row.modelVersion,horizon:row.horizon,
      startTime:new Date(start).toISOString(),resultExclusionReason,selectedSide:decision.side,decisionAt:at,quoteAt:offers[decision.side].quotedAt,bookmaker:book,
      sourceReceipt,sourceReceiptAgeMs:epoch(decision.evaluatedAt)-epoch(sourceReceipt.fetchedAt),quoteToReceiptLagMs:epoch(sourceReceipt.fetchedAt)-quoteInstant(offers[decision.side]),
      decimalOdds:offeredPrice.decimalOdds,probability,marketInformed:row.modelUsesMarket===true,
      modelVsSameBookFairProbability:probability-margin.fairProbabilities[decision.side],margin,modeled,
      outcome,counterfactualReturn,settlementVerified:odds.settlementVerified===true,executionVerified:false});
  }
  const summarize=rows=>{
    const resolved=rows.filter(row=>row.counterfactualReturn!==null);
    return {selectedGames:rows.length,resolvedCounterfactuals:resolved.length,
      unresolved:rows.filter(row=>row.outcome==='unresolved').length,censored:rows.filter(row=>row.outcome==='censored_or_unmodeled_settlement').length,
      meanAssumedReturnPerUnit:average(resolved.map(row=>row.counterfactualReturn)),
      meanModeledExpectedReturnPerUnit:average(rows.map(row=>row.modeled.expectedReturnPerUnit)),actualPaperExpectancy:null};
  };
  const byVersion=Object.fromEntries([...new Set(scenarios.map(row=>row.modelVersion))].map(version=>[version,summarize(scenarios.filter(row=>row.modelVersion===version))]));
  const cohortKey=row=>JSON.stringify([row.modelVersion,row.league,row.horizon]),cohorts=new Map();
  for(const row of scenarios){const key=cohortKey(row);if(!cohorts.has(key))cohorts.set(key,[]);cohorts.get(key).push(row);}
  const byCohort=[...cohorts.values()].map(rows=>({modelVersion:rows[0].modelVersion,league:rows[0].league,horizon:rows[0].horizon,...summarize(rows)}));
  return {schema:'sports-frozen-price-research-v3',asOf:new Date(asOf).toISOString(),costAssumptions:costs,
    methodology:'Retrospective cost sensitivity at the first frozen qualified price decision per game/version; original same-book prices only.',
    scope:{league,horizon,modelVersion},journalIntegrity:{duplicateForecastRecords:identities.duplicateRecords,conflictingForecastIds:identities.conflictingIds.size,invalidForecastIds:identities.invalidIdRecords,unverifiableRecordTimes:records.filter(row=>!Number.isFinite(epoch(row.recordedAt))).length,conflictingResultEvents:conflictingEvents.size,disputedOrInvalidResultEvents:disputedEvents.size},rejections,byVersion,byCohort,scenarios,executedTradesVerified:0,realizedProfit:null,actualPaperPerformance:null,promotionAllowed:false,
    limitations:['Class metadata, provider keys and exact original-model linkage are required; older unverifiable snapshots stay excluded without rewriting them.',
      'Local provider fetch/revalidation receipts must precede the frozen decision and follow its quote updates. They do not authenticate source publication, continuous price availability or executable fills; legacy missing receipts are never inferred from journal time.',
      'First selection is per canonical event/model across guilds and horizons within the requested scope. By-cohort groups describe that selected subset; separate scoped reports can overlap and must not be summed as independent evidence.',
      'Journal append order and hash-chain validation belong to the caller; local consistency does not authenticate publication or source truth.',
      'Observed quotes do not prove acceptance, executable entry, stake limits, fills or paid returns.',
      'Costs are declared per-stake/per-profit assumptions, not verified bookmaker tariffs, taxes or portfolio-level commission.',
      'Counterfactuals assume recorded market settlement scope; book-specific void/overtime rules may remain unverified.',
      'Model-market dependence, retrospective cost selection, overlapping model versions and small samples prevent profitability claims.']};
}
