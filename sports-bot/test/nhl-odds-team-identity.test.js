import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {enrichNhlGoalieResearch} from '../src/nhlGoalieResearch.js';
import {inspectOddsEventMatch} from '../src/oddsEventIdentity.js';
import {bestH2HMarket,bestSpreadTotalMarkets} from '../src/sportsData.js';
import {refreshValueQuotes} from '../src/valueQuoteRefresh.js';
import {predictionInputsAt} from '../src/inputChronology.js';
import {predictGame} from '../src/predictionEngine.js';
const now=Date.parse('2099-02-01T18:00:00Z'),start='2099-02-01T19:00:00Z',sport='icehockey_nhl';
const game=()=>({id:'nhl-2098020001',league:'NHL',leagueKey:'nhl',sportGroup:'Hockey',seasonYear:20982099,statusKey:'scheduled',startTime:start,away:{id:'24',name:'Ducks',abbr:'ANA'},home:{id:'4',name:'Flyers',abbr:'PHI'}});
const payload=()=>({id:2098020001,season:20982099,gameState:'FUT',startTimeUTC:start,awayTeam:{id:24,abbrev:'ANA',commonName:{default:'Ducks'},placeName:{default:'Anaheim'}},homeTeam:{id:4,abbrev:'PHI',commonName:{default:'Flyers'},placeName:{default:'Philadelphia'}}});
const event=()=>({id:'provider-nhl',sport_key:sport,commence_time:start,away_team:'Anaheim Ducks',home_team:'Philadelphia Flyers',bookmakers:books()});
const books=()=>['one','two'].map(key=>({key,title:key,markets:[{key:'h2h',last_update:new Date(now-30000).toISOString(),outcomes:[{name:'Anaheim Ducks',price:150},{name:'Philadelphia Flyers',price:-170}]},{key:'spreads',last_update:new Date(now-30000).toISOString(),outcomes:[{name:'Anaheim Ducks',price:-110,point:1.5},{name:'Philadelphia Flyers',price:-110,point:-1.5}]}]}));
async function enrich(g=game(),p=payload(),at=now){let calls=0;await enrichNhlGoalieResearch([g],{maxGames:1,clock:()=>at,fetchJson:async()=>{calls++;return {ok:true,status:200,json:p,fetchedAt:new Date(at).toISOString(),cacheState:'network'};}});assert.equal(calls,1);return g;}
const inspect=(g,rows=[event()],at=now)=>inspectOddsEventMatch(g,rows,sport,{asOf:at});
test('verified native event place/common names recover exact ordered provider event matching',async()=>{const g=await enrich();assert.equal(inspect(g).event?.id,'provider-nhl');assert.equal(g.away.name,'Ducks');assert.equal(g.home.name,'Flyers');assert.equal(g.goalieResearch.confirmedStarters,0);});
test('native alias identity also resolves complete original same-book h2h outcome labels',async()=>{const g=await enrich(),market=bestH2HMarket(books(),g,{asOf:now});assert.equal(market.bookmakerCount,2);assert.equal(market.away.price,150);assert.equal(market.home.price,-170);});
test('native identity applies consistently to complementary spread outcome labels',async()=>{const g=await enrich(),market=bestSpreadTotalMarkets(books(),g,{asOf:now});assert.equal(market.spread?.status,'complete');assert.equal(market.spread.away.point,1.5);});
test('explicit quote refresh uses the same verified team identity for event and book matching',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'sports-nhl-quote-id-'));t.after(()=>rm(directory,{recursive:true,force:true}));const g=await enrich();
 const prediction={gameId:g.id,leagueKey:'nhl',startTime:start,predictionGeneratedAt:new Date(now-1000).toISOString(),predictionMode:'pregame',modelVersion:'fixture',outcomeProbabilities:{away:45,home:55,draw:0},recommendationStatus:'prediction',evidenceQualityValue:80,calibrationSampleSize:100,predictionUncertaintyPoints:4,outcomeValidationSamples:{away:100,home:100},outcomeCalibrationError:{away:.02,home:.02}};
 const result=await refreshValueQuotes({guildId:'fixture',games:[g],predictions:[prediction]},{admin:true,refresh:true,localOnly:false,oddsApiKey:'fixture-key',dailyCap:1,cooldownMinutes:5,directory,now,fetchJson:async()=>({ok:true,status:200,cacheState:'network',fetchedAt:new Date(now).toISOString(),json:[event()]})});assert.equal(result.status,'fresh');assert.equal(result.slate.games[0].odds.h2h.bookmakerCount,2);
});
test('wrong native team IDs, sides, event, start and season never supply an alias',async()=>{
 for(const mutate of [p=>p.id++,p=>p.awayTeam.id=4,p=>p.awayTeam.abbrev='PHI',p=>p.startTimeUTC='2099-02-01T19:01:00Z',p=>p.season=20992000,p=>p.awayTeam.commonName.default='Other']){const p=payload();mutate(p);assert.equal(inspect(await enrich(game(),p)).event,null);}
});
test('unknown place names and arbitrary local alias lists do not guess a provider identity',async()=>{const p=payload();delete p.awayTeam.placeName;assert.equal(inspect(await enrich(game(),p)).event,null);const g=game();g.away.aliases=['Anaheim Ducks'];g.home.aliases=['Philadelphia Flyers'];assert.equal(inspect(g).event,null);});
test('native identity cannot reverse provider sides or transfer to another local game',async()=>{const g=await enrich(),e=event();[e.away_team,e.home_team]=[e.home_team,e.away_team];assert.equal(inspect(g,[e]).event,null);assert.equal(inspect({...g,id:'nhl-2098020002'}).event,null);});
test('native identity is unavailable before receipt, after its bounded age or after event start',async()=>{const g=await enrich();assert.equal(inspect(g,undefined,now-1).event,null);assert.equal(inspect(g,undefined,now+16*60000).event,null);assert.equal(inspect(g,undefined,Date.parse(start)).event,null);});
test('an earlier inference cutoff cannot consume later native identity evidence',async()=>{const g=await enrich(game(),payload(),now+60000),safe=predictionInputsAt(g,{},now).game;assert.equal(inspect(safe).event,null);});
test('team identity is diagnostic evidence and does not add a health or probability bonus',async()=>{const g=game(),before=predictGame(g,1,{now}),enriched=await enrich(g),after=predictGame(enriched,1,{now});assert.deepEqual(after.outcomeProbabilities,before.outcomeProbabilities);assert.equal(after.evidenceQualityValue,before.evidenceQualityValue);assert.equal(after.evidenceCoverage.sides.away.injuryCoverage,'unknown');});

for(const aged of [false,true])test('default live clock is taken after quote receipt'+(aged?' and preserves the six-hour model limit':''),async t=>{
 const directory=await mkdtemp(join(tmpdir(),'sports-nhl-live-clock-'));t.after(()=>rm(directory,{recursive:true,force:true}));const g=await enrich(),originalNow=Date.now;let clock=now;
 try{
  Date.now=()=>clock;
  const p={gameId:g.id,leagueKey:'nhl',startTime:start,predictionGeneratedAt:new Date(now-(aged?6*3600000-100:1000)).toISOString(),predictionMode:'pregame',modelVersion:'clock-fixture',outcomeProbabilities:{away:45,home:55,draw:0},recommendationStatus:'prediction',evidenceQualityValue:80,calibrationSampleSize:100,predictionUncertaintyPoints:4,outcomeValidationSamples:{away:100,home:100},outcomeCalibrationError:{away:.02,home:.02}};
  const result=await refreshValueQuotes({guildId:'clock-fixture',games:[g],predictions:[p]},{admin:true,refresh:true,localOnly:false,oddsApiKey:'fixture-key',dailyCap:1,cooldownMinutes:5,directory,fetchJson:async()=>{clock+=500;return {ok:true,status:200,cacheState:'network',fetchedAt:new Date(clock).toISOString(),json:[event()]};}});
  assert.equal(result.issuedSlate.generatedAt,new Date(clock).toISOString());const outcomes=result.slate.predictions[0].valueAnalysis.outcomes;assert.ok(outcomes.every(row=>!row.reasons.includes('quote receipt is invalid or after the evaluation cutoff')));
  if(aged){assert.equal(result.slate.predictions[0].valueAnalysis.bestOpportunity,null);assert.ok(outcomes.every(row=>row.reasons.some(reason=>reason.includes('older than six hours'))));}
 }finally{Date.now=originalNow;}
});
