import {withAuditFileLock} from './auditFileLock.js';
import {selectionReviewVerified,readVerifiedSelectionReview} from './selectionProtocol.js';
import {readPredictionJournal} from './predictionJournal.js';
import { probabilityLogLoss, LOG_LOSS_PROTOCOL } from './probabilityLogLoss.js';
import {hybridArtifactId} from './hybridArtifact.js';
import path from 'node:path';
import { config, dataDir } from './config.js';
import { readJson, writeJson } from './storage.js';
import { selectCandidateCohort, validCandidateVector } from './candidateCohorts.js';
import {quoteTimeEpoch as instant} from './oddsPricing.js';
import { CURRENT_MODEL_VERSION } from './modelIdentity.js';

const registryFile = path.join(dataDir, 'model-registry.json');
const MODELS = {
  evidence: 'evidence-ensemble-v6',
  hybrid: 'sport-specialist-hybrid-v2',
  ml: 'local-gbdt-hierarchical-v1'
};
let writeChain = Promise.resolve();

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function emptyRegistry() {
  return { version: 1, updatedAt: '', sports: {}, audit: [] };
}

function vectorValue(vector, side) {
  const value = Number(vector?.[side]);
  if (!Number.isFinite(value)) return 0;
  return value > 1 ? value / 100 : value;
}

function scoreModel(rows, model) {
  const eligible = rows.filter((row) => ['away', 'home', 'draw'].includes(row.actualSide) && validCandidateVector(row.candidateProbabilities?.[model], row.candidateModeledOutcomes?.[model]));
  if (!eligible.length) return { sampleSize: 0, brierScore: null, logLoss: null };
  let brier = 0;
  let logLoss = 0;
  for (const row of eligible) {
    const vector = row.candidateProbabilities[model];
    const sides = row.actualSide === 'draw' || vectorValue(vector, 'draw') > 0 ? ['away', 'home', 'draw'] : ['away', 'home'];
    brier += sides.reduce((sum, side) => sum + (vectorValue(vector, side) - Number(side === row.actualSide)) ** 2, 0) / sides.length;
    logLoss += probabilityLogLoss(vectorValue(vector, row.actualSide));
  }
  return { sampleSize: eligible.length, brierScore: brier / eligible.length, logLoss: logLoss / eligible.length };
}

export function evaluateCandidateModels(rows = []) {
  const selected = selectCandidateCohort(rows);
  rows = selected.rows;
  const modelNames = ['evidence', 'hybrid', 'ml'];
  const models = Object.fromEntries(modelNames.map((name) => [name, scoreModel(rows, name)]));
  const evidence = models.evidence;
  const hybrid = models.hybrid;
  const comparisons = {};
  for (const candidate of modelNames.filter((name) => name !== 'evidence')) {
    const matched = rows.filter((row) => validCandidateVector(row.candidateProbabilities?.evidence, row.candidateModeledOutcomes?.evidence)
      && validCandidateVector(row.candidateProbabilities?.[candidate], row.candidateModeledOutcomes?.[candidate])
      && (Number(row.candidateProbabilities.evidence.draw || 0) > 0) === (Number(row.candidateProbabilities[candidate].draw || 0) > 0));
    const baseline = scoreModel(matched, 'evidence');
    const challenger = scoreModel(matched, candidate);
    comparisons[candidate] = {
      baseline,
      challenger,
      sampleSize: challenger.sampleSize,
      brierImprovement: baseline.brierScore === null || challenger.brierScore === null ? null : baseline.brierScore - challenger.brierScore,
      logLossImprovement: baseline.logLoss === null || challenger.logLoss === null ? null : baseline.logLoss - challenger.logLoss
    };
  }
  const ranked = Object.entries(comparisons)
    .filter(([, row]) => row.brierImprovement !== null)
    .sort((a, b) => Number(b[1].brierImprovement) - Number(a[1].brierImprovement));
  const bestChallenger = ranked[0]?.[0] || 'hybrid';
  return {
    cohort: selected.cohort,
    logLossProtocol: LOG_LOSS_PROTOCOL,
    invalidVectorsByModel: Object.fromEntries(modelNames.map(name => [name, rows.filter(row => row.candidateProbabilities?.[name] !== undefined && !validCandidateVector(row.candidateProbabilities[name],row.candidateModeledOutcomes?.[name])).length])),
    models,
    evidence,
    hybrid,
    ml: models.ml,
    comparisons,
    bestChallenger,
    bestBrierImprovement: comparisons[bestChallenger]?.brierImprovement ?? null,
    bestLogLossImprovement: comparisons[bestChallenger]?.logLossImprovement ?? null,
    brierImprovement: comparisons.hybrid?.brierImprovement ?? null,
    logLossImprovement: comparisons.hybrid?.logLossImprovement ?? null
  };
}

function reviewAvailable(review,cutoff){
  const finalized=instant(review?.finalizedAt);
  return Number.isFinite(finalized)&&finalized<=cutoff&&selectionReviewVerified(review,cutoff);
}
function approvedReview(row = {}, sport = row.sport, cutoff = Date.now()) {
  const review = row.selectionReview, promoted=instant(row.promotedAt), evaluated=instant(row.evaluatedAt);
  const chronological=reviewAvailable(review,cutoff)&&Number.isFinite(promoted)&&instant(review.finalizedAt)<=promoted&&promoted<=cutoff
    &&Number.isFinite(evaluated)&&evaluated>=promoted&&evaluated<=cutoff;
  return chronological&&review?.status === 'review_ready' && review.modelVersion === CURRENT_MODEL_VERSION
    && review.candidate === row.champion && review.sport === sport
    && /^[a-f0-9]{64}$/.test(review.reportHash || '') && /^[a-f0-9]{64}$/.test(review.artifactId || '')
    && row.approvedArtifactId === review.artifactId
    && (row.champion !== 'hybrid' || review.artifactId === hybridArtifactId(sport,clamp(Number(row.specialistWeight)||.38,.15,.55)));
}

function defaultSportEntry(sport) {
  return {
    sport,
    champion: 'evidence',
    championModelId: MODELS.evidence,
    challenger: 'hybrid',
    challengerModelId: MODELS.hybrid,
    specialistWeight: 0.38,
    status: 'collecting',
    promotedAt: '',
    rolledBackAt: '',
    evaluation: null,
    recentEvaluation: null
  };
}

export function applyCandidateDecision(current = {}, sport = 'default', evaluation = {}, recentEvaluation = {}, options = {}) {
  const minimum = Math.max(30, Number(options.minimum) || 75);
  const now = options.now ?? new Date().toISOString(), cutoff=instant(now);
  if(!Number.isFinite(cutoff))throw new Error('Valid model decision information cutoff required');
  const existing = { ...defaultSportEntry(sport), ...current };
  let action = '';
  const proposed = evaluation.bestChallenger || 'hybrid';
  const fullComparison = evaluation.comparisons?.[proposed] || {
    sampleSize: evaluation[proposed]?.sampleSize || evaluation.evidence?.sampleSize || 0,
    brierImprovement: proposed === 'hybrid' ? evaluation.brierImprovement : null,
    logLossImprovement: proposed === 'hybrid' ? evaluation.logLossImprovement : null
  };
  const recentComparison = recentEvaluation.comparisons?.[proposed] || {
    sampleSize: recentEvaluation[proposed]?.sampleSize || recentEvaluation.evidence?.sampleSize || 0,
    brierImprovement: proposed === 'hybrid' ? recentEvaluation.brierImprovement : null,
    logLossImprovement: proposed === 'hybrid' ? recentEvaluation.logLossImprovement : null
  };
  const championRecentComparison = recentEvaluation.comparisons?.[existing.champion] || (existing.champion === 'hybrid' ? {
    sampleSize: recentEvaluation.evidence?.sampleSize || 0,
    brierImprovement: recentEvaluation.brierImprovement
  } : null);
  const provenanceEligible = !options.requireProspectiveRecords || evaluation.cohort?.prospectiveRecordsVerified === true;
  const review = options.selectionReview;
  const reviewEligible = reviewAvailable(review,cutoff) && options.allowPromotion === true && review?.status === 'review_ready'
    && review.candidate === proposed && review.sport === sport
    && review.modelVersion === CURRENT_MODEL_VERSION && /^[a-f0-9]{64}$/.test(review.reportHash || '')
    && /^[a-f0-9]{64}$/.test(review.artifactId || '')
    && (proposed !== 'hybrid' || review.artifactId === hybridArtifactId(sport,clamp(Number(existing.specialistWeight)||.38,.15,.55)));
  const promotable = reviewEligible && provenanceEligible && Number(fullComparison.sampleSize || 0) >= minimum &&
    Number(fullComparison.brierImprovement) > 0.0025 &&
    Number(fullComparison.logLossImprovement) >= -0.003 &&
    Number(recentComparison.brierImprovement ?? -1) > -0.004;
  const rollback = existing.champion !== 'evidence' && Number(championRecentComparison?.sampleSize || 0) >= 30 &&
    Number(championRecentComparison?.brierImprovement) < -0.009;
  if ((!provenanceEligible || !approvedReview(existing, sport, cutoff)) && existing.champion !== 'evidence') {
    existing.champion = 'evidence';
    existing.championModelId = MODELS.evidence;
    existing.status = 'provenance_revalidation_required';
    existing.rolledBackAt = now;
    action = 'rolled_back_unverified_provenance';
  } else if (existing.champion === 'evidence' && proposed !== 'evidence' && promotable) {
    existing.champion = proposed;
    existing.championModelId = MODELS[proposed] || proposed;
    existing.challenger = 'evidence';
    existing.challengerModelId = MODELS.evidence;
    existing.promotedAt = now;
    existing.selectionReview = review;
    existing.approvedArtifactId = review.artifactId;
    existing.status = 'promoted';
    action = `promoted_${proposed}`;
  } else if (rollback) {
    existing.champion = 'evidence';
    existing.championModelId = MODELS.evidence;
    existing.challenger = 'hybrid';
    existing.challengerModelId = MODELS.hybrid;
    existing.rolledBackAt = now;
    existing.status = 'rolled_back';
    action = 'rolled_back_to_evidence';
  } else if (existing.champion !== 'evidence') {
    existing.status = 'champion_active';
  } else {
    existing.challenger = proposed;
    existing.challengerModelId = MODELS[proposed] || proposed;
    existing.status = !provenanceEligible ? 'research_only_provenance_unverified'
      : !reviewEligible && Number(fullComparison.sampleSize || 0) >= minimum ? 'awaiting_preregistered_review'
      : Number(fullComparison.sampleSize || 0) >= minimum ? 'challenger_not_better' : 'collecting';
  }
  existing.evaluation = evaluation;
  existing.recentEvaluation = recentEvaluation;
  existing.evaluatedAt = now;
  existing.championModelId = MODELS[existing.champion] || existing.championModelId;
  existing.challengerModelId = MODELS[existing.challenger] || existing.challengerModelId;
  return { entry: existing, action };
}

export async function readModelRegistry({now=Date.now(),selectionDirectory=config.selectionEvidenceDirectory,journalFile=config.selectionEvidenceJournal}={}) {
  const stored = await readJson(registryFile, null, { throwOnError: true });
  if (stored && stored.version !== 1) throw new Error('Unsupported sports model registry version; existing state was preserved.');
  const registry=stored?.version === 1 ? { ...emptyRegistry(), ...stored } : emptyRegistry();
  if(selectionDirectory&&journalFile){
    let records;try{records=await readPredictionJournal(journalFile);}catch{}
    for(const row of Object.values(registry.sports)){
      if(!row.selectionReview)continue;
      try{row.selectionReview=await readVerifiedSelectionReview(row.selectionReview,{directory:selectionDirectory,records,now});row.selectionEvidenceStatus='verified_local_research';}
      catch{row.selectionEvidenceStatus='unverified_or_changed';}
    }
  }
  return registry;
}

export function modelDecisionForSport(registry = {}, sport = 'default', {now=Date.now(),league,horizon} = {}) {
  if(!Number.isFinite(now))throw new Error('Valid model inference information cutoff required');
  const updated=instant(registry.updatedAt), registryAvailable=Number.isFinite(updated)&&updated<=now;
  let row = registry.sports?.[sport] || defaultSportEntry(sport);
  if (row.champion !== 'evidence' && (!registryAvailable || !approvedReview(row, sport, now) || row.selectionReview?.league!==league || row.selectionReview?.horizon!==horizon || !row.evaluation?.cohort?.prospectiveRecordsVerified
    || !String(row.evaluation.cohort.key || '').includes(`|${CURRENT_MODEL_VERSION}|`)))
    row = { ...defaultSportEntry(sport), status: 'provenance_revalidation_required' };
  return {
    champion: row.champion || 'evidence',
    championModelId: row.championModelId || MODELS.evidence,
    challenger: row.challenger || 'hybrid',
    challengerModelId: row.challengerModelId || MODELS.hybrid,
    specialistWeight: clamp(Number(row.specialistWeight) || 0.38, 0.15, 0.55),
    status: row.status || 'collecting',
    approvedArtifactId: row.approvedArtifactId || null,
    hybridArtifactId: hybridArtifactId(sport,clamp(Number(row.specialistWeight)||.38,.15,.55)),
    sampleSize: row.evaluation?.models?.[row.champion]?.sampleSize || row.evaluation?.evidence?.sampleSize || 0
  };
}

export async function refreshModelRegistry(rows = [], options = {}) {
  const minimum = Math.max(30, Number(options.minimum ?? config.challengerMinSamples) || 75);
  // Preserve all originals for shared first-issue/conflict/cohort validation.
  // Freeze nested inputs before queued IO; callers cannot revise submitted evidence.
  rows = structuredClone(rows);
  const grouped = new Map();
  for (const row of rows) {
    const sport = String(row.sport || row.sportProfile || 'default').toLowerCase();
    if (!grouped.has(sport)) grouped.set(sport, []);
    grouped.get(sport).push(row);
  }
  const operation = writeChain.then(() => withAuditFileLock(registryFile,async () => {
    const registry = await readModelRegistry();
    for (const [sport, sportRows] of grouped) {
      const evaluation = evaluateCandidateModels(sportRows);
      const observed=row=>{
        const value=instant(row.source==='historical-replay'?row.predictionGeneratedAt:row.recordedAt);
        return Number.isFinite(value)?value:-Infinity;
      };
      const sorted=selectCandidateCohort(sportRows).rows.sort((a,b)=>observed(a)-observed(b)||String(a.gameId||'').localeCompare(String(b.gameId||'')));
      const recentEvaluation = evaluateCandidateModels(sorted.slice(-Math.min(75, Math.max(30, Math.floor(sorted.length / 3)))));
      const { entry: existing, action } = applyCandidateDecision(registry.sports[sport], sport, evaluation, recentEvaluation,
        { minimum, requireProspectiveRecords: true, allowPromotion: false });
      registry.sports[sport] = existing;
      if (action) registry.audit.push({ at: existing.evaluatedAt, sport, action, evaluation, recentEvaluation });
    }
    registry.audit = registry.audit.slice(-100);
    registry.updatedAt = new Date().toISOString();
    await writeJson(registryFile, registry, { backup: true, mode: 0o600 });
    return registry;
  }));
  writeChain = operation.catch(() => {});
  return operation;
}

export { MODELS, registryFile as modelRegistryFile };
