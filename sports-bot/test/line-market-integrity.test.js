import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const directory=await mkdtemp(join(tmpdir(),'sports-line-markets-'));process.env.OMNIMOD_SPORTS_DATA_DIR=directory;
const {bestSpreadTotalMarkets,bestH2HMarket,buildDailySlate}=await import('../src/sportsData.js');
const {config}=await import('../src/config.js');
const {predictGame}=await import('../src/predictionEngine.js');
const {recordPredictionJournal,readPredictionJournal}=await import('../src/predictionJournal.js');
const {recordSlateSnapshot,captureMarketSnapshots,readFeatureWarehouse}=await import('../src/featureWarehouse.js');
test.after(()=>rm(directory,{recursive:true,force:true}));
const now=Date.parse('2026-10-20T18:00:00Z'),time='2026-10-20T17:59:00Z';
const game=()=>({id:'lines',league:'NBA',leagueKey:'nba',sportGroup:'Basketball',startTime:'2026-10-20T19:00:00Z',statusKey:'scheduled',away:{name:'Away',abbr:'A'},home:{name:'Home',abbr:'H'}});
const outcome=(name,point,price=-110)=>({name,point,price});
const book=(key,market,outcomes)=>({key,title:key,markets:[{key:market,last_update:time,outcomes}]});
const spreads=(key,home)=>book(key,'spreads',[outcome('Home',home),outcome('Away',-home)]);
const totals=(key,point)=>book(key,'totals',[outcome('Over',point),outcome('Under',point)]);
const select=rows=>bestSpreadTotalMarkets(rows,game());

test('spread selection retains both sides of one offered market instead of cross-book medians',()=>{
 const result=select([spreads('a',-3),spreads('b',-5),book('partial','spreads',[outcome('Away',5)])]);assert.equal(result.spread.home.point,-3);assert.equal(result.spread.away.point,3);assert.equal(result.spread.home.bookmakerKey,result.spread.away.bookmakerKey);assert.equal(result.spread.status,'complete');
});

test('total selection cannot join over and under at different bookmaker points',()=>{
 const result=select([totals('a',45),totals('b',47),book('partial','totals',[outcome('Over',47)])]);assert.equal(result.total.over.point,45);assert.equal(result.total.under.point,45);assert.equal(result.total.over.bookmakerKey,result.total.under.bookmakerKey);
});

test('conflicting duplicate line observations are excluded without skewing the representative',()=>{
 for(const rows of [[spreads('bad',-1),spreads('bad',-7),spreads('bad',-9),spreads('good',-3)],[spreads('good',-3),spreads('bad',-9),spreads('bad',-7),spreads('bad',-1)]]){const result=select(rows);assert.equal(result.spread.home.point,-3);assert.equal(result.spread.home.bookmakerKey,'good');assert.equal(result.integrity.spreads.rejectedBooks,1);}
});

test('inconsistent spread and total pairs are rejected instead of inventing a valid market',()=>{
 assert.equal(select([book('bad','spreads',[outcome('Away',3),outcome('Home',-4)])]).spread,null);assert.equal(select([book('bad','totals',[outcome('Over',45),outcome('Under',47)])]).total,null);
});

test('unknown aliases, substring over names and malformed points cannot become lines',()=>{
 for(const rows of [[book('bad','totals',[outcome('Overtime',45)])],[book('bad','spreads',[outcome('',3),outcome('Home',-3)])],[book('bad','totals',[outcome('Over',-1),outcome('Under',-1)])],[book('bad','spreads',[outcome('Away',true),outcome('Home',-1)])]]){const result=select(rows);assert.equal(result.spread,null);assert.equal(result.total,null);}
});

test('duplicate conflicting outcomes cannot choose a line by row order',()=>{
 for(const outcomes of [[outcome('Away',3),outcome('Away',5),outcome('Home',-3)],[outcome('Home',-3),outcome('Away',5),outcome('Away',3)]])assert.equal(select([book('bad','spreads',outcomes)]).spread,null);
});

test('identical markets and books coalesce and ties select deterministically',()=>{
 const a=spreads('a',-3),b=spreads('b',-5);for(const rows of [[b,a,a],[a,b,b]]){const result=select(rows);assert.equal(result.spread.home.point,-3);assert.equal(result.spread.bookmakerKey,'a');assert.equal(result.integrity.spreads.acceptedBooks,2);}
});

test('partial context remains one observed quote and never fabricates the missing side or favorite',()=>{
 const result=select([book('a','spreads',[outcome('Away',3)]),book('b','spreads',[outcome('Home',-5)])]);assert.equal(Object.hasOwn(result.spread,'away')&&Object.hasOwn(result.spread,'home'),false);assert.equal(result.spread.status,'partial_context');
 const positive=select([book('positive','spreads',[outcome('Away',3)])]);assert.equal(positive.spread.favorite,null);const g=game();g.odds={spread:positive.spread};assert.equal(predictGame(g,0,{now}).spreadLine,'Away +3 (partial quote)');
});

test('pick-em zero and actual offered prices remain visible without assigning a favorite',()=>{
 const result=select([book('zero','spreads',[outcome('Away',0,-105),outcome('Home',0,-115)])]),g=game();g.odds={spread:result.spread};assert.equal(result.spread.favorite,null);assert.equal(result.spread.home.price,-115);assert.equal(predictGame(g,0,{now}).spreadLine,'Pick em (0)');
});

test('h2h settlement classification does not attest bookmaker terms or execution',()=>{
 const g=game(),h2h=bestH2HMarket([book('one','h2h',[{name:'Away',price:250},{name:'Home',price:-250}])],g);assert.equal(h2h.rules,'full_game_2way');assert.equal(h2h.settlementEvidence.classificationSource,'sport_profile_and_outcome_set');assert.equal(h2h.settlementEvidence.bookSpecificTermsVerified,false);assert.equal(h2h.settlementEvidence.executionVerified,false);
});

test('journal and warehouse retain observed line and settlement evidence with the original forecast',async()=>{
 const g=game(),extra=select([spreads('bad',-1),spreads('bad',-7),spreads('good',-3)]),h2h=bestH2HMarket([book('one','h2h',[{name:'Away',price:250},{name:'Home',price:-250}])],g);g.odds={h2h,spread:extra.spread,lineMarketIntegrity:extra.integrity};const prediction=predictGame(g,0,{now}),slate={guildId:'line-evidence',dateKey:'2026-10-20',generatedAt:new Date(now).toISOString(),games:[g],predictions:[prediction]},file=join(directory,'lines.jsonl');await recordPredictionJournal(slate,{file,now});await recordSlateSnapshot(slate,{now});await captureMarketSnapshots([g],{guildId:slate.guildId,dateKey:slate.dateKey,capturedAt:slate.generatedAt});const forecast=(await readPredictionJournal(file)).find(row=>row.type==='forecast');assert.equal(forecast.payload.odds.lineMarketIntegrity.spreads.rejectedBooks,1);assert.equal(forecast.payload.odds.lineMarkets.spread.home.point,-3);assert.equal(forecast.payload.odds.settlementEvidence.bookSpecificTermsVerified,false);const warehouse=await readFeatureWarehouse();assert.equal(warehouse.predictions.find(row=>row.guildId===slate.guildId).lineMarketIntegrity.spreads.rejectedBooks,1);assert.equal(warehouse.markets.find(row=>row.guildId===slate.guildId).settlementEvidence.bookSpecificTermsVerified,false);assert.deepEqual(forecast.payload.outcomePercentages,{...prediction.outcomeProbabilities,draw:prediction.outcomeProbabilities.draw??null});
});

test('actual daily enrichment retains one offered line pair and explicit settlement assumptions',async()=>{
 const originalFetch=globalThis.fetch,auto=config.autoEnrichEnabled,local=config.localOnly;config.autoEnrichEnabled=false;config.localOnly=false;
 const books=[spreads('a',-3),spreads('b',-5),book('partial','spreads',[outcome('Away',5)])];for(const row of books.slice(0,2))row.markets.push({key:'h2h',last_update:time,outcomes:[{name:'Away',price:250},{name:'Home',price:-250}]});
 globalThis.fetch=async raw=>{const url=new URL(raw),body=url.hostname==='api.the-odds-api.com'?[{id:'provider',sport_key:'basketball_nba',commence_time:game().startTime,away_team:'Away',home_team:'Home',bookmakers:books}]:{events:url.pathname.includes('/basketball/nba/scoreboard')?[{id:'lines',date:game().startTime,status:{type:{name:'STATUS_SCHEDULED',state:'pre'}},competitions:[{competitors:[{homeAway:'away',team:{displayName:'Away',abbreviation:'A'}},{homeAway:'home',team:{displayName:'Home',abbreviation:'H'}}]}]}]:[]};return new Response(JSON.stringify(body),{status:200,headers:{'content-type':'application/json'}});};
 try{const result=await buildDailySlate(new Date(now),{guildId:'line-builder',oddsApiKey:'synthetic-test-key',useOddsApi:true});assert.equal(result.games.length,1);const odds=result.games[0].odds;assert.equal(odds.spread.away.point,3);assert.equal(odds.spread.home.point,-3);assert.equal(odds.spread.status,'complete');assert.equal(odds.lineMarketIntegrity.spreads.acceptedBooks,3);assert.equal(odds.h2h.settlementEvidence.bookSpecificTermsVerified,false);}finally{globalThis.fetch=originalFetch;config.autoEnrichEnabled=auto;config.localOnly=local;}
});
