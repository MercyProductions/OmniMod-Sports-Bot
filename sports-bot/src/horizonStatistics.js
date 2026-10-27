import {quoteTimeEpoch as instant} from './oddsPricing.js';

const mean = values => values.reduce((sum,value) => sum + value,0) / values.length;
function gameIdentity(item) {
  const row=item.row,league=String(row?.leagueKey || row?.league || '').trim().toLowerCase(),start=instant(row?.startTime);
  if(!league || row.gameId==null || !String(row.gameId).trim() || !Number.isFinite(start)) return null;
  return JSON.stringify([league,String(row.gameId),new Date(start).toISOString()]);
}
function percentile(values,fraction) {
  const sorted=[...values].sort((a,b)=>a-b);
  return sorted[Math.floor((sorted.length-1)*fraction)];
}
function bootstrap(games,repetitions=300) {
  const metrics=['accuracy','brier','logLoss'];
  if(games.length<8)return Object.fromEntries(metrics.map(key=>[key,null]));
  let seed=(games.length*7919+17)>>>0;
  const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  const samples=Object.fromEntries(metrics.map(key=>[key,[]]));
  for(let repetition=0;repetition<repetitions;repetition++){
    const totals=Object.fromEntries(metrics.map(key=>[key,0]));
    for(let i=0;i<games.length;i++){
      const game=games[Math.floor(random()*games.length)];
      for(const key of metrics)totals[key]+=game[key];
    }
    for(const key of metrics)samples[key].push(totals[key]/games.length);
  }
  return Object.fromEntries(metrics.map(key=>[key,[percentile(samples[key],.025),percentile(samples[key],.975)]]));
}

/** Descriptive equal-game weighting; raw guild/horizon records never create independent trials. */
export function summarizeHorizonRows(rows=[]) {
  const groups=new Map();let unscopedForecastCount=0;
  for(const item of rows){
    const key=gameIdentity(item);
    if(key===null){unscopedForecastCount++;continue;}
    if(!groups.has(key))groups.set(key,[]);
    groups.get(key).push(item);
  }
  const clusters=[...groups].sort(([a],[b])=>a.localeCompare(b)).map(([,items])=>[...items].sort((a,b)=>
    JSON.stringify([Number(a.correct),a.brier,a.logLoss,a.selectedProbability,a.modelVsCloseEdge]).localeCompare(
      JSON.stringify([Number(b.correct),b.brier,b.logLoss,b.selectedProbability,b.modelVsCloseEdge]))));
  const games=clusters.map(items=>({accuracy:mean(items.map(row=>Number(row.correct))),brier:mean(items.map(row=>row.brier)),
    logLoss:mean(items.map(row=>row.logLoss)),closing:items.filter(row=>Number.isFinite(row.modelVsCloseEdge))}));
  const bins=Array.from({length:10},(_,i)=>({lower:i/10,forecastCount:0,gameWeight:0,probability:0,correct:0}));
  for(const items of clusters)for(const row of items){
    const weight=1/(clusters.length*items.length),bin=bins[Math.min(9,Math.floor(row.selectedProbability*10))];
    bin.forecastCount++;bin.gameWeight+=weight;bin.probability+=weight*row.selectedProbability;bin.correct+=weight*Number(row.correct);
  }
  const calibration=bins.filter(bin=>bin.forecastCount).map(bin=>({lower:bin.lower,forecastCount:bin.forecastCount,gameWeight:bin.gameWeight,
    meanProbability:bin.probability/bin.gameWeight,observedFrequency:bin.correct/bin.gameWeight}));
  const closingGames=games.filter(game=>game.closing.length);
  const dates=new Set(clusters.map(items=>new Date(instant(items[0].row.startTime)).toISOString().slice(0,10)));
  return {sampleSize:games.length,gameClusters:games.length,forecastCount:rows.length,unscopedForecastCount,
    distinctEventDates:dates.size,
    accuracy:games.length?mean(games.map(game=>game.accuracy)):null,
    brierScore:games.length?mean(games.map(game=>game.brier)):null,
    logLoss:games.length?mean(games.map(game=>game.logLoss)):null,
    calibrationError:games.length?calibration.reduce((sum,bin)=>sum+bin.gameWeight*Math.abs(bin.observedFrequency-bin.meanProbability),0):null,
    calibration,
    meanModelVsCloseEdge:closingGames.length?mean(closingGames.map(game=>mean(game.closing.map(row=>row.modelVsCloseEdge)))):null,
    closingSampleSize:closingGames.length,closingForecastCount:closingGames.reduce((sum,game)=>sum+game.closing.length,0),
    bootstrap95:bootstrap(games),
    intervalMethod:'300 canonical-game-cluster percentile replicates; null below 8 scoped games. Day/team/league dependence and multiple comparisons remain unadjusted.',
    weighting:'One weight per canonical league/event/start, shared across its forecast records in this table. Strata and horizons overlap; counts are not independent across tables.'};
}
