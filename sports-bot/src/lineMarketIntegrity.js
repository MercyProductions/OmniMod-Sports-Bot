import {collectProviderMarkets} from './bookmakerIntegrity.js';
import {normalizeEntityName} from './intelligenceStore.js';
import {finiteNumber} from './dataValidation.js';
import {normalizeOddsPrice} from './oddsPricing.js';
import {eventObservationHash} from './journalEventMatch.js';
const signature=book=>eventObservationHash(Object.fromEntries(Object.entries(book).map(([side,row])=>[side,[row.point,row.originalPrice,row.originalFormat,row.lastUpdate,row.timestampSource]])));

function parseLineMarket(market,bookmaker,game,key){
 if(!Array.isArray(market.outcomes)||!market.outcomes.length)return {reason:'invalid_outcome_collection'};
 const book={},aliases=side=>new Set([normalizeEntityName(game[side]?.name),normalizeEntityName(game[side]?.abbr)].filter(Boolean));
 for(const row of market.outcomes){
  if(!row||typeof row.name!=='string')return {reason:'invalid_outcome'};
  const name=normalizeEntityName(row.name),sides=key==='spreads'?['away','home'].filter(side=>name&&aliases(side).has(name)):['over','under'].filter(side=>row.name.trim().toLowerCase()===side);
  if(sides.length!==1)return {reason:sides.length?'ambiguous_outcome_alias':'unknown_outcome'};
  const side=sides[0],point=finiteNumber(row.point),price=normalizeOddsPrice(row.price,'american');
  if(point===null||!price||(key==='totals'&&point<0))return {reason:'invalid_line_or_price'};
  const quote={side,bookmaker:bookmaker.title||bookmaker.key,bookmakerKey:bookmaker.key.trim().toLowerCase(),point,price:price.americanOdds,originalPrice:price.originalPrice,originalFormat:price.originalFormat,
   lastUpdate:market.last_update||bookmaker.last_update||'',timestampSource:market.last_update?'provider_update':'bookmaker_update_unverified'};
  if(book[side]&&signature({[side]:book[side]})!==signature({[side]:quote}))return {reason:'conflicting_duplicate_outcome'};
  book[side]=quote;
 }
 if(key==='spreads'&&book.away&&book.home&&Math.abs(book.away.point+book.home.point)>1e-9)return {reason:'noncomplementary_spread_lines'};
 if(key==='totals'&&book.over&&book.under&&book.over.point!==book.under.point)return {reason:'mismatched_total_lines'};
 return {book};
}

function representative(books,key){
 const sides=key==='spreads'?['away','home']:['over','under'],complete=books.filter(book=>sides.every(side=>book[side])),pool=complete.length?complete:books;
 if(!pool.length)return null;
 const anchor=book=>key==='spreads'?(book.home?.point??-book.away.point):(book.over?.point??book.under.point),points=pool.map(anchor).sort((a,b)=>a-b),middle=Math.floor(points.length/2),median=points.length%2?points[middle]:(points[middle-1]+points[middle])/2;
 const selected=[...pool].sort((a,b)=>Math.abs(anchor(a)-median)-Math.abs(anchor(b)-median)||Object.values(a)[0].bookmakerKey.localeCompare(Object.values(b)[0].bookmakerKey))[0];
 const output={...selected,status:complete.length?'complete':'partial_context',bookmakerKey:Object.values(selected)[0].bookmakerKey,selection:complete.length?'one_observed_book_nearest_complete_book_median':'one_partial_observed_book_nearest_partial_median',settlementVerified:false};
 if(key==='spreads')output.favorite=Object.values(selected).find(row=>row.point<0)||null;
 return output;
}

export function selectLineMarkets(bookmakers,game){
 const result={integrity:{}};
 for(const key of ['spreads','totals']){
  const {books,audit}=collectProviderMarkets(bookmakers,{marketKey:key,parse:(market,row)=>parseLineMarket(market,row,game,key),signature});
  result.integrity[key]=audit;result[key==='spreads'?'spread':'total']=representative(books,key);
 }
 return result;
}
