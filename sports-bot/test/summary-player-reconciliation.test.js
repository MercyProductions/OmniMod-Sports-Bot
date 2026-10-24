import test from 'node:test';
import assert from 'node:assert/strict';
import {parseEspnSummary} from '../src/autoEnrichment.js';
import {buildSportModelPrediction} from '../src/sportModels.js';
import {predictionInputsAt} from '../src/inputChronology.js';
import {hasAvailabilityObservation} from '../src/dataValidation.js';
import {buildEvidenceCoverage} from '../src/evidenceCoverage.js';
import {predictGame} from '../src/predictionEngine.js';
import {recordPredictionJournal,readPredictionJournal} from '../src/predictionJournal.js';
import {join} from 'node:path';
import {reconcileAvailabilityRows} from '../src/availabilityReconciliation.js';
const now=Date.parse('2099-02-01T18:00:00Z'),meta={fetchedAt:new Date(now).toISOString(),cacheState:'network'};
const game=()=>({id:'401000001',source:'ESPN public scoreboard',leagueKey:'mlb',league:'MLB',sportGroup:'Baseball',statusKey:'scheduled',startTime:'2099-02-01T20:00Z',away:{id:'1',name:'Away',abbr:'AWY'},home:{id:'2',name:'Home',abbr:'HOM'}});
const injury=(status='Out')=>({athlete:{id:'99',displayName:'Starter'},status});
const summary=()=>({header:{id:'401000001',competitions:[{id:'401000001',date:game().startTime,competitors:[{homeAway:'away',team:{id:'1',displayName:'Away'},probables:[{athlete:{id:'99',displayName:'Starter',position:{displayName:'Starting Pitcher'}},displayName:'Probable Starting Pitcher',statistics:{splits:{categories:[{name:'ERA',value:2.1}]}}}]},{homeAway:'home',team:{id:'2',displayName:'Home'}}]}]},injuries:[{team:{id:'1',displayName:'Away'},injuries:[injury()]}]});
const parsed=(payload=summary(),g=game())=>parseEspnSummary(payload,g,meta);

test('an injury update retains the same pitcher role and observed statistics without clearing the restriction',()=>{
 const row=parsed().players[0];assert.equal(row.role,'Starting Pitcher');assert.equal(row.stats.ERA,2.1);assert.equal(row.availability,0);assert.equal(row.starter,true);assert.equal(row.confirmedStarter,false);
});

test('same-time contradictory injury rows are conservative and independent of array order',()=>{
 const a=summary(),b=summary();a.injuries[0].injuries=[injury('Out'),injury('Available')];b.injuries[0].injuries=[injury('Available'),injury('Out')];
 for(const payload of [a,b]){const row=parsed(payload).players[0];assert.equal(row.availability,0);assert.equal(row.availabilityConflict,true);}
});

test('the specialist still sees an injured starting pitcher when the injury row omits position',()=>{
 const g=game();g.autoPlayers=parsed().players;const p=buildSportModelPrediction(g,{modelLogit:0,now}),role=p.availabilityEvidence.roles.find(row=>row.side==='away'&&row.role==='starter');
 assert.equal(role.observedPlayers,1);assert.equal(role.value,-.55);
});

test('original projected and injury observations survive JSON without being overwritten or counted twice',()=>{
 const payload=summary(),original=structuredClone(payload),result=parsed(payload),row=JSON.parse(JSON.stringify(result.players[0]));
 assert.equal(result.players.length,1);assert.equal(row.availabilitySourceRows.length,2);assert.deepEqual(row.availabilitySourceRows.map(r=>r.summaryObservationType),['probable','injury']);assert.equal(row.availabilitySourceRows[0].role,'Starting Pitcher');assert.equal(row.availabilitySourceRows[1].role,'');assert.equal(row.availabilitySourceRows[1].availability,0);assert.deepEqual(payload,original);
});

test('roster-only goalie role remains known when a same-player injury omits position',()=>{
 const g={...game(),leagueKey:'nhl',league:'NHL',sportGroup:'Hockey'},payload=summary();delete payload.header.competitions[0].competitors[0].probables;payload.rosters=[{team:{id:'1',displayName:'Away'},roster:[{athlete:{id:'99',displayName:'Starter'},position:{displayName:'Goalie'},starter:true}]}];
 const result=parsed(payload,g);assert.equal(result.players[0].role,'Goalie');assert.equal(result.players[0].availability,0);assert.equal(result.players[0].confirmedStarter,false);g.autoPlayers=result.players;g.autoLineups=result.lineups;const model=buildSportModelPrediction(g,{modelLogit:0,now});assert.equal(model.availabilityEvidence.roles.find(row=>row.side==='away'&&row.role==='goalie').observedPlayers,1);assert.equal(buildEvidenceCoverage(g,{now}).sides.away.criticalStarterStatus,'projected_or_unavailable');
});

test('missing-position NFL injury updates retain the known quarterback role and restriction',()=>{
 const g={...game(),leagueKey:'nfl',league:'NFL',sportGroup:'Football'},payload=summary();payload.header.competitions[0].competitors[0].probables[0].athlete.position={displayName:'Quarterback'};
 const result=parsed(payload,g);assert.equal(result.players[0].role,'Quarterback');g.autoPlayers=result.players;const model=buildSportModelPrediction(g,{modelLogit:0,now});assert.equal(model.availabilityEvidence.roles.find(row=>row.side==='away'&&row.role==='quarterback').value,-.55);
});

test('generic pitcher metadata can coexist with an explicit starting role but a conflicting position cannot confirm it',()=>{
 const payload=summary();payload.injuries[0].injuries[0].athlete.position={displayName:'Pitcher'};assert.equal(parsed(payload).players[0].role,'Starting Pitcher');
 payload.injuries[0].injuries[0].athlete.position={displayName:'Catcher'};const row=parsed(payload).players[0];assert.equal(row.summaryRoleEvidence.status,'conflict');assert.equal(row.confirmedStarter,false);assert.equal(row.starterEvidenceConflict,true);assert.equal(row.availability,0);assert.equal(row.confirmationStatus,'conflicting_role_reports');
});

test('contradictory duplicate measurements stay missing rather than selecting the last value',()=>{
 const a=summary(),rows=a.header.competitions[0].competitors[0].probables,other=structuredClone(rows[0]);other.statistics.splits.categories[0].value=3.2;rows.push(other);const b=structuredClone(a);b.header.competitions[0].competitors[0].probables.reverse();
 for(const payload of [a,b]){const row=parsed(payload).players[0];assert.equal(row.stats.ERA,null);assert.deepEqual(row.summaryStatEvidence.conflicts,['ERA']);assert.equal(row.form,50);assert.equal(row.availability,0);}
});

test('identical duplicate projections preserve measurements but never manufacture injury observations',()=>{
 const payload=summary();payload.injuries=[];const rows=payload.header.competitions[0].competitors[0].probables;rows.push(structuredClone(rows[0]));const result=parsed(payload);assert.equal(result.players.length,1);assert.equal(result.players[0].stats.ERA,2.1);assert.equal(result.players[0].availability,null);assert.equal(hasAvailabilityObservation(result.players[0]),false);assert.equal(result.meta.injuryCount,0);
});

test('same athlete ID on the opposite team does not inherit this team injury assertion',()=>{
 const payload=summary();payload.header.competitions[0].competitors[1].probables=[structuredClone(payload.header.competitions[0].competitors[0].probables[0])];const result=parsed(payload),away=result.players.find(r=>r.team==='Away'),home=result.players.find(r=>r.team==='Home');assert.equal(away.availability,0);assert.equal(home.availability,null);assert.equal(home.confirmedStarter,false);assert.equal(home.starterEvidenceConflict,true);
});

test('expired injury observations reveal an unknown-health projection instead of erasing its role or reviving old restrictions',()=>{
 const result=parsed(),g=game();result.players[0].availabilitySourceRows.find(row=>row.summaryObservationType==='injury').availabilityExpiresAt=new Date(now+5*60000).toISOString();g.autoPlayers=JSON.parse(JSON.stringify(result.players));g.autoLineups=result.lineups;
 const safe=predictionInputsAt(g,{},now+6*60000).game;assert.equal(safe.autoPlayers[0].role,'Starting Pitcher');assert.equal(safe.autoPlayers[0].stats.ERA,2.1);assert.equal(safe.autoPlayers[0].availability,null);assert.notEqual(safe.autoPlayers[0].active,false);assert.equal(hasAvailabilityObservation(safe.autoPlayers[0]),false);assert.equal(g.autoPlayers[0].availability,0);
});

test('an expired roster cannot continue supplying a derived role to an otherwise positionless injury',()=>{
 const g={...game(),leagueKey:'nhl',league:'NHL',sportGroup:'Hockey'},payload=summary();delete payload.header.competitions[0].competitors[0].probables;payload.rosters=[{team:{id:'1',displayName:'Away'},roster:[{athlete:{id:'99',displayName:'Starter'},position:{displayName:'Goalie'},starter:true}]}];const result=parsed(payload,g);g.autoPlayers=result.players;g.autoLineups=result.lineups;g.autoLineups[0].availabilityExpiresAt=new Date(now+5*60000).toISOString();assert.equal(g.autoPlayers[0].role,'Goalie');
 const safe=predictionInputsAt(JSON.parse(JSON.stringify(g)),{},now+6*60000).game;assert.equal(safe.autoPlayers[0].summaryRoleEvidence.status,'unknown');assert.equal(safe.autoPlayers[0].availability,0);assert.equal(safe.autoPlayers[0].confirmedStarter,false);
});

test('source roles, unknown medical state and measurement conflicts are frozen in issued evidence',async()=>{
 const g=game(),result=parsed();g.autoPlayers=result.players;g.autoLineups=result.lineups;g.autoEnrichment=result.meta;const prediction=predictGame(g,1,{now}),file=join(process.env.OMNIMOD_SPORTS_DATA_DIR,'summary-player-journal.jsonl');
 await recordPredictionJournal({guildId:'summary-player-fixture',generatedAt:new Date(now).toISOString(),games:[g],predictions:[{...prediction,predictionGeneratedAt:new Date(now).toISOString()}]},{file,now});
 const record=(await readPredictionJournal(file)).find(row=>row.type==='forecast'),player=record.payload.evidenceCoverage.sides.away.modelInputs.players[0];assert.equal(player.summaryRoleEvidence.selectedRole,'Starting Pitcher');assert.deepEqual(player.summaryStatEvidence.sourceKinds,['probable']);assert.equal(player.summaryStatEvidence.samplePeriodVerified,false);assert.equal(record.payload.evidenceCoverage.sides.away.criticalStarterStatus,'projected_or_unavailable');
});

test('an independent provider role remains usable while a positionless summary injury still restricts that player',()=>{
 const injured=parsed().players[0].availabilitySourceRows.find(row=>row.summaryObservationType==='injury'),provider={...injured,summaryObservationType:undefined,source:'Independent provider starter',availabilityProvider:'fixture',role:'Starting Pitcher',starter:true,confirmedStarter:true,availability:null,availabilityEvidence:'role_prior_not_injury_clearance',status:'Confirmed event starter; health unknown',stats:{independentMetric:7}};
 for(const rows of [[injured,provider],[provider,injured]]){const view=reconcileAvailabilityRows(rows)[0];assert.equal(view.role,'Starting Pitcher');assert.equal(view.stats.independentMetric,7);assert.equal(view.availability,0);assert.equal(view.confirmedStarter,false);}
});
