import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
const directory=await mkdtemp(join(tmpdir(),'sports-scoped-quotes-'));process.env.OMNIMOD_SPORTS_DATA_DIR=directory;
const {refreshValueQuotes}=await import('../src/valueQuoteRefresh.js');
const {mergeValueQuoteRefresh,refreshScopedPredictionValues}=await import('../src/quoteRefreshIdentity.js');
const {persistValueQuoteRefresh}=await import('../src/quoteCachePersistence.js');
const {recordPredictionJournal,readPredictionJournal}=await import('../src/predictionJournal.js');
const {writeDailyCache,readDailyCache}=await import('../src/storage.js');
test.after(()=>rm(directory,{recursive:true,force:true}));
const now=Date.parse('2026-10-20T18:00:00Z'),generatedAt=new Date(now-3600000).toISOString(),startTime=new Date(now+3600000).toISOString();
function game(leagueKey='nba',start=startTime){return {id:'shared',leagueKey,sportGroup:leagueKey==='nba'?'Basketball':'Hockey',startTime:start,statusKey:'scheduled',away:{name:'Away',abbr:'A'},home:{name:'Home',abbr:'H'},odds:{eventId:leagueKey+'-'+start}};}
function prediction(g){return {gameId:g.id,leagueKey:g.leagueKey,startTime:g.startTime,predictionGeneratedAt:generatedAt,predictionMode:'pregame',modelVersion:'scope-test',predictedSide:'home',outcomeProbabilities:{away:35,home:65},predictionUncertaintyPoints:4,evidenceQualityValue:85,calibrationSampleSize:100,outcomeValidationSamples:{away:80,home:80},outcomeCalibrationError:{away:0.03,home:0.03},recommendationStatus:'prediction'};}
function slate(games=[game()]){return {guildId:'quotes-'+randomUUID(),dateKey:'2026-10-20',generatedAt,games,predictions:games.map(prediction)};}
function result(games){return {ok:true,status:200,cacheState:'network',fetchedAt:new Date(now).toISOString(),json:games.map((g,i)=>({id:g.odds.eventId,commence_time:g.startTime,away_team:'Away',home_team:'Home',bookmakers:['one','two'].map(key=>({key,title:key,last_update:new Date(now-30000).toISOString(),markets:[{key:'h2h',last_update:new Date(now-30000).toISOString(),outcomes:[{name:'Away',price:250+i*10},{name:'Home',price:-250}]}]}))}))};}
const options=(extra={})=>({refresh:true,admin:true,localOnly:false,oddsApiKey:'synthetic-test-key',dailyCap:2,cooldownMinutes:5,directory:join(directory,randomUUID()),now,...extra});

test('quote selection cannot let one league forecast qualify another league with the same native ID',async()=>{
 const value=slate([game(),game('nhl')]);value.predictions=value.predictions.filter(row=>row.leagueKey==='nhl');let calls=0;
 const refreshed=await refreshValueQuotes(value,options({league:'nba',fetchJson:async()=>{calls++;return result(value.games);}}));assert.equal(refreshed.status,'no_eligible_games');assert.equal(calls,0);
});

test('league-scoped updates preserve the other league and issue only the intended price snapshot',async()=>{
 const value=slate([game(),game('nhl')]),before=structuredClone(value),refreshed=await refreshValueQuotes(value,options({league:'nba',fetchJson:async()=>result([value.games[0]])}));
 assert.equal(refreshed.status,'fresh');assert.equal(refreshed.issuedSlate.predictions.length,1);assert.equal(refreshed.issuedSlate.predictions[0].leagueKey,'nba');assert.deepEqual(refreshed.slate.games[1],before.games[1]);assert.deepEqual(refreshed.slate.predictions[1],before.predictions[1]);assert.deepEqual(value,before);
});

test('different scheduled starts sharing a native ID retain their own quote markets',async()=>{
 const value=slate([game(),game('nba',new Date(now+5400000).toISOString())]);const refreshed=await refreshValueQuotes(value,options({fetchJson:async()=>result(value.games)}));
 assert.equal(refreshed.issuedSlate.predictions.length,2);assert.equal(refreshed.slate.games[0].odds.eventId,value.games[0].odds.eventId);assert.equal(refreshed.slate.games[1].odds.eventId,value.games[1].odds.eventId);assert.notEqual(refreshed.slate.games[0].odds.eventId,refreshed.slate.games[1].odds.eventId);
});

test('missing or mismatched forecast scope cannot consume quote credits',async()=>{
 for(const patch of [{leagueKey:''},{leagueKey:'nhl'},{startTime:null},{startTime:new Date(now+7200000).toISOString()}]){
  const value=slate();Object.assign(value.predictions[0],patch);let calls=0;const refreshed=await refreshValueQuotes(value,options({fetchJson:async()=>{calls++;return result(value.games);}}));assert.equal(refreshed.status,'no_eligible_games');assert.equal(calls,0);
 }
});

test('conflicting same-event predictions and source observations cannot be chosen by array order',async()=>{
 for(const kind of ['prediction','game']){
  const value=slate();if(kind==='prediction')value.predictions.push({...value.predictions[0],outcomeProbabilities:{away:60,home:40}});else value.games.push({...value.games[0],detail:'incompatible observation'});
  const refreshed=await refreshValueQuotes(value,options({fetchJson:async()=>{throw new Error('Provider must not be called');}}));assert.equal(refreshed.status,'no_eligible_games');assert.equal(refreshed.externalCalls,0);
 }
});

test('caller mutation during the provider wait cannot alter the frozen request or returned forecast',async()=>{
 const value=slate(),before=structuredClone(value);let release,entered;const waiting=new Promise(resolve=>entered=resolve),barrier=new Promise(resolve=>release=resolve);
 const args=options({fetchJson:async()=>{entered();await barrier;return result(before.games);}}),pending=refreshValueQuotes(value,args);await waiting;value.games[0].startTime='2099-01-01T00:00:00Z';value.predictions[0].outcomeProbabilities.home=99;args.now=now+99999999;release();const refreshed=await pending;
 assert.equal(refreshed.status,'fresh');assert.deepEqual(refreshed.slate.predictions[0].outcomeProbabilities,before.predictions[0].outcomeProbabilities);assert.equal(refreshed.slate.games[0].startTime,startTime);assert.equal(refreshed.issuedSlate.generatedAt,new Date(now).toISOString());
});

test('a game that starts while waiting for quotes cannot issue a pregame price decision',async()=>{
 const original=Date.now;let clock=now;Date.now=()=>clock;
 try{const value=slate(),args=options({fetchJson:async()=>{clock=now+7200000;return result(value.games);}});delete args.now;const refreshed=await refreshValueQuotes(value,args);assert.equal(refreshed.issuedSlate,null);assert.equal(refreshed.externalCalls,1);assert.equal(refreshed.status,'unmatched');}finally{Date.now=original;}
});

test('cache merge respects event scope, frozen model identity and newer quote receipts',async()=>{
 const value=slate([game(),game('nhl')]),refreshed=await refreshValueQuotes(value,options({league:'nba',fetchJson:async()=>result([value.games[0]])}));
 const merged=mergeValueQuoteRefresh(value,refreshed,now);assert.equal(merged.games[0].odds.quoteRefreshOnly,true);assert.deepEqual(merged.games[1].odds,value.games[1].odds);
 const changed=structuredClone(value);changed.predictions[0].outcomeProbabilities={away:60,home:40};const keep=mergeValueQuoteRefresh(changed,refreshed,now);assert.equal(keep.games[0].odds.quoteRefreshOnly,undefined);assert.deepEqual(keep.predictions[0].outcomeProbabilities,changed.predictions[0].outcomeProbabilities);
 const newer=structuredClone(value);newer.games[0].odds={fetchedAt:new Date(now+1000).toISOString(),eventId:'newer'};assert.equal(mergeValueQuoteRefresh(newer,refreshed,now+2000).games[0].odds.eventId,'newer');
 for(const patch of [{statusKey:'final'},{away:{name:'Different team'}}]){const changedEvent=structuredClone(value);Object.assign(changedEvent.games[0],patch);assert.equal(mergeValueQuoteRefresh(changedEvent,refreshed,now).games[0].odds.quoteRefreshOnly,undefined);}
 assert.equal(mergeValueQuoteRefresh(value,refreshed,now+7200000).games[0].odds.quoteRefreshOnly,undefined);
 const other=structuredClone(value);other.guildId='other';assert.deepEqual(mergeValueQuoteRefresh(other,refreshed,now),other);
});

test('ordinary value views reject ambiguous joins and apply the age limit to original model timestamps',()=>{
 const ambiguous=slate([game(),game('nhl')]);delete ambiguous.predictions[0].leagueKey;const view=refreshScopedPredictionValues(ambiguous,now);assert.equal(view.predictions[0].valueAnalysis,null);assert.deepEqual(view.predictions[1].outcomeProbabilities,ambiguous.predictions[1].outcomeProbabilities);
 const old=slate();old.predictions[0].predictionGeneratedAt=new Date(now-7*3600000).toISOString();const values=refreshScopedPredictionValues(old,now);assert.equal(values.predictions[0].valueAnalysis.bestOpportunity,null);assert.ok(values.predictions[0].valueAnalysis.outcomes.every(row=>row.reasons.includes('reused model is older than six hours or has unknown age')));
});

test('scoped cache persistence and journal price observations retain the original event and forecast',async()=>{
 const value=slate([game(),game('nhl')]),file=join(directory,'scoped-prices.jsonl');await recordPredictionJournal(value,{file,now});await writeDailyCache(value.dateKey,value,value.guildId);
 const refreshed=await refreshValueQuotes(value,options({league:'nba',fetchJson:async()=>result([value.games[0]])}));await recordPredictionJournal(refreshed.issuedSlate,{file,now:now+1000,lifecycle:'prices_only'});
 const latest=await readDailyCache(value.dateKey,value.guildId),merged=mergeValueQuoteRefresh(latest,refreshed,now);await writeDailyCache(value.dateKey,merged,value.guildId);const saved=await readDailyCache(value.dateKey,value.guildId),records=await readPredictionJournal(file);
 assert.equal(records.filter(r=>r.type==='forecast').length,2);const prices=records.filter(r=>r.type==='price_observation');assert.equal(prices.length,1);const forecast=records.find(r=>r.type==='forecast'&&r.payload.forecastId===prices[0].payload.sourceForecastId);assert.equal(forecast.payload.league,'nba');assert.deepEqual(saved.predictions[0].outcomeProbabilities,value.predictions[0].outcomeProbabilities);assert.deepEqual(saved.games[1].odds,value.games[1].odds);
});

test('identical duplicate observations coalesce without repeating a value-board opportunity',async()=>{
 const value=slate();value.games.push(structuredClone(value.games[0]));value.predictions.push(structuredClone(value.predictions[0]));let calls=0;
 const refreshed=await refreshValueQuotes(value,options({fetchJson:async()=>{calls++;return result([value.games[0]]);}}));assert.equal(calls,1);assert.equal(refreshed.issuedSlate.predictions.length,1);assert.equal(refreshScopedPredictionValues(refreshed.slate,now).predictions.length,1);
});

test('a cache race retries price persistence without another provider call or loss of unrelated finals',async()=>{
 let value=slate([game(),game('nhl')]);value=await writeDailyCache(value.dateKey,value,value.guildId);let calls=0,writes=0;
 const refreshed=await refreshValueQuotes(value,options({league:'nba',fetchJson:async()=>{calls++;return result([value.games[0]]);}}));
 const saved=await persistValueQuoteRefresh(value,refreshed,{clock:()=>now,write:async(...args)=>{
  if(++writes===1){const current=await readDailyCache(value.dateKey,value.guildId);current.games[1].statusKey='final';current.predictions[1].predictionCorrect=true;current.messageId='new-message';current.finalReplies={unrelated:{claimGeneration:4}};await writeDailyCache(value.dateKey,current,value.guildId);}
  return writeDailyCache(...args);
 }});
 assert.equal(calls,1);assert.equal(writes,2);assert.equal(refreshed.externalCalls,1);assert.equal(refreshed.budget.used,1);
 assert.equal(saved.games[0].odds.quoteRefreshOnly,true);assert.equal(saved.games[1].statusKey,'final');assert.equal(saved.predictions[1].predictionCorrect,true);
 assert.equal(saved.messageId,'new-message');assert.equal(saved.finalReplies.unrelated.claimGeneration,4);
 assert.deepEqual(saved.predictions[0].outcomeProbabilities,value.predictions[0].outcomeProbabilities);assert.equal(saved.priceCacheMergeAudit.appliedEvents,1);
});

test('a forecast changed during the first save is preserved with an explicit price rejection',async()=>{
 let value=slate();value=await writeDailyCache(value.dateKey,value,value.guildId);let writes=0;
 const refreshed=await refreshValueQuotes(value,options({fetchJson:async()=>result(value.games)}));
 const saved=await persistValueQuoteRefresh(value,refreshed,{clock:()=>now,write:async(...args)=>{
  if(++writes===1){const current=await readDailyCache(value.dateKey,value.guildId);current.predictions[0].outcomeProbabilities.home=91;await writeDailyCache(value.dateKey,current,value.guildId);}
  return writeDailyCache(...args);
 }});
 assert.equal(saved.predictions[0].outcomeProbabilities.home,91);assert.equal(saved.games[0].odds.quoteRefreshOnly,undefined);
 assert.equal(saved.priceCacheMergeAudit.appliedEvents,0);assert.equal(saved.priceCacheMergeAudit.rejected[0].reason,'forecast_changed');
});

test('a newer cached quote arriving during persistence cannot be rolled back on retry',async()=>{
 let value=slate();value=await writeDailyCache(value.dateKey,value,value.guildId);let writes=0;
 const refreshed=await refreshValueQuotes(value,options({fetchJson:async()=>result(value.games)}));
 const saved=await persistValueQuoteRefresh(value,refreshed,{clock:()=>now+3000,write:async(...args)=>{
  if(++writes===1){const current=await readDailyCache(value.dateKey,value.guildId);current.games[0].odds={eventId:'newer',fetchedAt:new Date(now+2000).toISOString()};await writeDailyCache(value.dateKey,current,value.guildId);}
  return writeDailyCache(...args);
 }});
 assert.equal(saved.games[0].odds.eventId,'newer');assert.equal(saved.priceCacheMergeAudit.rejected[0].reason,'newer_quote_already_cached');
});

test('a retry crossing the game start does not apply the formerly pregame quote',async()=>{
 let value=slate();value=await writeDailyCache(value.dateKey,value,value.guildId);let writes=0,reads=0;
 const refreshed=await refreshValueQuotes(value,options({fetchJson:async()=>result(value.games)}));
 const saved=await persistValueQuoteRefresh(value,refreshed,{clock:()=>++reads===1?now:now+7200000,write:async(...args)=>{
  if(++writes===1){const current=await readDailyCache(value.dateKey,value.guildId);current.messageId='concurrent';await writeDailyCache(value.dateKey,current,value.guildId);}
  return writeDailyCache(...args);
 }});
 assert.equal(reads,2);assert.equal(saved.games[0].odds.quoteRefreshOnly,undefined);
 assert.equal(saved.priceCacheMergeAudit.rejected[0].reason,'event_no_longer_pregame');
});

test('price retries are bounded and do not retry other storage failures',async()=>{
 const value=slate();let calls=0,writes=0;
 const refreshed=await refreshValueQuotes(value,options({fetchJson:async()=>{calls++;return result(value.games);}}));
 const settings={read:async()=>value,clock:()=>now,write:async()=>{writes++;throw Object.assign(new Error('conflict'),{code:'DAILY_CACHE_CONFLICT'});}};
 await assert.rejects(persistValueQuoteRefresh(value,refreshed,settings),{code:'DAILY_CACHE_CONFLICT'});assert.equal(writes,3);
 writes=0;settings.write=async()=>{writes++;throw new Error('disk unavailable');};
 await assert.rejects(persistValueQuoteRefresh(value,refreshed,settings),/disk unavailable/);assert.equal(writes,1);assert.equal(calls,1);
});

test('price persistence freezes issued snapshots before asynchronous cache reads',async()=>{
 const value=slate(),refreshed=await refreshValueQuotes(value,options({fetchJson:async()=>result(value.games)}));let release;
 const gate=new Promise(resolve=>{release=resolve;});
 const pending=persistValueQuoteRefresh(value,refreshed,{read:async()=>{await gate;return value;},write:async(date,row)=>row,clock:()=>now});
 refreshed.issuedSlate.games[0].odds.eventId='mutated';refreshed.issuedSlate.predictions[0].outcomeProbabilities.home=99;release();
 const saved=await pending;assert.equal(saved.games[0].odds.eventId,value.games[0].odds.eventId);assert.equal(saved.predictions[0].outcomeProbabilities.home,65);
});

test('missing caches, foreign scopes and invalid retry bounds never write a price cache',async()=>{
 const value=slate(),refreshed=await refreshValueQuotes(value,options({fetchJson:async()=>result(value.games)}));let writes=0;
 const settings={read:async()=>null,write:async()=>{writes++;},clock:()=>now};
 await assert.rejects(persistValueQuoteRefresh(value,refreshed,settings),/disappeared/);
 await assert.rejects(persistValueQuoteRefresh(value,refreshed,{...settings,read:async()=>({...value,guildId:'other'})}),/scope/);
 await assert.rejects(persistValueQuoteRefresh(value,{...refreshed,issuedSlate:{...refreshed.issuedSlate,dateKey:'other'}},settings),/scope/);
 await assert.rejects(persistValueQuoteRefresh(value,refreshed,{...settings,attempts:99}),/bound/);assert.equal(writes,0);
});

test('ambiguous issued snapshots have auditable rejection reasons rather than an array-order choice',async()=>{
 const value=slate(),refreshed=await refreshValueQuotes(value,options({fetchJson:async()=>result(value.games)}));
 const conflicting=structuredClone(refreshed.issuedSlate.predictions[0]);conflicting.outcomeProbabilities.home=99;refreshed.issuedSlate.predictions.push(conflicting);
 const saved=mergeValueQuoteRefresh(value,refreshed,now);assert.equal(saved.priceCacheMergeAudit.appliedEvents,0);
 assert.equal(saved.priceCacheMergeAudit.rejected.length,2);assert.ok(saved.priceCacheMergeAudit.rejected.every(row=>row.reason==='issued_forecast_scope_not_unique'));
});

test('different explicit quote snapshots with equal receipt times cannot overwrite by arrival order',async()=>{
 const value=slate(),first=await refreshValueQuotes(value,options({fetchJson:async()=>result(value.games)}));
 const second=await refreshValueQuotes(value,options({fetchJson:async()=>{
  const response=result(value.games);
  for(const book of response.json[0].bookmakers)book.markets[0].outcomes[1].price=-150;
  return response;
 }}));
 assert.equal(first.issuedSlate.games[0].odds.fetchedAt,second.slate.games[0].odds.fetchedAt);
 const saved=mergeValueQuoteRefresh(second.slate,first,now);
 assert.equal(saved.games[0].odds.h2h.home.price,-150);
 assert.equal(saved.priceCacheMergeAudit.rejected[0].reason,'conflicting_quote_receipt');
});
