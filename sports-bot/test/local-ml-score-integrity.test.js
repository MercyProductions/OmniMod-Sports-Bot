import test from 'node:test';
import assert from 'node:assert/strict';
import {trainLocalMlModels} from '../src/localMl.js';
const base=Date.parse('2090-01-01T20:00:00Z'),day=86400000,iso=value=>new Date(value).toISOString();
function rows(count=102){return Array.from({length:count},(_,i)=>({
 gameId:String(i),leagueKey:'nba',sport:'basketball',source:'frozen-production',modelVersion:'fixture',horizon:'Daily',
 snapshotPolicy:'first_issue_immutable_v1',dateKey:iso(base+i*day).slice(0,10),
 startTime:iso(base+i*day),predictionGeneratedAt:iso(base+i*day-12*3600000),recordedAt:iso(base+i*day-11*3600000),resolvedAt:iso(base+i*day+3*3600000),
 actualSide:i%2?'away':'home',candidateProbabilities:{evidence:{away:.5,home:.5,draw:0}},mlFeatureVector:{elo:i%2?-1:1}
}));}
const train=input=>trainLocalMlModels(input,{minimum:60,now:Date.parse('2100-01-01T00:00:00Z')}).sports.basketball;
const close=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-10,`${actual} != ${expected}`);

test('binary forecasts with actual draws include the missing draw coordinate in Brier loss',()=>{
 const input=rows();for(const row of input)row.actualSide='draw';
 const model=train(input);
 close(model.evaluation.baselineBrier,.5);close(model.evaluation.modelBrier,.5);
 assert.equal(model.evaluation.sampleSize,31);assert.equal(model.accepted,false);
});
test('zero-probability outcomes receive explicit floor loss rather than a one-in-a-thousand cap',()=>{
 const input=rows();for(const row of input)row.actualSide='draw';
 const evaluation=train(input).evaluation;
 close(evaluation.baselineLogLoss,-Math.log(1e-12));close(evaluation.modelLogLoss,-Math.log(1e-12));
});
test('a correctly certain baseline receives zero loss without artificial upper clipping',()=>{
 const input=rows();for(const row of input){row.actualSide='home';row.candidateProbabilities.evidence={away:0,home:1,draw:0};}
 const evaluation=train(input).evaluation;
 close(evaluation.baselineLogLoss,0);close(evaluation.baselineBrier,0);
});
test('equivalent explicit-zone start representations preserve the evaluated fit and holdout',()=>{
 const input=rows(),aliases=structuredClone(input);
 for(const [i,row] of aliases.entries()){
  const offset=i%2?-12:14,sign=offset<0?'-':'+';
  row.startTime=iso(Date.parse(row.startTime)+offset*3600000).replace('Z',`${sign}${String(Math.abs(offset)).padStart(2,'0')}:00`);
 }
 const before=JSON.stringify(aliases),a=train(input),b=train(aliases);
 assert.equal(a.artifactId,b.artifactId);assert.deepEqual(a.evaluation,b.evaluation);
 assert.equal(a.trainingSampleSize,71);assert.equal(b.trainingSampleSize,71);
 assert.equal(JSON.stringify(aliases),before);
});
test('input order cannot select different members at an equal-start chronological split',()=>{
 const input=rows();
 // All identities remain distinct. A tie at the split uses event IDs, not caller order.
 input[71].startTime=input[70].startTime;
 input[71].predictionGeneratedAt=input[70].predictionGeneratedAt;
 input[71].recordedAt=input[70].recordedAt;
 const a=train(input),b=train([...input].reverse());
 assert.equal(a.artifactId,b.artifactId);assert.deepEqual(a.evaluation,b.evaluation);
});
