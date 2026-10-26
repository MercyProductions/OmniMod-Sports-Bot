import test from 'node:test';
import assert from 'node:assert/strict';
process.env.AUTO_OFFICIAL_SOURCES='false';process.env.FEATURE_WAREHOUSE_ENABLED='false';process.env.AUTO_LEARNING_ENABLED='false';process.env.NHL_GOALIE_CONTEXT_MAX_GAMES='0';process.env.AUTO_BOXSCORE_MAX_EVENTS='0';
const {parseEspnEvent,mergeTargetedGames}=await import('../src/sportsData.js');
const {parseEspnSummary,enrichGamesAutomatically}=await import('../src/autoEnrichment.js');
const {inspectSummarySourceIdentity}=await import('../src/summarySourceIdentity.js');
const {espnSummaryEventId}=await import('../src/summarySourceIdentity.js');
const {bindEspnSummaryMappings,espnEventMappingState,mappedEspnTeams}=await import('../src/espnEventMapping.js');
const {predictionInputsAt}=await import('../src/inputChronology.js');
const {sourceEventsMatch}=await import('../src/sourceEventMatching.js');
const {summaryEvidence}=await import('../src/evidenceCoverage.js');
const now=Date.parse('2099-02-01T18:00:00Z'),receipt=new Date(now).toISOString(),start='2099-02-01T20:00:00Z';
const league={key:'nhl',sport:'hockey',league:'nhl',label:'NHL',group:'Hockey',priority:100};
const native=()=>({id:'nhl-2098020001',leagueKey:'nhl',league:'NHL',sportGroup:'Hockey',seasonYear:20982099,seasonType:2,statusKey:'scheduled',startTime:start,
 source:'NHL official scoreboard',sourceMeta:{provider:'NHL API',fetchedAt:receipt,cacheState:'network'},away:{id:'24',name:'Ducks',abbr:'ANA'},home:{id:'4',name:'Flyers',abbr:'PHI'}});
const event=()=>({id:'401000001',date:start,season:{year:2099,type:2},status:{type:{state:'pre'}},competitions:[{id:'401000001',date:start,competitors:[
 {homeAway:'away',team:{id:'25',displayName:'Anaheim Ducks',name:'Ducks',abbreviation:'ANA'}},
 {homeAway:'home',team:{id:'15',displayName:'Philadelphia Flyers',name:'Flyers',abbreviation:'PHI'}}]}]});
const espn=(payload=event(),meta={})=>parseEspnEvent(payload,league,{provider:'ESPN',fetchedAt:receipt,cacheState:'network',...meta});
const summary=()=>({header:{id:'401000001',season:{year:2099,type:2},league:{slug:'nhl'},competitions:[{id:'401000001',date:start,competitors:event().competitions[0].competitors}]},
 injuries:[{team:{id:'25',displayName:'Anaheim Ducks'},injuries:[{athlete:{id:'99',displayName:'Observed goalie',position:{abbreviation:'G'}},status:'Out'}]}]});

test('native NHL start/end season notation accepts the declared ESPN end-year for an explicitly mapped event',()=>{
 const game={...native(),espnEventId:'401000001'};
 const identity=inspectSummarySourceIdentity({...summary(),injuries:[]},game);
 assert.ok(!identity.reasons.includes('season_mismatch'));
 const wrong=summary();wrong.header.season.year=2100;assert.ok(inspectSummarySourceIdentity(wrong,game).reasons.includes('season_mismatch'));
});

test('a targeted NHL fallback reuses the exact fresh ESPN observation without duplicating the game or guessing native IDs',()=>{
 const originalNow=Date.now;Date.now=()=>now;
 try{
  const previous=espn(),game=native(),rows=mergeTargetedGames([game],{games:[previous]});
  assert.equal(rows.length,1);
  assert.equal(rows[0].id,game.id);
  assert.equal(rows[0].espnEventId,previous.id);
  const parsed=parseEspnSummary(summary(),rows[0],{fetchedAt:receipt,cacheState:'network',requestedLeagueRoute:'nhl'});
  assert.equal(parsed.meta.sourceIdentity.status,'matched_assertions');
  assert.equal(parsed.players.length,1);assert.equal(parsed.players[0].availability,0);
  assert.equal(parsed.players[0].team,'Ducks');assert.equal(parsed.players[0].confirmedStarter,false);
 }finally{Date.now=originalNow;}
});

function mapped(at=now){const game=native();assert.equal(bindEspnSummaryMappings([game],[espn()],{now:at}).mapped,1);return game;}
function clocked(run){const prior=Date.now;Date.now=()=>now;try{return run();}finally{Date.now=prior;}}

test('mapping retains both namespaces and leaves the cached original and native team IDs unchanged',()=>clocked(()=>{
 const before=espn(),saved=structuredClone(before),input=native(),rows=mergeTargetedGames([input],{games:[before]});
 assert.deepEqual(before,saved);assert.equal(input.espnEventId,undefined);
 assert.equal(rows[0].away.id,'24');assert.equal(rows[0].espnEventMapping.sourceEvent.away.id,'25');
 assert.equal(rows[0].espnEventMapping.independentlyVerified,false);assert.equal(rows[0].espnEventMapping.publicationTimeVerified,false);
}));

for(const [label,mutate] of [
 ['different start',e=>{e.date=e.competitions[0].date='2099-02-01T20:01:00Z';}],
 ['different season',e=>e.season.year=2100],
 ['different season type',e=>e.season.type=3],
 ['reversed sides',e=>{for(const row of e.competitions[0].competitors)row.homeAway=row.homeAway==='away'?'home':'away';}],
 ['same abbreviation with a different asserted name',e=>{const team=e.competitions[0].competitors[0].team;team.name='Other';team.displayName='Other Club';}],
 ['duplicate source team',e=>e.competitions[0].competitors[1].team.id='25'],
 ['contradictory event ID',e=>e.competitions[0].id='401000002'],
 ['duplicate competitor side',e=>e.competitions[0].competitors[1].homeAway='away']
])test('mapping rejects '+label,()=>{
 const payload=event();mutate(payload);const game=native();
 assert.equal(bindEspnSummaryMappings([game],[espn(payload)],{now}).mapped,0);assert.equal(game.espnEventId,undefined);
});

for(const [label,meta] of [
 ['stale receipt',{fetchedAt:new Date(now-16*60000).toISOString()}],
 ['future receipt',{fetchedAt:new Date(now+1).toISOString()}],
 ['stale fallback',{cacheState:'stale'}],
 ['upstream denial',{upstreamError:'HTTP 403'}],
 ['unknown receipt',{fetchedAt:null}],
 ['native provider namespace',{provider:'NHL API'}]
])test('mapping rejects ESPN '+label,()=>{
 assert.equal(bindEspnSummaryMappings([native()],[espn(event(),meta)],{now}).mapped,0);
});

test('mapping rejects multiple matching ESPN IDs and contradictory observations of one ID',()=>{
 const second=event();second.id=second.competitions[0].id='401000002';
 assert.equal(bindEspnSummaryMappings([native()],[espn(),espn(second)],{now}).rejected.ambiguous_espn_events,1);
 const conflict=event();conflict.competitions[0].competitors[0].team.name='Other';
 assert.equal(bindEspnSummaryMappings([native()],[espn(),espn(conflict)],{now}).rejected.conflicting_espn_event_observations,1);
});

test('unknown and stale native observations cannot manufacture a mapping or replace explicit legacy configuration',()=>{
 for(const patch of [{fetchedAt:null},{fetchedAt:new Date(now-16*60000).toISOString()},{cacheState:'stale'}]){
  const game=native();Object.assign(game.sourceMeta,patch);assert.equal(bindEspnSummaryMappings([game],[espn()],{now}).mapped,0);
 }
 const manual={...native(),espnEventId:'401000099'};bindEspnSummaryMappings([manual],[espn()],{now});assert.equal(manual.espnEventId,'401000099');
});

test('mapping revalidation rejects expiry, future binding, changed local identity and a changed mapped event ID',()=>{
 const game=mapped();assert.equal(espnEventMappingState(game.espnEventMapping,game,now),null);
 for(const at of [now-1,now+15*60000,Date.parse(start)])assert.ok(espnEventMappingState(game.espnEventMapping,game,at));
 for(const mutate of [g=>g.away.id='99',g=>g.home.name='Other',g=>g.espnEventId='401000002',g=>g.startTime='2099-02-02T20:00:00Z']){
  const changed=structuredClone(game);mutate(changed);assert.ok(espnEventMappingState(changed.espnEventMapping,changed,now));
 }
});

test('a native-to-ESPN recovery removes obsolete native mapping metadata instead of blocking the valid summary',()=>clocked(()=>{
 const old=mapped(),fresh=espn(),rows=mergeTargetedGames([fresh],{games:[old]});
 assert.equal(rows.length,1);assert.equal(rows[0].id,fresh.id);assert.equal(rows[0].espnEventMapping,undefined);
 assert.equal(espnSummaryEventId(rows[0]),fresh.id);
}));

test('mapped team IDs reject a foreign injury team and do not guess native IDs from an event ID alone',()=>clocked(()=>{
 const game=mapped(),wrong=summary();wrong.injuries[0].team.id='99';
 const bad=parseEspnSummary(wrong,game,{fetchedAt:receipt});assert.equal(bad.players.length,0);
 assert.equal(bad.meta.rejectedGroups.foreign_native_team_id,1);
 assert.equal(mappedEspnTeams({...native(),espnEventId:'401000001'},now),null);
}));

test('mapped probable goalies remain projections with unknown medical availability; explicit roster starter assertions stay separate',()=>clocked(()=>{
 const game=mapped(),payload=summary();payload.injuries=[];
 payload.header.competitions[0].competitors[0].probables=[{athlete:{id:'99',displayName:'Observed goalie',position:{displayName:'Goalie'}}}];
 const projected=parseEspnSummary(payload,game,{fetchedAt:receipt});
 assert.equal(projected.players[0].confirmedStarter,false);assert.equal(projected.players[0].availabilityEvidence,'role_prior_not_injury_clearance');assert.equal(projected.players[0].availability,null);
 payload.rosters=[{team:{id:'25',displayName:'Anaheim Ducks'},roster:[{athlete:{id:'99',displayName:'Observed goalie'},position:{displayName:'Goalie'},starter:true}]}];
 const explicit=parseEspnSummary(payload,game,{fetchedAt:receipt});assert.equal(explicit.players[0].confirmedStarter,true);
 assert.equal(explicit.players[0].availabilityEvidence,'role_prior_not_injury_clearance');assert.equal(explicit.players[0].availability,null);
}));

test('future mapping receipts and their dependent injury inputs cannot enter an earlier forecast',()=>clocked(()=>{
 const game=mapped(),parsed=parseEspnSummary(summary(),game,{fetchedAt:receipt});
 game.autoEnrichment=parsed.meta;game.autoPlayers=parsed.players;game.autoLineups=parsed.lineups;
 const early=predictionInputsAt(game,{},now-1).game;
 assert.equal(early.autoEnrichment,null);assert.equal(early.autoPlayers.length,0);assert.equal(early.espnEventId,undefined);
 assert.equal(predictionInputsAt(game,{},now).game.autoPlayers.length,1);
}));

test('a later mapping does not authorize an earlier cached summary even if the summary receipt itself is old',()=>clocked(()=>{
 const game=mapped(now+1000),prior=Date.now;Date.now=()=>now+1000;
 try{
  const parsed=parseEspnSummary(summary(),game,{fetchedAt:receipt});game.autoEnrichment=parsed.meta;game.autoPlayers=parsed.players;
  const early=predictionInputsAt(game,{},now).game;assert.equal(early.autoEnrichment,null);assert.equal(early.autoPlayers.length,0);
 }finally{Date.now=prior;}
}));

test('historical source alias matching grants identity only and never revives expired routing',()=>{
 const game=mapped();assert.equal(sourceEventsMatch(game,espn()),true);
 const prior=Date.now;Date.now=()=>now+16*60000;
 try{assert.equal(sourceEventsMatch(game,espn()),true);assert.equal(espnSummaryEventId(game),null);}finally{Date.now=prior;}
});

test('new contradictory scoreboard observations invalidate an existing still-fresh mapping',()=>{
 for(const mutate of [e=>e.competitions[0].competitors[0].team.name='Other',e=>{e.id=e.competitions[0].id='401000002';}]){
  const game=mapped(),changed=event();mutate(changed);
  const result=bindEspnSummaryMappings([game],[espn(changed)],{now:now+1000});
  assert.equal(result.mapped,0);assert.equal(result.rejected.conflicting_espn_event_observations,1);assert.equal(game.espnEventId,undefined);
 }
});

test('malformed native season ranges are rejected rather than treated as an unspecified season',()=>{
 const game={...native(),seasonYear:20982100,espnEventId:'401000001'};
 assert.ok(inspectSummarySourceIdentity(summary(),game).reasons.includes('invalid_expected_season'));
});

test('direct coverage diagnostics do not turn a later mapping into earlier accepted injury coverage',()=>clocked(()=>{
 const game=mapped(),parsed=parseEspnSummary(summary(),game,{fetchedAt:new Date(now-1000).toISOString(),cacheState:'network'});game.autoEnrichment=parsed.meta;
 const prior=summaryEvidence(game,now-500);assert.equal(prior.usableForInference,false);assert.equal(prior.injuryCoverage,'unknown');
 assert.ok(prior.mappingState);assert.equal(summaryEvidence(game,now).injuryCoverage,'reported_one_side');
}));

test('the normal enrichment client routes a verified native game to its ESPN summary with no mapping requests',async t=>{
 const prior=Date.now;Date.now=()=>now;
 try{
  const game=mapped(),urls=[];
  t.mock.method(globalThis,'fetch',async raw=>{const url=new URL(raw);urls.push(url.toString());return Response.json(url.pathname.endsWith('/summary')?summary():{events:[]});});
  const result=await enrichGamesAutomatically([game],new Date(now),{leagues:[league]});
  assert.equal(result.summaryCoverage.selected,1);assert.equal(result.summaryCoverage.accepted,1);assert.equal(result.summaryCoverage.identitySkipped,0);
  const summaries=urls.filter(url=>url.includes('/summary?'));assert.equal(summaries.length,1);assert.ok(summaries[0].endsWith('event=401000001'));
  assert.ok(!urls.some(url=>url.includes('/gamecenter/')||url.includes('the-odds-api')));
  assert.equal(game.autoPlayers[0].availability,0);assert.equal(game.autoPlayers[0].team,'Ducks');
  assert.equal(game.autoPlayers[0].confirmedStarter,false);assert.equal(game.autoEnrichment.sourceIdentity.espnEventMapping.sourceEvent.id,'401000001');
 }finally{Date.now=prior;}
});
