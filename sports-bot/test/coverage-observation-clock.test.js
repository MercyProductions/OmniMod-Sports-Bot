import test from 'node:test';
import assert from 'node:assert/strict';
import {predictGame} from '../src/predictionEngine.js';
import {summaryEvidence,buildEvidenceCoverage} from '../src/evidenceCoverage.js';
const now=Date.parse('2026-03-03T18:00:00Z'),before='2026-03-03T17:59:00Z',after='2026-03-03T19:00:00Z';
const game=()=>({id:'coverage-clock',leagueKey:'nhl',league:'NHL',sportGroup:'Hockey',away:{name:'A',abbr:'A'},home:{name:'H',abbr:'H'}});

test('coverage does not normalize impossible, unzoned or coerced receipt clocks',()=>{
 for(const fetchedAt of ['2026-02-30T17:59:00Z','2026-03-03T17:59:00',2026,true]){
  const value=game();value.autoEnrichment={fetchedAt,cacheState:'network'};
  const summary=summaryEvidence(value,now),report=buildEvidenceCoverage(value,{now});
  assert.equal(summary.fetchedAt,null);assert.equal(summary.receiptFresh,false);assert.equal(summary.observationState,'invalid_observation_time');assert.ok(report.missing.includes('summary:observation_invalid_observation_time'));
 }
});
test('fresh receipt remains separate from a future native observation and cannot establish injury coverage',()=>{
 const value=game();value.autoEnrichment={fetchedAt:before,sourceObservationAt:after,cacheState:'network',injuryTeams:['A','H']};
 const summary=summaryEvidence(value,now);assert.equal(summary.receiptFresh,true);assert.equal(summary.observationState,'after_information_cutoff');assert.equal(summary.nativeObservationState,'after_information_cutoff');assert.equal(summary.injuryCoverage,'unknown');
 const report=buildEvidenceCoverage(value,{now});assert.equal(report.sources.summary.state,'receipt_available');assert.ok(report.missing.includes('summary:observation_after_information_cutoff'));assert.equal(report.sides.away.injuryCoverage,'unknown');
});
test('absent native clocks stay unknown despite recent fetch receipts',()=>{
 const value=game();value.autoEnrichment={fetchedAt:before,cacheState:'network'};
 const report=buildEvidenceCoverage(value,{now});assert.equal(report.sources.summary.observationState,'observed_by_cutoff');assert.equal(report.sources.summary.nativeObservationState,'unknown');assert.ok(report.missing.includes('summary:native_observation_unknown'));assert.equal(report.sources.summary.underlyingFreshnessVerified,false);
});
test('date-only metadata retains unknown precision and cannot earn a midnight receipt bonus',()=>{
 const value=game();value.autoEnrichment={fetchedAt:'2026-03-03',sourceObservationAt:'2026-03-03',cacheState:'network'};
 const summary=summaryEvidence(value,Date.parse('2026-03-03T00:01:00Z'));assert.equal(summary.receiptFresh,false);assert.equal(summary.observationState,'unknown');assert.equal(summary.nativeObservationState,'unknown');assert.equal(summary.fetchedAt,null);
});
test('future advanced receipts and malformed refresh clocks remain visible as evidence gaps',()=>{
 const value=game();value.advancedDataset={sourceReceiptTimes:[before,after],sourceRefreshStatuses:[{sourceId:'fixture',checkedAt:'2026-02-30T17:59:00Z',state:'success',requestKey:'future'}]};
 const report=buildEvidenceCoverage(value,{now});assert.equal(report.advancedDatasetProvenance.observationState,'after_information_cutoff');assert.ok(report.missing.includes('advanced_dataset:observation_after_information_cutoff'));assert.equal(report.advancedDatasetProvenance.sourceRefreshStatuses[0].state,'unknown_at_cutoff');assert.equal(report.advancedDatasetProvenance.sourceRefreshStatuses[0].checkedAt,null);
});
test('valid explicit offset clocks preserve the instant without asserting native freshness',()=>{
 const value=game();value.autoEnrichment={fetchedAt:'2026-03-03T19:59:00+02:00',sourceObservationAt:'2020-01-01T00:00:00Z',cacheState:'network',injuryTeams:['A','H']};
 const original=structuredClone(value),summary=summaryEvidence(value,now);assert.equal(summary.fetchedAt,new Date(before).toISOString());assert.equal(summary.receiptFresh,true);assert.equal(summary.nativeObservationState,'observed_by_cutoff');assert.equal(summary.underlyingFreshnessVerified,false);assert.equal(summary.injuryCoverage,'reported_both_sides');assert.deepEqual(value,original);
});
test('summary evidence rejects an invalid direct cutoff',()=>{
 assert.throws(()=>summaryEvidence(game(),NaN),/cutoff/);
});

test('inference cannot award fresh summary confidence to date-only metadata near midnight',()=>{
 const cutoff=Date.parse('2026-03-03T00:01:00Z'),input=game(),base=predictGame(input,0,{now:cutoff});
 input.autoEnrichment={fetchedAt:'2026-03-03',cacheState:'network',injuryTeams:['A','H']};
 const predicted=predictGame(input,0,{now:cutoff});assert.equal(predicted.apiConfidenceValue,base.apiConfidenceValue);assert.equal(predicted.evidenceCoverage.schema,'sports-evidence-coverage-v2');assert.equal(predicted.evidenceCoverage.summary.receiptFresh,false);assert.equal(predicted.evidenceCoverage.summary.observationState,'unknown');
});
