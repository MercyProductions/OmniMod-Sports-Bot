import {normalizeEntityName} from './intelligenceStore.js';
import {normalizeOddsPrice} from './oddsPricing.js';
import {eventObservationHash} from './journalEventMatch.js';
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
const signature=book=>eventObservationHash(Object.fromEntries(Object.entries(book).map(([side,row])=>[side,[row.originalPrice,row.originalFormat,row.lastUpdate,row.timestampSource]])));

function parseMarket(market,bookmaker,game,twoWay,oddsFormat){
 const aliases=side=>new Set([normalizeEntityName(game[side]?.name),normalizeEntityName(game[side]?.abbr)].filter(Boolean));
 const away=aliases('away'),home=aliases('home'),book={};
 if(!Array.isArray(market.outcomes))return {reason:'invalid_outcome_collection'};
 for(const outcome of market.outcomes){
  if(!object(outcome)||typeof outcome.name!=='string')return {reason:'invalid_outcome'};
  const name=normalizeEntityName(outcome.name),sides=[...(name&&away.has(name)?['away']:[]),...(name&&home.has(name)?['home']:[]),...(/^(draw|tie)$/i.test(outcome.name.trim())?['draw']:[])];
  if(sides.length!==1)return {reason:sides.length?'ambiguous_outcome_alias':'unknown_outcome'};
  const side=sides[0],price=normalizeOddsPrice(outcome.price,oddsFormat);if(!price)return {reason:'invalid_outcome_price'};
  const quote={side,bookmaker:bookmaker.title||bookmaker.key,bookmakerKey:bookmaker.key.trim().toLowerCase(),name:outcome.name,price:price.americanOdds,originalPrice:price.originalPrice,originalFormat:price.originalFormat,rawImplied:price.impliedProbability,
   lastUpdate:market.last_update||bookmaker.last_update||'',timestampSource:market.last_update?'provider_update':'bookmaker_update_unverified'};
  if(book[side]&&signature({[side]:book[side]})!==signature({[side]:quote}))return {reason:'conflicting_duplicate_outcome'};
  book[side]=quote;
 }
 if(!book.away||!book.home||(twoWay?Boolean(book.draw):!book.draw))return {reason:'incomplete_or_wrong_outcome_set'};
 return {book};
}

/** Validate each provider book independently; never assemble a complete book from fragments. */
export function collectH2HBooks(bookmakers,game,{twoWay=true,oddsFormat='american'}={}){
 const groups=new Map(),audit={version:1,rawBookCount:Array.isArray(bookmakers)?bookmakers.length:0,acceptedBooks:0,rejectedBooks:0,observations:[],observationsTruncated:false},books=[];
 const record=row=>{if(audit.observations.length<100)audit.observations.push(row);else audit.observationsTruncated=true;};
 if(!Array.isArray(bookmakers)){record({status:'rejected',reason:'invalid_bookmaker_collection'});return {books,audit};}
 for(const row of bookmakers){
  if(!object(row)||typeof row.key!=='string'||!row.key.trim()){audit.rejectedBooks++;record({status:'rejected',reason:'provider_bookmaker_key_missing'});continue;}
  const key=row.key.trim().toLowerCase();if(!groups.has(key))groups.set(key,[]);groups.get(key).push(row);
 }
 for(const [key,rows] of groups){
  const candidates=[];let reason=null;
  for(const row of rows){
   if(!Array.isArray(row.markets)){reason='invalid_market_collection';break;}
   if(row.markets.some(market=>!object(market))){reason='invalid_market';break;}
   const markets=row.markets.filter(market=>market.key==='h2h');if(!markets.length){reason='h2h_market_missing';break;}
   for(const market of markets){const parsed=parseMarket(market,row,game,twoWay,oddsFormat);if(parsed.reason){reason=parsed.reason;break;}candidates.push(parsed.book);}
   if(reason)break;
  }
  const unique=new Map(candidates.map(book=>[signature(book),book]));
  if(!reason&&unique.size!==1)reason='conflicting_bookmaker_observations';
  if(reason){audit.rejectedBooks++;record({bookmakerKey:key.slice(0,120),status:'rejected',reason,observationCount:rows.length});continue;}
  books.push(unique.values().next().value);audit.acceptedBooks++;record({bookmakerKey:key.slice(0,120),status:'accepted',observationCount:rows.length,coalescedMarketCount:candidates.length});
 }
 return {books,audit};
}
