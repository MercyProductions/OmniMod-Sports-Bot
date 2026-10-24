import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
const directory=await mkdtemp(join(tmpdir(),'sports-provider-events-'));process.env.OMNIMOD_SPORTS_DATA_DIR=directory;
const {matchingOddsEvent,oddsEventMatches,buildDailySlate}=await import('../src/sportsData.js');
const {inspectOddsEventMatch,matchOddsEventCohort}=await import('../src/oddsEventIdentity.js');
const {refreshValueQuotes}=await import('../src/valueQuoteRefresh.js');
const {scopedEventKey,eventReference}=await import('../src/slateEventIdentity.js');
const {config}=await import('../src/config.js');
test.after(()=>rm(directory,{recursive:true,force:true}));
const now=Date.parse('2026-10-20T18:00:00Z'),start='2026-10-20T19:00:00Z',sport='basketball_nba';
const game=(patch={})=>({id:'local',leagueKey:'nba',league:'NBA',sportGroup:'Basketball',statusKey:'scheduled',startTime:start,away:{name:'Away Team',abbr:'A'},home:{name:'Home Team',abbr:'H'},...patch});
const event=(patch={})=>({id:'provider',sport_key:sport,commence_time:start,away_team:'Away Team',home_team:'Home Team',bookmakers:[],...patch});
const inspect=(g,rows)=>inspectOddsEventMatch(g,rows,sport);
function value(g=game()){
 return {guildId:'odds-'+randomUUID(),dateKey:'2026-10-20',generatedAt:new Date(now-3600000).toISOString(),games:[g],predictions:[{gameId:g.id,leagueKey:g.leagueKey,startTime:g.startTime,predictionGeneratedAt:new Date(now-3600000).toISOString(),predictionMode:'pregame',modelVersion:'identity-fixture',predictedSide:'home',outcomeProbabilities:{away:35,home:65},evidenceQualityValue:80,predictionUncertaintyPoints:4,calibrationSampleSize:100,outcomeValidationSamples:{away:80,home:80},outcomeCalibrationError:{away:.03,home:.03},recommendationStatus:'prediction'}]};
}
function books(){return ['one','two'].map(key=>({key,title:key,markets:[{key:'h2h',last_update:new Date(now-30000).toISOString(),outcomes:[{name:'Away Team',price:250},{name:'Home Team',price:-250}]}]}));}
const options=rows=>({refresh:true,admin:true,localOnly:false,oddsApiKey:'synthetic-test-key',dailyCap:1,cooldownMinutes:5,directory:join(directory,randomUUID()),now,fetchJson:async()=>({ok:true,status:200,cacheState:'network',fetchedAt:new Date(now).toISOString(),json:rows})});

test('reversed home and away provider roles cannot match a local event',()=>{
 const reversed=event({away_team:'Home Team',home_team:'Away Team'});assert.equal(oddsEventMatches(game(),reversed),false);assert.equal(matchingOddsEvent(game(),[reversed]),null);
});

test('a known provider event ID cannot fall back to a different same-team event',()=>{
 const g=game({odds:{eventId:'bound'}});assert.equal(matchingOddsEvent(g,[event()]),null);
 const bound=event({id:'bound',commence_time:'2026-10-20T19:20:00Z'});assert.equal(matchingOddsEvent(g,[event(),bound]).id,'bound');
});

test('an explicit provider sport mismatch is rejected instead of trusting team-name coincidence',()=>{
 assert.equal(matchingOddsEvent(game(),[event({sport_key:'icehockey_nhl'})]),null);const missing=event();delete missing.sport_key;const result=inspect(game(),[missing]);assert.equal(result.event.id,'provider');assert.equal(result.evidence.providerSportKeyVerified,false);assert.equal(result.evidence.sportScope,'request_scoped_native_unverified');
});

test('identity requires a provider ID, explicit ordered roles and timezone-qualified clocks',()=>{
 for(const patch of [{id:''},{away_team:''},{home_team:null},{commence_time:'2026-10-20T19:00:00'}])assert.equal(matchingOddsEvent(game(),[event(patch)]),null);
 assert.equal(matchingOddsEvent(game({startTime:'2026-10-20T19:00:00'}),[event({commence_time:'2026-10-20T19:00:00'})]),null);
});

test('several distinct eligible events are ambiguous even when one starts closer',()=>{
 assert.equal(matchingOddsEvent(game(),[event(),event({id:'other',commence_time:'2026-10-20T19:20:00Z'})]),null);
});

test('identical provider duplicates coalesce while conflicting same-ID observations remain rejected',()=>{
 const original=event();assert.equal(matchingOddsEvent(game(),[original,structuredClone(original)]).id,'provider');
 const conflict=inspect(game(),[original,event({bookmakers:books()})]);assert.equal(conflict.event,null);assert.equal(conflict.evidence.reason,'ambiguous_provider_events');assert.equal(conflict.evidence.candidateCount,2);
});

test('known IDs do not override wrong teams or starts, and free-provider IDs use their own namespace',()=>{
 const g=game({odds:{eventId:'provider'}});assert.equal(matchingOddsEvent(g,[event({home_team:'Different Team'})]),null);assert.equal(matchingOddsEvent(g,[event({commence_time:'2026-10-21T19:00:00Z'})]),null);
 assert.equal(matchingOddsEvent(game({odds:{eventId:'espn-id',freeProvider:true}}),[event()]).id,'provider');
});

test('one provider event cannot be assigned to multiple local games in a cohort',()=>{
 const a=game(),b=game({id:'second',startTime:'2026-10-20T19:30:00Z'}),matches=matchOddsEventCohort([a,b],[event()],sport);
 for(const match of matches.values()){assert.equal(match.event,null);assert.equal(match.evidence.reason,'provider_event_reused_across_local_games');}
});

test('local source conflicts are rejected while identical duplicates remain usable',()=>{
 const g=game(),key=scopedEventKey(eventReference(g));assert.equal(matchOddsEventCohort([g,structuredClone(g)],[event()],sport).get(key).event.id,'provider');const result=matchOddsEventCohort([g,{...g,detail:'conflict'}],[event()],sport).get(key);assert.equal(result.event,null);assert.equal(result.evidence.reason,'ambiguous_local_event_observations');
});

test('actual quote refresh rejects ambiguous upstream events and reports structured identity evidence',async()=>{
 const original=value(),rows=[event({bookmakers:books()}),event({id:'second',commence_time:'2026-10-20T19:10:00Z',bookmakers:books()})],args=options(rows),result=await refreshValueQuotes(original,args);
 assert.equal(result.status,'unmatched');assert.equal(result.externalCalls,1);assert.equal(result.issuedSlate,null);assert.equal(result.oddsMatchAudit[0].reason,'ambiguous_provider_events');assert.deepEqual(result.slate.games,original.games);
 const retry=await refreshValueQuotes(original,{...args,now:now+360000});assert.equal(retry.status,'daily_cap');
});

test('actual quote refresh freezes verified provider identity with a correct bound event',async()=>{
 const original=value(game({odds:{eventId:'bound'}})),bound=event({id:'bound',bookmakers:books()}),result=await refreshValueQuotes(original,options([event({bookmakers:books()}),bound]));
 assert.equal(result.status,'fresh');assert.equal(result.issuedSlate.games[0].odds.eventId,'bound');assert.equal(result.issuedSlate.games[0].odds.eventIdentity.providerSportKeyVerified,true);assert.deepEqual(result.slate.predictions[0].outcomeProbabilities,original.predictions[0].outcomeProbabilities);assert.equal(result.oddsMatchAudit[0].rejectedCount,1);
});

test('the actual daily builder rejects wrong-role paid odds and retains identity diagnostics',async()=>{
 const originalFetch=globalThis.fetch,originalAuto=config.autoEnrichEnabled,originalLocal=config.localOnly;let paid=0;config.autoEnrichEnabled=false;config.localOnly=false;
 globalThis.fetch=async raw=>{const url=new URL(raw);if(url.hostname==='api.the-odds-api.com'){paid++;return new Response(JSON.stringify([event({away_team:'Home Team',home_team:'Away Team',bookmakers:books()})]),{status:200,headers:{'content-type':'application/json','x-requests-remaining':'99'}});}
  const events=url.pathname.includes('/basketball/nba/scoreboard')?[{id:'local',date:start,status:{type:{name:'STATUS_SCHEDULED',state:'pre'}},competitions:[{competitors:[{homeAway:'away',team:{displayName:'Away Team',abbreviation:'A'}},{homeAway:'home',team:{displayName:'Home Team',abbreviation:'H'}}]}]}]:[];
  return new Response(JSON.stringify({events}),{status:200,headers:{'content-type':'application/json'}});};
 try{const result=await buildDailySlate(new Date(now),{guildId:'builder-'+randomUUID(),oddsApiKey:'synthetic-test-key',useOddsApi:true});assert.equal(paid,1);assert.equal(result.games.length,1);assert.equal(result.games[0].odds,null);assert.equal(result.games[0].oddsMatchEvidence.status,'rejected');assert.ok(result.games[0].oddsMatchEvidence.observations[0].reasons.includes('ordered_team_mismatch'));assert.ok(result.diagnostics.some(row=>/identity rejected 1/.test(row)));}
 finally{globalThis.fetch=originalFetch;config.autoEnrichEnabled=originalAuto;config.localOnly=originalLocal;}
});

test('journal and warehouse retain provider identity evidence without changing the original forecast',async()=>{
 const {recordPredictionJournal,readPredictionJournal}=await import('../src/predictionJournal.js');const {recordSlateSnapshot,captureMarketSnapshots,readFeatureWarehouse}=await import('../src/featureWarehouse.js');
 const original=value(),file=join(directory,'provider-identity-journal.jsonl');await recordPredictionJournal(original,{file,now});const before=(await readPredictionJournal(file)).find(r=>r.type==='forecast');
 const refreshed=await refreshValueQuotes(original,options([event({bookmakers:books()})]));await recordPredictionJournal(refreshed.issuedSlate,{file,now:now+1000,lifecycle:'prices_only'});await recordSlateSnapshot(refreshed.issuedSlate,{now:now+1000});await captureMarketSnapshots(refreshed.issuedSlate.games,{guildId:original.guildId,dateKey:original.dateKey,capturedAt:new Date(now+1000).toISOString()});
 const records=await readPredictionJournal(file),price=records.find(r=>r.type==='price_observation');assert.equal(price.payload.odds.identity.matchEvidence.eventId,'provider');assert.equal(price.payload.odds.identity.matchEvidence.providerSportKeyVerified,true);assert.deepEqual(records.find(r=>r.type==='forecast'),before);
 const warehouse=await readFeatureWarehouse();assert.equal(warehouse.predictions.find(r=>r.guildId===original.guildId).oddsMatchEvidence.eventId,'provider');assert.equal(warehouse.markets.find(r=>r.guildId===original.guildId).eventIdentity.eventId,'provider');
});
