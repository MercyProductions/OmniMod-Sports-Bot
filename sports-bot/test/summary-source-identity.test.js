import test from 'node:test';
import assert from 'node:assert/strict';
process.env.AUTO_OFFICIAL_SOURCES='false';process.env.FEATURE_WAREHOUSE_ENABLED='false';process.env.AUTO_LEARNING_ENABLED='false';process.env.NHL_GOALIE_CONTEXT_MAX_GAMES='0';process.env.AUTO_BOXSCORE_MAX_EVENTS='0';process.env.AUTO_SUMMARY_MAX_GAMES='1';
const {parseEspnSummary,enrichGamesAutomatically}=await import('../src/autoEnrichment.js');
const {parseHistoricalEventSummary}=await import('../src/advancedMetrics.js');
const {inspectSummarySourceIdentity,summaryTeamBinding}=await import('../src/summarySourceIdentity.js');
const {predictionInputsAt}=await import('../src/inputChronology.js');
const {predictGame}=await import('../src/predictionEngine.js');
const {buildEvidenceCoverage,summaryEvidence}=await import('../src/evidenceCoverage.js');
const {completePregameRefreshAttempt}=await import('../src/pregameRefresh.js');
const {parseScoreboardStarterEvidence}=await import('../src/scoreboardStarters.js');
const league={key:'nhl',sport:'hockey',league:'nhl',label:'NHL',group:'Hockey',priority:100};
const now=Date.parse('2099-02-01T18:00:00Z'),meta={fetchedAt:new Date(now).toISOString(),cacheState:'network'};
const game=()=>({id:'401000001',source:'ESPN public scoreboard',leagueKey:'nhl',league:'NHL',sportGroup:'Hockey',statusKey:'scheduled',startTime:'2099-02-01T20:00Z',seasonYear:2099,seasonType:2,away:{id:'1',name:'Away',abbr:'AWY'},home:{id:'2',name:'Home',abbr:'HOM'}});
const summary=()=>({header:{id:'401000001',competitions:[{id:'401000001',date:game().startTime,competitors:['away','home'].map((side,i)=>({homeAway:side,team:{id:String(i+1),displayName:side==='away'?'Away':'Home'}}))}]},rosters:[{team:{id:'1',displayName:'Away'},roster:[{starter:true,athlete:{id:'99',displayName:'Goalie'},position:{displayName:'Goalie'}}]}],injuries:[{team:{id:'1',displayName:'Away'},injuries:[{athlete:{id:'99',displayName:'Goalie'},status:'Out'}]}]});

test('an explicitly different summary event cannot supply injury or lineup inputs',()=>{
 const payload=summary();payload.header.id='401000002';const parsed=parseEspnSummary(payload,game(),meta);
 assert.equal(parsed.players.length,0);assert.equal(parsed.lineups.length,0);assert.equal(parsed.meta.sourceIdentity.status,'conflict');
});

test('summary compaction must retain a contradictory top-level event ID before live enrichment',async t=>{
 const payload=summary(),urls=[];payload.header.id='401000003';t.mock.method(globalThis,'fetch',async url=>{urls.push(String(url));return Response.json(String(url).includes('/summary?')?payload:{events:[]});});
 const current=game(),result=await enrichGamesAutomatically([current],new Date('2099-02-01T18:00:00Z'),{leagues:[league]});
 assert.equal((current.autoPlayers||[]).length,0);assert.equal(current.autoEnrichment,undefined);assert.equal(current.summaryIdentity.status,'rejected');
 assert.equal(result.summaryCoverage.identityConflicts,1);assert.equal(result.summaryCoverage.accepted,0);assert.equal(result.summaryCoverage.providerFailures,0);
 const calls=urls.length,second=game();await enrichGamesAutomatically([second],new Date('2099-02-01T18:00:00Z'),{leagues:[league]});assert.equal(urls.length,calls);assert.equal(second.summaryIdentity.status,'rejected');assert.ok(urls.some(url=>url.includes('/summary?event=401000001')));
});

test('summary diagnostics distinguish selected accepted data from cap omissions and unknown event mappings',async t=>{
 const games=['401000101','401000102','401000103'].map(id=>({...game(),id})),native={...game(),id:'nhl-2099020001',source:'NHL API',sourceMeta:{provider:'NHL API'}};games.push(native);
 t.mock.method(globalThis,'fetch',async raw=>{const url=new URL(raw),payload=summary();payload.header.id=payload.header.competitions[0].id=url.searchParams.get('event');return Response.json(url.pathname.endsWith('/summary')?payload:{events:[]});});
 const result=await enrichGamesAutomatically(games,new Date('2099-02-01T18:00:00Z'),{leagues:[league]});
 assert.equal(result.summaryGames,1);assert.equal(result.summaryCoverage.eligible,4);assert.equal(result.summaryCoverage.selected,1);assert.equal(result.summaryCoverage.accepted,1);assert.equal(result.summaryCoverage.capOmissions,2);assert.equal(result.summaryCoverage.identitySkipped,1);assert.equal(result.summaryCoverage.providerCalls,1);
 assert.equal(games[1].summaryIdentity.reason,'request_cap_omission');assert.ok(buildEvidenceCoverage(games[1],{now:Date.now()}).missing.includes('summary:request_cap_omission'));assert.equal(native.summaryIdentity.reason,'provider_event_mapping_not_verified');
});

test('provider failures are attempts without accepted coverage or inferred lack of injuries',async t=>{
 const current={...game(),id:'401000201'};t.mock.method(globalThis,'fetch',async raw=>String(raw).includes('/summary?')?new Response('Denied',{status:403}):Response.json({events:[]}));
 const result=await enrichGamesAutomatically([current],new Date('2099-02-01T18:00:00Z'),{leagues:[league]});assert.equal(result.summaryCoverage.attempted,1);assert.equal(result.summaryCoverage.accepted,0);assert.equal(result.summaryCoverage.providerFailures,1);assert.equal(result.summaryCoverage.identityConflicts,0);assert.equal(current.summaryIdentity.httpStatus,403);assert.equal(buildEvidenceCoverage(current,{now:Date.now()}).summary.injuryCoverage,'unknown');
});

test('offline enrichment reports unqueried coverage rather than an observed empty eligible universe',async t=>{
 t.mock.method(globalThis,'fetch',()=>{throw Error('No transport allowed');});const result=await enrichGamesAutomatically([game()],new Date('2099-02-01T18:00:00Z'),{localOnly:true});
 assert.equal(result.summaryCoverage.mode,'network_skipped');assert.equal(result.summaryCoverage.eligible,null);assert.equal(result.summaryCoverage.attempted,0);assert.equal(result.externalCalls,0);
});

test('accepted summary totals retain rejected player-group counts without calling them injury coverage',async t=>{
 const current={...game(),id:'401000301'},payload=summary();payload.header.id=payload.header.competitions[0].id=current.id;payload.injuries[0].team.id='999';
 t.mock.method(globalThis,'fetch',async raw=>Response.json(String(raw).includes('/summary?')?payload:{events:[]}));const result=await enrichGamesAutomatically([current],new Date('2099-02-01T18:00:00Z'),{leagues:[league]});
 assert.equal(result.summaryCoverage.accepted,1);assert.equal(result.summaryCoverage.rejectedPlayerGroups.foreign_native_team_id,1);assert.equal(current.autoEnrichment.injuryCount,0);assert.equal(buildEvidenceCoverage(current,{now:Date.now()}).summary.injuryCoverage,'unknown');
});

test('matching declared event, canonical start and ordered teams are assertions rather than publication verification',()=>{
 const payload=summary();payload.header.competitions[0].date='2099-02-01T15:00:00-05:00';const result=inspectSummarySourceIdentity(payload,game());
 assert.equal(result.status,'matched_assertions');assert.deepEqual(result.reasons,[]);assert.equal(result.independentlyVerified,false);assert.equal(result.publicationTimeVerified,false);
 const partial=inspectSummarySourceIdentity({injuries:[]},game());assert.equal(partial.status,'partial');assert.equal(partial.checks.eventId,'not_reported');
});

test('malformed starts and different days cannot turn a rematch into the requested event',()=>{
 for(const date of ['2099-02-02T20:00Z','2099-02-30T20:00Z','2099-02-01T20:00:00','invalid']){
  const payload=summary();payload.header.competitions[0].date=date;assert.equal(parseEspnSummary(payload,game(),meta).meta.sourceIdentity.status,'conflict');
 }
 const payload=summary();payload.header.date='2099-02-02T20:00Z';assert.ok(inspectSummarySourceIdentity(payload,game()).reasons.includes('conflicting_source_starts'));
});

test('reversed, duplicated and foreign ordered teams cannot pass on matching event ID alone',()=>{
 for(const modify of [rows=>rows.reverse().forEach((row,i)=>row.homeAway=i?'home':'away'),rows=>rows.push(structuredClone(rows[0])),rows=>rows[0].team.id='999']){
  const payload=summary();modify(payload.header.competitions[0].competitors);const parsed=parseEspnSummary(payload,game(),meta);assert.equal(parsed.players.length,0);assert.equal(parsed.meta.sourceIdentity.status,'conflict');
 }
});

test('explicit season and league contradictions reject, while missing metadata stays partial',()=>{
 for(const season of [{year:2100},{type:3},{year:true}]){const payload=summary();payload.header.season=season;assert.ok(inspectSummarySourceIdentity(payload,game()).reasons.some(reason=>/season/.test(reason)));}
 const payload=summary();payload.header.season={year:2099,type:{id:'2'}};assert.equal(inspectSummarySourceIdentity(payload,game()).status,'matched_assertions');payload.header.league={slug:'nba'};assert.ok(inspectSummarySourceIdentity(payload,game()).reasons.includes('league_mismatch'));
});

test('stable source team IDs canonicalize display aliases without guessing a different player or team',()=>{
 const payload=summary();payload.injuries=[];payload.rosters[0].team.displayName='Different Away Display';payload.header.competitions[0].competitors[0].team.displayName='Road Display';
 payload.header.competitions[0].competitors[0].probables=[{athlete:{id:'99',displayName:'Goalie',position:{displayName:'Goalie'}}}];
 const parsed=parseEspnSummary(payload,game(),meta);assert.equal(parsed.lineups[0].team,'Away');assert.equal(parsed.players[0].team,'Away');assert.equal(parsed.players[0].confirmedStarter,true);
 assert.equal(summaryTeamBinding({id:'1',displayName:'Home'},game()).reason,'team_id_name_conflict');
});

test('native team ID namespaces cannot be assumed identical merely because an ESPN event mapping exists',()=>{
 const native={...game(),id:'nhl-2099020001',espnEventId:'401000001',source:'NHL API',sourceMeta:{provider:'NHL API'},away:{id:'24',name:'Away',abbr:'AWY'},home:{id:'4',name:'Home',abbr:'HOM'}};
 const binding=summaryTeamBinding({id:'1',displayName:'Away'},native);assert.equal(binding.side,'away');assert.equal(binding.quality,'name_assertion');
 assert.equal(inspectSummarySourceIdentity(summary(),native).status,'matched_assertions');
});

test('unsupported and ambiguous headers stay rejected rather than throwing or silently selecting the first event',()=>{
 for(const header of [null,'not an event',[],{competitions:null},{competitions:[{},{}]}]){const parsed=parseEspnSummary({...summary(),header},game(),meta);assert.equal(parsed.meta.sourceIdentity.status,'conflict');assert.equal(parsed.players.length,0);}
});

test('malformed player groups do not crash a valid summary or manufacture team injury coverage',()=>{
 const payload=summary();payload.rosters=[null,{team:{id:'1',displayName:'Away'},roster:{}},...payload.rosters];payload.injuries=[null,{team:{id:'2',displayName:'Home'},injuries:{}}];
 const parsed=parseEspnSummary(payload,game(),meta);assert.equal(parsed.lineups.length,1);assert.equal(parsed.meta.reportedRosterGroups,3);assert.equal(parsed.meta.rosterGroups,1);assert.deepEqual(parsed.meta.injuryTeams,[]);assert.equal(parsed.meta.rejectedGroups.invalid_injury_group,2);
 const foreign=summary();foreign.rosters[0].team.id='999';assert.equal(parseEspnSummary(foreign,game(),meta).meta.rosterGroups,0);
});

test('historical team groups obey the same binding and preserve valid source identity in the sample',()=>{
 const payload=summary();payload.rosters=[];payload.boxscore={players:[{team:{id:'999',displayName:'Away'},statistics:[{name:'goalies',labels:['SV'],athletes:[{athlete:{id:'99',displayName:'Goalie'},stats:['20']}]}]}]};
 const sample=parseHistoricalEventSummary(payload,{...game(),id:'espn:401000001',awayTeam:'Away',homeTeam:'Home',awayTeamId:'1',homeTeamId:'2'},meta);assert.equal(sample.players.length,0);assert.equal(sample.sourceMeta.sourceIdentity.status,'matched_assertions');
});

test('contradictory stored summary metadata cannot earn confidence or retain derived player inputs',()=>{
 const value=game(),parsed=parseEspnSummary(summary(),value,meta);value.autoPlayers=parsed.players;value.autoLineups=parsed.lineups;value.autoEnrichment={...parsed.meta,sourceIdentity:{schema:'sports-summary-identity-v1',status:'conflict',reasons:['event_id_mismatch']}};
 const original=structuredClone(value),safe=predictionInputsAt(value,{},now);assert.equal(safe.game.autoPlayers.length,0);assert.equal(safe.game.autoEnrichment,null);assert.equal(summaryEvidence(value,now).usableForInference,false);assert.equal(buildEvidenceCoverage(value,{now}).summary.injuryCoverage,'unknown');
 const prediction=predictGame(value,1,{now});assert.ok(prediction.inputChronology.excluded['autoEnrichment:source_identity_conflict']);assert.deepEqual(value,original);
});

test('known future identity failures do not become an earlier source assertion',()=>{
 const value=game();value.summaryIdentity={fetchedAt:new Date(now+1000).toISOString(),sourceIdentity:{status:'conflict',reasons:['event_id_mismatch']}};
 assert.equal(predictionInputsAt(value,{},now).game.summaryIdentity,null);assert.equal(summaryEvidence(value,now).sourceIdentity,null);
});

test('targeted refreshes reject contradictory summary identity even when other issuance and receipt checks pass',()=>{
 const initial=game(),prediction={gameId:initial.id,leagueKey:'nhl',startTime:initial.startTime,modelVersion:'fixture',predictionMode:'pregame',outcomeProbabilities:{away:40,home:60,draw:0},predictionGeneratedAt:new Date(now-1000).toISOString()};
 const previous={games:[initial],predictions:[prediction]},due=[{gameId:initial.id,leagueKey:'nhl',startTime:initial.startTime,dueWindows:[120],minutesToStart:120}],rebuilt={games:[{...initial,autoEnrichment:{fetchedAt:new Date(now+10).toISOString(),cacheState:'network'}}],predictions:[{...prediction,predictionGeneratedAt:new Date(now+20).toISOString()}]};
 assert.equal(completePregameRefreshAttempt(previous,rebuilt,due,new Date(now).toISOString(),new Date(now+30).toISOString()).completed.length,1);
 rebuilt.games[0].autoEnrichment.sourceIdentity={status:'conflict',reasons:['event_id_mismatch']};const rejected=completePregameRefreshAttempt(previous,rebuilt,due,new Date(now).toISOString(),new Date(now+30).toISOString());assert.equal(rejected.completed.length,0);assert.ok(rejected.rejected[0].reasons.includes('summary_source_identity_conflict'));assert.deepEqual(rejected.slate.predictions,previous.predictions);
});

test('a rejected summary leaves independent fresh scoreboard projections usable',async t=>{
 const current={...game(),id:'401000099',leagueKey:'mlb',league:'MLB',sportGroup:'Baseball',sourceMeta:{provider:'ESPN',fetchedAt:new Date().toISOString(),cacheState:'network'}},competition={id:current.id,date:current.startTime,competitors:['away','home'].map((side,i)=>({homeAway:side,team:{id:String(i+1),displayName:i?'Home':'Away'},probables:[{name:'probableStartingPitcher',playerId:100+i,athlete:{id:String(100+i),displayName:'Pitcher '+i,position:'SP',team:{id:String(i+1)}}}]}))};
 current.scoreboardStarterEvidence=parseScoreboardStarterEvidence({id:current.id,competitions:[competition]},current);const payload=summary();t.mock.method(globalThis,'fetch',async url=>Response.json(String(url).includes('/summary?')?payload:{events:[]}));
 await enrichGamesAutomatically([current],new Date('2099-02-01T18:00:00Z'),{leagues:[{...league,key:'mlb',league:'mlb',sport:'baseball',label:'MLB',group:'Baseball'}]});assert.equal(current.summaryIdentity.status,'rejected');assert.equal(current.autoEnrichment,undefined);assert.equal(predictionInputsAt(current,{},Date.now()).game.autoPlayers.length,2);
});

test('a summary for a different event cannot become a historical training box score',()=>{
 const payload=summary();payload.header.id='401000003';const sample=parseHistoricalEventSummary(payload,{...game(),id:'espn:401000001',awayTeam:'Away',homeTeam:'Home',awayTeamId:'1',homeTeamId:'2'},meta);
 assert.equal(sample,null);
});

test('a same-name injury group with an explicitly different native team ID cannot affect the selected team',()=>{
 const payload=summary();payload.injuries[0].team.id='999';const parsed=parseEspnSummary(payload,game(),meta);
 assert.equal(parsed.players.filter(row=>/injury/i.test(row.source)).length,0);assert.equal(parsed.meta.injuryTeams.length,0);
});
