import {finiteNumber} from './dataValidation.js';

/** Format is explicit; a small American value is never guessed to be decimal. */
export function normalizeOddsPrice(value,format='american'){
  const price=finiteNumber(value);
  if(price===null||!['american','decimal'].includes(format))return null;
  if(format==='american'&&Math.abs(price)<100||format==='decimal'&&price<=1)return null;
  const decimal=format==='decimal'?price:price>0?1+price/100:1+100/-price;
  if(!Number.isFinite(decimal)||decimal<=1)return null;
  return {originalPrice:price,originalFormat:format,decimalOdds:decimal,
    americanOdds:format==='american'?price:decimal>=2?(decimal-1)*100:-100/(decimal-1),impliedProbability:1/decimal};
}

export function quotePrice(quote={}){
  const format=quote.priceFormat||quote.originalFormat||'american';
  const raw=quote.originalPrice??(format==='decimal'?(quote.priceDecimal??quote.decimalOdds??quote.price):quote.priceAmerican??quote.price);
  const normalized=normalizeOddsPrice(raw,format);
  const statedDecimal=finiteNumber(quote.decimalOdds??quote.priceDecimal);
  if(!normalized||statedDecimal!==null&&Math.abs(statedDecimal-normalized.decimalOdds)>1e-7)return null;
  return normalized;
}

/** Explicit timezone and real calendar date; never infer the host's local timezone. */
export function quoteTimeEpoch(value){
  if(typeof value!=='string')return NaN;
  const match=/^(\d{4})-(\d{2})-(\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/i.exec(value);
  if(!match)return NaN;
  const [,year,month,day]=match.map(Number),calendar=new Date(0);calendar.setUTCFullYear(year,month,0);
  if(month<1||month>12||day<1||day>calendar.getUTCDate())return NaN;
  return Date.parse(value);
}

/** A local fetch/revalidation receipt is not an assertion of source publication time. */
export function oddsReceiptSnapshot(fetchedAt){
  const at=quoteTimeEpoch(fetchedAt);
  return {schema:'sports-local-odds-receipt-v1',fetchedAt:Number.isFinite(at)?new Date(at).toISOString():null,
    timestampStatus:Number.isFinite(at)?'explicit_zone':fetchedAt===undefined||fetchedAt===null||fetchedAt===''?'missing':'invalid',
    kind:'local_fetch_receipt_not_provider_publication'};
}

export function verifiedOddsReceipt(receipt){
  if(!receipt||receipt.schema!=='sports-local-odds-receipt-v1'||receipt.timestampStatus!=='explicit_zone'
    ||receipt.kind!=='local_fetch_receipt_not_provider_publication'||!Number.isFinite(quoteTimeEpoch(receipt.fetchedAt)))return null;
  return oddsReceiptSnapshot(receipt.fetchedAt);
}

export function quoteTimestampVerified(quote={}){
  return quote.timestampSource==='provider_update'&&Number.isFinite(quoteTimeEpoch(quote.lastUpdate??quote.quotedAt));
}

/** One complete bookmaker's offered outcomes; never de-vig cross-book best prices. */
export function bookmakerMargin(quotes,sides){
  if(!quotes||typeof quotes!=='object'||!Array.isArray(sides)||![2,3].includes(sides.length))return null;
  const normalized=Object.fromEntries(sides.map(side=>[side,quotePrice(quotes[side])]));
  if(sides.some(side=>!normalized[side]))return null;
  const total=sides.reduce((sum,side)=>sum+normalized[side].impliedProbability,0);
  return {overround:total-1,impliedProbabilitySum:total,
    fairProbabilities:Object.fromEntries(sides.map(side=>[side,normalized[side].impliedProbability/total]))};
}

export function validateCostAssumptions(costs){
  if(!costs||typeof costs!=='object')throw new Error('Explicit cost assumptions required');
  const result={};
  for(const key of ['feePerStake','commissionOnProfit','profitHaircut']){
    const value=finiteNumber(costs[key]);
    if(value===null||value<0||value>.5)throw new Error('Invalid bounded cost assumption');
    result[key]=value;
  }
  return result;
}

export function costedPriceScenario(decimalOdds,probability,costs){
  const c=validateCostAssumptions(costs),decimal=finiteNumber(decimalOdds),p=finiteNumber(probability);
  if(decimal===null||decimal<=1||p===null||p<0||p>1)return null;
  const win=(decimal-1)*(1-c.profitHaircut)*(1-c.commissionOnProfit)-c.feePerStake;
  const loss=-1-c.feePerStake;
  return {winReturnPerUnit:win,lossReturnPerUnit:loss,expectedReturnPerUnit:p*win+(1-p)*loss,
    breakEvenProbability:-loss/(win-loss),costs:c,executionVerified:false};
}
