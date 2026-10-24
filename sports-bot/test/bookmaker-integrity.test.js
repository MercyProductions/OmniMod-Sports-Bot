import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
const directory=await mkdtemp(join(tmpdir(),'sports-book-integrity-'));process.env.OMNIMOD_SPORTS_DATA_DIR=directory;
const {bestH2HMarket,bestSpreadTotalMarkets,buildDailySlate}=await import('../src/sportsData.js');
const {refreshValueQuotes}=await import('../src/valueQuoteRefresh.js');
const {config}=await import('../src/config.js');
test.after(()=>rm(directory,{recursive:true,force:true}));
const now=Date.parse('2026-10-20T18:00:00Z'),startTime='2026-10-20T19:00:00Z',quotedAt='2026-10-20T17:59:30Z';
const game=(patch={})=>({id:'game',league:'NBA',leagueKey:'nba',sportGroup:'Basketball',startTime,statusKey:'scheduled',away:{name:'Away',abbr:'A'},home:{name:'Home',abbr:'H'},...patch});
const outcome=(name,price)=>({name,price});
const book=(key='one',outcomes=[outcome('Away',250),outcome('Home',-250)])=>({key,title:key,markets:[{key:'h2h',last_update:quotedAt,outcomes}]});
const market=books=>bestH2HMarket(books,game());
const rejected=(result,reason)=>assert.ok(result.bookmakerIntegrity.observations.some(row=>row.status==='rejected'&&row.reason===reason));
function slate(){const g=game(),generatedAt='2026-10-20T17:00:00Z';return {guildId:'books-'+randomUUID(),dateKey:'2026-10-20',generatedAt,games:[g],predictions:[{gameId:g.id,leagueKey:g.leagueKey,startTime,modelVersion:'books-fixture',predictionGeneratedAt:generatedAt,predictionMode:'pregame',predictedSide:'home',outcomeProbabilities:{away:35,home:65},predictionUncertaintyPoints:4,evidenceQualityValue:85,calibrationSampleSize:100,outcomeValidationSamples:{away:80,home:80},outcomeCalibrationError:{away:.03,home:.03},recommendationStatus:'prediction'}]};}
const options=books=>({refresh:true,admin:true,localOnly:false,oddsApiKey:'synthetic-test-key',dailyCap:1,cooldownMinutes:5,directory:join(directory,randomUUID()),now,fetchJson:async()=>({ok:true,status:200,cacheState:'network',fetchedAt:new Date(now).toISOString(),json:[{id:'provider',sport_key:'basketball_nba',commence_time:startTime,away_team:'Away',home_team:'Home',bookmakers:books}]})});

test('conflicting duplicate outcomes reject a book instead of letting the last row set its price',()=>{
 const rows=[outcome('Away',250),outcome('Away',150),outcome('Home',-250)];for(const outcomes of [rows,[...rows].reverse()]){const result=market([book('bad',outcomes)]);assert.equal(result.bookmakerCount,0);rejected(result,'conflicting_duplicate_outcome');}
});

test('identical duplicate outcomes coalesce without increasing book count or changing probabilities',()=>{
 const expected=market([book()]),actual=market([book('one',[outcome('Away',250),outcome('Home',-250),outcome('Away',250)])]);assert.equal(actual.bookmakerCount,1);assert.equal(actual.away.price,expected.away.price);assert.equal(actual.home.fairProbability,expected.home.fairProbability);
});

test('unknown or malformed extra outcomes cannot be skipped to manufacture a complete book',()=>{
 for(const extra of [outcome('Other team',120),outcome('Away','bad'),null]){const result=market([book('bad',[outcome('Away',250),outcome('Home',-250),extra])]);assert.equal(result.bookmakerCount,0);assert.equal(result.bookmakerIntegrity.rejectedBooks,1);}
});

test('shared team aliases and missing outcome names cannot be assigned to the away side',()=>{
 const ambiguous=bestH2HMarket([book('bad',[outcome('X',250),outcome('Home',-250)])],game({away:{name:'Away',abbr:'X'},home:{name:'Home',abbr:'X'}}));assert.equal(ambiguous.bookmakerCount,0);rejected(ambiguous,'ambiguous_outcome_alias');
 const missing=bestH2HMarket([book('bad',[{price:250},outcome('Home',-250)])],game({away:{name:'Away'}}));assert.equal(missing.bookmakerCount,0);
});

test('conflicting bookmaker observations are excluded independently of array order',()=>{
 const first=book('bad'),second=book('bad',[outcome('Away',150),outcome('Home',-250)]),good=book('good');const expected=market([good]);
 for(const rows of [[first,second,good],[second,first,good]]){const actual=market(rows);assert.equal(actual.bookmakerCount,1);assert.equal(actual.away.fairProbability,expected.away.fairProbability);assert.equal(actual.away.bookmakerKey,'good');rejected(actual,'conflicting_bookmaker_observations');}
});

test('conflicting duplicate h2h markets cannot use first-market precedence',()=>{
 const first=book().markets[0],second=book('one',[outcome('Away',150),outcome('Home',-250)]).markets[0];for(const markets of [[first,second],[second,first]]){const actual=market([{key:'one',markets}]);assert.equal(actual.bookmakerCount,0);rejected(actual,'conflicting_bookmaker_observations');}
});

test('malformed bookmaker market and outcome collections fail locally without throwing',()=>{
 for(const rows of [{},[null],[{}],[{key:'bad',markets:{}}],[{key:'bad',markets:[null]}],[{key:'bad',markets:[{key:'h2h',outcomes:{}}]}]])assert.equal(market(rows).bookmakerCount,0);
 for(const rows of [{},[null],[{key:'bad',markets:{}}],[{key:'bad',markets:[null,{key:'spreads',outcomes:[null]}]}]])assert.doesNotThrow(()=>bestSpreadTotalMarkets(rows,game()));
});

test('provider keys identify books while duplicate key variants and identical markets coalesce',()=>{
 const missing=market([{title:'Label only',markets:book().markets}]);assert.equal(missing.bookmakerCount,0);rejected(missing,'provider_bookmaker_key_missing');
 const first=book('ONE'),second=book('one');second.markets.push(structuredClone(second.markets[0]));const result=market([first,second]);assert.equal(result.bookmakerCount,1);assert.equal(result.away.bookmakerKey,'one');assert.equal(result.bookmakerIntegrity.observations[0].coalescedMarketCount,3);
});

test('incomplete duplicate fragments cannot be assembled into one complete bookmaker',()=>{
 const result=market([book('fragment',[outcome('Away',250)]),book('fragment',[outcome('Home',-250)])]);assert.equal(result.bookmakerCount,0);rejected(result,'incomplete_or_wrong_outcome_set');
});

test('complete two-way and three-way books preserve original prices and normalized margin arithmetic',()=>{
 const two=market([book('fair',[outcome('Away',200),outcome('Home',-150)])]);assert.equal(two.away.price,200);assert.ok(Math.abs(two.away.fairProbability-(1/3)/(1/3+.6))<1e-12);
 const soccer=bestH2HMarket([book('three',[outcome('Away',200),outcome('Home',100),outcome('Draw',300)])],game({sportGroup:'Soccer',leagueKey:'epl'}));assert.equal(soccer.bookmakerCount,1);assert.ok(Math.abs(soccer.away.fairProbability+soccer.home.fairProbability+soccer.draw.fairProbability-1)<1e-12);assert.equal(soccer.rules,'regulation_3way');
});

test('actual quote refresh cannot count a conflicted book toward the two-book value gate',async()=>{
 const result=await refreshValueQuotes(slate(),options([book('bad'),book('bad',[outcome('Away',150),outcome('Home',-250)]),book('good')]));assert.equal(result.status,'fresh');assert.equal(result.slate.games[0].odds.bookmakerCount,1);assert.equal(result.slate.predictions[0].valueAnalysis.bestOpportunity,null);assert.equal(result.oddsMatchAudit[0].bookmakerIntegrity.rejectedBooks,1);
});

test('journal and warehouse preserve bookmaker rejection evidence with frozen price observations',async()=>{
 const {recordPredictionJournal,readPredictionJournal}=await import('../src/predictionJournal.js');const {recordSlateSnapshot,captureMarketSnapshots,readFeatureWarehouse}=await import('../src/featureWarehouse.js');const original=slate(),file=join(directory,'book-journal.jsonl');await recordPredictionJournal(original,{file,now});const before=(await readPredictionJournal(file)).find(row=>row.type==='forecast');
 const refreshed=await refreshValueQuotes(original,options([book('bad'),book('bad',[outcome('Away',150),outcome('Home',-250)]),book('good'),book('second')]));await recordPredictionJournal(refreshed.issuedSlate,{file,now:now+1000,lifecycle:'prices_only'});await recordSlateSnapshot(refreshed.issuedSlate,{now:now+1000});await captureMarketSnapshots(refreshed.issuedSlate.games,{guildId:original.guildId,dateKey:original.dateKey,capturedAt:new Date(now).toISOString()});
 const records=await readPredictionJournal(file);assert.equal(records.find(row=>row.type==='price_observation').payload.odds.bookmakerIntegrity.rejectedBooks,1);assert.deepEqual(records.find(row=>row.type==='forecast'),before);const warehouse=await readFeatureWarehouse();assert.equal(warehouse.predictions.find(row=>row.guildId===original.guildId).bookmakerIntegrity.acceptedBooks,2);assert.equal(warehouse.markets.find(row=>row.guildId===original.guildId).bookmakerIntegrity.rejectedBooks,1);
});

test('actual daily builder isolates malformed bookmaker payloads rather than crashing the slate',async()=>{
 const originalFetch=globalThis.fetch,auto=config.autoEnrichEnabled,local=config.localOnly;config.autoEnrichEnabled=false;config.localOnly=false;globalThis.fetch=async raw=>{const url=new URL(raw);const data=url.hostname==='api.the-odds-api.com'?[{id:'provider',sport_key:'basketball_nba',commence_time:startTime,away_team:'Away',home_team:'Home',bookmakers:{broken:true}}]:{events:url.pathname.includes('/basketball/nba/scoreboard')?[{id:'game',date:startTime,status:{type:{name:'STATUS_SCHEDULED',state:'pre'}},competitions:[{competitors:[{homeAway:'away',team:{displayName:'Away',abbreviation:'A'}},{homeAway:'home',team:{displayName:'Home',abbreviation:'H'}}]}]}]:[]};return new Response(JSON.stringify(data),{status:200,headers:{'content-type':'application/json'}});};
 try{const result=await buildDailySlate(new Date(now),{guildId:'builder-'+randomUUID(),oddsApiKey:'synthetic-test-key',useOddsApi:true});assert.equal(result.games.length,1);assert.equal(result.games[0].odds.h2h.bookmakerCount,0);assert.equal(result.games[0].oddsBookmakerEvidence.observations[0].reason,'invalid_bookmaker_collection');}finally{globalThis.fetch=originalFetch;config.autoEnrichEnabled=auto;config.localOnly=local;}
});
