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

export function quoteTimestampVerified(quote={}){
  return quote.timestampSource==='provider_update';
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
