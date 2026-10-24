import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { recordPredictionJournal, readPredictionJournal as readFullPredictionJournal } from '../src/predictionJournal.js';
import { completePregameRefreshAttempt, completeAndJournalPregameRefresh, duePregameRefreshes } from '../src/pregameRefresh.js';
import { selectCandidateCohort } from '../src/candidateCohorts.js';
import { evaluateCandidateModels, applyCandidateDecision } from '../src/modelRegistry.js';
import { summarizePredictionJournal } from '../src/journalEvaluation.js';

// Existing scoring assertions inspect eligible forecasts/results; the full reader still checks every hash-chain event.
const readPredictionJournal = async file => (await readFullPredictionJournal(file)).filter(row => !['provisional_forecast', 'forecast_lifecycle', 'refresh_attempt'].includes(row.type));

const now = Date.parse('2026-10-20T18:00:00Z');
const time = offset => new Date(now + offset).toISOString();
function slate() {
  return { guildId: 'fixture', dateKey: '2026-10-20', generatedAt: time(-1000),
    games: [{ id: 'game', leagueKey: 'nba', statusKey: 'scheduled', startTime: time(3_600_000),
      away: { name: 'Away', score: 0 }, home: { name: 'Home', score: 0 },
      sourceMeta: { fetchedAt: time(-2000), cacheState: 'network' },
      autoEnrichment: { fetchedAt: time(-1000), cacheState: 'network' },
      odds: { provider: 'fixture', h2h: { rules: 'full_game_including_overtime', home: { price: -110, bookmaker: 'Example', lastUpdate: time(-2000), timestampSource: 'provider_update' } } } }],
    predictions: [{ gameId: 'game', modelVersion: 'OmniMod Evidence Ensemble v6.0.1', startTime: time(3_600_000),
      predictionGeneratedAt: time(-1000), predictionMode: 'pregame', predictedSide: 'home', predictionProbability: 0.65,
      outcomeProbabilities: { home: 65, away: 35, draw: 0 }, snapshotStage: 'daily', recommendationStatus: 'withheld' }] };
}
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'sports-journal-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return join(directory, 'predictions.jsonl');
}

test('journal freezes every pregame forecast including withheld rows, odds and original source timestamps', async t => {
  const file = await fixture(t), first = slate();
  first.predictions[0].evidenceCoverage = { schema: 'sports-evidence-coverage-v1', missing: ['home:critical_starter_unconfirmed'] };
  await recordPredictionJournal(first, { file, now });
  const changed = structuredClone(first);
  changed.predictions[0].outcomeProbabilities.home = 90;
  changed.predictions[0].outcomeProbabilities.away = 10;
  changed.games[0].odds.h2h.home.price = -500;
  changed.predictions[0].evidenceCoverage.missing = [];
  await recordPredictionJournal(changed, { file, now: now + 1000 });
  const rows = await readPredictionJournal(file);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].type, 'forecast');
  assert.equal(rows[0].payload.outcomePercentages.home, 65);
  assert.equal(rows[0].payload.recommendationStatus, 'withheld');
  assert.deepEqual(rows[0].payload.evidenceCoverage.missing, ['home:critical_starter_unconfirmed']);
  assert.equal(rows[0].payload.odds.outcomes.home.offeredQuotes[0].priceAmerican, -110);
  assert.equal(rows[0].payload.dataTimestamps.schedule.fetchedAt, time(-2000));
});

test('results and later score corrections append without changing the forecast', async t => {
  const file = await fixture(t), value = slate();
  await recordPredictionJournal(value, { file, now });
  const final = structuredClone(value);
  final.games[0].statusKey = 'final'; final.games[0].home.score = 110; final.games[0].away.score = 100;
  await recordPredictionJournal(final, { file, now: now + 4 * 3_600_000 });
  await recordPredictionJournal(final, { file, now: now + 4 * 3_600_000 + 1000 });
  final.games[0].away.score = 120;
  await recordPredictionJournal(final, { file, now: now + 5 * 3_600_000 });
  const rows = await readPredictionJournal(file);
  assert.deepEqual(rows.map(row => row.type), ['forecast', 'result', 'result']);
  assert.equal(rows[1].payload.correct, true);
  assert.equal(rows[2].payload.correct, false);
  assert.equal(rows[2].payload.revision, 2);
  assert.equal(rows[0].payload.outcomePercentages.home, 65);
});

test('a final resolves all previously journaled horizons even when the slate only retains its newest forecast', async t => {
  const file = await fixture(t), first = slate();
  first.predictions[0].snapshotStage = 't-90';
  await recordPredictionJournal(first, { file, now });
  const later = slate(); later.predictions[0].snapshotStage = 't-10';
  later.predictions[0].predictionGeneratedAt = time(2_000_000);
  await recordPredictionJournal(later, { file, now: now + 2_000_000 });
  later.games[0].statusKey = 'final'; later.games[0].home.score = 100; later.games[0].away.score = 90;
  await recordPredictionJournal(later, { file, now: now + 4 * 3_600_000 });
  const rows = await readPredictionJournal(file);
  assert.equal(rows.filter(row => row.type === 'forecast').length, 2);
  assert.equal(rows.filter(row => row.type === 'result').length, 2);
  const summary = summarizePredictionJournal(await readFullPredictionJournal(file));
  assert.equal(summary.byVersion['OmniMod Evidence Ensemble v6.0.1'].selectedOutcomeBinary.sampleSize, 1);
});

test('unavailable odds remain unavailable and late imports never become prospective forecasts', async t => {
  const file = await fixture(t), value = slate(); delete value.games[0].odds;
  await recordPredictionJournal(value, { file, now });
  value.predictions[0].gameId = 'late'; value.games[0].id = 'late';
  await recordPredictionJournal(value, { file, now: now + 4 * 3_600_000 });
  const rows = await readPredictionJournal(file);
  assert.equal(rows[0].payload.odds.status, 'unavailable');
  assert.equal(rows[1].type, 'unverifiable_observation');
  assert.equal(rows[1].payload.recordEligibility, 'unverifiable_or_late_observation');
});

test('journal rejects edited or torn records without overwriting them', async t => {
  const file = await fixture(t);
  await recordPredictionJournal(slate(), { file, now });
  const text = await readFile(file, 'utf8');
  await writeFile(file, text.replace('"home":65', '"home":66'));
  await assert.rejects(recordPredictionJournal(slate(), { file, now }), /integrity/);
  assert.equal(await readFile(file, 'utf8'), text.replace('"home":65', '"home":66'));
  await writeFile(file, text.trimEnd());
  await assert.rejects(recordPredictionJournal(slate(), { file, now }), /incomplete final line/);
});

test('existing owner lock is preserved and concurrent calls do not duplicate a forecast', async t => {
  const file = await fixture(t);
  await writeFile(`${file}.lock`, 'active-owner');
  await assert.rejects(recordPredictionJournal(slate(), { file, now }), /locked/);
  assert.equal(await readFile(`${file}.lock`, 'utf8'), 'active-owner');
  await rm(`${file}.lock`);
  await Promise.all([recordPredictionJournal(slate(), { file, now }), recordPredictionJournal(slate(), { file, now })]);
  assert.equal((await readPredictionJournal(file)).length, 1);
});

test('pregame completion preserves earlier windows and retries stale or failed evidence', () => {
  const previous = slate();
  previous.pregameRefreshes = { game: {eventKey:JSON.stringify(['nba','game',time(3_600_000)]), windows: { 90: time(-100_000) } } };
  const due = [{ gameId: 'game', dueWindows: [30], stage: 't-30' }];
  const rebuilt = slate();
  rebuilt.games[0].autoEnrichment.fetchedAt = time(500);
  rebuilt.predictions[0].predictionGeneratedAt = time(700);
  const success = completePregameRefreshAttempt(previous, rebuilt, due, time(0), time(1000));
  assert.equal(success.completed.length, 1);
  assert.ok(success.slate.pregameRefreshes.game.windows[90]);
  assert.ok(success.slate.pregameRefreshes.game.windows[30]);
  assert.equal(success.slate.pregameRefreshDeliveryPending, true);
  rebuilt.games[0].autoEnrichment.cacheState = 'stale';
  const failed = completePregameRefreshAttempt(previous, rebuilt, due, time(0), time(1000));
  assert.equal(failed.completed.length, 0);
  assert.equal(failed.slate.pregameRefreshes.game.windows[30], undefined);
  assert.deepEqual(failed.slate.predictions, previous.predictions);
  assert.equal(failed.slate.pregameRefreshDeliveryPending, false);
});

test('refresh completion preserves untouched forecasts and cannot publish unsolicited or rejected new predictions',()=>{
  const previous=slate(),rebuilt=slate();
  const oldOther={...previous.predictions[0],gameId:'other',outcomeProbabilities:{home:55,away:45,draw:0}};
  previous.predictions.push(oldOther);previous.games.push({...previous.games[0],id:'other'});
  rebuilt.games[0].autoEnrichment.fetchedAt=time(500);rebuilt.predictions[0].predictionGeneratedAt=time(700);
  rebuilt.predictions.push({...oldOther,outcomeProbabilities:{home:99,away:1,draw:0}},
    {...rebuilt.predictions[0],gameId:'unsolicited'});
  rebuilt.games.push({...rebuilt.games[0],id:'other'},{...rebuilt.games[0],id:'unsolicited'});
  const result=completePregameRefreshAttempt(previous,rebuilt,[{gameId:'game',dueWindows:[30]}],time(0),time(1000));
  assert.equal(result.completed.length,1);
  assert.deepEqual(result.slate.predictions.find(row=>row.gameId==='other'),oldOther);
  assert.equal(result.slate.predictions.some(row=>row.gameId==='unsolicited'),false);
  assert.ok(result.slate.games.some(row=>row.id==='unsolicited'));
  const rejected=completePregameRefreshAttempt({games:[],predictions:[]},slate(),[{gameId:'game',dueWindows:[30]}],time(0),time(1000));
  assert.equal(rejected.completed.length,0);assert.equal(rejected.slate.predictions.length,0);
});

test('refresh completion does not claim malformed or event-inconsistent forecasts as successful',()=>{
  for(const change of [row=>row.outcomeProbabilities={home:NaN,away:35},row=>row.startTime=time(7200000),row=>row.leagueKey='nfl',row=>delete row.modelVersion]){
    const previous=slate(),rebuilt=slate();
    rebuilt.games[0].autoEnrichment.fetchedAt=time(500);rebuilt.predictions[0].predictionGeneratedAt=time(700);
    change(rebuilt.predictions[0]);
    const result=completePregameRefreshAttempt(previous,rebuilt,[{gameId:'game',dueWindows:[30]}],time(0),time(1000));
    assert.equal(result.completed.length,0);assert.deepEqual(result.slate.predictions,previous.predictions);
  }
});

test('journal issuance rejects mismatched schedule and league evidence using the refresh policy',async t=>{
  for(const change of [row=>row.startTime=time(7200000),row=>row.leagueKey='nfl']){
    const file=await fixture(t),value=slate();change(value.predictions[0]);
    await recordPredictionJournal(value,{file,now});
    const rows=await readFullPredictionJournal(file);
    assert.equal(rows.filter(row=>row.type==='forecast').length,0);
    assert.ok(rows.some(row=>row.type==='event_association_rejected'));
  }
});

test('journal refusal of a reused rejected or mutated identity cannot complete a refresh',async t=>{
  for(const lifecycle of ['provisional','issued','rejected']){
    const file=await fixture(t),rebuilt=slate(),previous=slate();
    rebuilt.games[0].autoEnrichment.fetchedAt=time(500);rebuilt.predictions[0].predictionGeneratedAt=time(700);
    await recordPredictionJournal(rebuilt,{file,now:now+800,lifecycle});
    if(lifecycle!=='rejected')rebuilt.predictions[0].outcomeProbabilities={home:75,away:25,draw:0};
    const attempt=await completeAndJournalPregameRefresh(previous,rebuilt,[{gameId:'game',dueWindows:[30]}],time(0),time(1000),{file});
    assert.equal(attempt.completed.length,0);
    assert.deepEqual(attempt.slate.predictions,previous.predictions);
    const records=await readFullPredictionJournal(file);
    assert.equal(records.find(row=>row.type==='refresh_attempt').payload.games[0].status,'rejected');
    assert.ok(records.find(row=>row.type==='refresh_attempt').payload.games[0].reasons.includes('journal_issuance_not_verified'));
  }
});

test('delivery must match frozen probabilities but may acknowledge an unchanged forecast after kickoff',async t=>{
  const file=await fixture(t),value=slate();await recordPredictionJournal(value,{file,now});
  value.messageId='message';value.channelId='channel';
  const changed=structuredClone(value);changed.predictions[0].outcomeProbabilities={home:75,away:25,draw:0};
  await recordPredictionJournal(changed,{file,now:now+1000,lifecycle:'delivered'});
  assert.equal((await readFullPredictionJournal(file)).filter(row=>row.payload.state==='DELIVERED').length,0);
  value.games[0].statusKey='live';
  await recordPredictionJournal(value,{file,now:now+7200000,lifecycle:'delivered'});
  const delivered=(await readFullPredictionJournal(file)).filter(row=>row.payload.state==='DELIVERED');
  assert.equal(delivered.length,1);assert.equal(delivered[0].recordedAt,time(7200000));
});

test('new model and horizon cohorts are not pooled with older or replay forecasts', () => {
  const base = { gameId: 'g', dateKey: '2026-10-01', sport: 'basketball', actualSide: 'home',
    source: 'frozen-production', modelVersion: 'v6.0.1', snapshotStage: 't-30',
    candidateProbabilities: { evidence: { home: 0.6, away: 0.4 }, hybrid: { home: 0.7, away: 0.3 } } };
  const selected = selectCandidateCohort([base, { ...base, modelVersion: 'v5' }, { ...base, source: 'historical-replay' }]);
  assert.equal(selected.rows.length, 1);
  assert.equal(selected.cohort.excludedOtherCohorts, 2);
  assert.equal(selected.cohort.prospectiveRecordsVerified, false);
});

test('production promotion cannot rely on unverified historical provenance', () => {
  const evaluation = { bestChallenger: 'hybrid', comparisons: { hybrid: { sampleSize: 100, brierImprovement: 0.04, logLossImprovement: 0.03 } },
    cohort: { prospectiveRecordsVerified: false } };
  const result = applyCandidateDecision({}, 'basketball', evaluation, evaluation, { minimum: 75, requireProspectiveRecords: true });
  assert.equal(result.entry.champion, 'evidence');
  assert.equal(result.entry.status, 'research_only_provenance_unverified');
});

test('audit summary separates unresolved rows and scores each version on matched reference populations', async t => {
  const file = await fixture(t), value = slate();
  value.predictions[0].referenceBaselines = { elo: { probabilities: { away: 0.5, home: 0.5, draw: 0 } } };
  await recordPredictionJournal(value, { file, now });
  let summary = summarizePredictionJournal(await readPredictionJournal(file));
  assert.equal(summary.gradedForecasts, 0);
  value.games[0].statusKey = 'final'; value.games[0].home.score = 100; value.games[0].away.score = 90;
  await recordPredictionJournal(value, { file, now: now + 4 * 3_600_000 });
  summary = summarizePredictionJournal(await readPredictionJournal(file));
  const version = summary.byVersion['OmniMod Evidence Ensemble v6.0.1'];
  assert.equal(version.graded, 1);
  assert.equal(version.outcomes.overall.accuracy, 1);
  assert.equal(version.outcomes.byHorizon['T-90'].sampleSize, 1);
  assert.equal(version.outcomes.byHorizon.Daily, undefined);
  assert.equal(version.referenceComparisons.elo.primaryOnMatchedGames.overall.sampleSize, 1);
  assert.equal(version.referenceComparisons.elo.referenceOnMatchedGames.overall.sampleSize, 1);
  assert.equal(version.referenceComparisons.market.referenceOnMatchedGames.overall.sampleSize, 0);
});


test('stale targeted refresh stays provisional/rejected and cannot enter eligible cohorts on retry', async t => {
  const file = await fixture(t), previous = slate(), rebuilt = slate();
  rebuilt.predictions[0].predictionGeneratedAt = time(700);
  rebuilt.games[0].autoEnrichment.cacheState = 'stale';
  await recordPredictionJournal(rebuilt, { file, now: now + 1000, lifecycle: 'provisional' });
  assert.equal(summarizePredictionJournal(await readFullPredictionJournal(file)).forecasts, 0);
  const attempt = await completeAndJournalPregameRefresh(previous, rebuilt,
    [{ gameId: 'game', dueWindows: [30] }], time(0), time(1000), { file });
  assert.equal(attempt.completed.length, 0);
  await recordPredictionJournal(rebuilt, { file, now: now + 1200 });
  const rows = await readFullPredictionJournal(file);
  assert.deepEqual(rows.map(r => r.type), ['provisional_forecast', 'forecast_lifecycle', 'refresh_attempt']);
  assert.equal(rows[1].payload.state, 'REJECTED');
  assert.equal(summarizePredictionJournal(rows).forecasts, 0);
});

test('valid refresh issues before transport, then delivery and grading append immutable lifecycle evidence', async t => {
  const file = await fixture(t), previous = slate(), rebuilt = slate();
  rebuilt.games[0].autoEnrichment.fetchedAt = time(500);
  rebuilt.predictions[0].predictionGeneratedAt = time(700);
  await recordPredictionJournal(rebuilt, { file, now: now + 800, lifecycle: 'provisional' });
  await completeAndJournalPregameRefresh(previous, rebuilt, [{gameId:'game',dueWindows:[30]}], time(0), time(1000), {file});
  let rows = await readFullPredictionJournal(file);
  assert.deepEqual(rows.map(r=>r.type), ['provisional_forecast','forecast_lifecycle','forecast','refresh_attempt']);
  assert.equal(rows[1].payload.state, 'VALIDATED');
  assert.equal(rows[2].payload.lifecycleState, 'ISSUED');
  // Transport failure sends no acknowledgement; issued forecasts survive a fresh module instance.
  const restarted = await import('../src/predictionJournal.js?restart-lifecycle');
  await restarted.recordPredictionJournal(rebuilt, {file,now:now+1100});
  assert.equal(summarizePredictionJournal(await readFullPredictionJournal(file)).undeliveredForecasts,1);
  rebuilt.messageId='message';rebuilt.channelId='channel';
  await restarted.recordPredictionJournal(rebuilt,{file,now:now+1200,lifecycle:'delivered'});
  await restarted.recordPredictionJournal(rebuilt,{file,now:now+1300,lifecycle:'delivered'});
  rebuilt.games[0].statusKey='final';rebuilt.games[0].home.score=100;rebuilt.games[0].away.score=90;
  await restarted.recordPredictionJournal(rebuilt,{file,now:now+7200000,lifecycle:'results_only'});
  rows=await readFullPredictionJournal(file);
  assert.equal(rows.filter(r=>r.type==='forecast').length,1);
  assert.equal(rows.filter(r=>r.payload.state==='DELIVERED').length,1);
  assert.equal(rows.filter(r=>r.payload.state==='GRADED').length,1);
  assert.equal(rows.find(r=>r.type==='forecast').payload.outcomePercentages.home,65);
  assert.equal(summarizePredictionJournal(rows).gradedForecasts,1);
});

test('canceled, postponed and expired refreshes remain outside forecast performance cohorts',async t=>{
  for(const status of ['canceled','postponed','expired']) {
    const file=(await fixture(t))+status, value=slate();
    value.games[0].autoEnrichment.fetchedAt=time(500);value.predictions[0].predictionGeneratedAt=time(700);
    if(status==='expired')value.games[0].startTime=time(900);else value.games[0].statusKey=status;
    await recordPredictionJournal(value,{file,now:now+800,lifecycle:'provisional'});
    const result=await completeAndJournalPregameRefresh(slate(),value,[{gameId:'game',dueWindows:[10]}],time(0),time(1000),{file});
    assert.equal(result.completed.length,0);assert.equal(summarizePredictionJournal(await readFullPredictionJournal(file)).forecasts,0);
  }
});

test('provisional probability mutation requires a new forecast identity and legacy records are unverified',async t=>{
  const file=await fixture(t),value=slate();
  await recordPredictionJournal(value,{file,now,lifecycle:'provisional'});
  value.predictions[0].outcomeProbabilities={home:90,away:10,draw:0};
  await recordPredictionJournal(value,{file,now:now+1000});
  assert.equal(summarizePredictionJournal(await readFullPredictionJournal(file)).forecasts,0);
  const legacy=summarizePredictionJournal([{type:'forecast',payload:{forecastId:'legacy'}}]);
  assert.equal(legacy.legacyUnverifiedForecasts,1);assert.equal(legacy.forecasts,0);
});


test('journal freezes candidate and reference emitted classes without changing old issues',async t=>{
 const file=await fixture(t),value=slate();
 value.predictions[0].candidateProbabilities={evidence:{away:.35,home:.65}};
 value.predictions[0].referenceBaselines={elo:{probabilities:{away:.5,home:.5}}};
 await recordPredictionJournal(value,{file,now});
 let row=(await readFullPredictionJournal(file)).find(event=>event.type==='forecast').payload;
 assert.deepEqual(row.candidateModeledOutcomes.evidence,['away','home']);assert.deepEqual(row.referenceModeledOutcomes.elo,['away','home']);
 const before=await readFile(file,'utf8');value.predictions[0].candidateProbabilities.evidence.draw=0;
 await recordPredictionJournal(value,{file,now:now+1000});
 assert.equal(await readFile(file,'utf8'),before);
});
