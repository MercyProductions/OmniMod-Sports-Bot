import test from 'node:test';
import assert from 'node:assert/strict';
import {probabilityLogLoss,LOG_LOSS_PROTOCOL} from '../src/probabilityLogLoss.js';
import {evaluateCandidateModels} from '../src/modelRegistry.js';
import {evaluatePredictionHorizons} from '../src/horizonEvaluation.js';
import {evaluateMatchedJournal} from '../src/matchedJournalEvaluation.js';
import {operationalDrift} from '../src/operationalDrift.js';
import {replayHistoricalResults} from '../src/historicalReplay.js';
const close=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-10,`${actual} != ${expected}`);
const issued='2026-10-20T18:00:00Z',start='2026-10-20T19:00:00Z',final='2026-10-20T22:00:00Z',asOf=Date.parse('2026-10-21T00:00:00Z');
function row(away=.0001,actualSide='away'){
 return {forecastId:'f',gameId:'g',guildId:'guild',league:'nfl',leagueKey:'nfl',sport:'football',modelVersion:'fixture',horizon:'Daily',
 predictionGeneratedAt:issued,recordedAt:issued,startTime:start,resolvedAt:final,actualSide,selectedSide:'home',predictedSide:'home',
 predictionMode:'pregame',lifecycleState:'ISSUED',recordEligibility:'observed_pregame',source:'frozen-production',snapshotPolicy:'first_issue_immutable_v1',
 modeledOutcomes:['away','home'],outcomePercentages:{away:away*100,home:(1-away)*100,draw:0},outcomeProbabilities:{away:away*100,home:(1-away)*100,draw:0},
 candidateProbabilities:{evidence:{away,home:1-away,draw:0},hybrid:{away,home:1-away,draw:0}}};
}

test('shared log loss preserves certain, zero and tiny probabilities under one numerical floor',()=>{
 close(probabilityLogLoss(1),0);close(probabilityLogLoss(0),-Math.log(1e-12));
 close(probabilityLogLoss(.000001),-Math.log(.000001));
});
test('shared log loss rejects malformed probability values without echoing them',()=>{
 for(const value of [null,undefined,'secret-value',true,NaN,Infinity,-.1,1.1])assert.throws(()=>probabilityLogLoss(value),/^Error: Log loss requires a finite probability/);
});
test('registry metrics neither cap impossible-result loss nor penalize a certain correct forecast',()=>{
 const a=evaluateCandidateModels([row(0)]),b=evaluateCandidateModels([row(0,'home')]);
 close(a.evidence.logLoss,-Math.log(1e-12));close(b.evidence.logLoss,0);
 assert.equal(a.logLossProtocol,LOG_LOSS_PROTOCOL);
});
test('horizon metrics use the same probability-zero and certainty boundaries',()=>{
 const a=evaluatePredictionHorizons([row(0)]),b=evaluatePredictionHorizons([row(0,'home')]);
 close(a.overall.logLoss,-Math.log(1e-12));close(b.overall.logLoss,0);
 assert.equal(a.logLossProtocol,LOG_LOSS_PROTOCOL);
});
test('actual historical replay penalizes a binary forecast followed by a tied final',()=>{
 const inputs=Array.from({length:3},(_,i)=>({id:String(i),dateKey:`2090-01-0${i+1}`,startTime:`2090-01-0${i+1}T19:00:00Z`,
 leagueKey:'nfl',sportGroup:'Football',awayTeam:'Away',homeTeam:'Home',awayScore:i===2?20:10,homeScore:20}));
 const before=JSON.stringify(inputs),report=replayHistoricalResults(inputs);
 assert.equal(report.predictionCount,1);assert.equal(report.predictions[0].actualSide,'draw');
 assert.equal(report.predictions[0].candidateProbabilities.evidence.draw,0);
 close(report.overall.evidence.logLoss,-Math.log(1e-12));close(report.overall.hybrid.logLoss,-Math.log(1e-12));
 assert.equal(report.logLossProtocol,LOG_LOSS_PROTOCOL);assert.equal(JSON.stringify(inputs),before);
});
test('registry, horizon, matched and operational reports agree on the same frozen unlikely outcome',()=>{
 const input=row(),before=JSON.stringify(input),event={type:'forecast',recordedAt:issued,payload:input};
 const result={actualSide:'away',observedAt:final,resultRecordedAt:final};
 const registry=evaluateCandidateModels([input]).evidence.logLoss;
 const horizon=evaluatePredictionHorizons([input]).overall.logLoss;
 const matched=evaluateMatchedJournal([event,{type:'result',recordedAt:final,payload:{...result,forecastId:'f'}}],{asOf,repetitions:100}).byVersion.fixture.hybrid.primary.logLoss;
 const operational=operationalDrift([event],new Map([['f',result]]),new Map(),{asOf,windowDays:7,minDriftGames:1}).cohorts[0].recent.logLoss;
 for(const score of [registry,horizon,matched,operational])close(score,-Math.log(.0001));
 assert.equal(JSON.stringify(input),before);
});
