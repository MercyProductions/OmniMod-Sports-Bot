import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {bestH2HMarket} from '../src/sportsData.js';
import {analyzeOddsValue} from '../src/oddsValue.js';
import {recordPredictionJournal,readPredictionJournal} from '../src/predictionJournal.js';
import {evaluatePriceResearch} from '../src/priceResearch.js';

const issue='2099-02-01T18:00:00Z',start='2099-02-01T19:00:00Z',quoteAt='2099-02-01T17:59:00Z',receivedAt='2099-02-01T17:59:30.000Z';
const options={costs:{feePerStake:.01,commissionOnProfit:.02,profitHaircut:.01},asOf:Date.parse('2099-02-01T18:30:00Z')};
const receipt=at=>({schema:'sports-local-odds-receipt-v1',fetchedAt:at,timestampStatus:'explicit_zone',kind:'local_fetch_receipt_not_provider_publication'});
const evaluate=rows=>evaluatePriceResearch(rows,options);
function slate(now=issue,received=receivedAt,quoted=quoteAt){
 const book=(key,away,home)=>({key,title:key,markets:[{key:'h2h',last_update:quoted,outcomes:[{name:'Away',price:away},{name:'Home',price:home}]}]});
 const game={id:'receipt',leagueKey:'nba',league:'NBA',sportGroup:'Basketball',startTime:start,statusKey:'scheduled',away:{name:'Away',abbr:'A'},home:{name:'Home',abbr:'H'}};
 game.odds={h2h:bestH2HMarket([book('a',250,-250),book('b',240,-240)],game,{asOf:Date.parse(now)}),eventId:'provider-receipt',commenceTime:start,matchStatus:'matched',cacheState:'network',fetchedAt:received};
 const model={probabilities:{away:.35,home:.65},halfWidth:.04,evidenceQuality:85,calibrationSamples:100,outcomeValidationSamples:{away:80,home:80},outcomeCalibrationError:{away:.03,home:.03},recommendationStatus:'prediction',mode:'pregame'};
 const prediction={gameId:game.id,leagueKey:'nba',startTime:start,modelVersion:'receipt-fixture',predictionGeneratedAt:now,predictionMode:'pregame',outcomeProbabilities:{away:35,home:65},predictedSide:'home',predictionProbability:65,valueAnalysis:analyzeOddsValue(game,model,{now:Date.parse(now)})};
 return {guildId:'receipt-fixture',dateKey:'2099-02-01',generatedAt:now,games:[game],predictions:[prediction]};
}
function rows(){
 const quote=price=>({originalPrice:price,originalFormat:'american',bookmakerKey:'a',bookmaker:'A',quotedAt:quoteAt,timestampSource:'provider_update'});
 const payload={forecastId:'f',gameId:'g',guildId:'guild',league:'nba',modelVersion:'fixture',horizon:'T-90',modeledOutcomes:['away','home'],lifecycleState:'ISSUED',recordEligibility:'observed_pregame',predictionGeneratedAt:issue,startTime:start,outcomePercentages:{away:45,home:55,draw:0},valueDecision:{side:'home',status:'research_opportunity',evaluatedAt:issue,quote:quote(150)},odds:{rules:'full_game_2way',cacheState:'network',sourceReceipt:receipt(receivedAt),identity:{localGameId:'g',league:'nba',providerEventId:'provider-g',providerStartTime:start,matchStatus:'matched'},outcomes:{home:{offeredQuotes:[quote(150)]},away:{offeredQuotes:[quote(-180)]}}}};
 return [{type:'forecast',recordedAt:issue,payload}];
}
async function fileFixture(t){const directory=await mkdtemp(join(tmpdir(),'sports-price-receipt-'));t.after(()=>rm(directory,{recursive:true,force:true}));return join(directory,'journal.jsonl');}

test('actual issue and linked quote refresh freeze distinct local fetch receipts without rewriting the original',async t=>{
 const file=await fileFixture(t),initial=slate();
 assert.ok(initial.predictions[0].valueAnalysis.bestOpportunity);
 await recordPredictionJournal(initial,{file,now:Date.parse(issue)});
 const original=await readFile(file,'utf8'),issued=(await readPredictionJournal(file)).find(row=>row.type==='forecast');
 assert.deepEqual(issued.payload.odds.sourceReceipt,receipt(receivedAt));
 const later='2099-02-01T18:05:00Z',refresh=slate(later,'2099-02-01T18:04:30Z','2099-02-01T18:04:00Z');
 Object.assign(refresh.predictions[0],{quoteRefreshOnly:true,snapshotStage:'quote-refresh',originalForecastGeneratedAt:issue,originalForecastHorizon:'T-90'});
 await recordPredictionJournal(refresh,{file,now:Date.parse(later),lifecycle:'prices_only'});
 const records=await readPredictionJournal(file),price=records.find(row=>row.type==='price_observation');
 assert.deepEqual(price.payload.odds.sourceReceipt,receipt('2099-02-01T18:04:30.000Z'));
 assert.ok((await readFile(file,'utf8')).startsWith(original));
 const report=evaluate(records);
 assert.equal(report.scenarios.length,1);
 assert.deepEqual(report.scenarios[0].sourceReceipt,receipt(receivedAt));
 assert.equal(report.scenarios[0].outcome,'unresolved');
 assert.equal(report.actualPaperPerformance,null);
});

test('missing or unverifiable local provider receipts cannot certify qualified frozen price decisions',()=>{
 for(const value of [undefined,null,{},receipt('2099-02-01'),receipt('2099-02-01T17:59:30'),{...receipt(receivedAt),kind:'publication_time'},{...receipt(receivedAt),timestampStatus:'unknown'}]){
  const data=rows();data[0].payload.odds.sourceReceipt=value;
  const report=evaluate(data);
  assert.equal(report.scenarios.length,0);
  assert.equal(report.rejections.provider_receipt_unverified,1);
 }
});

test('a linked later price observation may use new prices without retiming the original model',async t=>{
 const file=await fileFixture(t),initial=slate();initial.predictions[0].valueAnalysis.bestOpportunity=null;
 await recordPredictionJournal(initial,{file,now:Date.parse(issue)});
 const later='2099-02-01T18:05:00Z',refresh=slate(later,'2099-02-01T18:04:30Z','2099-02-01T18:04:00Z');
 Object.assign(refresh.predictions[0],{quoteRefreshOnly:true,snapshotStage:'quote-refresh',originalForecastGeneratedAt:issue,originalForecastHorizon:'T-90'});
 await recordPredictionJournal(refresh,{file,now:Date.parse(later),lifecycle:'prices_only'});
 const records=await readPredictionJournal(file),report=evaluate(records),forecasts=records.filter(row=>row.type==='forecast');
 assert.equal(forecasts.length,1);
 assert.equal(forecasts[0].payload.predictionGeneratedAt,new Date(issue).toISOString());
 assert.equal(report.scenarios.length,1);
 assert.equal(report.scenarios[0].decisionAt,new Date(later).toISOString());
 assert.equal(report.scenarios[0].sourceReceipt.fetchedAt,'2099-02-01T18:04:30.000Z');
 assert.equal(report.scenarios[0].probability,.35);
});

test('missing and invalid input receipts stay unknown without suppressing a valid non-wager forecast or echoing input text',async t=>{
 const file=await fileFixture(t);
 for(const [index,value] of [undefined,'private-invalid-receipt-marker','2099-02-01T17:59:30'].entries()){
  const initial=slate();initial.guildId+='-'+index;initial.games[0].odds.fetchedAt=value;
  await recordPredictionJournal(initial,{file,now:Date.parse(issue)});
 }
 const records=await readPredictionJournal(file),forecasts=records.filter(row=>row.type==='forecast');
 assert.equal(forecasts.length,3);
 assert.deepEqual(forecasts.map(row=>row.payload.odds.sourceReceipt.timestampStatus),['missing','invalid','invalid']);
 assert.ok(forecasts.every(row=>row.payload.odds.sourceReceipt.fetchedAt===null&&row.payload.recordEligibility==='observed_pregame'));
 assert.ok(!(await readFile(file,'utf8')).includes('private-invalid-receipt-marker'));
 const report=evaluate(records);
 assert.equal(report.scenarios.length,0);
 assert.equal(report.rejections.provider_receipt_unverified,3);
});

test('an old provider quote fetched after its frozen evaluation cannot be used as earlier available information',()=>{
 const data=rows();data[0].payload.odds.sourceReceipt=receipt('2099-02-01T18:00:01Z');
 const report=evaluate(data);
 assert.equal(report.scenarios.length,0);
 assert.equal(report.rejections.provider_receipt_after_decision,1);
});

test('provider update times after the local fetch cannot be certified by a later journal append',()=>{
 const data=rows();data[0].payload.odds.sourceReceipt=receipt('2099-02-01T17:58:59Z');
 const report=evaluate(data);
 assert.equal(report.scenarios.length,0);
 assert.equal(report.rejections.quote_update_after_provider_receipt,1);
});

test('equivalent explicit receipt instants preserve cost assumptions and immutable input records',()=>{
 const data=rows();data[0].payload.odds.sourceReceipt=receipt('2099-02-01T11:59:30-06:00');
 const before=structuredClone(data),report=evaluate(data);
 assert.equal(report.scenarios.length,1);
 assert.equal(report.scenarios[0].sourceReceipt.fetchedAt,'2099-02-01T17:59:30.000Z');
 assert.equal(report.scenarios[0].sourceReceiptAgeMs,30_000);
 assert.equal(report.scenarios[0].quoteToReceiptLagMs,30_000);
 assert.deepEqual(report.costAssumptions,options.costs);
 assert.deepEqual(data,before);
});

test('an identical legacy issue retry cannot backfill a missing provider receipt or change journal bytes',async t=>{
 const file=await fileFixture(t),initial=slate();await recordPredictionJournal(initial,{file,now:Date.parse(issue)});
 const records=await readPredictionJournal(file);let previousHash=null;
 const legacy=records.map(({eventHash,...row})=>{if(row.payload.odds)delete row.payload.odds.sourceReceipt;row.previousHash=previousHash;previousHash=createHash('sha256').update(JSON.stringify(row)).digest('hex');return JSON.stringify({...row,eventHash:previousHash});}).join('\n')+'\n';
 await writeFile(file,legacy);
 await recordPredictionJournal(initial,{file,now:Date.parse(issue)});
 assert.equal(await readFile(file,'utf8'),legacy);
 const report=evaluate(await readPredictionJournal(file));
 assert.equal(report.scenarios.length,0);
 assert.equal(report.rejections.provider_receipt_unverified,1);
});
