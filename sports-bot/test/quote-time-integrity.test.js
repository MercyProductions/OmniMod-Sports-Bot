import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const directory=await mkdtemp(join(tmpdir(),'sports-quote-time-'));process.env.OMNIMOD_SPORTS_DATA_DIR=directory;
const {quoteTimeEpoch,quoteTimestampVerified}=await import('../src/oddsPricing.js');
const {bestH2HMarket}=await import('../src/sportsData.js');
const {predictGame}=await import('../src/predictionEngine.js');
const {analyzeOddsValue}=await import('../src/oddsValue.js');
const {recordPredictionJournal,readPredictionJournal}=await import('../src/predictionJournal.js');
const {recordSlateSnapshot,readFeatureWarehouse}=await import('../src/featureWarehouse.js');
test.after(()=>rm(directory,{recursive:true,force:true}));
const now=Date.parse('2026-10-20T18:00:00Z'),recent='2026-10-20T17:59:00Z';
const book=(key,time=recent)=>({key,title:key,markets:[{key:'h2h',last_update:time,outcomes:[{name:'Away',price:250},{name:'Home',price:-250}]}]});
function game(){return {id:'quote-time',league:'NBA',leagueKey:'nba',sportGroup:'Basketball',startTime:'2026-10-20T19:00:00Z',statusKey:'scheduled',away:{name:'Away',abbr:'A'},home:{name:'Home',abbr:'H'}};}
function priced(books=[book('one'),book('two')]){const g=game();g.odds={h2h:bestH2HMarket(books,g)};return g;}
const model={probabilities:{away:.35,home:.65},halfWidth:.04,evidenceQuality:85,calibrationSamples:100,outcomeValidationSamples:{away:80,home:80},outcomeCalibrationError:{away:.03,home:.03},recommendationStatus:'prediction',mode:'pregame'};

test('quote clocks require explicit timezone and real dates without permissive numeric coercion',()=>{
 for(const value of ['2026-10-20T17:59:00','2026-02-30T17:59:00Z','2026-13-01T00:00:00Z','2026-10-20','2026-10-20T24:00:00Z',true,now,{},null,''])assert.equal(Number.isFinite(quoteTimeEpoch(value)),false);
 assert.equal(quoteTimeEpoch('2026-10-20T12:59:00-05:00'),Date.parse(recent));assert.ok(Number.isFinite(quoteTimeEpoch('2024-02-29T00:00:00Z')));assert.equal(Number.isFinite(quoteTimeEpoch('2026-02-29T00:00:00Z')),false);
});

test('prediction mode uses the same injected cutoff as market evidence rather than the wall clock',()=>{
 assert.equal(predictGame(game(),0,{now}).predictionMode,'pregame');assert.equal(predictGame(game(),0,{now:Date.parse(game().startTime)+1}).predictionMode,'late_pregame');
});

test('untimestamped market aggregates cannot steer the ensemble',()=>{
 const g=game();g.odds={h2h:{bookmakerCount:3,away:{fairProbability:.2},home:{fairProbability:.8}}};const predicted=predictGame(g,0,{now});assert.equal(predicted.marketBlendWeight,0);assert.deepEqual(predicted.outcomeProbabilities,predictGame(game(),0,{now}).outcomeProbabilities);assert.ok(predicted.marketTimestampEvidence.reasons.includes('aggregate_quote_time_unverified'));
});

test('a new aggregate cannot hide an old contributing bookmaker quote',()=>{
 const g=priced();g.odds.h2h.home.quotes[0].lastUpdate='2026-10-20T10:00:00Z';const prediction=predictGame(g,0,{now});assert.equal(prediction.marketBlendWeight,0);assert.ok(prediction.marketTimestampEvidence.reasons.includes('contributing_quote_older_than_six_hours'));
});

test('aggregate oldest time is selected chronologically across timezone offsets',()=>{
 const old='2026-10-20T13:30:00+05:00',newer='2026-10-20T09:00:00-08:00',g=priced([book('old',old),book('new',newer)]);assert.equal(g.odds.h2h.lastUpdate,old);assert.equal(predictGame(g,0,{now}).marketBlendWeight,0);
});

test('timezone-ambiguous provider quote times cannot qualify a value decision',()=>{
 const g=priced([book('one','2026-10-20T17:59:00'),book('two','2026-10-20T17:59:00')]);assert.equal(analyzeOddsValue(g,model,{now}).bestOpportunity,null);assert.equal(predictGame(g,0,{now}).marketBlendWeight,0);
});

test('future invalid and causally inconsistent receipts block market blending and value qualification',()=>{
 for(const receipt of ['2026-10-20T18:01:00Z','2026-10-20T17:58:00Z',false,'not-a-clock']){
  const g=priced();g.odds.fetchedAt=receipt;const prediction=predictGame(g,0,{now});assert.equal(prediction.marketBlendWeight,0);assert.equal(analyzeOddsValue(g,model,{now}).bestOpportunity,null);assert.ok(prediction.marketTimestampEvidence.reasons.length);
 }
});

test('missing detailed quote times stay unknown even beneath a valid aggregate timestamp',()=>{
 const g=priced();delete g.odds.h2h.home.quotes[0].lastUpdate;const prediction=predictGame(g,0,{now});assert.equal(prediction.marketBlendWeight,0);assert.ok(prediction.marketTimestampEvidence.reasons.includes('contributing_quote_time_unverified'));
});

test('valid explicit times preserve supported market input and existing value arithmetic',()=>{
 const g=priced([book('one','2026-10-20T12:59:00-05:00'),book('two')]);g.odds.fetchedAt=new Date(now).toISOString();const prediction=predictGame(g,0,{now});assert.ok(prediction.marketBlendWeight>0);assert.equal(prediction.marketTimestampEvidence.eligible,true);assert.equal(prediction.marketTimestampEvidence.publicationTimeIndependentlyVerified,false);assert.ok(analyzeOddsValue(g,model,{now}).bestOpportunity);
 assert.equal(quoteTimestampVerified({timestampSource:'fetch_time',lastUpdate:recent}),false);assert.equal(quoteTimestampVerified({timestampSource:'provider_update',quotedAt:recent}),true);
});

test('journal cannot launder an ambiguous provider quote time into verified UTC',async()=>{
 const raw='2026-10-20T17:59:00',g=priced([book('one',raw),book('two',raw)]),prediction=predictGame(g,0,{now}),file=join(directory,'invalid-quote.jsonl');const slate={guildId:'journal-invalid',dateKey:'2026-10-20',generatedAt:new Date(now).toISOString(),games:[g],predictions:[prediction]};await recordPredictionJournal(slate,{file,now});const row=(await readPredictionJournal(file)).find(row=>row.type==='forecast');assert.ok(row);const quote=row.payload.odds.outcomes.home.offeredQuotes[0];assert.equal(quote.quotedAt,null);assert.equal(quote.originalQuotedAt,raw);assert.equal(quoteTimestampVerified(quote),false);
});

test('market time reasons are frozen in journal and warehouse without changing the forecast',async()=>{
 const g=priced();g.odds.fetchedAt='2026-10-20T18:01:00Z';const prediction=predictGame(g,0,{now}),file=join(directory,'evidence.jsonl'),slate={guildId:'evidence',dateKey:'2026-10-20',generatedAt:new Date(now).toISOString(),games:[g],predictions:[prediction]};await recordPredictionJournal(slate,{file,now});await recordSlateSnapshot(slate,{now});const before=(await readPredictionJournal(file)).find(row=>row.type==='forecast');assert.deepEqual(before.payload.marketTimestampEvidence,prediction.marketTimestampEvidence);assert.ok(before.payload.marketTimestampEvidence.reasons.includes('quote_receipt_after_information_cutoff'));assert.deepEqual((await readFeatureWarehouse()).predictions.find(row=>row.guildId==='evidence').marketTimestampEvidence,prediction.marketTimestampEvidence);g.odds.fetchedAt=recent;assert.deepEqual((await readPredictionJournal(file)).find(row=>row.type==='forecast'),before);
});
