import test from 'node:test';
import assert from 'node:assert/strict';
import {estimatePredictionUncertainty} from '../src/uncertainty.js';
import {buildEvidenceCoverage} from '../src/evidenceCoverage.js';
import {predictGame} from '../src/predictionEngine.js';
import {recordPredictionJournal,readPredictionJournal} from '../src/predictionJournal.js';
const now=Date.parse('2099-02-01T18:00:00Z'),start='2099-02-01T18:20:00Z';
const player=(side,patch={})=>({athleteId:side,name:side+' goalie',team:side==='away'?'Away':'Home',role:'Goalie',starter:true,confirmedStarter:true,availability:100,status:'Available',updatedAt:'2099-02-01T17:59:00Z',...patch});
const game=(patch={})=>({id:'uncertainty-clock',leagueKey:'nhl',league:'NHL',sportGroup:'Hockey',statusKey:'scheduled',startTime:start,away:{name:'Away',abbr:'AWY'},home:{name:'Home',abbr:'HOM'},autoPlayers:[player('away')],autoLineup:{confirmedSides:1,away:{criticalStarterCount:1},home:{criticalStarterCount:0}},...patch});
const input=(g=game(),patch={})=>({game:g,now,probabilities:{away:.3,home:.7,draw:0},selectedSide:'home',evidenceQuality:55,apiConfidence:90,localConfidence:90,historySamples:80,calibrationSamples:100,featureAgreement:90,...patch});
const gap=result=>result.reasons.includes('critical lineup not fully confirmed inside 30 minutes');
test('critical lineup timing uses the explicit forecast cutoff',()=>{
 const result=estimatePredictionUncertainty(input());assert.equal(gap(result),true);assert.equal(result.recommendationStatus,'withheld');assert.equal(result.context.minutesToStart,20);
});
test('the same explicit information cutoff is invariant to later process wall clocks',t=>{
 const clock=t.mock.method(Date,'now',()=>Date.parse('2098-01-01T00:00:00Z'));
 const first=estimatePredictionUncertainty(input());clock.mock.mockImplementation(()=>Date.parse('2100-01-01T00:00:00Z'));assert.deepEqual(estimatePredictionUncertainty(input()),first);
});
test('zero confirmed critical starters is a gap, not a way to skip the check',()=>{
 for(const autoLineup of [undefined,{confirmedSides:0,away:{criticalStarterCount:0},home:{criticalStarterCount:0}}])assert.equal(gap(estimatePredictionUncertainty(input(game({autoPlayers:[],autoLineup})))),true);
});
test('forged aggregate counts or non-goalie starters cannot establish NHL goalie coverage',()=>{
 const g=game({autoPlayers:[player('away',{role:'Center'}),player('home',{role:'Center'})],autoLineup:{confirmedSides:2,away:{criticalStarterCount:1},home:{criticalStarterCount:1}}});assert.equal(gap(estimatePredictionUncertainty(input(g))),true);
});
test('one actual confirmed role per side resolves the critical-role gap despite missing aggregate counts',()=>{
 const g=game({autoPlayers:[player('away'),player('home')],autoLineup:undefined});const result=estimatePredictionUncertainty(input(g));assert.equal(gap(result),false);assert.equal(result.context.criticalRoles.home,'confirmed_record_present');
});
test('multiple distinct confirmed goalies on one side remain conflicting evidence',()=>{
 const g=game({autoPlayers:[player('away'),player('away',{athleteId:'other',name:'Other goalie'}),player('home')]});assert.equal(buildEvidenceCoverage(g,{now}).sides.away.criticalStarterStatus,'conflicting_confirmed_records');assert.equal(gap(estimatePredictionUncertainty(input(g))),true);
});
test('projected, future and explicitly unavailable goalie assertions do not close the gap',()=>{
 for(const patch of [{confirmedStarter:false,confirmationStatus:'projected'},{updatedAt:'2099-02-01T18:01:00Z'},{status:'Out',availability:0}]){
  const g=game({autoPlayers:[player('away'),player('home',patch)]});assert.equal(gap(estimatePredictionUncertainty(input(g))),true);
 }
});
test('the thirty-minute boundary applies only to a scheduled game before its start',()=>{
 assert.equal(gap(estimatePredictionUncertainty(input(game({startTime:'2099-02-01T18:30:00Z'})))),true);
 for(const patch of [{startTime:'2099-02-01T18:30:00.001Z'},{startTime:'2099-02-01T18:00:00Z'},{startTime:'2099-02-01T17:59:59Z'},{statusKey:'live'},{statusKey:'final'},{statusKey:'alert'}])assert.equal(gap(estimatePredictionUncertainty(input(game(patch)))),false);
});
test('the existing 58 evidence threshold remains unchanged for the late-role gap',()=>{
 assert.equal(estimatePredictionUncertainty(input(game(),{evidenceQuality:57})).recommendationStatus,'withheld');assert.notEqual(estimatePredictionUncertainty(input(game(),{evidenceQuality:58})).recommendationStatus,'withheld');
});
test('NBA and soccer do not inherit an NHL/football/baseball single-critical-role requirement',()=>{
 for(const [leagueKey,sportGroup] of [['nba','Basketball'],['epl','Soccer']])assert.equal(gap(estimatePredictionUncertainty(input(game({leagueKey,sportGroup,autoPlayers:[]})))),false);
});
test('invalid or unzoned starts cannot yield an actionable pregame status',()=>{
 for(const startTime of ['2099-02-30T18:20:00Z','2099-02-01T18:20:00','invalid']){
  const g=game({startTime});assert.equal(estimatePredictionUncertainty(input(g,{evidenceQuality:90})).isActionablePrediction,false);assert.equal(predictGame(g,1,{now}).eligibleForCalibration,false);
 }
});
test('explicit invalid uncertainty cutoffs fail instead of falling back to the wall clock',()=>{
 for(const value of [NaN,null,'2099-02-01T18:00:00Z'])assert.throws(()=>estimatePredictionUncertainty(input(game(),{now:value})),/cutoff/);
});
test('a stale or different-event supplied coverage report cannot resolve the current gap',()=>{
 const report=buildEvidenceCoverage(game({autoPlayers:[player('away'),player('home')]}),{now});
 for(const patch of [{gameId:'other'},{cutoffAt:'2099-02-01T17:00:00Z'}])assert.equal(gap(estimatePredictionUncertainty(input(game({autoPlayers:[]}),{evidenceCoverage:{...report,...patch}}))),true);
 assert.equal(gap(estimatePredictionUncertainty(input(game({autoPlayers:[]}),{evidenceCoverage:report}))),true);
});
test('the existing critical-role families use their actual role records',()=>{
 for(const [leagueKey,sportGroup,role] of [['nhl','Hockey','Goalie'],['nfl','Football','Quarterback'],['mlb','Baseball','Starting Pitcher']]){
  const g=game({leagueKey,sportGroup,autoLineup:undefined,autoPlayers:[player('away',{role}),player('home',{role})]});assert.equal(gap(estimatePredictionUncertainty(input(g))),false);
  g.autoPlayers.pop();assert.equal(gap(estimatePredictionUncertainty(input(g))),true);
 }
});
test('duplicate same-player assertions are distinct from multiple confirmed identities',()=>{
 const g=game({autoPlayers:[player('away'),player('away'),player('home')]});const report=buildEvidenceCoverage(g,{now});assert.equal(report.sides.away.criticalConfirmedAssertions,1);assert.equal(gap(estimatePredictionUncertainty(input(g))),false);
});
test('a role confirmation remains separate from unknown health and team injury coverage',()=>{
 const g=game({autoPlayers:[player('away',{availability:null,status:'unknown'}),player('home',{availability:null,status:'unknown'})]});const report=buildEvidenceCoverage(g,{now});assert.equal(report.sides.away.criticalStarterStatus,'confirmed_record_present');assert.equal(report.sides.away.injuryCoverage,'unknown');assert.equal(report.sides.away.modelInputs.players[0].availabilityObserved,false);
});
test('primary calibration eligibility ends exactly at the captured start',()=>{
 const g=game({startTime:new Date(now).toISOString()});const p=predictGame(g,1,{now});assert.equal(p.predictionMode,'late_pregame');assert.equal(p.eligibleForCalibration,false);
});
test('primary inference freezes its cutoff and critical-role context in the original forecast',async()=>{
 const g=game(),p=predictGame(g,1,{now});assert.equal(p.uncertaintyContext.evaluatedAt,new Date(now).toISOString());assert.equal(p.uncertaintyContext.lateLineupGap,true);assert.equal(p.evidenceCoverage.uncertaintyContext.minutesToStart,20);
 await recordPredictionJournal({guildId:'uncertainty-clock',dateKey:'2099-02-01',generatedAt:new Date(now).toISOString(),games:[g],predictions:[p]},{now});const row=(await readPredictionJournal()).find(row=>row.type==='forecast'&&row.payload.gameId===g.id);assert.equal(row.payload.evidenceCoverage.uncertaintyContext.lateLineupGap,true);
});
