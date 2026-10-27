import test from 'node:test';
import assert from 'node:assert/strict';
import {applyAvailabilitySnapshot} from '../src/availabilityProvider.js';
import {buildEvidenceCoverage} from '../src/evidenceCoverage.js';
import {hasAvailabilityObservation} from '../src/dataValidation.js';
import {predictionInputsAt} from '../src/inputChronology.js';
import {estimatePredictionUncertainty} from '../src/uncertainty.js';
import {applyAvailabilitySnapshotFile} from '../src/availabilityProvider.js';
import {enrichGamesAutomatically} from '../src/autoEnrichment.js';
import {config} from '../src/config.js';
import {mkdtemp,writeFile,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {buildSportModelPrediction} from '../src/sportModels.js';
const now=Date.parse('2099-02-01T18:00:00Z');
const game=()=>({id:'nhl-2099020001',leagueKey:'nhl',league:'NHL',sportGroup:'Hockey',statusKey:'scheduled',startTime:'2099-02-01T18:20:00Z',away:{name:'Away',abbr:'AWY'},home:{name:'Home',abbr:'HOM'}});
const row=(change={})=>({kind:'goalie_projection',eventId:game().id,startTime:game().startTime,teamAbbr:'AWY',playerId:'123',playerIdNamespace:'nhl',name:'Projected goalie',...change});
const snapshot=(records=[row()],change={})=>({schema:'sports-player-availability-v1',provider:'Fixture Provider',sourceReference:'https://example.com/authorized-provider-export',observedAt:new Date(now-1000).toISOString(),expiresAt:new Date(now+10*60000).toISOString(),records,...change});

test('a provider can report an event goalie projection without confirmation or medical clearance',()=>{
 const g=game(),result=applyAvailabilitySnapshot([g],snapshot(),{now});assert.equal(result.accepted,1);assert.equal(g.autoPlayers[0].confirmedStarter,false);assert.equal(g.autoPlayers[0].availability,null);assert.equal(hasAvailabilityObservation(g.autoPlayers[0]),false);
 const coverage=buildEvidenceCoverage(g,{now});assert.equal(coverage.sides.away.projectedStarters,1);assert.equal(coverage.sides.away.criticalStarterStatus,'projected_or_unavailable');assert.equal(coverage.sides.away.injuryCoverage,'unknown');
});

test('extra positive upstream fields cannot upgrade a projected record into a confirmed or healthy input',()=>{
 const g=game();applyAvailabilitySnapshot([g],snapshot([row({confirmedStarter:true,availability:100,confirmationStatus:'confirmed',starter:true})]),{now});
 assert.equal(g.autoPlayers[0].confirmedStarter,false);assert.equal(g.autoPlayers[0].availability,null);assert.equal(g.autoPlayers[0].confirmationStatus,'provider_reported_projection');assert.equal(g.availabilityProviderEvidence.observationsByKind.goalie_projection,1);assert.equal(g.availabilityProviderEvidence.observationsByKind.goalie_starter,0);
});

test('a same-player injury still restricts a projection without creating team-wide medical coverage',()=>{
 const g=game(),result=applyAvailabilitySnapshot([g],snapshot([row(),row({kind:'injury',status:'out'})]),{now});assert.deepEqual(result.acceptedByKind,{goalie_starter:0,goalie_projection:1,injury:1});assert.equal(g.autoPlayers.length,1);assert.equal(g.autoPlayers[0].role,'Goalie');assert.equal(g.autoPlayers[0].availability,0);assert.equal(g.autoPlayers[0].confirmedStarter,false);assert.equal(buildEvidenceCoverage(g,{now}).sides.away.injuryCoverage,'unknown');
 const specialist=buildSportModelPrediction(g,{modelLogit:0,now});assert.equal(specialist.availabilityEvidence.roles.find(r=>r.side==='away'&&r.role==='goalie').observedPlayers,1);
});

test('different projected goalies for the same side are quarantined while independent injury observations remain',()=>{
 const g=game(),result=applyAvailabilitySnapshot([g],snapshot([row(),row({playerId:'456',name:'Other projected goalie'}),row({kind:'injury',playerId:'789',name:'Other injured player',status:'out'})]),{now});assert.equal(result.rejected.conflicting_projected_event_goalies,1);assert.equal(result.acceptedByKind.goalie_projection,0);assert.equal(result.acceptedByKind.injury,1);assert.equal(g.autoLineups.length,0);
});

test('an explicit same-snapshot confirmation supersedes redundant projections instead of losing its confirmation',()=>{
 for(const projected of [row(),row({playerId:'456',name:'Alternative projection'})]){
  const g=game(),result=applyAvailabilitySnapshot([g],snapshot([projected,row({kind:'goalie_starter'})]),{now});assert.equal(result.acceptedByKind.goalie_starter,1);assert.equal(result.acceptedByKind.goalie_projection,0);assert.equal(result.rejected.projection_superseded_by_event_starter,1);assert.equal(g.autoPlayers[0].confirmedStarter,true);assert.equal(hasAvailabilityObservation(g.autoPlayers[0]),false);
 }
});

test('a projection cannot rescue contradictory confirmed-starter assertions',()=>{
 const g=game(),result=applyAvailabilitySnapshot([g],snapshot([row(),row({kind:'goalie_starter'}),row({kind:'goalie_starter',playerId:'456',name:'Another confirmed goalie'})]),{now});assert.equal(result.accepted,0);assert.equal(result.rejected.conflicting_event_starters,1);assert.equal(g.autoLineups.length,0);
});

test('a newer projection can withdraw that providers old confirmation without clearing independent records',()=>{
 const g=game();g.autoPlayers=[{name:'Independent player',team:'Away',sourceAthleteId:'manual:1'}];applyAvailabilitySnapshot([g],snapshot([row({kind:'goalie_starter'})]),{now});
 const result=applyAvailabilitySnapshot([g],snapshot(undefined,{observedAt:new Date(now+1000).toISOString()}),{now:now+2000});const view=g.autoPlayers.find(p=>p.sourceAthleteId==='nhl:123');assert.equal(result.acceptedByKind.goalie_projection,1);assert.equal(view.confirmedStarter,false);assert.equal(view.availability,null);assert.ok(g.autoPlayers.some(p=>p.sourceAthleteId==='manual:1'));
});

test('older and same-time changed snapshots do not use a projection to bypass source chronology',()=>{
 const g=game();applyAvailabilitySnapshot([g],snapshot([row({kind:'goalie_starter'})]),{now});const same=applyAvailabilitySnapshot([g],snapshot(),{now});assert.equal(same.rejected.conflicting_same_time_snapshot,1);assert.equal(g.autoLineups.length,0);
 const h=game();applyAvailabilitySnapshot([h],snapshot([row({kind:'goalie_starter'})],{observedAt:new Date(now).toISOString()}),{now});const old=applyAvailabilitySnapshot([h],snapshot(),{now});assert.equal(old.rejected.older_snapshot_not_selected,1);assert.equal(h.autoPlayers[0].confirmedStarter,true);
});

test('serialized projections expire before inference and do not become unknown-time legacy confirmations',()=>{
 const g=game();applyAvailabilitySnapshot([g],snapshot(),{now});const stored=JSON.parse(JSON.stringify(g)),safe=predictionInputsAt(stored,{},now+11*60000).game;assert.equal(safe.autoPlayers.length,0);assert.equal(safe.autoLineups.length,0);assert.equal(buildEvidenceCoverage(safe,{now:now+11*60000}).sides.away.criticalStarterStatus,'missing');assert.equal(g.autoPlayers[0].confirmedStarter,false);
});

test('projections leave the lineup gap open and preserve the existing low-evidence late-lineup rule',()=>{
 const g=game();applyAvailabilitySnapshot([g],snapshot([row(),row({teamAbbr:'HOM',playerId:'456',name:'Home projection'})]),{now});
 const input={game:g,now,probabilities:{home:.7,away:.3,draw:0},selectedSide:'home',evidenceQuality:95,apiConfidence:95,localConfidence:95,historySamples:100,calibrationSamples:500,featureAgreement:95};
 assert.equal(estimatePredictionUncertainty(input).context.lateLineupGap,true);const result=estimatePredictionUncertainty({...input,evidenceQuality:55});assert.equal(result.context.lateLineupGap,true);assert.equal(result.isActionablePrediction,false);
});

test('the optional local exporter path works with projections and performs no provider HTTP requests',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'sports-projected-provider-'));assert.ok(resolve(dir).startsWith(resolve(tmpdir())+sep));t.after(()=>rm(dir,{recursive:true,force:true}));const file=join(dir,'snapshot.json'),at=Date.now(),g={...game(),startTime:new Date(at+20*60000).toISOString()},record={...row(),startTime:g.startTime};
 await writeFile(file,JSON.stringify(snapshot([record],{observedAt:new Date(at-1000).toISOString(),expiresAt:new Date(at+10*60000).toISOString()})));const original=config.availabilityProviderSnapshotFile;config.availabilityProviderSnapshotFile=file;t.after(()=>config.availabilityProviderSnapshotFile=original);t.mock.method(globalThis,'fetch',()=>{throw Error('No transport permitted');});
 await enrichGamesAutomatically([g],new Date(at),{localOnly:true});assert.equal(g.autoPlayers[0].confirmedStarter,false);assert.equal(g.autoPlayers[0].availability,null);assert.equal(g.autoPlayers[0].participationProjection.availabilityObserved,false);
});

test('the checked-in projection example cannot be accepted as an actual current provider observation',async()=>{
 const payload=JSON.parse(await readFile(new URL('../../examples/availability-provider.projection.example.json',import.meta.url),'utf8'));assert.equal(payload.records[0].kind,'goalie_projection');assert.equal(applyAvailabilitySnapshot([game()],payload,{now}).accepted,0);
});
