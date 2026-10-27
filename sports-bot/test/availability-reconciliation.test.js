import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {applyAvailabilitySnapshot} from '../src/availabilityProvider.js';
import {predictionInputsAt} from '../src/inputChronology.js';
import {buildEvidenceCoverage} from '../src/evidenceCoverage.js';
import {enrichGamesAutomatically} from '../src/autoEnrichment.js';
import {config} from '../src/config.js';
import {predictGame} from '../src/predictionEngine.js';
const now=Date.parse('2099-02-01T18:00:00Z');
const game=()=>({id:'nhl-2098020001',league:'NHL',leagueKey:'nhl',sportGroup:'Hockey',statusKey:'scheduled',startTime:'2099-02-02T18:00:00Z',away:{name:'Away',abbr:'AAA'},home:{name:'Home',abbr:'HHH'}});
const row=(change={})=>({kind:'goalie_starter',eventId:game().id,startTime:game().startTime,teamAbbr:'AAA',playerId:'123',playerIdNamespace:'nhl',name:'Goalie A',...change});
const snapshot=(records=[row()],change={})=>({schema:'sports-player-availability-v1',provider:'Provider A',sourceReference:'https://example.com/report',observedAt:new Date(now-1000).toISOString(),expiresAt:new Date(now+20*60000).toISOString(),records,...change});
const apply=(g,records,change={},clock=now)=>applyAvailabilitySnapshot([g],snapshot(records,change),{now:clock});
const base=()=>({id:'original-roster',team:'Away',name:'Goalie A',sourceAthleteId:'nhl:123',role:'Goalie',starter:true,confirmedStarter:true,availability:null,status:'unknown',source:'Independent roster',updatedAt:new Date(now-5000).toISOString(),stats:{sample:7}});
const player=g=>g.autoPlayers.find(p=>p.sourceAthleteId==='nhl:123');

test('provider omission preserves independent same-player evidence through JSON restart',()=>{
 let g={...game(),autoPlayers:[base()],autoLineups:[base()]};const original=structuredClone(g.autoPlayers[0]);apply(g,[row({kind:'injury',status:'out'})]);g=JSON.parse(JSON.stringify(g));
 apply(g,[],{observedAt:new Date(now+1000).toISOString()},now+1000);
 assert.equal(player(g)?.id,original.id);assert.deepEqual(player(g)?.stats,original.stats);assert.equal(player(g)?.availability,null);assert.equal(g.autoLineups[0]?.id,original.id);
});
test('expired external assertion does not erase an independent same-player roster input',()=>{
 const g={...game(),autoPlayers:[base()],autoLineups:[base()]};apply(g,[row({kind:'injury',status:'out'})]);g.autoLineup={confirmedSides:1};g.participationSummary={away:{coverage:1}};
 const safe=predictionInputsAt(g,{},now+21*60000).game;assert.equal(player(safe)?.id,'original-roster');assert.equal(player(safe)?.availability,null);assert.notEqual(player(safe)?.active,false);assert.equal(safe.autoLineup,null);assert.equal(safe.participationSummary,null);assert.equal(player(g).active,false);
});
test('expiry is checked per source before combining starter and negative injury evidence',()=>{
 const g=game();apply(g,[row({kind:'injury',status:'out'})],{expiresAt:new Date(now+10*60000).toISOString()});apply(g,[row()],{provider:'Provider B'});
 assert.equal(player(g).active,false);const safe=predictionInputsAt(g,{},now+11*60000).game;assert.equal(player(safe).confirmedStarter,true);assert.notEqual(player(safe).active,false);assert.equal(player(safe).availability,null);assert.equal(buildEvidenceCoverage(safe,{now:now+11*60000}).sides.away.injuryCoverage,'unknown');
});
test('switching providers cannot allow an older snapshot to replace that providers newer state',()=>{
 const g=game();apply(g,[row({kind:'injury',status:'out'})]);apply(g,[row({kind:'injury',status:'available'})],{observedAt:new Date(now+1000).toISOString()},now+1000);apply(g,[row()],{provider:'Provider B'},now+2000);
 const result=apply(g,[row({kind:'injury',status:'out'})],{},now+3000);assert.equal(result.rejected.older_snapshot_not_selected,1);assert.notEqual(player(g).active,false);assert.equal(player(g).availability,100);
});
test('same-time conflict remains quarantined after another provider is loaded',()=>{
 const g=game();apply(g,[row()]);apply(g,[row({playerId:'456',name:'Goalie B'})]);apply(g,[],{provider:'Provider B'});apply(g,[row()]);assert.equal(g.autoLineups.length,0);
});
test('one native player cannot be asserted for both event teams',()=>{
 const g=game(),result=apply(g,[row(),row({teamAbbr:'HHH'})]);assert.equal(result.accepted,0);assert.equal(g.autoLineups.length,0);assert.equal(g.autoPlayers.length,0);
});
test('different providers asserting different starting goalies cannot manufacture two confirmed starters',()=>{
 const g=game();apply(g,[row()]);apply(g,[row({playerId:'456',name:'Goalie B'})],{provider:'Provider B'});const report=buildEvidenceCoverage(g,{now});assert.equal(report.sides.away.confirmedStarters,0);assert.notEqual(report.sides.away.criticalStarterStatus,'confirmed_record_present');assert.ok(report.sides.away.lineupEvidenceConflicts>0);
});
test('conflicting injury assertions never select a healthy value by array order',()=>{
 for(const records of [[row({kind:'injury',status:'out'}),row({kind:'injury',status:'available'})],[row({kind:'injury',status:'available'}),row({kind:'injury',status:'out'})]]){
  const g=game();apply(g,records);assert.equal(player(g).availability,0);assert.equal(player(g).active,false);assert.equal(player(g).availabilityConflict,true);
 }
});
test('malformed individual rows are rejected without suppressing valid independent observations',()=>{
 const g=game();let result;assert.doesNotThrow(()=>{result=apply(g,[null,42,row()]);});assert.equal(result.accepted,1);assert.equal(g.autoLineups.length,1);
});
test('local-only enrichment derives participation and lineup evidence after applying optional availability',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'sports-availability-order-'));t.after(()=>rm(dir,{recursive:true,force:true}));const file=join(dir,'provider.json'),at=Date.now(),g=game();g.startTime=new Date(at+86400000).toISOString();
 const payload=snapshot([{...row(),startTime:g.startTime}],{observedAt:new Date(at-1000).toISOString(),expiresAt:new Date(at+20*60000).toISOString()});await writeFile(file,JSON.stringify(payload));
 const prior=config.availabilityProviderSnapshotFile;config.availabilityProviderSnapshotFile=file;t.after(()=>{config.availabilityProviderSnapshotFile=prior;});
 const result=await enrichGamesAutomatically([g],new Date(at),{localOnly:true});assert.equal(result.games[0].autoLineup.away.criticalRoleEvidence.confirmed,1);assert.equal(result.games[0].participationProjections.length,1);assert.equal(result.games[0].autoLineup.away.criticalRoleEvidence.healthUnknown,1);
});

test('a newer empty snapshot is remembered before any later stale report arrives',()=>{
 const g=game();apply(g,[],{observedAt:new Date(now+1000).toISOString()},now+1000);
 const result=apply(g,[row()],{},now+2000);assert.equal(result.rejected.older_snapshot_not_selected,1);assert.equal(g.autoLineups.length,0);
});
test('cross-provider opposing-team identity conflicts remain unconfirmed',()=>{
 const g=game();apply(g,[row()]);apply(g,[row({teamAbbr:'HHH'})],{provider:'Provider B'});
 const report=buildEvidenceCoverage(g,{now});assert.equal(report.sides.away.confirmedStarters,0);assert.equal(report.sides.home.confirmedStarters,0);
});
test('different-provider starter conflict resolves only when the conflicting original input expires',()=>{
 const g=game();apply(g,[row()],{expiresAt:new Date(now+5*60000).toISOString()});apply(g,[row({playerId:'456',name:'Goalie B'})],{provider:'Provider B'});
 const safe=predictionInputsAt(g,{},now+6*60000).game;assert.equal(safe.autoLineups.length,1);assert.equal(safe.autoLineups[0].sourceAthleteId,'nhl:456');assert.equal(safe.autoLineups[0].confirmedStarter,true);assert.equal(g.autoLineups.filter(p=>p.confirmedStarter).length,0);
});
test('a future original observation cannot hide behind a later materialized source label',()=>{
 const g=game();apply(g,[row({kind:'injury',status:'out'})]);apply(g,[row()],{provider:'Provider B'});
 player(g).availabilitySourceRows[0].updatedAt=new Date(now+60000).toISOString();
 const safe=predictionInputsAt(g,{},now).game;assert.notEqual(player(safe).active,false);assert.equal(player(safe).availability,null);
});

test('actual inference removes expired injury dependency while retaining current unverified-health role evidence',()=>{
 const g=game();apply(g,[row({kind:'injury',status:'out'})],{expiresAt:new Date(now+5*60000).toISOString()});apply(g,[row()],{provider:'Provider B'});const original=structuredClone(g);
 const prediction=predictGame(g,1,{now:now+6*60000});assert.equal(prediction.evidenceCoverage.sides.away.criticalStarterStatus,'confirmed_record_present');assert.equal(prediction.evidenceCoverage.sides.away.modelInputs.players[0].availabilityObserved,false);assert.equal(prediction.evidenceCoverage.sides.away.injuryCoverage,'unknown');assert.deepEqual(g,original);
});
test('provider receipt maps preserve reserved JavaScript property names across restart',()=>{
 let g=game();apply(g,[row()],{provider:'__proto__'});g=JSON.parse(JSON.stringify(g));apply(g,[],{provider:'Other'});const result=apply(g,[row({playerId:'456',name:'Goalie B'})],{provider:'__proto__',observedAt:new Date(now-2000).toISOString()});assert.equal(result.rejected.older_snapshot_not_selected,1);
});
