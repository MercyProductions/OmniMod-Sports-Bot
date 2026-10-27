import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {config} from '../src/config.js';
import {enrichGamesAutomatically} from '../src/autoEnrichment.js';
import {applyAvailabilitySnapshot,applyAvailabilitySnapshotFile} from '../src/availabilityProvider.js';
import {buildEvidenceCoverage} from '../src/evidenceCoverage.js';
import {predictionInputsAt} from '../src/inputChronology.js';
const now=Date.parse('2099-02-01T18:00:00Z');
const game=()=>({id:'nhl-2098020001',leagueKey:'nhl',sportGroup:'Hockey',statusKey:'scheduled',startTime:'2099-02-02T18:00:00Z',away:{name:'Away',abbr:'AAA'},home:{name:'Home',abbr:'HHH'}});
const row=(change={})=>({kind:'goalie_starter',eventId:game().id,startTime:game().startTime,teamAbbr:'AAA',playerId:'123',playerIdNamespace:'nhl',name:'Goalie A',...change});
const snapshot=(records=[row()],change={})=>({schema:'sports-player-availability-v1',provider:'Example Provider',sourceReference:'https://example.com/report',observedAt:'2099-02-01T17:59:00Z',expiresAt:'2099-02-01T18:20:00Z',records,...change});
test('an explicit event-starter snapshot can fill the goalie gap without asserting health clearance',()=>{
 const g=game(),result=applyAvailabilitySnapshot([g],snapshot(),{now});assert.equal(result.accepted,1);const report=buildEvidenceCoverage(g,{now});assert.equal(report.sides.away.criticalStarterStatus,'confirmed_record_present');assert.equal(report.sides.away.modelInputs.players[0].availabilityObserved,false);assert.equal(report.sides.away.injuryCoverage,'unknown');assert.equal(g.autoPlayers[0].sourceAthleteId,'nhl:123');
});
test('an injury report can veto a starter while leaving team-wide medical coverage unknown',()=>{
 const g=game();applyAvailabilitySnapshot([g],snapshot([row(),row({kind:'injury',status:'out'})]),{now});const report=buildEvidenceCoverage(g,{now});assert.equal(report.sides.away.confirmedStarters,0);assert.equal(report.sides.away.criticalStarterStatus,'projected_or_unavailable');assert.equal(g.autoPlayers[0].availability,0);assert.equal(g.availabilityProviderEvidence.injuryCoverage,'individual_reports_only_not_team_clearance');
});
test('future, expired, unzoned and overlong observation windows reject without changing games',()=>{
 for(const change of [{observedAt:'2099-02-01T19:00:00Z'},{expiresAt:'2099-02-01T18:00:00Z'},{observedAt:'2099-02-01T17:59:00'},{expiresAt:'2099-02-02T18:20:00Z'}]){const g=game(),original=structuredClone(g);assert.equal(applyAvailabilitySnapshot([g],snapshot(undefined,change),{now}).status,'rejected');assert.deepEqual(g,original);}
});
test('source references cannot contain credentials, secret query strings or non-HTTPS links',()=>{
 for(const sourceReference of ['https://user:secret@example.com/report','https://example.com/report?token=secret','http://example.com/report'])assert.equal(applyAvailabilitySnapshot([game()],snapshot(undefined,{sourceReference}),{now}).status,'rejected');
});
test('providers must map explicit NHL player/event/team identities rather than guessing another namespace',()=>{
 for(const change of [{eventId:'other'},{startTime:'2099-02-02T18:01:00Z'},{teamAbbr:'OTHER'},{playerIdNamespace:'espn'}])assert.equal(applyAvailabilitySnapshot([game()],snapshot([row(change)]),{now}).accepted,0);
});
test('two distinct confirmed goalies for the same side are quarantined',()=>{
 const g=game(),result=applyAvailabilitySnapshot([g],snapshot([row(),row({playerId:'456',name:'Goalie B'})]),{now});assert.equal(result.accepted,0);assert.equal(result.rejected.conflicting_event_starters,1);assert.equal(g.autoLineups.length,0);
});
test('an existing differently namespaced player with the same name cannot borrow confirmation',()=>{
 const g=game();g.autoPlayers=[{name:'Goalie A',team:'Away',sourceAthleteId:'espn:999'}];const result=applyAvailabilitySnapshot([g],snapshot(),{now});assert.equal(result.accepted,0);assert.equal(result.rejected.unverified_player_namespace_mapping,1);assert.equal(g.autoPlayers.length,1);
});
test('newer provider assertions replace prior ones while preserving unrelated manual data and raw audit observations',()=>{
 const g=game();g.autoPlayers=[{name:'Other Player',team:'Away',sourceAthleteId:'manual:1'}];applyAvailabilitySnapshot([g],snapshot([row({kind:'injury',status:'out'})]),{now});
 applyAvailabilitySnapshot([g],snapshot([row({kind:'injury',status:'available'})],{observedAt:'2099-02-01T18:00:00Z'}),{now:now+1000});assert.equal(g.autoPlayers.find(p=>p.sourceAthleteId==='nhl:123').availability,100);assert.ok(g.autoPlayers.some(p=>p.sourceAthleteId==='manual:1'));assert.equal(g.availabilityObservations.length,2);
});
test('same-time contradictory snapshots remove effective provider assertions until a later observation',()=>{
 const g=game();applyAvailabilitySnapshot([g],snapshot(),{now});const conflict=applyAvailabilitySnapshot([g],snapshot([row({playerId:'456',name:'Goalie B'})]),{now});assert.equal(conflict.rejected.conflicting_same_time_snapshot,1);assert.equal(g.autoLineups.length,0);assert.equal(g.availabilityProviderEvidence.conflict,true);
 applyAvailabilitySnapshot([g],snapshot(),{now});assert.equal(g.autoLineups.length,0);
});
test('expired provider players and dependent lineup aggregates cannot enter later inference',()=>{
 const g=game();applyAvailabilitySnapshot([g],snapshot(),{now});const filtered=predictionInputsAt(g,{},now+21*60000);assert.equal(filtered.game.autoPlayers.length,0);assert.equal(filtered.game.autoLineups.length,0);assert.equal(filtered.game.availabilityProviderEvidence,null);assert.equal(g.autoPlayers.length,1);
});
test('an empty current provider snapshot removes old assertions without declaring previously injured players healthy',()=>{
 const g=game();applyAvailabilitySnapshot([g],snapshot([row({kind:'injury',status:'out'})]),{now});applyAvailabilitySnapshot([g],snapshot([],{observedAt:'2099-02-01T18:00:00Z'}),{now:now+1000});assert.equal(g.autoPlayers.length,0);assert.equal(buildEvidenceCoverage(g,{now:now+1000}).sides.away.injuryCoverage,'unknown');
});
test('optional file adapter is disabled by default and handles bounded local exports without exposing malformed contents',async t=>{
 assert.equal((await applyAvailabilitySnapshotFile([game()])).status,'disabled');const dir=await mkdtemp(join(tmpdir(),'sports-availability-fixture-'));assert.ok(resolve(dir).startsWith(resolve(tmpdir())+sep));t.after(()=>rm(dir,{recursive:true,force:true}));const file=join(dir,'snapshot.json');await writeFile(file,JSON.stringify(snapshot()));assert.equal((await applyAvailabilitySnapshotFile([game()],{file,now})).accepted,1);await writeFile(file,'not JSON; private content');const result=await applyAvailabilitySnapshotFile([game()],{file,now});assert.equal(result.status,'unavailable');assert.ok(!JSON.stringify(result).includes('private content'));
});

test('the configured provider file remains usable in local-only enrichment without network requests',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'sports-availability-offline-'));assert.ok(resolve(dir).startsWith(resolve(tmpdir())+sep));t.after(()=>rm(dir,{recursive:true,force:true}));const file=join(dir,'snapshot.json'),at=Date.now();
 const input=game(),data=snapshot();data.observedAt=new Date(at-1000).toISOString();data.expiresAt=new Date(at+20*60000).toISOString();await writeFile(file,JSON.stringify(data));
 const original=config.availabilityProviderSnapshotFile,fetcher=globalThis.fetch;config.availabilityProviderSnapshotFile=file;globalThis.fetch=async()=>{throw Error('Network must not be used');};t.after(()=>{config.availabilityProviderSnapshotFile=original;globalThis.fetch=fetcher;});
 const result=await enrichGamesAutomatically([input],new Date(at),{localOnly:true});assert.equal(result.games[0].autoPlayers[0].confirmedStarter,true);assert.ok(result.diagnostics.some(x=>x.includes('local observation')));
});
