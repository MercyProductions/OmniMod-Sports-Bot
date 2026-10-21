import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'sports-quote-refresh-'));
process.env.OMNIMOD_SPORTS_DATA_DIR = directory;
const { claimValueRefresh, refreshValueQuotes } = await import('../src/valueQuoteRefresh.js');
const { recordSlateSnapshot, warehouseCandidateRowsBefore } = await import('../src/featureWarehouse.js');
const { evaluatePredictionHorizons } = await import('../src/horizonEvaluation.js');
const { refreshPredictionValue } = await import('../src/oddsValue.js');
const { buildCommands } = await import('../src/commands.js');
const { collectGradedRows, buildCalibrationModel, buildOutcomeValidation } = await import('../src/modelEvaluation.js');

const now = Date.now();
const modelAsOf = new Date(now - 3_600_000).toISOString();
const startTime = new Date(now + 3_600_000).toISOString();
const quoteTime = new Date(now - 30_000).toISOString();
function slate() {
  return { dateKey: '2099-01-01', guildId: 'refresh-test', generatedAt: modelAsOf,
    games: [{ id: 'game', leagueKey: 'nba', sportGroup: 'Basketball', startTime, statusKey: 'scheduled', away: { name: 'Away', abbr: 'A' }, home: { name: 'Home', abbr: 'H' }, odds: { eventId: 'provider-game' } }],
    predictions: [{ gameId: 'game', startTime, predictionGeneratedAt: modelAsOf, predictionMode: 'pregame', statusKey: 'scheduled', predictedSide: 'home', sportProfile: 'basketball', leagueKey: 'nba', outcomeProbabilities: { away: 35, home: 65 }, candidateProbabilities: { evidence: { away: 0.35, home: 0.65 } }, predictionUncertaintyPoints: 4, evidenceQualityValue: 85, calibrationSampleSize: 100, outcomeValidationSamples: { away: 80, home: 80 }, outcomeCalibrationError: { away: 0.03, home: 0.03 }, recommendationStatus: 'prediction', valueAnalysis: { issuedAt: modelAsOf, outcomes: [], bestOpportunity: null } }]
  };
}
function providerResult(timestamp = quoteTime) {
  return { ok: true, status: 200, cacheState: 'network', fetchedAt: new Date(now).toISOString(), headers: { 'x-requests-remaining': '99' }, json: [{ id: 'provider-game', commence_time: startTime, away_team: 'Away', home_team: 'Home', bookmakers: ['one', 'two'].map((key) => ({ key, title: key, last_update: timestamp, markets: [{ key: 'h2h', last_update: timestamp, outcomes: [{ name: 'Away', price: 250 }, { name: 'Home', price: -250 }] }] })) }] };
}
const options = (name, extra = {}) => ({ refresh: true, admin: true, oddsApiKey: 'synthetic-test-key', oddsApiRegion: 'us', dailyCap: 2, cooldownMinutes: 5, now, directory: path.join(directory, name), localOnly: false, ...extra });

test('ordinary reads, disabled budgets, non-admins and missing keys never call a provider', async () => {
  let calls = 0;
  const fetchJson = async () => { calls += 1; return providerResult(); };
  for (const [override, status] of [[{ refresh: false }, 'cached'], [{ admin: false }, 'forbidden'], [{ dailyCap: 0 }, 'disabled'], [{ localOnly: true }, 'disabled'], [{ oddsApiKey: '' }, 'unconfigured']]) {
    const result = await refreshValueQuotes(slate(), options('no-calls', { ...override, fetchJson }));
    assert.equal(result.status, status);
    assert.equal(result.externalCalls, 0);
  }
  assert.equal(calls, 0);
});

test('durable request slots enforce cooldown and daily cap across repeated callers', async () => {
  // Keep these claims on one local date even when the suite runs near midnight.
  const budgetNow=Date.parse('2026-10-20T18:00:00Z');
  const args = { now:budgetNow, dailyCap: 2, cooldownMinutes: 5, directory: path.join(directory, 'budget') };
  assert.equal((await claimValueRefresh(args)).claimed, true);
  assert.equal((await claimValueRefresh({ ...args, now: budgetNow + 1 })).status, 'cooldown');
  assert.equal((await claimValueRefresh({ ...args, now: budgetNow + 6 * 60_000 })).claimed, true);
  assert.equal((await claimValueRefresh({ ...args, now: budgetNow + 12 * 60_000 })).status, 'daily_cap');
  const claims = await fs.readdir(path.join(args.directory, 'value-refresh-claims'));
  assert.equal(claims.filter((name) => name.endsWith('.json')).length, 2);
});

test('concurrent claims reserve at most one request, including the cooldown constraint', async () => {
  const args = { now, dailyCap: 5, cooldownMinutes: 5, directory: path.join(directory, 'concurrent') };
  const results = await Promise.all(Array.from({ length: 8 }, () => claimValueRefresh(args)));
  assert.equal(results.filter((row) => row.claimed).length, 1);
});

test('local date rollover resets the daily cap while retaining the cross-midnight cooldown',async()=>{
  // October in America/Chicago: 04:59 UTC is 23:59 local, 05:00 UTC is the next date.
  const beforeMidnight=Date.parse('2026-10-21T04:59:00Z');
  const args={now:beforeMidnight,dailyCap:1,cooldownMinutes:5,directory:path.join(directory,'rollover-budget')};
  assert.equal((await claimValueRefresh(args)).claimed,true);
  assert.equal((await claimValueRefresh({...args,now:beforeMidnight+2*60_000})).status,'cooldown');
  assert.equal((await claimValueRefresh({...args,now:beforeMidnight+6*60_000})).claimed,true);
  assert.equal((await claimValueRefresh({...args,now:beforeMidnight+12*60_000})).status,'daily_cap');
});

test('provider failure consumes its reservation and never exposes raw key-bearing errors', async () => {
  let calls = 0;
  const args = options('failure', { dailyCap: 1, fetchJson: async () => { calls += 1; throw new Error('https://example.test?apiKey=synthetic-test-key'); } });
  const failed = await refreshValueQuotes(slate(), args);
  assert.equal(failed.status, 'provider_failure');
  assert.equal(failed.externalCalls, 1);
  assert.doesNotMatch(JSON.stringify(failed), /synthetic-test-key/);
  const blocked = await refreshValueQuotes(slate(), { ...args, now: now + 6 * 60_000 });
  assert.equal(blocked.status, 'daily_cap');
  assert.equal(calls, 1);
});

test('explicit refresh requests selected league h2h only and preserves frozen model timestamps', async () => {
  const original = slate();
  let requests = 0;
  const result = await refreshValueQuotes(original, options('success', { league: 'nba', oddsApiRegion: 'us,uk', fetchJson: async (raw, cacheOptions) => {
    requests += 1;
    const url = new URL(raw);
    assert.match(url.pathname, /basketball_nba\/odds\/$/);
    assert.equal(url.searchParams.get('markets'), 'h2h');
    assert.equal(url.searchParams.get('eventIds'), 'provider-game');
    assert.equal(url.searchParams.get('regions'), 'us');
    assert.equal(cacheOptions.force, true);
    assert.deepEqual(cacheOptions.secretParams, ['apiKey']);
    return providerResult();
  } }));
  assert.equal(requests, 1);
  assert.equal(result.status, 'fresh');
  assert.equal(result.slate.predictions[0].predictionGeneratedAt, modelAsOf);
  assert.equal(result.slate.predictions[0].modelAsOf, modelAsOf);
  assert.deepEqual(result.slate.predictions[0].outcomeProbabilities, original.predictions[0].outcomeProbabilities);
  const issued = result.issuedSlate.predictions[0];
  assert.equal(issued.predictionGeneratedAt, new Date(now).toISOString());
  assert.equal(issued.quoteRefreshOnly, true);
  assert.equal(issued.eligibleForCalibration, false);
  assert.equal(issued.valueAnalysis.issuedAt, issued.predictionGeneratedAt);
  assert.equal(issued.valueAnalysis.bestOpportunity.quote.quotedAt, quoteTime);
  assert.equal(original.predictions[0].valueAnalysis.bestOpportunity, null);

  await recordSlateSnapshot(original);
  await recordSlateSnapshot(result.issuedSlate);
  const final = { ...original.games[0], statusKey: 'final', away: { name: 'Away', score: 110 }, home: { name: 'Home', score: 100 } };
  const warehouse = await recordSlateSnapshot({ ...result.issuedSlate, games: [final] });
  assert.equal(warehouse.predictions.length, 2);
  const old = warehouse.predictions.find((row) => !row.quoteRefreshOnly);
  const newer = warehouse.predictions.find((row) => row.quoteRefreshOnly);
  assert.equal(old.valueAnalysis.bestOpportunity, null);
  assert.equal(newer.valueAnalysis.bestOpportunity.quote.price, 250);
  assert.equal(newer.modelAsOf, modelAsOf);
  assert.equal((await warehouseCandidateRowsBefore('2099-01-02')).length, 1);
  assert.equal(evaluatePredictionHorizons(warehouse.predictions).overall.sampleSize, 1);
  const quotePrediction = { ...issued, predictionCorrect: true, predictionProbability: 0.65, modelVersion: 'OmniMod Evidence Ensemble v6.0.0' };
  assert.equal(collectGradedRows([{ dateKey: original.dateKey, slate: { games: [final], predictions: [quotePrediction] } }]).length, 0);
  assert.deepEqual(buildCalibrationModel([{ prediction: quotePrediction, correct: true }]), {});
  assert.deepEqual(buildOutcomeValidation([{ prediction: quotePrediction, actualSide: 'home' }]), {});
});

test('stale models and unknown selected leagues do not consume refresh credits', async () => {
  let calls = 0;
  const fetchJson = async () => { calls += 1; return providerResult(); };
  const old = slate();
  old.predictions[0].predictionGeneratedAt = new Date(now - 7 * 3_600_000).toISOString();
  assert.equal((await refreshValueQuotes(old, options('old', { fetchJson }))).status, 'no_eligible_games');
  for (const timestamp of [new Date(now + 1).toISOString(), new Date(now - 6 * 3_600_000 - 1).toISOString(), 'unknown']) {
    const invalid = slate();
    invalid.predictions[0].predictionGeneratedAt = timestamp;
    assert.equal((await refreshValueQuotes(invalid, options('invalid-time', { fetchJson }))).status, 'no_eligible_games');
  }
  assert.equal((await refreshValueQuotes(slate(), options('unknown', { league: 'not-a-league', fetchJson }))).status, 'no_eligible_games');
  assert.equal(calls, 0);
  const view = refreshPredictionValue({ ...slate().predictions[0], modelAsOf: old.predictions[0].predictionGeneratedAt }, slate().games[0], now);
  assert.equal(view.valueAnalysis.bestOpportunity, null);
});

test('new response carrying stale quotes reports its actual provenance instead of claiming freshness', async () => {
  const result = await refreshValueQuotes(slate(), options('stale', { fetchJson: async () => providerResult(new Date(now - 20 * 60_000).toISOString()) }));
  assert.equal(result.status, 'provider_quotes_stale');
  assert.equal(result.slate.predictions[0].valueAnalysis.bestOpportunity, null);
  assert.match(result.message, /stale\/unknown-time/);
});

test('corrupt budget claims fail closed without an unintended provider request', async () => {
  const args = options('corrupt');
  const claims = path.join(args.directory, 'value-refresh-claims');
  await fs.mkdir(claims, { recursive: true });
  await fs.writeFile(path.join(claims, '2020-01-01-1.json'), '{broken');
  const result = await refreshValueQuotes(slate(), { ...args, fetchJson: async () => { throw new Error('should not call'); } });
  assert.equal(result.status, 'budget_error');
  assert.equal(result.externalCalls, 0);
});

test('existing value command exposes optional explicit refresh and league selection', () => {
  const command = buildCommands().find((row) => row.name === 'sports').options.find((row) => row.name === 'value');
  assert.ok(command.options.some((row) => row.name === 'refresh' && !row.required));
  assert.ok(command.options.some((row) => row.name === 'league' && !row.required));
});

test.after(async () => { await fs.rm(directory, { recursive: true, force: true }); });


test('actual quote refresh journal events remain linked prices rather than new winner forecasts',async()=>{
  const {recordPredictionJournal,readPredictionJournal}=await import('../src/predictionJournal.js');
  const value=slate();value.predictions[0].modelVersion='OmniMod Evidence Ensemble v6.0.2';
  const file=path.join(directory,'immutable-quote-events.jsonl');
  await recordPredictionJournal(value,{file,now});
  const changed=await refreshValueQuotes(value,options('journal-refresh',{fetchJson:async()=>providerResult()}));
  assert.ok(changed.issuedSlate);
  assert.equal(changed.issuedSlate.predictions[0].originalForecastGeneratedAt,modelAsOf);
  await recordPredictionJournal(changed.issuedSlate,{file,now:now+1000,lifecycle:'prices_only'});
  await recordPredictionJournal(changed.issuedSlate,{file,now:now+2000,lifecycle:'prices_only'});
  let records=await readPredictionJournal(file);
  assert.equal(records.filter(row=>row.type==='forecast').length,1);
  assert.equal(records.filter(row=>row.type==='price_observation').length,1);
  const issued=records.find(row=>row.type==='forecast');
  const price=records.find(row=>row.type==='price_observation');
  assert.equal(price.payload.sourceForecastId,issued.payload.forecastId);
  assert.equal(issued.payload.predictionGeneratedAt,modelAsOf);
  const foreign=structuredClone(changed.issuedSlate);foreign.predictions[0].modelVersion='unknown-model';
  await recordPredictionJournal(foreign,{file,now:now+3000,lifecycle:'prices_only'});
  records=await readPredictionJournal(file);
  assert.equal(records.filter(row=>row.type==='unlinked_price_observation').length,1);
  assert.equal(records.filter(row=>row.type==='forecast').length,1);
});
