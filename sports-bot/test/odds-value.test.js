import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'sports-value-'));
process.env.OMNIMOD_SPORTS_DATA_DIR = directory;
const { analyzeOddsValue, formatValueDetails, payoutAtAmericanOdds, refreshPredictionValue, valueOpportunityLine } = await import('../src/oddsValue.js');
const { bestH2HMarket } = await import('../src/sportsData.js');
const { buildOutcomeValidation } = await import('../src/modelEvaluation.js');
const { recordSlateSnapshot } = await import('../src/featureWarehouse.js');
const { formatSlateEmbeds } = await import('../src/discordPublisher.js');

const now = Date.now();
const quoteTime = new Date(now - 60_000).toISOString();
const model = { probabilities: { away: 0.35, home: 0.65 }, halfWidth: 0.04, evidenceQuality: 85, calibrationSamples: 100, outcomeValidationSamples: { away: 80, home: 80 }, outcomeCalibrationError: { away: 0.03, home: 0.03 }, recommendationStatus: 'prediction', mode: 'pregame', marketInformed: true };
const book = (key, awayPrice = 250, homePrice = -250, timestamp = quoteTime) => ({ key, title: key, last_update: timestamp, markets: [{ key: 'h2h', last_update: timestamp, outcomes: [{ name: 'Away', price: awayPrice }, { name: 'Home', price: homePrice }] }] });
function game(books = [book('A'), book('B', 240, -240)]) {
  const result = { id: 'value-game', leagueKey: 'nba', sportGroup: 'Basketball', statusKey: 'scheduled', startTime: new Date(now + 3_600_000).toISOString(), away: { name: 'Away', abbr: 'A' }, home: { name: 'Home', abbr: 'H' } };
  result.odds = { h2h: bestH2HMarket(books, result) };
  return result;
}
const prediction = () => ({ index: 1, gameId: 'value-game', predictedSide: 'home', predictedWinner: 'Home', outcomeProbabilities: { away: 35, home: 65 }, predictionUncertaintyPoints: 4, evidenceQualityValue: 85, calibrationSampleSize: 100, outcomeValidationSamples: { away: 80, home: 80 }, outcomeCalibrationError: { away: 0.03, home: 0.03 }, predictionMode: 'pregame', recommendationStatus: 'prediction', marketBlendWeight: 0.2 });

test('American payout EV distinguishes bookmaker margin from consensus disagreement', () => {
  assert.equal(payoutAtAmericanOdds(200), 2);
  assert.equal(payoutAtAmericanOdds(-200), 0.5);
  assert.equal(payoutAtAmericanOdds(1.91), null);
  const event = game([book('A', 180, -180), book('B', 170, -180)]);
  event.odds.h2h.home.fairProbability = 0.57;
  const row = analyzeOddsValue(event, { ...model, probabilities: { away: 0.4, home: 0.6 } }, { now }).outcomes.find((row) => row.side === 'home');
  assert.ok(row.modelMarketDisagreement > 0);
  assert.ok(Math.abs(row.expectedReturn - (-0.06667)) < 1e-5);
  assert.equal(row.actionable, false);
});

test('the best quoted value can be the less likely outcome', () => {
  const result = analyzeOddsValue(game(), model, { now });
  assert.equal(result.bestOpportunity.side, 'away');
  assert.equal(result.bestOpportunity.quote.price, 250);
  assert.equal(result.bestOpportunity.quote.bookmaker, 'A');
  assert.equal(result.bestOpportunity.expectedReturn, 0.225);
  assert.equal(result.bestOpportunity.stressedReturn, 0.085);
  assert.equal(result.bestOpportunity.freshBookmakers, 2);
  assert.match(result.independence, /not an independent market edge/);
  assert.match(formatValueDetails(result), /break-even/);
  assert.match(valueOpportunityLine({ index: 1, valueAnalysis: result }), /Away @ \+250/);
});

test('line shopping skips a stale attractive price in favor of an actual fresh quote', () => {
  const event = game([book('stale', 400, -400, new Date(now - 3_600_000).toISOString()), book('A'), book('B', 240, -240)]);
  assert.equal(event.odds.h2h.away.price, 400);
  const result = analyzeOddsValue(event, model, { now });
  assert.equal(result.bestOpportunity.quote.price, 250);
  assert.equal(result.bestOpportunity.quotesExamined, 3);
});

test('unknown, stale, future and fetched-only timestamps all withhold opportunities', () => {
  for (const timestamp of ['', new Date(now - 16 * 60_000).toISOString(), new Date(now + 1).toISOString()]) {
    const event = game([book('A', 250, -250, timestamp), book('B', 240, -240, timestamp)]);
    assert.equal(analyzeOddsValue(event, model, { now }).bestOpportunity, null);
  }
  const event = game();
  for (const side of ['away', 'home']) for (const quote of event.odds.h2h[side].quotes) quote.timestampSource = 'fetch_time';
  assert.equal(analyzeOddsValue(event, model, { now }).bestOpportunity, null);
});

test('settlement, missing outcomes, evidence, calibration and uncertainty risks block EV recommendations', () => {
  for (const override of [{ evidenceQuality: 64 }, { calibrationSamples: 39 }, { outcomeValidationSamples: {} }, { outcomeCalibrationError: { away: 0.2, home: 0.2 } }, { halfWidth: 0.2 }, { recommendationStatus: 'lean_only' }]) {
    assert.equal(analyzeOddsValue(game(), { ...model, ...override }, { now }).bestOpportunity, null);
  }
  const unknown = game();
  delete unknown.odds.h2h.rules;
  assert.equal(analyzeOddsValue(unknown, model, { now }).bestOpportunity, null);
  const incomplete = game();
  delete incomplete.odds.h2h.home;
  assert.equal(analyzeOddsValue(incomplete, model, { now }).bestOpportunity, null);
  assert.equal(analyzeOddsValue(game([book('only')]), model, { now }).bestOpportunity, null);
});

test('cached value analysis expires and cannot remain actionable after start', () => {
  const event = game();
  const current = refreshPredictionValue(prediction(), event, now);
  assert.ok(current.valueAnalysis.bestOpportunity);
  assert.equal(refreshPredictionValue(current, event, now + 16 * 60_000).valueAnalysis.bestOpportunity, null);
  assert.equal(refreshPredictionValue(current, event, now + 3_600_001).valueAnalysis.bestOpportunity, null);
});

test('all-outcome validation includes the unselected outcome without double counting sport bins', () => {
  const result = buildOutcomeValidation([{ actualSide: 'away', prediction: { sportProfile: 'basketball', predictedSide: 'home', predictionGeneratedAt: new Date(now).toISOString(), startTime: new Date(now + 3_600_000).toISOString(), outcomeProbabilities: { away: 35, home: 65 } } }]);
  assert.equal(result.basketball.away[3].count, 1);
  assert.equal(result.basketball.away[3].correct, 1);
  assert.equal(result.basketball.home[6].count, 1);
  assert.equal(result.basketball.home[6].correct, 0);
  assert.deepEqual(buildOutcomeValidation([{ actualSide: 'away', prediction: { sportProfile: 'basketball', outcomeProbabilities: { away: 35, home: 65 } } }]), {});
});

test('forward warehouse records executable-price assumptions separately from outcome selection', async () => {
  const event = game();
  const forecast = { ...refreshPredictionValue(prediction(), event, now), startTime: event.startTime, predictionGeneratedAt: new Date(now).toISOString() };
  const warehouse = await recordSlateSnapshot({ guildId: 'ev-test', dateKey: new Date(now).toISOString().slice(0, 10), generatedAt: new Date(now).toISOString(), games: [event], predictions: [forecast] });
  const saved = warehouse.predictions.find((row) => row.guildId === 'ev-test');
  assert.equal(saved.predictedSide, 'home');
  assert.equal(saved.valueAnalysis.bestOpportunity.side, 'away');
  assert.equal(saved.valueAnalysis.bestOpportunity.quote.quotedAt, quoteTime);
  assert.equal(saved.valueAnalysis.bestOpportunity.expectedReturn, 0.225);
  assert.ok(saved.valueAnalysis.issuedAt);
  const expired = refreshPredictionValue(forecast, event, now + 20 * 60_000);
  assert.equal(expired.valueAnalysis.bestOpportunity, null);
  const finalTime = new Date(now + 7_200_000).toISOString();
  const final = { ...event, statusKey: 'final', away: { ...event.away, score: 110 }, home: { ...event.home, score: 100 } };
  const graded = await recordSlateSnapshot({ guildId: 'ev-test', dateKey: new Date(now).toISOString().slice(0, 10), generatedAt: new Date(now).toISOString(), refreshedAt: finalTime, games: [final], predictions: [expired] });
  const resolved = graded.predictions.find((row) => row.guildId === 'ev-test');
  assert.equal(resolved.valueAnalysis.bestOpportunity.quote.price, 250);
  assert.equal(resolved.valueAnalysis.issuedAt, saved.valueAnalysis.issuedAt);
  assert.equal(resolved.actualSide, 'away');
  assert.equal(resolved.resolvedAt, finalTime);
  assert.equal(resolved.resolvedAtSource, 'first_observed_final');
});

test('Discord slate surfaces payout value while labeling consensus disagreement separately', () => {
  const event = game();
  const forecast = { ...refreshPredictionValue(prediction(), event, now), league: 'NBA', matchup: 'A @ H', startTimeLocal: 'Later', confidence: '65%', apiConfidence: '90%', evidenceQuality: '85%', edge: '+3 pts' };
  const embeds = formatSlateEmbeds({ generatedAt: new Date(now).toISOString(), games: [event], predictions: [forecast] });
  const content = embeds.flatMap((embed) => embed.toJSON().fields || []).map((field) => field.value).join('\n');
  assert.match(content, /Model vs consensus/);
  assert.match(content, /Away @ \+250/);
  assert.match(content, /model EV \+22.5%/);
});

test.after(async () => { await fs.rm(directory, { recursive: true, force: true }); });


test('unknown quote provenance and invalid probability mass cannot qualify as value opportunities',()=>{
  const event=game();
  for(const side of ['away','home'])for(const quote of event.odds.h2h[side].quotes)delete quote.timestampSource;
  const unknown=analyzeOddsValue(event,model,{now});
  assert.equal(unknown.bestOpportunity,null);
  assert.ok(unknown.outcomes.every(row=>!row.actionable));
  const malformed=analyzeOddsValue(game(),{...model,probabilities:{away:.65,home:.65}},{now});
  assert.equal(malformed.bestOpportunity,null);
  assert.ok(malformed.outcomes[0].reasons.some(reason=>reason.includes('sum to one')));
});

test('provider start time cannot be ignored when the local schedule still says future',()=>{
  const event=game();event.odds.commenceTime=new Date(now-1).toISOString();
  const result=analyzeOddsValue(event,model,{now});
  assert.equal(result.bestOpportunity,null);
  assert.ok(result.outcomes[0].reasons.some(reason=>reason.includes('already reached')));
});

test('declared decimal ingestion preserves original format and canonical American quote math',()=>{
  const event=game(),books=[{key:'decimal',title:'Decimal',markets:[{key:'h2h',last_update:quoteTime,outcomes:[
    {name:event.away.name,price:3.5},{name:event.home.name,price:1.4}
  ]}]}];
  const market=bestH2HMarket(books,event,{oddsFormat:'decimal'});
  assert.equal(market.away.price,250);assert.equal(market.away.originalPrice,3.5);
  assert.equal(market.away.originalFormat,'decimal');assert.ok(Math.abs(market.home.price+250)<1e-9);
  assert.equal(bestH2HMarket(books,event).bookmakerCount,0);
});
