import test from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {applyAvailabilitySnapshot} from '../src/availabilityProvider.js';
import {availabilityProviderInputState} from '../src/availabilityProviderScope.js';
import {predictionInputsAt} from '../src/inputChronology.js';
import {predictGame} from '../src/predictionEngine.js';
import {buildEvidenceCoverage} from '../src/evidenceCoverage.js';
import {parseEspnEvent} from '../src/sportsData.js';
import {applyScoreboardStarters} from '../src/scoreboardStarters.js';
import {recordPredictionJournal,readPredictionJournal} from '../src/predictionJournal.js';
const now=Date.parse('2099-02-01T18:00:00Z');
const game=()=>({id:'nhl-2099020001',leagueKey:'nhl',league:'NHL',sportGroup:'Hockey',statusKey:'scheduled',startTime:'2099-02-01T18:20:00Z',away:{name:'Away',abbr:'AWY'},home:{name:'Home',abbr:'HOM'}});
const summary=(change={})=>({fetchedAt:new Date(now-2000).toISOString(),cacheState:'network',sourceIdentity:{status:'matched_assertions'},...change});
const payload=(g,change={},records)=>({schema:'sports-player-availability-v1',provider:'Independent fixture',sourceReference:'https://example.com/provider',observedAt:new Date(now-1000).toISOString(),expiresAt:new Date(now+10*60000).toISOString(),records:records||[{kind:'goalie_starter',eventId:g.id,startTime:g.startTime,teamAbbr:'AWY',playerId:'123',playerIdNamespace:'nhl',name:'Goalie'}],...change});
const apply=(g,change={},records)=>applyAvailabilitySnapshot([g],payload(g,change,records),{now});
const badSummary=()=>summary({fetchedAt:new Date(now+1000).toISOString()});
const player=g=>g.autoPlayers.find(row=>row.sourceAthleteId==='nhl:123');
const scopeState=(g,at=now)=>availabilityProviderInputState(g.autoPlayers[0],g,at);

test('a future summary cannot erase an independently current provider starter and its unknown health',()=>{
 const g={...game(),autoEnrichment:badSummary()};assert.equal(apply(g).accepted,1);const original=structuredClone(g),result=predictionInputsAt(g,{},now);
 assert.equal(result.game.autoEnrichment,null);assert.equal(player(result.game).confirmedStarter,true);assert.equal(player(result.game).availability,null);assert.equal(result.game.autoLineups.length,1);assert.ok(result.audit.excluded['autoEnrichment:after_information_cutoff']);assert.deepEqual(g,original);
});

test('contradictory and invalid-clock summary parents do not invalidate an independent snapshot',()=>{
 for(const meta of [summary({sourceIdentity:{status:'conflict'}}),summary({fetchedAt:'invalid'})]){
  const g={...game(),autoEnrichment:meta};apply(g);const safe=predictionInputsAt(g,{},now).game;assert.equal(safe.autoEnrichment,null);assert.equal(player(safe).confirmedStarter,true);assert.equal(scopeState(safe),null);
 }
});

test('same-player summary restrictions are removed only when their rejected parent is unavailable',()=>{
 for(const meta of [badSummary(),summary()]){
  const injury={sourceAthleteId:'nhl:123',name:'Goalie',team:'Away',leagueKey:'nhl',role:'Goalie',availability:0,status:'Out',summaryObservationType:'injury',source:'ESPN injury report',updatedAt:new Date(now-2000).toISOString(),stats:{unscoped:7}};
  const g={...game(),autoEnrichment:meta,autoPlayers:[injury]};apply(g);assert.equal(player(g).availability,0);const safe=predictionInputsAt(g,{},now).game;
  if(meta.fetchedAt===badSummary().fetchedAt){assert.equal(player(safe).availability,null);assert.equal(player(safe).confirmedStarter,true);assert.deepEqual(player(safe).stats,{});}else{assert.equal(player(safe).availability,0);assert.equal(player(safe).confirmedStarter,false);assert.equal(player(safe).stats.unscoped,7);}
  assert.equal(player(g).availability,0);
 }
});

test('an independent positionless injury cannot retain a role borrowed from the rejected summary',()=>{
 const roster={sourceAthleteId:'nhl:123',name:'Goalie',team:'Away',leagueKey:'nhl',role:'Goalie',starter:true,confirmedStarter:true,summaryObservationType:'roster',source:'ESPN roster',updatedAt:new Date(now-2000).toISOString(),stats:{sample:5}};
 const g={...game(),autoEnrichment:badSummary(),autoPlayers:[roster],autoLineups:[roster]},records=[{...payload(g).records[0],kind:'injury',status:'out'}];apply(g,{},records);assert.equal(player(g).role,'Goalie');
 const safe=predictionInputsAt(JSON.parse(JSON.stringify(g)),{},now).game;assert.equal(player(safe).role,'');assert.equal(player(safe).availability,0);assert.equal(player(safe).confirmedStarter,false);assert.deepEqual(player(safe).stats,{});assert.equal(safe.autoLineups.length,0);
});

test('unclassified legacy automatic rows and summary-derived aggregates remain excluded',()=>{
 const g={...game(),autoEnrichment:badSummary(),autoPlayers:[{team:'Home',name:'Legacy'}],autoLineup:{ratingDifference:50},participationSummary:{coverage:1},participationProjections:[{expectedShare:1}],autoContext:{factors:{homeMotivation:100}},eventEnvironment:{x:1},advancedDataset:{x:1}};apply(g);
 const result=predictionInputsAt(g,{},now);assert.equal(result.game.autoPlayers.length,1);assert.ok(result.audit.excluded['auto_player:summary_parent_unavailable']);for(const key of ['autoLineup','participationSummary','autoContext','eventEnvironment','advancedDataset'])assert.equal(result.game[key],null);assert.deepEqual(result.game.participationProjections,[]);
});

test('adapter assertions carry current snapshot and native event identities through JSON restart',()=>{
 const g=game();apply(g);const copy=JSON.parse(JSON.stringify(g));assert.equal(scopeState(copy),null);assert.equal(player(copy).availabilityEventIdentity.eventId,g.id);assert.equal(player(copy).availabilitySnapshotHash,copy.availabilityProviderEvidence.snapshotHash);assert.deepEqual(g,copy);
});

test('wrong event, rescheduled start, team swap and final status cannot reuse a provider assertion',()=>{
 const original=game();apply(original);
 for(const mutate of [g=>g.id='nhl-other',g=>g.startTime='2099-02-01T18:30:00Z',g=>[g.away,g.home]=[g.home,g.away],g=>g.statusKey='final']){
  const g=structuredClone(original);mutate(g);assert.ok(scopeState(g));const result=predictionInputsAt(g,{},now);assert.equal(result.game.autoPlayers.length,0);assert.equal(result.game.autoLineups.length,0);
 }
});

test('ambiguous event sides cannot accept a preferred-provider assertion at import',()=>{
 const g=game();g.home.abbr='AWY';const result=apply(g);assert.equal(result.accepted,0);assert.ok(result.rejected.invalid_team_or_native_player_identity);assert.equal(g.autoPlayers.length,0);
});

test('native player identity and provider source-reference mismatches cannot be rescued',()=>{
 const original=game();apply(original);
 for(const mutate of [g=>player(g).sourceAthleteId='nhl:456',g=>player(g).availabilityEventIdentity.playerIdNamespace='espn',g=>player(g).sourceReference='https://example.com/different',g=>player(g).availabilitySnapshotHash='f'.repeat(64)]){
  const g=structuredClone(original);mutate(g);assert.ok(scopeState(g));
 }
});

test('snapshot conflict, future source clock and expired assertions remain rejected independently',()=>{
 const original=game();apply(original);
 for(const mutate of [g=>g.availabilityProviderEvidenceByProvider['Independent fixture'].conflict=true,g=>player(g).updatedAt=new Date(now+1000).toISOString(),g=>player(g).sourceObservationAt=new Date(now+1000).toISOString(),g=>player(g).availabilityExpiresAt=new Date(now).toISOString()]){
  const g=structuredClone(original);mutate(g);assert.ok(scopeState(g));
 }
 assert.ok(scopeState(original,now+11*60000));assert.ok(scopeState(original,Date.parse(original.startTime)));
});

test('unbound legacy preferred-provider rows stay unknown and cannot silently become current confirmations',()=>{
 const g=game();apply(g);for(const rows of [g.autoPlayers,g.autoLineups])for(const row of rows){delete row.availabilityEventIdentity;delete row.availabilitySourceRows;}
 const result=predictionInputsAt(g,{},now);assert.equal(result.game.autoPlayers.length,0);assert.equal(result.game.autoLineups.length,0);assert.ok(result.audit.excluded['auto_player:provider_event_binding_unknown']);
});

test('a withdrawn old observation cannot borrow a newer snapshot receipt after restart',()=>{
 const g=game();apply(g);const old=structuredClone(g.autoPlayers),lineups=structuredClone(g.autoLineups);apply(g,{observedAt:new Date(now).toISOString()},[]);g.autoPlayers=old;g.autoLineups=lineups;
 const safe=predictionInputsAt(JSON.parse(JSON.stringify(g)),{},now).game;assert.equal(safe.autoPlayers.length,0);assert.equal(safe.autoLineups.length,0);
});

const baseball=()=>{
 const raw={id:'401000001',date:'2099-02-01T18:20:00Z',season:{year:2099,type:2},status:{type:{state:'pre',name:'STATUS_SCHEDULED'}},competitions:[{id:'401000001',date:'2099-02-01T18:20:00Z',competitors:['away','home'].map((side,i)=>({homeAway:side,team:{id:String(i+1),displayName:side,abbreviation:side==='away'?'AWY':'HOM'},probables:[{name:'probableStartingPitcher',playerId:String(100+i),athlete:{id:String(100+i),displayName:'Pitcher '+i,position:'SP'}}]}))}]};
 const g=parseEspnEvent(raw,{key:'mlb',label:'MLB',group:'Baseball'},{provider:'ESPN',fetchedAt:new Date(now-1000).toISOString(),cacheState:'network'});applyScoreboardStarters([g],{now});g.autoEnrichment=badSummary();return g;
};

test('independently bound scoreboard projections survive summary rejection without confirmation or health',()=>{
 const g=baseball();assert.equal(g.autoPlayers.length,2);const safe=predictionInputsAt(g,{},now).game;assert.equal(safe.autoPlayers.length,2);assert.equal(safe.autoLineup,null);for(const row of safe.autoPlayers){assert.equal(row.confirmedStarter,false);assert.equal(row.availability,null);}
});

test('scoreboard binding and expiry still apply when the summary is unusable',()=>{
 const g=baseball();g.id='401999999';assert.equal(predictionInputsAt(g,{},now).game.autoPlayers.length,0);const h=baseball();assert.equal(predictionInputsAt(h,{},now+15*60000).game.autoPlayers.length,0);
});

test('actual prediction and issuance freeze independently scoped inputs without a summary confidence claim',async()=>{
 const g={...game(),autoEnrichment:badSummary()};apply(g);const original=structuredClone(g),prediction=predictGame(g,1,{now}),coverage=prediction.evidenceCoverage;
 assert.equal(coverage.sides.away.criticalStarterStatus,'confirmed_record_present');assert.equal(coverage.sides.away.injuryCoverage,'unknown');assert.equal(coverage.sides.away.modelInputs.players[0].availabilityEventIdentity.eventId,g.id);assert.ok(prediction.inputChronology.excluded['autoEnrichment:after_information_cutoff']);
 const file=join(process.env.OMNIMOD_SPORTS_DATA_DIR,'provider-parent-isolation.jsonl');await recordPredictionJournal({guildId:'provider-parent-fixture',generatedAt:new Date(now).toISOString(),games:[g],predictions:[{...prediction,predictionGeneratedAt:new Date(now).toISOString()}]},{file,now});
 const issued=(await readPredictionJournal(file)).find(row=>row.type==='forecast');assert.equal(issued.payload.evidenceCoverage.sides.away.modelInputs.players[0].availabilitySnapshotHash,player(g).availabilitySnapshotHash);assert.deepEqual(g,original);
 assert.equal(buildEvidenceCoverage(predictionInputsAt(g,{},now).game,{now}).summary.receiptFresh,false);
});

test('issued evidence retains each independent provider receipt rather than borrowing the last source clock',()=>{
 const g={...game(),autoEnrichment:badSummary()},records=[{...payload(g).records[0],kind:'injury',status:'out'}];apply(g,{provider:'Injury fixture'},records);apply(g,{provider:'Role fixture',observedAt:new Date(now-500).toISOString()});
 const prediction=predictGame(g,1,{now}),row=prediction.evidenceCoverage.sides.away.modelInputs.players[0];assert.equal(prediction.evidenceCoverage.sides.away.criticalStarterStatus,'projected_or_unavailable');assert.equal(player(g).availability,0);
 assert.equal(row.availabilityProviderSources.length,2);assert.deepEqual(row.availabilityProviderSources.map(input=>input.provider).sort(),['Injury fixture','Role fixture']);for(const input of row.availabilityProviderSources){assert.equal(input.inputState,'current_bound_assertion');assert.equal(input.eventIdentity.eventId,g.id);}
 const health=row.availabilityProviderSources.find(input=>input.provider==='Injury fixture'),role=row.availabilityProviderSources.find(input=>input.provider==='Role fixture');assert.equal(health.sourceObservationAt,new Date(now-1000).toISOString());assert.equal(role.sourceObservationAt,new Date(now-500).toISOString());assert.equal(health.availabilityObserved,true);assert.equal(role.availabilityObserved,false);
 player(g).availabilityEventIdentity.eventId='mutated after inference';assert.equal(row.availabilityEventIdentity.eventId,'nhl-2099020001');assert.ok(row.availabilityProviderSources.every(input=>input.eventIdentity.eventId==='nhl-2099020001'));
});
