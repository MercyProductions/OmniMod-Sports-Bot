import test from 'node:test';
import assert from 'node:assert/strict';
import {selectCandidateCohort} from '../src/candidateCohorts.js';
import {evaluateCandidateModels} from '../src/modelRegistry.js';
import {trainLocalMlModels} from '../src/localMl.js';
const first={source:'frozen-production',modelVersion:'fixture',horizon:'Daily',leagueKey:'nba',sport:'basketball',gameId:'g',
 startTime:'2026-10-20T19:00:00Z',predictionGeneratedAt:'2026-10-20T17:59:00Z',recordedAt:'2026-10-20T18:00:00Z',resolvedAt:'2026-10-20T22:00:00Z',
 snapshotPolicy:'first_issue_immutable_v1',actualSide:'home',candidateProbabilities:{evidence:{away:.4,home:.6,draw:0}},mlFeatureVector:{elo:.1}};
const later=()=>({...first,recordedAt:'2026-10-20T18:30:00Z',predictionGeneratedAt:'2026-10-20T18:29:00Z',
 candidateProbabilities:{...first.candidateProbabilities,hybrid:{away:.1,home:.9,draw:0}}});

test('first issue cannot be replaced by a richer later model revision in either input order',()=>{
 for(const rows of [[first,later()],[later(),first]]){
  const before=JSON.stringify(rows),selected=selectCandidateCohort(rows);
  assert.deepEqual(selected.rows,[first]);assert.equal(selected.cohort.duplicateRowsRemoved,1);
  assert.equal(JSON.stringify(rows),before);
 }
});
test('actual registry comparison cannot acquire challenger evidence from a later revision',()=>{
 const result=evaluateCandidateModels([later(),first]);
 assert.equal(result.evidence.sampleSize,1);assert.equal(result.comparisons.hybrid.sampleSize,0);
});
test('equivalent time offsets and league aliases share one event identity',()=>{
 const copy={...later(),leagueKey:' NBA ',startTime:'2026-10-20T14:00:00-05:00'};
 assert.equal(selectCandidateCohort([copy,first]).rows.length,1);
 assert.equal(selectCandidateCohort([copy,first]).rows[0],first);
});
test('simultaneous different frozen candidate inputs are quarantined rather than selected by order',()=>{
 const other={...first,candidateProbabilities:{evidence:{away:.3,home:.7,draw:0}}};
 for(const rows of [[first,other],[other,first]]){
  const selected=selectCandidateCohort(rows);assert.equal(selected.rows.length,0);
  assert.equal(selected.cohort.ambiguousFirstForecastGamesExcluded,1);
 }
});
test('duplicate rows without explicit-zone capture order cannot enter a learning cohort',()=>{
 const selected=selectCandidateCohort([first,{...later(),recordedAt:'2026-10-20T18:30:00'}]);
 assert.equal(selected.rows.length,0);assert.equal(selected.cohort.duplicateChronologyGamesExcluded,1);
});
test('result disagreements quarantine all copies even if the later vector is richer',()=>{
 const selected=selectCandidateCohort([first,{...later(),actualSide:'away'}]);
 assert.equal(selected.rows.length,0);assert.equal(selected.cohort.conflictingGamesExcluded,1);
});
test('identical cross-guild copies count once, using conservative latest label receipt on a tied issue',()=>{
 const copy={...first,guildId:'other',resolvedAt:'2026-10-21T01:00:00Z'};
 const selected=selectCandidateCohort([first,copy]);assert.equal(selected.rows.length,1);assert.equal(selected.rows[0],copy);
 const trained=trainLocalMlModels([first,copy],{now:Date.parse('2026-10-20T23:00:00Z')});
 assert.equal(trained.temporalRowsExcluded,1);
});
test('replay duplicate selection uses generated time and remains nonprospective',()=>{
 const a={...first,source:'historical-replay'},b={...later(),source:'historical-replay'};
 const selected=selectCandidateCohort([b,a]);assert.deepEqual(selected.rows,[a]);assert.equal(selected.cohort.prospectiveRecordsVerified,false);
});
test('a single naive-clock or incomplete event identity record cannot attest prospective chronology',()=>{
 assert.equal(selectCandidateCohort([{...first,recordedAt:'2026-10-20T18:00:00'}]).cohort.prospectiveRecordsVerified,false);
 assert.equal(selectCandidateCohort([{...first,gameId:undefined}]).cohort.prospectiveRecordsVerified,false);
});
