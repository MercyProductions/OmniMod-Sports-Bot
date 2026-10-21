import { createHash } from 'node:crypto';
import path from 'node:path';
import { finiteNumber, scoreOutcome } from './dataValidation.js';
import { predictionHorizon } from './horizonEvaluation.js';

const sorted = value => Array.isArray(value) ? value.map(sorted) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, sorted(value[key])])) : value;
export const reviewDigest = value => createHash('sha256').update(JSON.stringify(sorted(value))).digest('hex');
const time = value => { const n = Date.parse(value || ''); return Number.isFinite(n) ? n : null; };
const vector = value => Object.fromEntries(['away','home','draw'].map(side => [side,finiteNumber(value?.[side])]));
const need = (condition, message) => { if (!condition) throw new Error(message); };

function journalEvidence(records, forecastId, now) {
  need(Number.isFinite(now), 'Valid review time required');
  const issued = records.filter(row => row.type === 'forecast' && row.payload.forecastId === forecastId);
  need(issued.length === 1, 'A unique journal forecast is required');
  const entry = issued[0], forecast = entry.payload;
  need(forecast.lifecycleState === 'ISSUED' && forecast.recordEligibility === 'observed_pregame', 'Forecast was not validly issued pregame');
  const generated = time(forecast.predictionGeneratedAt), start = time(forecast.startTime), captured = time(entry.recordedAt);
  need(generated !== null && start !== null && captured !== null && generated <= captured && captured < start, 'Issued forecast chronology is invalid');
  need(forecast.guildId && forecast.league && forecast.gameId && forecast.modelVersion, 'Complete forecast identity required');
  const results = records.filter(row => row.type === 'result' && row.payload.forecastId === forecastId);
  need(results.length > 0, 'No journal result is available');
  const resultEntry = results.at(-1), result = resultEntry.payload;
  const observed = time(result.observedAt), fetched = time(result.providerFetchedAt), recorded = time(resultEntry.recordedAt);
  need(observed !== null && fetched !== null && recorded !== null && start <= fetched && fetched <= observed && observed <= recorded && recorded <= now,
    'A timely post-start provider receipt and result observation are required');
  need(result.scheduleChanged === false, 'Changed event schedules require separate reconciliation');
  need(result.selectedSide === forecast.selectedSide && result.correct === (result.actualSide === forecast.selectedSide), 'Journal result selection is inconsistent');
  need(['away','home','draw'].includes(result.actualSide) && [result.awayScore,result.homeScore].every(value=>Number.isSafeInteger(finiteNumber(value))&&finiteNumber(value)>=0), 'Comparable final score observations required');
  need(scoreOutcome(result.awayScore,result.homeScore) === result.actualSide, 'Journal result does not match its observed scores');
  return { entry, forecast, resultEntry, result, generated, start, observed };
}

function matchingRows(rows, evidence) {
  const f = evidence.forecast;
  return rows.map((row,index) => ({row,index})).filter(({row}) => String(row.guildId || '') === f.guildId
    && String(row.leagueKey || row.league || '').trim().toLowerCase() === f.league.toLowerCase()
    && String(row.gameId) === f.gameId && row.modelVersion === f.modelVersion && predictionHorizon(row) === f.horizon
    && time(row.startTime) === evidence.start && time(row.predictionGeneratedAt) === evidence.generated);
}

export function makeWarehouseResultProposal(records, rows, forecastId, dataDirectory, now, journalFile) {
  const evidence = journalEvidence(records,forecastId,now), matches = matchingRows(rows,evidence);
  need(matches.length === 1, 'A unique matching warehouse forecast is required');
  const row = matches[0].row;
  need(row.resultEvidenceStatus === 'disputed', 'Only a disputed result can be reviewed');
  need(time(row.resultConflictObservedAt)!==null&&time(row.resultConflictObservedAt)<=now, 'Warehouse dispute chronology is invalid');
  need(row.predictionMode === 'pregame' && row.snapshotPolicy === 'first_issue_immutable_v1' && time(row.recordedAt) !== null
    && evidence.generated <= time(row.recordedAt) && time(row.recordedAt) < evidence.start, 'Warehouse inputs were not observed pregame');
  need(row.predictedSide === evidence.forecast.selectedSide
    && reviewDigest(vector(row.outcomeProbabilities)) === reviewDigest(vector(evidence.forecast.outcomePercentages)), 'Original warehouse forecast differs from the journal');
  const body = { schema:'warehouse-result-review-v1',dataDirectory:path.resolve(dataDirectory),journalFile:path.resolve(journalFile),createdAt:new Date(now).toISOString(),
    forecastId,event:{guildId:evidence.forecast.guildId,league:evidence.forecast.league,gameId:evidence.forecast.gameId,modelVersion:evidence.forecast.modelVersion,
      horizon:evidence.forecast.horizon,predictionGeneratedAt:evidence.forecast.predictionGeneratedAt,startTime:evidence.forecast.startTime,selectedSide:evidence.forecast.selectedSide},
    teams:{away:row.inputSnapshot?.teams?.away?.name||'',home:row.inputSnapshot?.teams?.home?.name||''},originalOutcomePercentages:vector(row.outcomeProbabilities),
    priorDispute:{observedAt:row.resultConflictObservedAt||null,observations:row.conflictingFinalObservations||[],lastUndisputedGrade:row.lastUndisputedGrade||null},
    forecastEventHash:evidence.entry.eventHash,resultEventHash:evidence.resultEntry.eventHash,warehouseRecordHash:reviewDigest(row),
    result:{actualSide:evidence.result.actualSide,awayScore:evidence.result.awayScore,homeScore:evidence.result.homeScore,
      observedAt:evidence.result.observedAt,providerFetchedAt:evidence.result.providerFetchedAt},
    scope:'Verified journal integrity and recorded receipt; source truth and reviewer identity are not authenticated' };
  return {...body,proposalId:reviewDigest(body)};
}

export function reviewedWarehouseResult(records, rows, proposal, review, dataDirectory, now, journalFile) {
  need(proposal?.schema === 'warehouse-result-review-v1' && proposal.dataDirectory === path.resolve(dataDirectory), 'Review data directory mismatch');
  need(proposal.journalFile===path.resolve(journalFile), 'Review journal location mismatch');
  const {proposalId,...body} = proposal;
  need(reviewDigest(body) === proposalId, 'Review proposal digest mismatch');
  need(review?.proposalId === proposalId && review.decision === 'accept' && review.sourceChecked === true, 'Explicit accepted source review required');
  need(typeof review.reviewer === 'string' && review.reviewer.trim() && typeof review.reason === 'string' && review.reason.trim(), 'Reviewer and reason required');
  need(typeof review.sourceReference === 'string' && review.sourceReference.trim(), 'Reviewed source reference required');
  const created = time(proposal.createdAt), reviewed = time(review.reviewedAt);
  need(created !== null && reviewed !== null && created <= reviewed && reviewed <= now, 'Review chronology is invalid');
  const evidence = journalEvidence(records,proposal.forecastId,now), matches = matchingRows(rows,evidence);
  need(matches.length === 1 && evidence.entry.eventHash === proposal.forecastEventHash && evidence.resultEntry.eventHash === proposal.resultEventHash,
    'Journal evidence changed; prepare a new review');
  const {row,index} = matches[0], reviewHash = reviewDigest(review), receipts = row.resultAdjudications || [];
  const prior = receipts.find(receipt => receipt.proposalId === proposalId);
  if (row.resultEvidenceStatus === 'adjudicated' && row.resultReviewProposalId === proposalId && prior?.reviewHash === reviewHash) return {index,row,duplicate:true};
  need(!prior, 'An earlier review cannot overwrite a later dispute');
  const expected = makeWarehouseResultProposal(records,rows,proposal.forecastId,dataDirectory,created,journalFile);
  need(expected.proposalId === proposalId, 'Warehouse evidence changed; prepare a new review');
  const receipt = {proposalId,forecastId:proposal.forecastId,journalFile:path.resolve(journalFile),reviewHash,reviewer:review.reviewer.trim(),reason:review.reason.trim(),sourceReference:review.sourceReference.trim(),
    reviewedAt:review.reviewedAt,appliedAt:new Date(now).toISOString(),forecastEventHash:proposal.forecastEventHash,resultEventHash:proposal.resultEventHash,
    verifiedJournalHeadHash:records.at(-1)?.eventHash || null,providerFetchedAt:evidence.result.providerFetchedAt,
    disputeEvidence:{observedAt:row.resultConflictObservedAt || null,observations:row.conflictingFinalObservations || [],
      truncated:row.conflictingFinalObservationsTruncated || false,lastUndisputedGrade:row.lastUndisputedGrade || null},
    independentSourceTruthVerified:false,reviewerIdentityAuthenticated:false};
  return {index,duplicate:false,row:{...row,actualSide:evidence.result.actualSide,predictionCorrect:row.predictedSide === evidence.result.actualSide,
    actualWinner:evidence.result.actualSide==='draw'?'Draw':row.inputSnapshot?.teams?.[evidence.result.actualSide]?.name||'',resolvedAt:new Date(now).toISOString(),resolvedAtSource:'reviewed_adjudication_applied_at',resultEvidenceStatus:'adjudicated',
    resultReviewProposalId:proposalId,adjudicatedResult:proposal.result,resultAdjudications:[...receipts,receipt]}};
}

export function currentReviewedWarehouseResult(row,receipt,forecastEntry,resultEntry){
  try{
    if(!forecastEntry||!resultEntry||resultEntry.eventHash!==receipt.resultEventHash)return false;
    const applied=time(receipt.appliedAt),reviewed=time(receipt.reviewedAt),captured=time(row.recordedAt);
    if(applied===null||reviewed===null||reviewed>applied||time(row.resolvedAt)!==applied)return false;
    const evidence=journalEvidence([forecastEntry,resultEntry],receipt.forecastId,applied);
    return matchingRows([row],evidence).length===1&&row.predictionMode==='pregame'&&row.snapshotPolicy==='first_issue_immutable_v1'
      &&captured!==null&&captured>=evidence.generated&&captured<evidence.start
      &&row.predictedSide===evidence.forecast.selectedSide&&row.actualSide===evidence.result.actualSide
      &&row.predictionCorrect===(row.predictedSide===row.actualSide)
      &&reviewDigest(vector(row.outcomeProbabilities))===reviewDigest(vector(evidence.forecast.outcomePercentages))
      &&row.adjudicatedResult?.actualSide===evidence.result.actualSide
      &&row.adjudicatedResult?.awayScore===evidence.result.awayScore&&row.adjudicatedResult?.homeScore===evidence.result.homeScore;
  }catch{return false;}
}
