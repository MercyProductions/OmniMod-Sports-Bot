import path from 'node:path';
import { dataDir } from './config.js';
import { warehousePlayRows } from './playByPlay.js';
import { readJson, writeJson } from './storage.js';
import { finalOutcomeSide } from './dataValidation.js';
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

function predictionKey(row = {}) {
  return [row.guildId || 'default', row.dateKey, row.gameId, row.predictionGeneratedAt || row.generatedAt].join(':');
}

function marketKey(row = {}) {
  return [row.guildId || 'default', row.leagueKey || row.league, row.gameId, row.capturedAt, row.stage].join(':');
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

function compactInputSnapshot(game = {}) {
  const compactSide = (row = {}) => ({
    confirmed: Boolean(row.confirmed),
    starterCount: Number(row.starterCount || 0),
    learnedCoverage: Number(row.learnedCoverage || 0),
    continuity: Number.isFinite(Number(row.continuity)) ? Number(row.continuity) : null,
    lineupRating: Number.isFinite(Number(row.lineupRating)) ? Number(row.lineupRating) : null
  });
  const compactTeam = (side) => {
    const row = game.autoTeamMetrics?.[side] || {};
    return {
      name: game[side]?.name || '',
      abbreviation: game[side]?.abbr || '',
      record: game[side]?.record || '',
      sampleSize: Number(row.sampleSize || 0),
      powerRating: Number.isFinite(Number(row.powerRating)) ? Number(row.powerRating) : null,
      offense: Number.isFinite(Number(row.offense)) ? Number(row.offense) : null,
      defense: Number.isFinite(Number(row.defense)) ? Number(row.defense) : null,
      form: Number.isFinite(Number(row.form)) ? Number(row.form) : null,
      opponentAdjustedRating: Number.isFinite(Number(row.opponentAdjustedRating)) ? Number(row.opponentAdjustedRating) : null,
      scheduleStrength: Number.isFinite(Number(row.scheduleStrength)) ? Number(row.scheduleStrength) : null,
      advancedRating: Number.isFinite(Number(row.advancedRating)) ? Number(row.advancedRating) : null,
      seasonTransitionRisk: Number.isFinite(Number(row.seasonTransitionRisk)) ? Number(row.seasonTransitionRisk) : null,
      source: String(row.source || '').slice(0, 120)
    };
  };
  const advancedDataset = Object.fromEntries(Object.entries(game.advancedDataset || {})
    .filter(([, value]) => ['string', 'number', 'boolean'].includes(typeof value))
    .slice(0, 30));
  const participationPlayers = [...(game.participationProjections || [])]
    .sort((a, b) => Number(b.impact || 0) * Number(b.historicalShare || 0) - Number(a.impact || 0) * Number(a.historicalShare || 0))
    .slice(0, 40)
    .map((row) => ({
      name: row.name || '', team: row.team || '', role: row.role || '', impact: Number(row.impact || 0),
      availabilityProbability: row.availabilityProbability, startProbability: row.startProbability,
      historicalShare: row.historicalShare, expectedShare: row.expectedShare,
      expectedWorkload: row.expectedWorkload, workloadUnit: row.workloadUnit,
      uncertainty: row.uncertainty, historySamples: row.historySamples
    }));
  return {
    capturedAt: new Date().toISOString(),
    statusKey: game.statusKey || '',
    seasonYear: game.seasonYear || null,
    seasonType: game.seasonType || null,
    seasonSlug: game.seasonSlug || '',
    sourceProviders: game.sourceCorroboration?.providers || [],
    sourceConflicts: game.sourceCorroboration?.conflicts?.length || 0,
    autoHistory: game.autoHistory || null,
    teams: { away: compactTeam('away'), home: compactTeam('home') },
    advancedDataset,
    lineup: game.autoLineup ? { away: compactSide(game.autoLineup.away), home: compactSide(game.autoLineup.home), ratingDifference: game.autoLineup.ratingDifference } : null,
    participation: game.participationSummary || null,
    participationPlayers,
    contextFactors: game.autoContext?.factors || {},
    environment: game.eventEnvironment ? {
      indoor: Boolean(game.eventEnvironment.indoor),
      roof: game.eventEnvironment.roof || '',
      surface: game.eventEnvironment.surface || '',
      temperatureF: game.eventEnvironment.temperatureF ?? null,
      windSpeedMph: game.eventEnvironment.windSpeedMph ?? null,
      precipitation: Boolean(game.eventEnvironment.precipitation),
      officials: (game.eventEnvironment.officials || []).map((row) => row.name).slice(0, 8)
    } : null,
    playByPlay: {
      away: game.autoTeamMetrics?.away?.advancedMetrics?.playByPlay || null,
      home: game.autoTeamMetrics?.home?.advancedMetrics?.playByPlay || null
    },
    marketMovement: game.marketMovement || null
  };
}

function publicPrediction(prediction = {}, slate = {}, game = {}) {
  const start = new Date(prediction.startTime || game.startTime || '').getTime();
  const generated = new Date(prediction.predictionGeneratedAt || slate.generatedAt || '').getTime();
  const minutesToStart = Number.isFinite(start) && Number.isFinite(generated) ? (start - generated) / 60_000 : null;
  return {
    guildId: slate.guildId || '',
    dateKey: slate.dateKey || '',
    gameId: prediction.gameId,
    league: prediction.league,
    leagueKey: prediction.leagueKey,
    sportProfile: prediction.sportProfile,
    startTime: prediction.startTime,
    predictionGeneratedAt: prediction.predictionGeneratedAt || slate.generatedAt || '',
    modelVersion: prediction.modelVersion || '',
    snapshotPolicy: 'first_issue_immutable_v1',
    recordedAt: new Date().toISOString(),
    modelAsOf: prediction.modelAsOf || prediction.predictionGeneratedAt || slate.generatedAt || '',
    quoteRefreshOnly: prediction.quoteRefreshOnly === true,
    snapshotStage: prediction.snapshotStage || 'daily',
    minutesToStart: Number.isFinite(minutesToStart) ? Number(minutesToStart.toFixed(1)) : null,
    predictionMode: prediction.predictionMode,
    predictedSide: prediction.predictedSide,
    outcomeProbabilities: prediction.outcomeProbabilities,
    valueAnalysis: prediction.valueAnalysis || null,
    candidateProbabilities: prediction.candidateProbabilities,
    referenceBaselines: prediction.referenceBaselines || null,
    championModel: prediction.championModel,
    mlFeatureVector: prediction.mlFeatureVector || null,
    featureContributions: (prediction.factors || []).slice(0, 30).map((row) => ({
      label: row.label || '', present: Boolean(row.present), baseValue: Number(row.baseValue ?? row.value ?? 0),
      learnedMultiplier: Number(row.learnedMultiplier || 1), value: Number(row.value || 0)
    })),
    modelState: {
      championModel: prediction.championModel || '', challengerModel: prediction.challengerModel || '', championStatus: prediction.championStatus || '',
      specialistModel: prediction.sportModel?.id || '', specialistActive: Boolean(prediction.sportModel?.active),
      localMlModel: prediction.localMlModel?.id || '', localMlAccepted: Boolean(prediction.localMlModel?.accepted), localMlActive: Boolean(prediction.localMlModel?.active)
    },
    confidenceState: {
      predictionProbability: prediction.predictionProbability ?? null,
      apiConfidenceValue: prediction.apiConfidenceValue ?? null,
      localDataConfidenceValue: prediction.localDataConfidenceValue ?? null,
      evidenceQualityValue: prediction.evidenceQualityValue ?? null,
      featureAgreement: prediction.featureAgreement ?? null,
      driftPenalty: prediction.driftPenalty ?? null,
      seasonTransitionRisk: prediction.seasonTransitionRisk ?? null
    },
    inputSnapshot: compactInputSnapshot(game),
    predictionUncertaintyPoints: prediction.predictionUncertaintyPoints,
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
    stage: meta.stages?.[String(game.id)] || meta.stage || 'daily',
    minutesToStart: Number.isFinite(Number(meta.minutesToStart)) ? Number(meta.minutesToStart) : null,
    away: vector.away,
    home: vector.home,
    draw: vector.draw,
    bookmakerCount: Number(game.odds?.h2h?.bookmakerCount || game.odds?.bookmakerCount || 0),
    dispersion: Number(game.odds?.h2h?.dispersion || 0),
    provider: game.odds?.provider || game.odds?.freeProvider || '',
    cacheState: game.odds?.cacheState || ''
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

export async function readFeatureWarehouse() {
  const stored = await readJson(warehouseFile, null, { throwOnError: true });
  if (!stored) return emptyWarehouse();
  if (![1, WAREHOUSE_VERSION].includes(Number(stored.version)) || Object.keys(LIMITS).some((key) => stored[key] !== undefined && !Array.isArray(stored[key]))) {
    throw new Error('Invalid sports feature warehouse schema; existing history was preserved.');
  }
  return { ...emptyWarehouse(), ...stored, version: WAREHOUSE_VERSION };
}

async function queuedUpdate(updater) {
  const operation = writeChain.then(async () => {
    const current = await readFeatureWarehouse();
    const next = await updater(current);
    next.version = WAREHOUSE_VERSION;
    next.updatedAt = new Date().toISOString();
    await writeJson(warehouseFile, next, { compact: true, backup: true, mode: 0o600 });
    return next;
  });
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

export async function recordSlateSnapshot(slate = {}) {
  const gameMap = new Map((slate.games || []).map((game) => [String(game.id), game]));
  const rows = (slate.predictions || []).map((prediction) => publicPrediction(prediction, slate, gameMap.get(String(prediction.gameId)) || {}));
  if (!rows.length) return readFeatureWarehouse();
  const finals = new Map((slate.games || []).filter((game) => finalOutcomeSide(game)).map((game) => {
    const actualSide = finalOutcomeSide(game);
    return [String(game.id), { actualSide, actualWinner: actualSide === 'draw' ? 'Draw' : game[actualSide]?.name || '' }];
  }));
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
        const final = finals.get(String(row.gameId));
        if (!final || (row.guildId || '') !== (slate.guildId || '')) return row;
        return { ...row, ...final, predictionCorrect: row.predictedSide === final.actualSide,
          resolvedAt: row.resolvedAt || slate.refreshedAt || new Date().toISOString(),
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
  const incoming = games.filter((game) => !captureIds || captureIds.has(String(game.id))).map((game) => compactMarket(game, { ...meta, capturedAt })).filter(Boolean);
  for (const game of games) {
    const rows = [...current.markets, ...incoming]
      .filter((row) => String(row.gameId) === String(game.id) && String(row.guildId || '') === String(meta.guildId || ''))
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
  return {
    version: warehouse.version,
    updatedAt: warehouse.updatedAt,
    results: warehouse.results.length,
    boxscores: warehouse.boxscores.length,
    players: warehouse.players.length,
    lineups: warehouse.lineups.length,
    plays: warehouse.plays.length,
    predictions: warehouse.predictions.length,
    markets: warehouse.markets.length
  };
}

export async function warehouseCandidateRowsBefore(dateKey = '') {
  const warehouse = await readFeatureWarehouse();
  return warehouse.predictions
    .filter((row) => {
      if (row.quoteRefreshOnly || !['away', 'home', 'draw'].includes(row.actualSide) || !row.candidateProbabilities || row.predictionMode !== 'pregame' || (dateKey && String(row.dateKey) >= String(dateKey))) return false;
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
      candidateProbabilities: row.candidateProbabilities,
      mlFeatureVector: row.mlFeatureVector,
      source: 'frozen-production'
    }));
}

export { warehouseFile };
