import {quoteTimeEpoch} from './oddsPricing.js';

/** Declared timestamps and known local receipts, not independent publication proof. */
export function marketTimestampEvidence(game={},now=Date.now()){
 const h2h=game.odds?.h2h||{},reasons=[],aggregate=h2h.lastUpdate||game.odds?.lastUpdate,aggregateTime=quoteTimeEpoch(aggregate);
 const times=[aggregate,...[h2h.lastUpdate,game.odds?.lastUpdate].filter(value=>value!==undefined&&value!==null&&value!=='' && value!==aggregate)];
 let detailedQuotes=0;
 for(const side of ['away','home','draw']){
  const row=h2h[side];if(!row)continue;
  if(row.lastUpdate!==undefined&&row.lastUpdate!==null&&row.lastUpdate!=='')times.push(row.lastUpdate);
  if(Array.isArray(row.quotes)){detailedQuotes+=row.quotes.length;for(const quote of row.quotes)times.push(quote?.lastUpdate);}
 }
 const epochs=times.map(quoteTimeEpoch),receipt=game.odds?.fetchedAt,hasReceipt=receipt!==undefined&&receipt!==null&&receipt!=='',received=quoteTimeEpoch(receipt);
 if(!Number.isFinite(now))reasons.push('invalid_evaluation_clock');
 if(!Number.isFinite(aggregateTime))reasons.push('aggregate_quote_time_unverified');
 if(epochs.some(value=>!Number.isFinite(value)))reasons.push('contributing_quote_time_unverified');
 if(epochs.some(value=>value>now))reasons.push('quote_after_information_cutoff');
 if(epochs.some(value=>now-value>6*3600000))reasons.push('contributing_quote_older_than_six_hours');
 if(hasReceipt&&!Number.isFinite(received))reasons.push('invalid_quote_receipt');
 if(hasReceipt&&received>now)reasons.push('quote_receipt_after_information_cutoff');
 if(Number.isFinite(received)&&epochs.some(value=>value>received))reasons.push('quote_update_after_recorded_receipt');
 return {eligible:reasons.length===0,reasons,aggregateAt:Number.isFinite(aggregateTime)?new Date(aggregateTime).toISOString():null,
  receivedAt:Number.isFinite(received)?new Date(received).toISOString():null,receiptKnown:hasReceipt,detailedQuoteCount:detailedQuotes,
  granularity:detailedQuotes?'declared_contributor_times':'aggregate_only_legacy',publicationTimeIndependentlyVerified:false,maxAgeHours:6};
}
