import {quotePrice} from './oddsPricing.js';
import { createHash } from 'node:crypto';
import { open, readFile, mkdir, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { hostname } from 'node:os';
import { dataDir } from './config.js';
import { finiteNumber, finalOutcomeSide } from './dataValidation.js';
import { predictionHorizon } from './horizonEvaluation.js';

export const predictionJournalFile = join(dataDir, 'prediction-journal.jsonl');
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const iso = value => Number.isFinite(Date.parse(value || '')) ? new Date(value).toISOString() : null;
let writeChain = Promise.resolve();

export async function readPredictionJournal(file = predictionJournalFile) {
  let text;
  try { text = await readFile(file, 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  const records = [];
  if (text && !text.endsWith('\n')) throw new Error('Prediction journal has an incomplete final line; preserve it for review.');
  let previousHash = null;
  for (const line of text.split('\n')) {
    if (!line) continue;
    let row;
    try { row = JSON.parse(line); } catch { throw new Error('Prediction journal is malformed; preserve it for review.'); }
    const { eventHash, ...body } = row;
    if (body.schemaVersion !== 1 || body.sequence !== records.length + 1 || body.previousHash !== previousHash
      || eventHash !== digest(body)) throw new Error('Prediction journal integrity check failed; existing records were preserved.');
    records.push(row); previousHash = eventHash;
  }
  return records;
}

function priceSnapshot(market = {}) {
  const result = {};
  for (const side of ['away', 'home', 'draw']) {
    if (!market[side]) continue;
    const quotes = market[side].quotes?.length ? market[side].quotes : [market[side]];
    result[side] = { offeredQuotes: quotes.slice(0, 100).map(quote => ({
      priceAmerican: quotePrice(quote)?.americanOdds ?? null,
      originalPrice: finiteNumber(quote.originalPrice ?? quote.price ?? quote.priceDecimal ?? quote.decimalOdds ?? quote.priceAmerican), originalFormat: quote.priceFormat || quote.originalFormat || 'american',
      priceDecimal: quotePrice(quote)?.decimalOdds ?? null, bookmaker: String(quote.bookmaker || '').slice(0, 120),
      bookmakerKey: String(quote.bookmakerKey || '').slice(0, 120), quotedAt: iso(quote.lastUpdate),
      timestampSource: String(quote.timestampSource || 'unknown').slice(0, 80)
    })), availableQuoteCount: quotes.length, truncated: quotes.length > 100,
      consensusProbability: finiteNumber(market[side].fairProbability ?? market[side].implied) };
  }
  return result;
}

function forecastSnapshot(prediction, game, slate, capturedAt) {
  const generatedAt = iso(prediction.predictionGeneratedAt || slate.generatedAt), startTime = iso(prediction.startTime || game.startTime);
  const version = String(prediction.modelVersion || 'legacy-unversioned');
  const horizon = predictionHorizon({ ...prediction, minutesToStart: generatedAt && startTime
    ? (Date.parse(startTime) - Date.parse(generatedAt)) / 60_000 : null });
  const identity = { guildId: String(slate.guildId || ''), league: String(prediction.leagueKey || game.leagueKey || ''),
    gameId: String(prediction.gameId), modelVersion: version, horizon, predictionGeneratedAt: generatedAt };
  const observedPregame = prediction.predictionMode === 'pregame' && game.statusKey === 'scheduled'
    && generatedAt && startTime && Date.parse(generatedAt) <= capturedAt && capturedAt < Date.parse(startTime);
  const dataTimes = { schedule: game.sourceMeta, summary: game.autoEnrichment, history: game.autoHistory };
  const vector = Object.fromEntries(['away', 'home', 'draw'].map(side => [side, finiteNumber(prediction.outcomeProbabilities?.[side])]));
  const probabilityValid = vector.away !== null && vector.home !== null
    && Object.values(vector).filter(value => value !== null).every(value => value >= 0 && value <= 100)
    && Math.abs(Object.values(vector).reduce((sum, value) => sum + (value || 0), 0) - 100) <= 0.5;
  const offeredOdds = priceSnapshot(game.odds?.h2h);
  const hasOfferedPrice = Object.values(offeredOdds).some(outcome => outcome.offeredQuotes.some(quote =>
    quote.priceAmerican !== null && Math.abs(quote.priceAmerican) >= 100 && quote.bookmaker));
  return { forecastId: digest(identity), ...identity, startTime, snapshotStage: prediction.snapshotStage || 'daily',
    recordEligibility: observedPregame && probabilityValid && version !== 'legacy-unversioned'
      ? 'observed_pregame' : 'unverifiable_or_late_observation',
    selectedSide: prediction.predictedSide || null, selectedProbability: finiteNumber(prediction.predictionProbability),
    outcomePercentages: vector, recommendationStatus: prediction.recommendationStatus || 'unknown',
    evidenceCoverage: prediction.evidenceCoverage || null,
    eventContext: { sport: prediction.sportProfile || game.sportGroup || null,
      season: game.seasonYear ?? game.season?.year ?? null, seasonType: game.seasonType ?? game.season?.type ?? null },
    valueDecision: prediction.valueAnalysis?.bestOpportunity ? {
      side: prediction.valueAnalysis.bestOpportunity.side, status: prediction.valueAnalysis.bestOpportunity.status,
      evaluatedAt: iso(prediction.valueAnalysis.evaluatedAt), policy: prediction.valueAnalysis.policy || null,
      quote: prediction.valueAnalysis.bestOpportunity.quote || null,
      expectedReturnBeforeCosts: finiteNumber(prediction.valueAnalysis.bestOpportunity.expectedReturn),
      stressedReturnBeforeCosts: finiteNumber(prediction.valueAnalysis.bestOpportunity.stressedReturn)
    } : null,
    candidateArtifactIds: prediction.candidateArtifactIds || null,
    candidateProbabilities: prediction.candidateProbabilities || null,
    referenceBaselines: prediction.referenceBaselines || null,
    issuanceScope: 'Computed pregame slate; Discord delivery is not attested by this journal.',
    dataTimestamps: Object.fromEntries(Object.entries(dataTimes).map(([source, meta]) => [source, {
      fetchedAt: iso(meta?.fetchedAt), cacheState: String(meta?.cacheState || 'unknown'),
      kind: 'source_fetch_receipt; not an attestation of underlying event freshness',
      laterThanPrediction: Boolean(generatedAt && iso(meta?.fetchedAt) && Date.parse(meta.fetchedAt) > Date.parse(generatedAt))
    }])),
    odds: { status: hasOfferedPrice ? 'available' : 'unavailable',
      provider: String(game.odds?.provider || game.odds?.freeProvider || '').slice(0, 120),
      rules: String(game.odds?.h2h?.rules || game.odds?.rules || 'unknown').slice(0, 120),
      cacheState: String(game.odds?.cacheState || 'unknown'),
      identity: { localGameId: String(game.id || ''), league: String(game.leagueKey || ''),
        providerEventId: String(game.odds?.eventId || ''), providerStartTime: iso(game.odds?.commenceTime),
        matchStatus: String(game.odds?.matchStatus || 'unknown') },
      settlementVerified: game.odds?.h2h?.settlementVerified === true, outcomes: offeredOdds },
    modelUsesMarket: Number(prediction.marketBlendWeight || 0) > 0,
    confidence: { dataQuality: finiteNumber(prediction.evidenceQualityValue), uncertaintyPoints: finiteNumber(prediction.predictionUncertaintyPoints),
      calibrationSamples: finiteNumber(prediction.calibrationSampleSize) } };
}

/** Mandatory prospective audit trail, independent of optional warehouse retention. */
export function recordPredictionJournal(slate = {}, { file = predictionJournalFile, now = Date.now(), lifecycle = 'issued', reason = '' } = {}) {
  const operation = writeChain.then(async () => {
    if (!Number.isFinite(now)) throw new Error('A valid journal observation time is required.');
    if (!['provisional', 'issued', 'rejected', 'delivered', 'results_only', 'prices_only'].includes(lifecycle)) throw new Error('Invalid forecast lifecycle operation.');
    await mkdir(dirname(file), { recursive: true });
    let lock;
    try { lock = await open(`${file}.lock`, 'wx', 0o600); }
    catch (error) { if (error.code === 'EEXIST') throw new Error('Prediction journal is locked; do not remove an active owner lock.'); throw error; }
    try {
      await lock.writeFile(JSON.stringify({ pid: process.pid, host: hostname(), acquiredAt: new Date(now).toISOString() }) + '\n');
      const records = await readPredictionJournal(file), forecasts = new Map(), results = new Map(), observations = new Set(), provisional = new Map(), states = new Map(), priceRecords = new Set();
      for (const row of records) {
        if (row.type === 'forecast') forecasts.set(row.payload.forecastId, row.payload);
        if (row.type === 'provisional_forecast') provisional.set(row.payload.forecastId, row.payload);
        if (row.type === 'forecast_lifecycle') states.set(`${row.payload.forecastId}:${row.payload.state}`, row.payload);
        if (row.type === 'unverifiable_observation') observations.add(row.payload.forecastId);
        if (['price_observation', 'unlinked_price_observation'].includes(row.type)) priceRecords.add(row.payload.priceObservationId);
        if (row.type === 'result') results.set(row.payload.forecastId, row.payload);
      }
      const pending = [];
      let sequence = records.length, previousHash = records.at(-1)?.eventHash || null;
      const add = (type, payload) => {
        const body = { schemaVersion: 1, sequence: ++sequence, previousHash, recordedAt: new Date(now).toISOString(), type, payload };
        const row = { ...body, eventHash: digest(body) }; pending.push(row); previousHash = row.eventHash;
      };
      const transition = (forecastId, state, details = {}) => {
        const key = `${forecastId}:${state}`;
        if (!states.has(key)) {
          const payload = { forecastId, state, ...details };
          add('forecast_lifecycle', payload); states.set(key, payload);
        }
      };
      const gameMap = new Map((slate.games || []).map(game => [String(game.id), game]));
      for (const prediction of slate.predictions || []) {
        const game = gameMap.get(String(prediction.gameId)) || {};
        if (lifecycle === 'prices_only') {
          const snapshot = forecastSnapshot(prediction, game, slate, now);
          const generatedAt = iso(prediction.originalForecastGeneratedAt || prediction.modelAsOf);
          const matched = [...forecasts.values()].filter(row => row.lifecycleState === 'ISSUED'
            && row.gameId === String(prediction.gameId) && row.guildId === String(slate.guildId || '')
            && row.league === String(game.leagueKey || '') && row.modelVersion === prediction.modelVersion
            && generatedAt && row.predictionGeneratedAt === generatedAt);
          const price = { sourceForecastId: matched.length === 1 ? matched[0].forecastId : null,
            gameId: String(prediction.gameId), guildId: String(slate.guildId || ''), league: String(game.leagueKey || ''),
            originalForecastGeneratedAt: generatedAt, modelVersion: prediction.modelVersion || 'unknown', observedAt: new Date(now).toISOString(),
            odds: snapshot.odds, valueDecision: snapshot.valueDecision,
            linkage: matched.length === 1 ? 'exact_frozen_model_issue' : 'original_issued_forecast_not_uniquely_verified' };
          const priceObservationId = digest({ ...price, observedAt: undefined });
          if (!priceRecords.has(priceObservationId)) {
            add(price.sourceForecastId ? 'price_observation' : 'unlinked_price_observation', { priceObservationId, ...price });
            priceRecords.add(priceObservationId);
          }
          continue;
        }
        if (prediction.quoteRefreshOnly || lifecycle === 'results_only') continue;
        const snapshot = forecastSnapshot(prediction, game, slate, now);
        const id = snapshot.forecastId, original = forecasts.get(id);
        if (lifecycle === 'delivered') {
          if (original && slate.messageId && slate.channelId) transition(id, 'DELIVERED', {
            messageId: String(slate.messageId), channelId: String(slate.channelId) });
          continue;
        }
        if (original || observations.has(id)) continue;
        if (!provisional.has(id)) {
          add('provisional_forecast', { ...snapshot, lifecycleState: 'PROVISIONAL' });
          provisional.set(id, pending.at(-1).payload);
        }
        if (lifecycle === 'provisional') continue;
        if (lifecycle === 'rejected') {
          transition(id, 'REJECTED', { reason: String(reason || 'refresh_validation_failed').slice(0, 240) });
          continue;
        }
        if (states.has(`${id}:REJECTED`)) continue;
        const frozen = provisional.get(id);
        if (digest(frozen.outcomePercentages) !== digest(snapshot.outcomePercentages)) {
          transition(id, 'REJECTED', { reason: 'probabilities_changed_without_new_forecast_identity' });
          continue;
        }
        if (frozen.recordEligibility === 'observed_pregame' && snapshot.recordEligibility === 'observed_pregame') {
          transition(id, 'VALIDATED');
          const issued = { ...frozen, lifecycleState: 'ISSUED',
            issuanceScope: 'Validated issued forecast; Discord delivery requires a separate lifecycle acknowledgement.' };
          add('forecast', issued); forecasts.set(id, issued);
        } else { add('unverifiable_observation', snapshot); observations.add(id); }

      }
      // Resolve every frozen horizon/version for this event, not only the
      // latest prediction still displayed in the mutable daily slate.
      for (const issued of lifecycle === 'prices_only' ? [] : forecasts.values()) {
        const game = gameMap.get(issued.gameId);
        if (!game || issued.guildId !== String(slate.guildId || '')
          || issued.league !== String(game.leagueKey || '')) continue;
        const actualSide = finalOutcomeSide(game);
        if (!issued || !actualSide) continue;
        const payload = { forecastId: issued.forecastId, actualSide, selectedSide: issued.selectedSide,
          correct: issued.selectedSide === actualSide, awayScore: finiteNumber(game.away?.score), homeScore: finiteNumber(game.home?.score),
          observedAt: new Date(now).toISOString(), providerFetchedAt: iso(game.sourceMeta?.fetchedAt),
          scheduleChanged: issued.startTime !== iso(game.startTime),
          provenance: 'first/later observed final; no historical completion time is inferred' };
        const prior = results.get(issued.forecastId);
        if (!prior || prior.actualSide !== actualSide || prior.awayScore !== payload.awayScore || prior.homeScore !== payload.homeScore) {
          add('result', { ...payload, revision: (prior?.revision || 0) + 1 }); results.set(issued.forecastId, pending.at(-1).payload);
          transition(issued.forecastId, 'GRADED');
        }
      }
      if (pending.length) {
        const handle = await open(file, 'a', 0o600);
        try { await handle.writeFile(pending.map(row => JSON.stringify(row)).join('\n') + '\n'); await handle.sync(); }
        finally { await handle.close(); }
      }
      return { appended: pending.length, forecastRecords: pending.filter(row => row.type === 'forecast').length,
        resultRecords: pending.filter(row => row.type === 'result').length,
        priceObservations: pending.filter(row => row.type === 'price_observation').length,
        unverifiableObservations: pending.filter(row => row.type === 'unverifiable_observation').length,
        totalRecords: records.length + pending.length };
    } finally { await lock.close(); await unlink(`${file}.lock`); }
  });
  writeChain = operation.catch(() => {});
  return operation;
}
