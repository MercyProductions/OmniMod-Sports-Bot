import {scopedEventKey,eventReference} from './slateEventIdentity.js';
import {journalResultState} from './journalResults.js';
import path from 'node:path';
import { withAuditFileLock } from './auditFileLock.js';
import { readPredictionJournal, predictionJournalFile } from './predictionJournal.js';
import { makeWarehouseResultProposal, reviewedWarehouseResult, currentReviewedWarehouseResult } from './warehouseResultReview.js';
import { dataDir } from './config.js';
import { warehousePlayRows } from './playByPlay.js';
import { readJson, writeJson } from './storage.js';
import { finalOutcomeSide, finiteNumber } from './dataValidation.js';
import { predictionHorizon } from './horizonEvaluation.js';

const WAREHOUSE_VERSION = 2;
const warehouseFile = path.join(dataDir, 'feature-warehouse.json');
let writeChain = Promise.resolve();

const LIMITS = {
  results: 12_000,
  boxscores: 5_000,
  players: 12_000,
  lineups: 5_000,
  plays: 120_000,
  predictions: 12_000,
  markets: 20_000
};

function emptyWarehouse() {
  return {
    version: WAREHOUSE_VERSION,
    updatedAt: '',
    results: [],
    boxscores: [],
    players: [],
    lineups: [],
    plays: [],
    predictions: [],
    markets: []
  };
}

function validDateKey(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) ? String(value) : '';
}

function resultKey(row = {}) {
  return String(row.id || `${row.leagueKey || row.league}:${row.dateKey}:${row.awayTeam}:${row.homeTeam}`);
}

function boxscoreKey(row = {}) {
  return String(row.gameId || row.id || `${row.leagueKey || row.league}:${row.dateKey}:${row.awayTeam}:${row.homeTeam}`);
}

function playerKey(row = {}) {
  return [row.leagueKey || row.league, row.gameId || row.dateKey, row.athleteId || row.sourceAthleteId || row.name, row.team].join(':');
}

function lineupKey(row = {}) {
  return [row.leagueKey || row.league, row.gameId, row.side, row.athleteId || row.name].join(':');
}

function playKey(row = {}) {
  return [row.leagueKey || row.league, row.gameId, row.id || row.sequence].join(':');
}

function eventKey(row = {}) {
  return JSON.stringify([String(row.leagueKey || row.league || '').trim().toLowerCase(),String(row.gameId ?? row.id ?? '')]);
}

function datedEventKey(row = {}) {
  const start=Date.parse(row.startTime||'');
  return JSON.stringify([eventKey(row),Number.isFinite(start)?new Date(start).toISOString():row.dateKey||'']);
}

function predictionKey(row = {}) {
  const issued=row.predictionGeneratedAt||row.generatedAt||'',time=Date.parse(issued);
  return JSON.stringify([row.guildId || 'default',row.dateKey,datedEventKey(row),row.modelVersion || '',predictionHorizon(row),Number.isFinite(time)?new Date(time).toISOString():issued]);
}

const observedBoolean=value=>typeof value==='boolean'?value:null;
const observedCount=value=>{const number=finiteNumber(value);return Number.isSafeInteger(number)&&number>=0?number:null;};

function marketKey(row = {}) {
  return JSON.stringify([row.guildId||'default',scopedEventKey(row),row.capturedAt,row.stage]);
}

function mergeRows(existing, incoming, keyFn, limit, sortField = 'dateKey') {
  const rows = new Map();
  for (const row of [...(existing || []), ...(incoming || [])]) {
    if (!row || typeof row !== 'object') continue;
    const key = keyFn(row);
    if (!key) continue;
    rows.set(key, { ...(rows.get(key) || {}), ...row });
  }
  return [...rows.values()]
    .sort((a, b) => String(a?.[sortField] || a?.capturedAt || '').localeCompare(String(b?.[sortField] || b?.capturedAt || '')))
    .slice(-limit);
}

function compactInputSnapshot(game = {}, capturedAt = Date.now()) {
  const compactSide = (row = {}) => ({
    confirmed: observedBoolean(row.confirmed),
    starterCount: observedCount(row.starterCount),
    learnedCoverage: finiteNumber(row.learnedCoverage),
    continuity: finiteNumber(row.continuity),
    lineupRating: finiteNumber(row.lineupRating)
  });
  const compactTeam = (side) => {
    const row = game.autoTeamMetrics?.[side] || {};
    return {
      name: game[side]?.name || '',
      abbreviation: game[side]?.abbr || '',
      record: game[side]?.record || '',
      sampleSize: observedCount(row.sampleSize),
      powerRating: finiteNumber(row.powerRating),
      offense: finiteNumber(row.offense),
      defense: finiteNumber(row.defense),
      form: finiteNumber(row.form),
      opponentAdjustedRating: finiteNumber(row.opponentAdjustedRating),
      scheduleStrength: finiteNumber(row.scheduleStrength),
      advancedRating: finiteNumber(row.advancedRating),
      seasonTransitionRisk: finiteNumber(row.seasonTransitionRisk),
      source: String(row.source || '').slice(0, 120)
    };
  };
  const advancedDataset = Object.fromEntries(Object.entries(game.advancedDataset || {})
    .filter(([, value]) => value === null || ['string', 'number', 'boolean'].includes(typeof value))
    .slice(0, 30).map(([key,value])=>[key,typeof value==='number'?finiteNumber(value):value]));
  const participationPlayers = [...(game.participationProjections || [])]
    .sort((a, b) => finiteNumber(b.impact,0) * finiteNumber(b.historicalShare,0) - finiteNumber(a.impact,0) * finiteNumber(a.historicalShare,0))
    .slice(0, 40)
    .map((row) => ({
      name: row.name || '', team: row.team || '', role: row.role || '', impact: finiteNumber(row.impact),
      availabilityProbability: finiteNumber(row.availabilityProbability), startProbability: finiteNumber(row.startProbability),
      historicalShare: finiteNumber(row.historicalShare), expectedShare: finiteNumber(row.expectedShare),
      expectedWorkload: finiteNumber(row.expectedWorkload), workloadUnit: typeof row.workloadUnit==='string'?row.workloadUnit:null,
      uncertainty: finiteNumber(row.uncertainty), historySamples: observedCount(row.historySamples)
    }));
  return {
    schema: 'sports-compact-inputs-v2',
    scope: 'bounded_compact_inputs_not_complete_source_payload',
    capturedAt: new Date(capturedAt).toISOString(),
    statusKey: game.statusKey || '',
    seasonYear: game.seasonYear || null,
    seasonType: game.seasonType || null,
    seasonSlug: game.seasonSlug || '',
    sourceProviders: game.sourceCorroboration?.providers || [],
    sourceConflicts: game.sourceCorroboration?.conflicts?.length || 0,
    autoHistory: game.autoHistory || null,
    teams: { away: compactTeam('away'), home: compactTeam('home') },
    advancedDataset,
    lineup: game.autoLineup ? { away: compactSide(game.autoLineup.away), home: compactSide(game.autoLineup.home), ratingDifference: finiteNumber(game.autoLineup.ratingDifference) } : null,
    participation: game.participationSummary || null,
    participationPlayers,
    contextFactors: game.autoContext?.factors || {},
    environment: game.eventEnvironment ? {
      indoor: observedBoolean(game.eventEnvironment.indoor),
      roof: game.eventEnvironment.roof || '',
      surface: game.eventEnvironment.surface || '',
      temperatureF: finiteNumber(game.eventEnvironment.temperatureF),
      windSpeedMph: finiteNumber(game.eventEnvironment.windSpeedMph),
      precipitation: observedBoolean(game.eventEnvironment.precipitation),
      officials: (game.eventEnvironment.officials || []).map((row) => row.name).slice(0, 8)
    } : null,
    playByPlay: {
      away: game.autoTeamMetrics?.away?.advancedMetrics?.playByPlay || null,
      home: game.autoTeamMetrics?.home?.advancedMetrics?.playByPlay || null
    },
    marketMovement: game.marketMovement || null
  };
}

function publicPrediction(prediction = {}, slate = {}, game = {}, capturedAt = Date.now()) {
  const start = new Date(prediction.startTime || game.startTime || '').getTime();
  const generated = new Date(prediction.predictionGeneratedAt || slate.generatedAt || '').getTime();
  const minutesToStart = Number.isFinite(start) && Number.isFinite(generated) ? (start - generated) / 60_000 : null;
  return {
    guildId: slate.guildId || '',
    dateKey: slate.dateKey || '',
    gameId: prediction.gameId,
    league: prediction.league || game.league,
    leagueKey: prediction.leagueKey || game.leagueKey,
    sportProfile: prediction.sportProfile,
    startTime: prediction.startTime || game.startTime || '',
    predictionGeneratedAt: prediction.predictionGeneratedAt || slate.generatedAt || '',
    modelVersion: prediction.modelVersion || '',
    snapshotPolicy: 'first_issue_immutable_v1',
    identityPolicy: 'league_start_model_horizon_issue_v2',
    horizon: predictionHorizon({...prediction,minutesToStart}),
    recordedAt: new Date(capturedAt).toISOString(),
    modelAsOf: prediction.modelAsOf || prediction.predictionGeneratedAt || slate.generatedAt || '',
    quoteRefreshOnly: prediction.quoteRefreshOnly === true,
    snapshotStage: prediction.snapshotStage || 'daily',
    minutesToStart: Number.isFinite(minutesToStart) ? Number(minutesToStart.toFixed(1)) : null,
    predictionMode: prediction.predictionMode,
    predictedSide: prediction.predictedSide,
    outcomeProbabilities: prediction.outcomeProbabilities,
    modeledOutcomes: Object.keys(prediction.outcomeProbabilities || {}).sort(),
    candidateModeledOutcomes: Object.fromEntries(Object.entries(prediction.candidateProbabilities || {}).map(([name,vector]) =>
      [name, Object.keys(vector || {}).sort()])),
    valueAnalysis: prediction.valueAnalysis || null,
    marketTimestampEvidence:structuredClone(prediction.marketTimestampEvidence||null),
    lineMarkets:{spread:structuredClone(game.odds?.spread||null),total:structuredClone(game.odds?.total||null)},
    lineMarketIntegrity:structuredClone(game.odds?.lineMarketIntegrity||null),
    settlementEvidence:structuredClone(game.odds?.h2h?.settlementEvidence||null),
    bookmakerIntegrity:structuredClone(game.odds?.h2h?.bookmakerIntegrity||null),
    attemptedBookmakerIntegrity:structuredClone(game.oddsBookmakerEvidence||null),
    oddsMatchEvidence:structuredClone(game.odds?.eventIdentity||game.oddsMatchEvidence||null),
    candidateArtifactIds: prediction.candidateArtifactIds || null,
    candidateProbabilities: prediction.candidateProbabilities,
    referenceBaselines: prediction.referenceBaselines || null,
    championModel: prediction.championModel,
    mlFeatureVector: prediction.mlFeatureVector || null,
    featureContributions: (prediction.factors || []).slice(0, 30).map((row) => ({
      label: row.label || '', present: observedBoolean(row.present), baseValue: finiteNumber(row.baseValue===undefined?row.value:row.baseValue),
      learnedMultiplier: finiteNumber(row.learnedMultiplier), value: finiteNumber(row.value)
    })),
    modelState: {
      championModel: prediction.championModel || '', challengerModel: prediction.challengerModel || '', championStatus: prediction.championStatus || '',
      specialistModel: prediction.sportModel?.id || '', specialistActive: Boolean(prediction.sportModel?.active),
      localMlModel: prediction.localMlModel?.id || '', localMlAccepted: Boolean(prediction.localMlModel?.accepted), localMlActive: Boolean(prediction.localMlModel?.active)
    },
    confidenceState: {
      predictionProbability: finiteNumber(prediction.predictionProbability),
      apiConfidenceValue: finiteNumber(prediction.apiConfidenceValue),
      localDataConfidenceValue: finiteNumber(prediction.localDataConfidenceValue),
      evidenceQualityValue: finiteNumber(prediction.evidenceQualityValue),
      featureAgreement: finiteNumber(prediction.featureAgreement),
      driftPenalty: finiteNumber(prediction.driftPenalty),
      seasonTransitionRisk: finiteNumber(prediction.seasonTransitionRisk)
    },
    inputSnapshot: compactInputSnapshot(game,capturedAt),
    predictionUncertaintyPoints: finiteNumber(prediction.predictionUncertaintyPoints),
    recommendationStatus: prediction.recommendationStatus,
    actualWinner: prediction.actualWinner || '',
    actualSide: prediction.actualSide || '',
    predictionCorrect: typeof prediction.predictionCorrect === 'boolean' ? prediction.predictionCorrect : null
  };
}

function fairVector(game = {}) {
  const fair = game.odds?.h2h || {};
  const vector = {
    away: Number(fair.away?.fairProbability ?? fair.away?.implied),
    home: Number(fair.home?.fairProbability ?? fair.home?.implied),
    draw: Number(fair.draw?.fairProbability ?? fair.draw?.implied)
  };
  const sides = ['away', 'home', 'draw'].filter((side) => Number.isFinite(vector[side]) && vector[side] > 0);
  if (sides.length < 2) return null;
  const total = sides.reduce((sum, side) => sum + vector[side], 0);
  return Object.fromEntries(['away', 'home', 'draw'].map((side) => [side, sides.includes(side) ? vector[side] / total : 0]));
}

function compactMarket(game = {}, meta = {}) {
  const vector = fairVector(game);
  if (!vector) return null;
  return {
    guildId: meta.guildId || '',
    dateKey: meta.dateKey || '',
    gameId: String(game.id || ''),
    league: game.league || '',
    leagueKey: game.leagueKey || '',
    startTime: game.startTime || '',
    capturedAt: meta.capturedAt || new Date().toISOString(),
    stage: meta.stages?.['event:'+scopedEventKey(eventReference(game))] || meta.stages?.[String(game.id)] || meta.stage || 'daily',
    minutesToStart: Number.isFinite(Number(meta.minutesToStart)) ? Number(meta.minutesToStart) : null,
    away: vector.away,
    home: vector.home,
    draw: vector.draw,
    bookmakerCount: Number(game.odds?.h2h?.bookmakerCount || game.odds?.bookmakerCount || 0),
    dispersion: Number(game.odds?.h2h?.dispersion || 0),
    provider: game.odds?.provider || game.odds?.freeProvider || '',
    cacheState: game.odds?.cacheState || '',
    lineMarkets:{spread:structuredClone(game.odds?.spread||null),total:structuredClone(game.odds?.total||null)},
    lineMarketIntegrity:structuredClone(game.odds?.lineMarketIntegrity||null),
    settlementEvidence:structuredClone(game.odds?.h2h?.settlementEvidence||null),
    bookmakerIntegrity:structuredClone(game.odds?.h2h?.bookmakerIntegrity||null),
    eventIdentity:structuredClone(game.odds?.eventIdentity||game.oddsMatchEvidence||null)
  };
}

export function calculateMarketMovement(rows = []) {
  const ordered = [...rows].sort((a, b) => String(a.capturedAt || '').localeCompare(String(b.capturedAt || '')));
  if (!ordered.length) return null;
  const opening = ordered[0];
  const latest = ordered.at(-1);
  const closing = [...ordered].reverse().find((row) => row.stage === 'closing' || row.stage === 't-10') || null;
  return {
    openingCapturedAt: opening.capturedAt,
    currentCapturedAt: latest.capturedAt,
    opening: { away: opening.away, home: opening.home, draw: opening.draw },
    current: { away: latest.away, home: latest.home, draw: latest.draw },
    closing: closing ? { away: closing.away, home: closing.home, draw: closing.draw, capturedAt: closing.capturedAt } : null,
    movementPoints: {
      away: Number(((latest.away - opening.away) * 100).toFixed(1)),
      home: Number(((latest.home - opening.home) * 100).toFixed(1)),
      draw: Number(((latest.draw - opening.draw) * 100).toFixed(1))
    },
    snapshots: ordered.length
  };
}

export async function readFeatureWarehouse({readOnly=false} = {}) {
  const stored = await readJson(warehouseFile, null, { throwOnError: true,readOnly,redactErrors:readOnly });
  if (!stored) return emptyWarehouse();
  if (![1, WAREHOUSE_VERSION].includes(Number(stored.version)) || Object.keys(LIMITS).some((key) => stored[key] !== undefined && !Array.isArray(stored[key]))) {
    throw new Error('Invalid sports feature warehouse schema; existing history was preserved.');
  }
  return { ...emptyWarehouse(), ...stored, version: WAREHOUSE_VERSION };
}

async function queuedUpdate(updater,{skipDataMigration=false}={}) {
  const operation = writeChain.then(() => withAuditFileLock(warehouseFile,async () => {
    const current = await readFeatureWarehouse({readOnly:skipDataMigration});
    const next = await updater(current);
    if(next===current)return current;
    next.version = WAREHOUSE_VERSION;
    next.updatedAt = new Date().toISOString();
    await writeJson(warehouseFile, next, { compact: true, backup: true, mode: 0o600,skipDataMigration });
    return next;
  }));
  writeChain = operation.catch(() => {});
  return operation;
}

export async function ingestFeatureEvidence(evidence = {}) {
  const historyResults = (evidence.historyResults || []).filter((row) => validDateKey(row.dateKey));
  const samples = (evidence.historicalSamples || []).filter(Boolean);
  const plays = samples.flatMap(warehousePlayRows);
  const boxscores = samples.map(({ plays: ignoredPlays, ...sample }) => sample);
  const games = evidence.games || [];
  const players = [];
  const lineups = [];
  for (const game of games) {
    for (const row of game.autoPlayers || []) {
      players.push({ ...row, gameId: String(game.id), dateKey: evidence.dateKey || '', leagueKey: game.leagueKey });
    }
    for (const row of game.autoLineups || []) {
      lineups.push({ ...row, gameId: String(game.id), dateKey: evidence.dateKey || '', leagueKey: game.leagueKey });
    }
  }
  return queuedUpdate((current) => ({
    ...current,
    results: mergeRows(current.results, historyResults, resultKey, LIMITS.results),
    boxscores: mergeRows(current.boxscores, boxscores, boxscoreKey, LIMITS.boxscores),
    players: mergeRows(current.players, players, playerKey, LIMITS.players, 'updatedAt'),
    lineups: mergeRows(current.lineups, lineups, lineupKey, LIMITS.lineups, 'updatedAt'),
    plays: mergeRows(current.plays, plays, playKey, LIMITS.plays, 'startTime')
  }));
}

export async function recordSlateSnapshot(slate = {}, {now=Date.now()} = {}) {
  if(!Number.isFinite(now))throw new Error('Valid warehouse observation time required');
  const games=slate.games||[],gamesById=new Map();
  for(const game of games){const id=String(game.id);if(!gamesById.has(id))gamesById.set(id,[]);gamesById.get(id).push(game);}
  const rows = (slate.predictions || []).map(prediction=>{
    const scoped=Boolean(prediction.leagueKey||prediction.league);
    const issuedStart=Date.parse(prediction.startTime||'');
    const matches=(gamesById.get(String(prediction.gameId))||[]).filter(game=>{
      const gameStart=Date.parse(game.startTime||'');
      return (scoped?eventKey(game)===eventKey(prediction):String(game.id)===String(prediction.gameId))
        &&(!Number.isFinite(issuedStart)||!Number.isFinite(gameStart)||issuedStart===gameStart);
    });
    // Clone before the queued write yields: callers may refresh their mutable slate.
    return structuredClone(publicPrediction(prediction,slate,matches.length===1?matches[0]:{},now));
  });
  const finals=new Map(),conflicts=new Set(),finalObservations=new Map();
  for(const game of games){
    if(game.manualResultConflict){const key=datedEventKey({...game,dateKey:game.dateKey||slate.dateKey});conflicts.add(key);finalObservations.set(key,(game.manualResultConflict.observations||[]).map(row=>({...row,signature:JSON.stringify([row.actualSide,row.awayScore,row.homeScore])})));continue;}
    const actualSide=finalOutcomeSide(game);if(!actualSide)continue;
    const key=datedEventKey({...game,dateKey:game.dateKey||slate.dateKey}),final={actualSide,actualWinner:actualSide==='draw'?'Draw':game[actualSide]?.name||'',awayScore:finiteNumber(game.away?.score),homeScore:finiteNumber(game.home?.score),resultSource:game.manualResultEvidence?{kind:'manual',...structuredClone(game.manualResultEvidence)}:{kind:'provider',fetchedAt:game.sourceMeta?.fetchedAt||null}};
    const signature=JSON.stringify([actualSide,finiteNumber(game.away?.score),finiteNumber(game.home?.score)]);
    if(!finalObservations.has(key))finalObservations.set(key,[]);
    const observations=finalObservations.get(key);
    if(!observations.some(row=>row.signature===signature))observations.push({signature,actualSide,awayScore:finiteNumber(game.away?.score),homeScore:finiteNumber(game.home?.score)});
    if(finals.has(key)&&finals.get(key).signature!==signature)conflicts.add(key);
    finals.set(key,{...final,signature});
  }
  for(const key of conflicts)finals.delete(key);
  if(!rows.length&&!finals.size&&!conflicts.size)return readFeatureWarehouse();
  return queuedUpdate((current) => {
    // A later display refresh or final grade must not replace an issued price
    // decision with a now-expired quote analysis for the same frozen prediction.
    const existing = new Map(current.predictions.map((row) => [predictionKey(row), row]));
    const frozenRows = rows.map((row) => {
      const prior = existing.get(predictionKey(row));
      // Grades may change later; the issued forecast and point-in-time inputs may not.
      return prior || row;
    });
    const predictions = mergeRows(current.predictions, frozenRows, predictionKey, LIMITS.predictions, 'predictionGeneratedAt')
      .map((row) => {
        if((row.guildId || '') !== (slate.guildId || ''))return row;
        const key=datedEventKey(row);
        if(conflicts.has(key))return {...row,actualSide:'',actualWinner:'',predictionCorrect:null,resultEvidenceStatus:'disputed',
          resultConflictObservedAt:row.resultConflictObservedAt||new Date(now).toISOString(),
          lastUndisputedGrade:['away','home','draw'].includes(row.actualSide)?{actualSide:row.actualSide,actualWinner:row.actualWinner,predictionCorrect:row.predictionCorrect,resolvedAt:row.resolvedAt||null,resultReviewProposalId:row.resultReviewProposalId||null}:row.lastUndisputedGrade||null,
          conflictingFinalObservations:finalObservations.get(key).slice(0,8).map(({signature:ignored,...observation})=>observation),
          conflictingFinalObservationsTruncated:finalObservations.get(key).length>8};
        // Re-admission requires explicit adjudication, never an unverified later batch.
        if(row.resultEvidenceStatus==='disputed')return row;
        const final = finals.get(key);
        if (!final) return row;
        if(row.resultEvidenceStatus==='adjudicated'){
          const approved=row.adjudicatedResult;
          if(final.actualSide===approved?.actualSide&&final.awayScore===approved?.awayScore&&final.homeScore===approved?.homeScore)return row;
          return {...row,actualSide:'',actualWinner:'',predictionCorrect:null,resultEvidenceStatus:'disputed',resultConflictObservedAt:new Date(now).toISOString(),
            lastUndisputedGrade:{actualSide:row.actualSide,actualWinner:row.actualWinner,predictionCorrect:row.predictionCorrect,resolvedAt:row.resolvedAt},
            conflictingFinalObservations:[{...approved},{actualSide:final.actualSide,awayScore:final.awayScore,homeScore:final.homeScore}],conflictingFinalObservationsTruncated:false};
        }
        return { ...row, actualSide:final.actualSide,actualWinner:final.actualWinner, predictionCorrect: row.predictedSide === final.actualSide,resultSource:final.resultSource,
          resolvedAt: row.resolvedAt || slate.refreshedAt || new Date(now).toISOString(),
          resolvedAtSource: row.resolvedAtSource || 'first_observed_final'
        };
      });
    return { ...current, predictions };
  });
}

export async function captureMarketSnapshots(games = [], meta = {}) {
  const current = await readFeatureWarehouse();
  const capturedAt = meta.capturedAt || new Date().toISOString();
  const captureIds = meta.gameIds?.length ? new Set(meta.gameIds.map(String)) : null;
  const captureEvents=meta.events?.length?new Set(meta.events.map(scopedEventKey)):null;
  const incoming = games.filter((game) => captureEvents?captureEvents.has(scopedEventKey(eventReference(game))):!captureIds || captureIds.has(String(game.id))).map((game) => compactMarket(game, { ...meta, capturedAt })).filter(Boolean);
  for (const game of games) {
    const rows = [...current.markets, ...incoming]
      .filter((row) => scopedEventKey(row)===scopedEventKey(eventReference(game)) && String(row.guildId || '') === String(meta.guildId || ''))
      .sort((a, b) => String(a.capturedAt).localeCompare(String(b.capturedAt)));
    if (!rows.length) continue;
    game.marketMovement = calculateMarketMovement(rows);
  }
  if (incoming.length) {
    await queuedUpdate((latest) => ({
      ...latest,
      markets: mergeRows(latest.markets, incoming, marketKey, LIMITS.markets, 'capturedAt')
    }));
  }
  return incoming.length;
}

export async function historicalEvidenceBefore(dateKey) {
  const warehouse = await readFeatureWarehouse();
  return {
    results: warehouse.results.filter((row) => !dateKey || String(row.dateKey) < String(dateKey)),
    boxscores: warehouse.boxscores.filter((row) => !dateKey || String(row.dateKey || row.startTime || '').slice(0, 10) < String(dateKey))
  };
}

export async function warehouseInventory() {
  const warehouse = await readFeatureWarehouse();
  const proofs=await currentAdjudicationProofs(warehouse.predictions);
  return {
    version: warehouse.version,
    updatedAt: warehouse.updatedAt,
    results: warehouse.results.length,
    boxscores: warehouse.boxscores.length,
    players: warehouse.players.length,
    lineups: warehouse.lineups.length,
    plays: warehouse.plays.length,
    predictions: warehouse.predictions.length,
    disputedPredictionRecords: warehouse.predictions.filter(row=>row.resultEvidenceStatus==='disputed').length,
    adjudicatedPredictionRecords: warehouse.predictions.filter(row=>row.resultEvidenceStatus==='adjudicated').length,
    staleAdjudicatedPredictionRecords:warehouse.predictions.filter(row=>row.resultEvidenceStatus==='adjudicated'&&!proofs.get(row)).length,
    markets: warehouse.markets.length
  };
}

export async function warehouseCandidateRowsBefore(dateKey = '') {
  const warehouse = await readFeatureWarehouse();
  const proofs=await currentAdjudicationProofs(warehouse.predictions);
  return warehouse.predictions
    .filter((row) => {
      if (row.resultEvidenceStatus==='adjudicated'&&!proofs.get(row))return false;
      if (row.resultEvidenceStatus==='disputed' || row.quoteRefreshOnly || !['away', 'home', 'draw'].includes(row.actualSide) || !row.candidateProbabilities || row.predictionMode !== 'pregame' || (dateKey && String(row.dateKey) >= String(dateKey))) return false;
      const generatedAt = new Date(row.predictionGeneratedAt || '').getTime();
      const startTime = new Date(row.startTime || '').getTime();
      return Number.isFinite(generatedAt) && Number.isFinite(startTime) && generatedAt < startTime;
    })
    .map((row) => ({
      dateKey: row.dateKey,
      gameId: row.gameId,
      sport: row.sportProfile,
      leagueKey: row.leagueKey,
      startTime: row.startTime,
      modelVersion: row.modelVersion || '',
      snapshotStage: row.snapshotStage || 'daily',
      horizon: predictionHorizon(row),
      predictionGeneratedAt: row.predictionGeneratedAt || '',
      recordedAt: row.recordedAt || '',
      resolvedAt: row.resolvedAt || '',
      snapshotPolicy: row.snapshotPolicy || '',
      actualSide: row.actualSide,
      candidateArtifactIds: row.candidateArtifactIds || null,
      candidateProbabilities: row.candidateProbabilities,
      mlFeatureVector: row.mlFeatureVector,
      resultEvidenceStatus:row.resultEvidenceStatus||'unreviewed_observation',resultReviewProposalId:row.resultReviewProposalId||null,
      outcomeSourceIndependentlyVerified:false,
      source: 'frozen-production'
    }));
}

export { warehouseFile };


/** Read-only preparation; the journal is fully checked by its canonical reader. */
export async function prepareWarehouseResultReview(forecastId,{journalFile=predictionJournalFile,now=Date.now()}={}) {
  requireLocalReviewJournal(journalFile);
  const records=await readPredictionJournal(journalFile),warehouse=await readFeatureWarehouse({readOnly:true});
  return makeWarehouseResultProposal(records,warehouse.predictions,forecastId,dataDir,now,journalFile);
}

/** Explicit operator review only; ordinary scanners never invoke this recovery path. */
export async function applyWarehouseResultReview(proposal,review,{journalFile=predictionJournalFile,expectedDataDirectory,now=Date.now()}={}) {
  if(!expectedDataDirectory||path.resolve(expectedDataDirectory)!==path.resolve(dataDir))throw new Error('Explicit matching data directory required');
  requireLocalReviewJournal(journalFile);
  proposal=structuredClone(proposal);review=structuredClone(review);
  return withAuditFileLock(journalFile,async()=>{
    const records=await readPredictionJournal(journalFile);let decision;
    await queuedUpdate(current=>{
      decision=reviewedWarehouseResult(records,current.predictions,proposal,review,dataDir,now,journalFile);
      if(decision.duplicate)return current;
      const predictions=[...current.predictions];predictions[decision.index]=decision.row;
      return {...current,predictions};
    },{skipDataMigration:true});
    return {status:decision.duplicate?'already_applied':'applied',proposalId:proposal.proposalId,forecastId:proposal.forecastId};
  });
}


function requireLocalReviewJournal(file){
  if(typeof file!=='string'||path.dirname(path.resolve(file))!==path.resolve(dataDir)||path.extname(file)!=='.jsonl')throw new Error('Review journal must be a JSONL file in the configured data directory');
}

async function currentAdjudicationProofs(rows){
  const cache=new Map(),proofs=new Map();
  for(const row of rows){
    if(row.resultEvidenceStatus!=='adjudicated')continue;
    const receipt=(row.resultAdjudications||[]).find(value=>value.proposalId===row.resultReviewProposalId);
    if(!receipt?.journalFile||!receipt.forecastId){proofs.set(row,false);continue;}
    try{requireLocalReviewJournal(receipt.journalFile);}catch{proofs.set(row,false);continue;}
    if(!cache.has(receipt.journalFile)){
      const records=await readPredictionJournal(receipt.journalFile),latest=journalResultState(records).eligible,forecasts=new Map();
      for(const record of records){if(record.type==='forecast')forecasts.set(record.eventHash,record);}
      cache.set(receipt.journalFile,{latest,forecasts});
    }
    const {latest,forecasts}=cache.get(receipt.journalFile);
    proofs.set(row,currentReviewedWarehouseResult(row,receipt,forecasts.get(receipt.forecastEventHash),latest.get(receipt.forecastId)));
  }
  return proofs;
}
