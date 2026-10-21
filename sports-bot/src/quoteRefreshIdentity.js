import {scopedSlatePredictions,scopedEventKey,eventReference,resolveSlateGame} from './slateEventIdentity.js';
import {journalGameIndex,eventObservationHash} from './journalEventMatch.js';
import {refreshPredictionValue} from './oddsValue.js';

export const hasQuoteScope=row=>Boolean(row?.leagueKey&&String(row.gameId??row.id??'')&&Number.isFinite(Date.parse(row.startTime||'')));
export const uniqueQuoteRows=rows=>[...new Map(rows.map(row=>[eventObservationHash(row),row])).values()];
export const quotePredictions=slate=>scopedSlatePredictions({...slate,predictions:(slate.predictions||[]).filter(hasQuoteScope)});

export function refreshScopedPredictionValues(slate,now=Date.now()){
 const index=journalGameIndex(slate.games||[]),predictions=quotePredictions(slate);
 return {...slate,predictions:uniqueQuoteRows(slate.predictions||[]).map(row=>{
  const game=hasQuoteScope(row)&&predictions.has(scopedEventKey(row))?resolveSlateGame(index,row).game:null;
  return refreshPredictionValue({...row,modelAsOf:row.modelAsOf||row.predictionGeneratedAt||''},game||undefined,now);
 })};
}

function forecastIdentity(row){
 const value=structuredClone(row);delete value.valueAnalysis;
 value.predictionGeneratedAt=row.originalForecastGeneratedAt||row.predictionGeneratedAt;
 value.modelAsOf=row.modelAsOf||value.predictionGeneratedAt;
 for(const field of ['originalForecastGeneratedAt','originalForecastHorizon','quoteRefreshOnly','eligibleForCalibration','snapshotStage'])delete value[field];
 return eventObservationHash(value);
}

/** A delayed response cannot replace a changed forecast, event or newer quote. */
export function mergeValueQuoteRefresh(latest,refreshed,now=Date.now()){
 const current=structuredClone(latest),issued=refreshed?.issuedSlate;
 if(!issued||String(issued.guildId||'')!==String(current.guildId||'')||issued.dateKey!==current.dateKey)return current;
 const currentPredictions=quotePredictions(current),newPredictions=quotePredictions(issued),source=journalGameIndex(issued.games||[]),target=journalGameIndex(current.games||[]),updates=new Map(),rejected=[];
 for(const row of uniqueQuoteRows(issued.predictions||[])){
  if(!hasQuoteScope(row)||!newPredictions.has(scopedEventKey(row)))rejected.push({eventKey:hasQuoteScope(row)?scopedEventKey(row):null,reason:'issued_forecast_scope_not_unique'});
 }
 for(const [key,row] of newPredictions){
  const before=currentPredictions.get(key),game=before&&resolveSlateGame(target,before).game,fresh=resolveSlateGame(source,row).game;
  let reason;
  if(!before)reason='current_forecast_missing_or_ambiguous';
  else if(forecastIdentity(before)!==forecastIdentity(row))reason='forecast_changed';
  else if(!game||!fresh)reason='event_missing_or_ambiguous';
  else if(game.statusKey!=='scheduled'||Date.parse(game.startTime)<=now)reason='event_no_longer_pregame';
  else if(!fresh.odds?.quoteRefreshOnly)reason='not_explicit_price_snapshot';
  else if(game.away?.name!==fresh.away?.name||game.home?.name!==fresh.home?.name)reason='participants_changed';
  else {
   const fetched=Date.parse(fresh.odds.fetchedAt||''),previous=Date.parse(game.odds?.fetchedAt||'');
   if(!Number.isFinite(fetched)||fetched>now)reason='quote_receipt_invalid';
   else if(Number.isFinite(previous)&&previous>fetched)reason='newer_quote_already_cached';
   else if(previous===fetched&&game.odds?.quoteRefreshOnly&&eventObservationHash(game.odds)!==eventObservationHash(fresh.odds))reason='conflicting_quote_receipt';
  }
  if(reason){rejected.push({eventKey:key,reason});continue;}
  updates.set(key,structuredClone(fresh.odds));
 }
 const next={...current,games:(current.games||[]).map(game=>updates.has(scopedEventKey(eventReference(game)))?{...game,odds:updates.get(scopedEventKey(eventReference(game)))}:game)};
 next.priceCacheMergeAudit={observedAt:new Date(now).toISOString(),appliedEvents:updates.size,rejected};
 if(updates.size)next.lastValueQuoteRefreshAt=refreshed.slate.lastValueQuoteRefreshAt;
 return refreshScopedPredictionValues(next,now);
}
