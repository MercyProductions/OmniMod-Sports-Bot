import {journalResultState} from './journalResults.js';
import {quotePrice,quoteTimestampVerified} from './oddsPricing.js';
import {finiteNumber} from './dataValidation.js';

const SIDES=['away','home','draw'];
const COMPARATORS=['evidence','hybrid','specialist','ml','elo','market'];
const time=value=>Date.parse(value||'');
const mean=values=>values.reduce((a,b)=>a+b,0)/values.length;
const winner=vector=>SIDES.filter(side=>vector[side]!==undefined).sort((a,b)=>vector[b]-vector[a])[0];
const group=(rows,key)=>{
  const groups=new Map();
  for(const row of rows){const value=key(row);if(!groups.has(value))groups.set(value,[]);groups.get(value).push(row);}
  return groups;
};

function vector(raw,scale=1){
  if(!raw)return null;
  const result={away:finiteNumber(raw.away),home:finiteNumber(raw.home),draw:raw.draw==null?0:finiteNumber(raw.draw)};
  if(Object.values(result).some(p=>p===null||p<0||p>scale))return null;
  const total=Object.values(result).reduce((a,b)=>a+b,0);
  if(Math.abs(total-scale)>(scale===100?0.5:0.0011)||total<=0)return null;
  return Object.fromEntries(Object.entries(result).map(([side,p])=>[side,p/total]));
}

function marketVerified(row){
  const market=vector(row.referenceBaselines?.market?.probabilities),generated=time(row.predictionGeneratedAt);
  return market&&SIDES.filter(side=>market[side]>0).every(side=>(row.odds?.outcomes?.[side]?.offeredQuotes||[])
    .some(quote=>quote.bookmaker&&quotePrice(quote)&&quoteTimestampVerified(quote)
      &&Number.isFinite(time(quote.quotedAt))&&time(quote.quotedAt)<=generated&&generated-time(quote.quotedAt)<=30*60000));
}

function score(probabilities,actual,sides,selected=winner(probabilities)){
  return {accuracy:Number(selected===actual),
    brier:sides.reduce((sum,side)=>sum+(probabilities[side]-Number(side===actual))**2,0)/sides.length,
    logLoss:-Math.log(Math.max(1e-12,probabilities[actual])),selectedProbability:probabilities[selected]};
}

function summarize(pairs,which){
  if(!pairs.length)return {forecasts:0,games:0,accuracy:null,brier:null,logLoss:null,calibrationError:null,calibration:[]};
  const games=group(pairs,p=>p.game),values=[...games.values()];
  const bins=Array.from({length:10},(_,i)=>({lower:i/10,forecasts:0,weight:0,probability:0,correct:0}));
  for(const rows of values)for(const row of rows){
    const s=row[which],weight=1/(values.length*rows.length),bin=bins[Math.min(9,Math.floor(s.selectedProbability*10))];
    bin.forecasts++;bin.weight+=weight;bin.probability+=weight*s.selectedProbability;bin.correct+=weight*s.accuracy;
  }
  const calibration=bins.filter(b=>b.forecasts).map(b=>({lower:b.lower,forecasts:b.forecasts,gameWeight:b.weight,
    meanProbability:b.probability/b.weight,observedFrequency:b.correct/b.weight}));
  return {forecasts:pairs.length,games:values.length,
    ...Object.fromEntries(['accuracy','brier','logLoss'].map(metric=>[metric,mean(values.map(rows=>mean(rows.map(row=>row[which][metric]))))])),
    calibrationError:calibration.reduce((sum,b)=>sum+b.gameWeight*Math.abs(b.meanProbability-b.observedFrequency),0),calibration};
}

function pairedIntervals(pairs,repetitions){
  const games=[...group(pairs,p=>p.game).values()];
  if(games.length<8)return {independentGames:games.length,brierImprovement:null,logLossImprovement:null,accuracyImprovement:null,
    primary:{accuracy:null,brier:null,logLoss:null},reference:{accuracy:null,brier:null,logLoss:null}};
  const differences=games.map(rows=>({brierImprovement:mean(rows.map(p=>p.reference.brier-p.primary.brier)),
    logLossImprovement:mean(rows.map(p=>p.reference.logLoss-p.primary.logLoss)),
    accuracyImprovement:mean(rows.map(p=>p.primary.accuracy-p.reference.accuracy)),
    ...Object.fromEntries(['primary','reference'].flatMap(which=>['accuracy','brier','logLoss'].map(metric=>
      [which+'_'+metric,mean(rows.map(p=>p[which][metric]))])))}));
  let seed=17;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  const samples=Object.fromEntries(Object.keys(differences[0]).map(key=>[key,[]]));
  for(let i=0;i<repetitions;i++){
    const draw=Array.from({length:games.length},()=>differences[Math.floor(random()*games.length)]);
    for(const key of Object.keys(samples))samples[key].push(mean(draw.map(row=>row[key])));
  }
  const bounds=Object.fromEntries(Object.entries(samples).map(([key,values])=>{
    values.sort((a,b)=>a-b);return [key,[values[Math.floor((values.length-1)*.025)],values[Math.floor((values.length-1)*.975)]]];
  }));
  return {independentGames:games.length,brierImprovement:bounds.brierImprovement,
    logLossImprovement:bounds.logLossImprovement,accuracyImprovement:bounds.accuracyImprovement,
    ...Object.fromEntries(['primary','reference'].map(which=>[which,Object.fromEntries(
      ['accuracy','brier','logLoss'].map(metric=>[metric,bounds[which+'_'+metric]]))]))};
}

function compare(pairs,repetitions){
  const primary=summarize(pairs,'primary'),reference=summarize(pairs,'reference');
  return {primary,reference,distinctEventDates:new Set(pairs.map(row=>row.eventDate)).size,
    differences:{accuracyImprovement:primary.games?primary.accuracy-reference.accuracy:null,
      brierImprovement:primary.games?reference.brier-primary.brier:null,
      logLossImprovement:primary.games?reference.logLoss-primary.logLoss:null},
    pairedGameBootstrap95:pairedIntervals(pairs,repetitions),promotionAllowed:false};
}

function strata(row){
  const coverage=row.evidenceCoverage,context=row.eventContext||{};
  const market=marketVerified(row)?vector(row.referenceBaselines.market.probabilities):null;
  const max=market?Math.max(...Object.values(market)):null;
  const confidenceLower=Math.min(9,Math.floor(Math.max(...Object.values(vector(row.outcomePercentages,100)))*10))*10;
  const favorite=market?SIDES.filter(side=>market[side]===max):[];
  const risk=finiteNumber(coverage?.rosterTransitionRisk);
  return {sport:context.sport||'unknown',league:row.league||'unknown',horizon:row.horizon||'unknown',
    confidence:`${confidenceLower}-${confidenceLower+10}%`,
    favorite:favorite.length!==1?'unknown_or_balanced':favorite[0]===row.selectedSide?'favorite':'underdog',
    season:context.season==null?'unknown':String(context.season),seasonPhase:context.seasonType==null?'unknown':String(context.seasonType),
    rosterTransition:risk===null?'unknown':risk>=.25?'elevated':'lower_reported_risk',
    injuryCoverage:coverage?.summary?.injuryCoverage||'unknown',
    lineupCoverage:coverage?['away','home'].every(side=>coverage.sides?.[side]?.confirmedStarters>0)?'starter_records_both_sides_not_full_lineup_proof':'incomplete_starter_records':'unknown',
    sourceFreshness:coverage?.summary?.receiptFresh===true?'fresh_receipt_underlying_freshness_unverified':coverage?'not_fresh_receipt':'unknown',
    marketData:market?'timestamp_verified_offered_quotes':row.odds?.status==='available'?'prices_present_timestamp_unverified':'unavailable'};
}

/** Diagnostic-only, same-issue comparisons. Never trains, selects, promotes or writes. */
export function evaluateMatchedJournal(records=[],{asOf=Date.now(),repetitions=300}={}){
  if(!Number.isFinite(asOf)||!Number.isInteger(repetitions)||repetitions<100||repetitions>2000)throw new Error('Invalid bounded evaluation settings');
  const rejects={},reject=reason=>{rejects[reason]=(rejects[reason]||0)+1;};
  const visible=records.filter(event=>Number.isFinite(time(event.recordedAt))&&time(event.recordedAt)<=asOf);
  const results=new Map([...journalResultState(visible).eligible].map(([id,event])=>[id,{...event.payload,resultRecordedAt:event.recordedAt}]));
  const first=new Map();
  for(const event of visible){
    if(event.type!=='forecast')continue;
    const row=event.payload,generated=time(row.predictionGeneratedAt),issued=time(event.recordedAt),start=time(row.startTime);
    if(row.lifecycleState!=='ISSUED'||row.recordEligibility!=='observed_pregame'){reject('issuance_unverified');continue;}
    if(![generated,issued,start].every(Number.isFinite)||generated>issued||issued>=start){reject('invalid_issuance_chronology');continue;}
    if(!row.gameId||!row.league||!row.modelVersion||!row.horizon){reject('identity_or_horizon_missing');continue;}
    const key=JSON.stringify([row.guildId,row.league,row.gameId,row.modelVersion,row.horizon]);
    if(!first.has(key))first.set(key,row);else reject('later_same_horizon_revision_not_selected');
  }
  const eligible=[];
  for(const row of first.values()){
    const result=results.get(row.forecastId),probabilities=vector(row.outcomePercentages,100);
    if(!result){reject('unresolved');continue;}
    if(!SIDES.includes(result.actualSide)||!Number.isFinite(time(result.observedAt))||time(result.observedAt)<time(row.startTime)||time(result.observedAt)>time(result.resultRecordedAt)||result.scheduleChanged){reject('result_chronology_or_schedule_invalid');continue;}
    if(!probabilities||!SIDES.includes(row.selectedSide)||probabilities[row.selectedSide]!==Math.max(...Object.values(probabilities))){reject('invalid_primary_probabilities_or_pick');continue;}
    const game=JSON.stringify([row.league,row.gameId,new Date(time(row.startTime)).toISOString()]);
    eligible.push({row,result,probabilities,game});
  }
  const conflicts=new Set([...group(eligible,item=>item.game)].filter(([,items])=>new Set(items.map(item=>item.result.actualSide)).size>1).map(([key])=>key));
  const versions=Object.create(null);
  for(const [version,items] of group(eligible,item=>item.row.modelVersion)){
    versions[version]={};
    for(const name of COMPARATORS){
      const pairs=[],excluded={};const skip=reason=>{excluded[reason]=(excluded[reason]||0)+1;};
      for(const item of items){
        const {row,result,probabilities,game}=item;
        if(conflicts.has(game)){skip('conflicting_game_results');continue;}
        const candidate=vector(row.candidateProbabilities?.[name]||row.referenceBaselines?.[name]?.probabilities);
        if(!candidate){skip('reference_missing_or_invalid');continue;}
        if(name==='market'&&!marketVerified(row)){skip('offered_price_timestamps_unverified');continue;}
        if((probabilities.draw>0)!==(candidate.draw>0)){skip('outcome_space_mismatch');continue;}
        const sides=probabilities.draw>0||result.actualSide==='draw'?SIDES:['away','home'];
        pairs.push({game,eventDate:new Date(time(row.startTime)).toISOString().slice(0,10),primary:score(probabilities,result.actualSide,sides,row.selectedSide),reference:score(candidate,result.actualSide,sides),strata:strata(row)});
      }
      const by={};
      for(const key of ['sport','league','horizon','confidence','favorite','season','seasonPhase','rosterTransition','injuryCoverage','lineupCoverage','sourceFreshness','marketData'])
        by[key]=Object.fromEntries([...group(pairs,p=>p.strata[key])].map(([value,rows])=>[value,compare(rows,repetitions)]));
      versions[version][name]={...compare(pairs,repetitions),excluded,strata:by};
    }
  }
  return {schema:'sports-matched-journal-v1',asOf:new Date(asOf).toISOString(),inputRecords:records.length,
    visibleRecords:visible.length,unverifiableOrFutureRecordTimes:records.length-visible.length,
    selectedForecasts:first.size,conflictingGames:conflicts.size,rejections:rejects,byVersion:versions,
    selectionRule:'First issued forecast per guild/event/model-version/horizon; later revisions retained in journal but not selected.',
    weighting:'One weight per league/event/start time, shared across its guild/horizon observations; versions evaluated separately.',
    intervalMethod:`${repetitions} paired game-cluster bootstrap replicates; null below 8 games; descriptive, no multiple-testing correction`,
    scoreDefinition:'Mean-coordinate multiclass Brier; multinomial log loss clipped at 1e-12; selected-outcome calibration.',
    limitations:['No full frozen v6.0.0 baseline is reconstructed. Comparators are only vectors frozen at the same issuance.',
      'Cross-game day/team/league dependence remains; game-cluster intervals are not proof of deployable improvement.',
      'Market timestamp verification uses a declared 30-minute cutoff, not execution or independence proof.',
      'Caller must verify the append-only journal hash chain; this evaluator does not authenticate arbitrary input arrays.',
      'Reports do not select winners among models, promote models or establish wagering returns.'],promotionAllowed:false};
}
