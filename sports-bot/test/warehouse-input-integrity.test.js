import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const directory=await mkdtemp(join(tmpdir(),'sports-warehouse-inputs-'));
process.env.OMNIMOD_SPORTS_DATA_DIR=directory;process.env.LOCAL_ONLY='true';
const {recordSlateSnapshot,readFeatureWarehouse,warehouseFile,warehouseCandidateRowsBefore,warehouseInventory}=await import('../src/featureWarehouse.js');
const {writeJson}=await import('../src/storage.js');
const {buildSportModelPrediction}=await import('../src/sportModels.js');
const startTime='2099-01-01T18:00:00Z',generated='2099-01-01T16:00:00Z';
function fixture(leagueKey='nba',modelVersion='model-a',stage='daily'){
 const game={id:'same-id',leagueKey,startTime,statusKey:'scheduled',away:{name:leagueKey+' Away'},home:{name:leagueKey+' Home'}};
 const prediction={gameId:game.id,leagueKey,modelVersion,startTime,predictionGeneratedAt:generated,snapshotStage:stage,horizon:stage==='daily'?'Daily':'T-30',predictionMode:'pregame',predictedSide:'home',outcomeProbabilities:{away:40,home:60,draw:0},candidateProbabilities:{evidence:{away:.4,home:.6,draw:0}}};
 return {guildId:'test',dateKey:'2099-01-01',generatedAt:generated,games:[game],predictions:[prediction]};
}
const first=warehouse=>warehouse.predictions[0];
test.beforeEach(()=>rm(warehouseFile,{force:true}));test.after(()=>rm(directory,{recursive:true,force:true}));

test('frozen team and lineup numbers preserve unknown inputs instead of manufacturing zero',async()=>{
 for(const value of [undefined,null,'',' ',false,true]){
  await rm(warehouseFile,{force:true});const s=fixture();s.games[0].autoTeamMetrics={away:{powerRating:value,sampleSize:value,offense:value,defense:value,form:value}};
  s.games[0].autoLineup={away:{confirmed:value,continuity:value,lineupRating:value,starterCount:null}};
  const row=first(await recordSlateSnapshot(s));assert.equal(row.inputSnapshot.teams.away.powerRating,null);assert.equal(row.inputSnapshot.teams.away.sampleSize,null);
  assert.equal(row.inputSnapshot.lineup.away.continuity,null);assert.equal(row.inputSnapshot.lineup.away.starterCount,null);
  if(typeof value!=='boolean')assert.equal(row.inputSnapshot.lineup.away.confirmed,null);
 }
});

test('genuine zero measurements and explicit false flags survive unchanged',async()=>{
 const s=fixture();s.games[0].autoTeamMetrics={away:{powerRating:0,sampleSize:0,offense:0}};s.games[0].autoLineup={away:{confirmed:false,starterCount:0,continuity:0,lineupRating:0,learnedCoverage:0},ratingDifference:0};
 s.games[0].eventEnvironment={indoor:false,precipitation:false,temperatureF:0,windSpeedMph:0};
 const row=first(await recordSlateSnapshot(s));assert.equal(row.inputSnapshot.teams.away.powerRating,0);assert.equal(row.inputSnapshot.lineup.away.confirmed,false);assert.equal(row.inputSnapshot.environment.indoor,false);
 assert.equal(row.inputSnapshot.schema,'sports-compact-inputs-v2');
});

test('unknown environment and participation measurements remain null instead of healthy or zero',async()=>{
 const s=fixture();s.games[0].eventEnvironment={};s.games[0].participationProjections=[{name:'Unknown',impact:null,historicalShare:null,historySamples:null}];
 const row=first(await recordSlateSnapshot(s));assert.equal(row.inputSnapshot.environment.indoor,null);assert.equal(row.inputSnapshot.environment.precipitation,null);
 assert.equal(row.inputSnapshot.participationPlayers[0].impact,null);assert.equal(row.inputSnapshot.participationPlayers[0].historySamples,null);
});

test('explicit missing advanced measurements remain distinct from absent fields and zeros',async()=>{
 const s=fixture();s.games[0].advancedDataset={epaDifference:null,cpoeDifference:0,publicationTimeVerified:false};
 const row=first(await recordSlateSnapshot(s));assert.equal(Object.hasOwn(row.inputSnapshot.advancedDataset,'epaDifference'),true);assert.equal(row.inputSnapshot.advancedDataset.epaDifference,null);assert.equal(row.inputSnapshot.advancedDataset.cpoeDifference,0);
});

test('frozen factor contributions retain zero multipliers and unknown numeric values',async()=>{
 const s=fixture();s.predictions[0].factors=[{label:'disabled',present:true,baseValue:2,learnedMultiplier:0,value:0},{label:'unknown',present:false,baseValue:null,learnedMultiplier:null,value:null}];
 s.predictions[0].apiConfidenceValue=false;
 const row=first(await recordSlateSnapshot(s));assert.equal(row.featureContributions[0].learnedMultiplier,0);assert.equal(row.featureContributions[1].baseValue,null);assert.equal(row.featureContributions[1].value,null);assert.equal(row.confidenceState.apiConfidenceValue,null);
});

test('same-time versions and horizons retain separate immutable warehouse records',async()=>{
 for(const model of ['model-a','model-b'])for(const stage of ['daily','t-30'])await recordSlateSnapshot(fixture('nba',model,stage));
 const rows=(await readFeatureWarehouse()).predictions;assert.equal(rows.length,4);assert.deepEqual(new Set(rows.map(row=>row.horizon)),new Set(['Daily','T-30']));
});

test('reused native IDs across leagues preserve their own game inputs and cannot cross-grade',async()=>{
 const nba=fixture(),nhl=fixture('nhl');const both={...nba,games:[...nba.games,...nhl.games],predictions:[...nba.predictions,...nhl.predictions]};
 let rows=(await recordSlateSnapshot(both)).predictions;assert.equal(rows.length,2);
 for(const row of rows)assert.equal(row.inputSnapshot.teams.away.name,row.leagueKey+' Away');
 nba.games[0].statusKey='final';nba.games[0].away.score=90;nba.games[0].home.score=100;await recordSlateSnapshot(nba);
 rows=(await readFeatureWarehouse()).predictions;assert.equal(rows.find(row=>row.leagueKey==='nba').actualSide,'home');assert.equal(rows.find(row=>row.leagueKey==='nhl').actualSide,'');
});

test('conflicting duplicate final observations cannot choose the last result as truth',async()=>{
 const s=fixture();await recordSlateSnapshot(s);const a={...s.games[0],statusKey:'final',away:{name:'Away',score:100},home:{name:'Home',score:90}},b={...a,home:{name:'Home',score:110}};
 await recordSlateSnapshot({...s,games:[a,b]});assert.equal(first(await readFeatureWarehouse()).actualSide,'');
});

test('same-identity refreshes preserve original inputs while final grades can be added',async()=>{
 const s=fixture();s.games[0].autoTeamMetrics={away:{powerRating:null}};const original=first(await recordSlateSnapshot(s));
 s.games[0].autoTeamMetrics.away.powerRating=99;s.predictions[0].outcomeProbabilities={away:1,home:99,draw:0};s.games[0].statusKey='final';s.games[0].away.score=90;s.games[0].home.score=100;
 const after=first(await recordSlateSnapshot(s));assert.deepEqual(after.inputSnapshot,original.inputSnapshot);assert.deepEqual(after.outcomeProbabilities,original.outcomeProbabilities);assert.equal(after.actualSide,'home');
});

test('old snapshots are preserved without pretending their lost missingness can be reconstructed',async()=>{
 const legacy={...fixture().predictions[0],guildId:'legacy',dateKey:'2099-01-01',inputSnapshot:{teams:{away:{powerRating:0}}}};
 await writeJson(warehouseFile,{version:2,predictions:[legacy]});await recordSlateSnapshot(fixture());
 const rows=(await readFeatureWarehouse()).predictions;assert.deepEqual(rows.find(row=>row.guildId==='legacy').inputSnapshot,legacy.inputSnapshot);assert.equal(rows.find(row=>row.guildId==='test').inputSnapshot.schema,'sports-compact-inputs-v2');
});

test('CPOE research fields do not affect the current specialist while EPA remains an active input',()=>{
 const game={leagueKey:'nfl',sportGroup:'Football',advancedDataset:{epaDifference:.1,cpoeDifference:10,passingEpaDifference:10,rushingEpaDifference:10}};
 const a=buildSportModelPrediction(game,{modelLogit:.2});const b=buildSportModelPrediction({...game,advancedDataset:{...game.advancedDataset,cpoeDifference:-10,passingEpaDifference:-10,rushingEpaDifference:-10}},{modelLogit:.2});
 assert.deepEqual(a.probabilities,b.probabilities);assert.notDeepEqual(a.probabilities,buildSportModelPrediction({...game,advancedDataset:{epaDifference:.5}},{modelLogit:.2}).probabilities);
});


test('mutable caller data cannot change the snapshot while its queued write is pending',async()=>{
 const s=fixture();s.games[0].autoHistory={sampleSize:5};const writing=recordSlateSnapshot(s);
 s.predictions[0].outcomeProbabilities.home=99;s.games[0].autoHistory.sampleSize=999;
 const row=first(await writing);assert.equal(row.outcomeProbabilities.home,60);assert.equal(row.inputSnapshot.autoHistory.sampleSize,5);
});

test('identical duplicate finals can grade the existing record without changing its inputs',async()=>{
 const s=fixture();const original=first(await recordSlateSnapshot(s));const final={...s.games[0],statusKey:'final',away:{name:'Away',score:90},home:{name:'Home',score:100}};
 const row=first(await recordSlateSnapshot({...s,games:[final,structuredClone(final)]}));assert.equal(row.actualSide,'home');assert.deepEqual(row.inputSnapshot,original.inputSnapshot);
});

test('cross-league grading is isolated even when both old-style issue timestamps differ',async()=>{
 const nba=fixture(),nhl=fixture('nhl');nhl.predictions[0].predictionGeneratedAt='2099-01-01T16:01:00Z';
 await recordSlateSnapshot(nba);await recordSlateSnapshot(nhl);
 nba.games[0].statusKey='final';nba.games[0].away.score=90;nba.games[0].home.score=100;await recordSlateSnapshot(nba);
 const rows=(await readFeatureWarehouse()).predictions;assert.equal(rows.find(row=>row.leagueKey==='nba').actualSide,'home');assert.equal(rows.find(row=>row.leagueKey==='nhl').actualSide,'');
});


test('reused IDs on different scheduled dates cannot cross-grade older or future games',async()=>{
 const a=fixture(),b=fixture();b.dateKey='2099-01-02';b.games[0].startTime='2099-01-02T18:00:00Z';b.predictions[0].startTime=b.games[0].startTime;
 await recordSlateSnapshot(a);await recordSlateSnapshot(b);
 a.games[0].statusKey='final';a.games[0].away.score=90;a.games[0].home.score=100;await recordSlateSnapshot(a);
 const rows=(await readFeatureWarehouse()).predictions;assert.equal(rows.find(row=>row.dateKey==='2099-01-01').actualSide,'home');assert.equal(rows.find(row=>row.dateKey==='2099-01-02').actualSide,'');
});


test('finals-only input grades an archived forecast without inventing another prediction',async()=>{
 const s=fixture();const original=first(await recordSlateSnapshot(s));const final={...s.games[0],statusKey:'final',away:{name:'Away',score:90},home:{name:'Home',score:100}};
 const warehouse=await recordSlateSnapshot({...s,predictions:[],games:[final]});assert.equal(warehouse.predictions.length,1);assert.equal(first(warehouse).actualSide,'home');assert.deepEqual(first(warehouse).inputSnapshot,original.inputSnapshot);
});

test('a disputed previously graded result is retained for audit but removed from eligible learning outcomes',async()=>{
 const s=fixture();await recordSlateSnapshot(s);const a={...s.games[0],statusKey:'final',away:{name:'Away',score:90},home:{name:'Home',score:100}},b={...a,home:{name:'Home',score:80}};
 await recordSlateSnapshot({...s,games:[a]});assert.equal((await warehouseCandidateRowsBefore('2100-01-01')).length,1);
 let row=first(await recordSlateSnapshot({...s,predictions:[],games:[a,b]}));assert.equal(row.actualSide,'');assert.equal(row.predictionCorrect,null);assert.equal(row.resultEvidenceStatus,'disputed');assert.equal(row.lastUndisputedGrade.actualSide,'home');assert.equal(row.conflictingFinalObservations.length,2);
 assert.equal((await warehouseCandidateRowsBefore('2100-01-01')).length,0);assert.equal((await warehouseInventory()).disputedPredictionRecords,1);
 row=first(await recordSlateSnapshot({...s,predictions:[],games:[a]}));assert.equal(row.actualSide,'');assert.equal(row.resultEvidenceStatus,'disputed');
});


test('equivalent issue-time formatting cannot duplicate one immutable forecast',async()=>{
 const s=fixture();const original=first(await recordSlateSnapshot(s));s.predictions[0].predictionGeneratedAt=new Date(generated).toISOString();s.predictions[0].outcomeProbabilities.home=99;
 const warehouse=await recordSlateSnapshot(s);assert.equal(warehouse.predictions.length,1);assert.deepEqual(first(warehouse).outcomeProbabilities,original.outcomeProbabilities);
});

test('an unscoped forecast cannot adopt arbitrary inputs from a shared native ID',async()=>{
 const s=fixture(),nhl=fixture('nhl');delete s.predictions[0].leagueKey;s.games.push(nhl.games[0]);
 const row=first(await recordSlateSnapshot(s));assert.equal(row.inputSnapshot.teams.away.name,'');assert.equal(row.inputSnapshot.teams.away.powerRating,null);
});

test('an unscoped legacy caller can use one uniquely identified game without guessing among leagues',async()=>{
 const s=fixture();delete s.predictions[0].leagueKey;const row=first(await recordSlateSnapshot(s));assert.equal(row.leagueKey,'nba');assert.equal(row.inputSnapshot.teams.away.name,'nba Away');
});


test('new warehouse snapshots freeze actual emitted primary and candidate outcome keys',async()=>{
 const s=fixture();delete s.predictions[0].outcomeProbabilities.draw;delete s.predictions[0].candidateProbabilities.evidence.draw;
 const row=first(await recordSlateSnapshot(s));
 assert.deepEqual(row.modeledOutcomes,['away','home']);assert.deepEqual(row.candidateModeledOutcomes.evidence,['away','home']);
 s.predictions[0].outcomeProbabilities={away:20,home:60,draw:20};
 s.predictions[0].candidateProbabilities.evidence={away:.2,home:.6,draw:.2};
 const retained=first(await recordSlateSnapshot(s));
 assert.deepEqual(retained.modeledOutcomes,['away','home']);assert.deepEqual(retained.outcomeProbabilities,{away:40,home:60});
});
test('a later snapshot cannot retroactively declare missing legacy warehouse outcome classes',async()=>{
 const s=fixture(),warehouse=await recordSlateSnapshot(s);
 delete warehouse.predictions[0].modeledOutcomes;delete warehouse.predictions[0].candidateModeledOutcomes;
 await writeJson(warehouseFile,warehouse);
 const retained=first(await recordSlateSnapshot(s));
 assert.equal(Object.hasOwn(retained,'modeledOutcomes'),false);assert.equal(Object.hasOwn(retained,'candidateModeledOutcomes'),false);
});
