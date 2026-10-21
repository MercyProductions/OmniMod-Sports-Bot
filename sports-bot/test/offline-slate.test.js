import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const testDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'omnimod-sports-offline-'));
process.env.OMNIMOD_SPORTS_DATA_DIR = testDataDir;

const { importIntelligence, intelligenceInventory, parseCsv, readIntelligenceStore, upsertIntelligence } = await import('../src/intelligenceStore.js');
const { buildDailySlate } = await import('../src/sportsData.js');
const { cachedFetchJson } = await import('../src/providerCache.js');
const { claimFinalResult, finishFinalResult, releaseFinalResultClaim } = await import('../src/storage.js');

test('CSV parser supports quoted values and offline intelligence import', async () => {
  const rows = parseCsv('name,league,notes\r\n"Example, City",NBA,"verified, manual"\r\n');
  assert.equal(rows[0].name, 'Example, City');
  assert.equal(rows[0].notes, 'verified, manual');
  const result = await importIntelligence('guild-offline', rows, { kind: 'team', actor: 'test' });
  assert.equal(result.counts.teams, 1);
});

test('strict offline slate builds from local schedule, players, teams, and history', async () => {
  await importIntelligence('guild-offline', {
    teams: [
      { name: 'Local Away', league: 'NBA', powerRating: 55, offense: 58, defense: 54, form: 48 },
      { name: 'Local Home', league: 'NBA', powerRating: 72, offense: 74, defense: 70, form: 68 }
    ],
    players: [
      { name: 'Home Starter', team: 'Local Home', league: 'NBA', role: 'starter', impact: 6, availability: 100, starter: true }
    ],
    games: [
      { id: 'offline-game-1', dateKey: '2099-01-02', startTime: '2099-01-02T19:00:00-06:00', league: 'NBA', leagueKey: 'nba', sportGroup: 'Basketball', awayTeam: 'Local Away', homeTeam: 'Local Home' }
    ],
    results: [
      { dateKey: '2098-12-01', league: 'NBA', leagueKey: 'nba', awayTeam: 'Local Away', homeTeam: 'Local Home', awayScore: 95, homeScore: 108 }
    ]
  }, { actor: 'test' });

  const slate = await buildDailySlate(new Date('2099-01-02T18:00:00Z'), {
    guildId: 'guild-offline',
    localOnly: true
  });
  assert.equal(slate.games.length, 1);
  assert.equal(slate.predictions.length, 1);
  assert.equal(slate.predictions[0].predictedWinner, 'Local Home');
  assert.equal(slate.predictions[0].apiConfidenceValue, 0);
  assert.ok(slate.predictions[0].localDataConfidenceValue > 20);
  assert.equal(slate.modelSummary.externalCalls, 0);

  const inventory = await intelligenceInventory('guild-offline');
  assert.equal(inventory.teams, 3);
  assert.equal(inventory.players, 1);
  assert.equal(inventory.games, 1);
  assert.equal(inventory.results, 1);
});

test('busy days retain cross-league coverage instead of being crowded out by one league', async () => {
  const games = [
    ...Array.from({ length: 90 }, (_, index) => ({
      id: `college-${index}`,
      dateKey: '2099-01-04',
      startTime: `2099-01-04T${String(Math.floor(index / 6)).padStart(2, '0')}:${String((index % 6) * 10).padStart(2, '0')}:00Z`,
      league: 'NCAAB', leagueKey: 'ncaab', sportGroup: 'Basketball',
      awayTeam: `College Away ${index}`, homeTeam: `College Home ${index}`
    })),
    ...Array.from({ length: 5 }, (_, index) => ({
      id: `baseball-${index}`,
      dateKey: '2099-01-04',
      startTime: `2099-01-04T23:${String(index * 5).padStart(2, '0')}:00Z`,
      league: 'MLB', leagueKey: 'mlb', sportGroup: 'Baseball',
      awayTeam: `Baseball Away ${index}`, homeTeam: `Baseball Home ${index}`
    }))
  ];
  await importIntelligence('guild-busy', { games }, { actor: 'test' });
  const slate = await buildDailySlate(new Date('2099-01-04T18:00:00Z'), { guildId: 'guild-busy', localOnly: true });
  assert.equal(slate.games.length, 75);
  assert.equal(slate.games.filter((game) => game.leagueKey === 'mlb').length, 5);
  assert.ok(slate.games.some((game) => game.leagueKey === 'ncaab'));
});

test('recalculation preserves a frozen prediction after the event start', async () => {
  await importIntelligence('guild-freeze', { games: [{
    id: 'freeze-game', dateKey: '2020-01-02', startTime: '2020-01-02T19:00:00Z',
    league: 'NBA', leagueKey: 'nba', sportGroup: 'Basketball', awayTeam: 'Frozen Away', homeTeam: 'Frozen Home'
  }] }, { actor: 'test' });
  const cachedSlate = {
    games: [{
      id: 'freeze-game', league: 'NBA', leagueKey: 'nba', sportGroup: 'Basketball',
      away: { name: 'Frozen Away' }, home: { name: 'Frozen Home' }
    }],
    predictions: [{
      gameId: 'freeze-game', index: 1, modelVersion: 'OmniMod Evidence Ensemble v3.0.0',
      predictedWinner: 'Frozen Away', predictedSide: 'away', confidenceValue: 61.2,
      confidence: '61.2%', predictionConfidence: '61.2%', predictionProbability: 0.612,
      predictionMode: 'pregame', eligibleForCalibration: true, predictionCorrect: null
    }],
    finalReplies: {}
  };
  const slate = await buildDailySlate(new Date('2020-01-02T18:00:00Z'), {
    guildId: 'guild-freeze', localOnly: true, cachedSlate
  });
  assert.equal(slate.predictions[0].predictedWinner, 'Frozen Away');
  assert.equal(slate.predictions[0].confidenceValue, 61.2);
  assert.equal(slate.predictions[0].frozenAfterStart, true);
});

test('provider cache avoids duplicate calls and never persists secret query values', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response(JSON.stringify({ ok: true, value: 42, unusedLargePayload: 'x'.repeat(10_000) }), {
      status: 200,
      headers: { 'content-type': 'application/json', 'x-requests-remaining': '99' }
    });
  };
  try {
    const url = 'https://provider.invalid/data?apiKey=super-secret-test-key&sport=nba';
    const options = {
      namespace: 'secret-test', ttlMs: 60_000, staleMs: 60_000, secretParams: ['apiKey'],
      transformJson: (payload) => ({ value: payload.value })
    };
    const first = await cachedFetchJson(url, options);
    const second = await cachedFetchJson(url, options);
    assert.equal(first.json.value, 42);
    assert.equal(second.cacheState, 'fresh');
    assert.equal(calls, 1);
    const files = await fs.readdir(path.join(testDataDir, 'provider-cache'));
    const secretFile = files.find((name) => name.startsWith('secret-test-'));
    const persisted = await fs.readFile(path.join(testDataDir, 'provider-cache', secretFile), 'utf8');
    assert.doesNotMatch(persisted, /super-secret-test-key/);
    assert.doesNotMatch(persisted, /unusedLargePayload/);
    assert.ok(persisted.length < 1_000);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('final-result claims allow only one poster and survive cache rewrites', async () => {
  const args = ['2099-01-06', 'guild-result-claim', 'game-result-1'];
  const claims = await Promise.all([
    claimFinalResult(...args, { reason: 'first' }),
    claimFinalResult(...args, { reason: 'second' })
  ]);
  assert.equal(claims.filter((row) => row.claimed).length, 1);
  await finishFinalResult(...args, { messageId: 'message-1', channelId: 'channel-1' });
  assert.equal((await claimFinalResult(...args, { reason: 'third' })).claimed, false);
  await releaseFinalResultClaim(...args);
  assert.equal((await claimFinalResult(...args, { reason: 'fourth' })).claimed, false);
});

test('concurrent local intelligence updates are serialized without losing rows', async () => {
  await Promise.all(Array.from({ length: 20 }, (_, index) => upsertIntelligence('guild-concurrent', 'teams', {
    name: `Concurrent Team ${index}`,
    league: 'NBA',
    powerRating: 40 + index
  }, 'test')));
  const store = await readIntelligenceStore('guild-concurrent');
  assert.equal(Object.keys(store.teams).length, 20);
  const backup = path.join(testDataDir, 'intelligence-guild-concurrent.json.bak');
  assert.equal(JSON.parse(await fs.readFile(backup, 'utf8')).version, 2);
});

test('partial team/player updates preserve previously entered optional fields', async () => {
  await upsertIntelligence('guild-merge', 'teams', { name: 'Merge Team', league: 'NBA', powerRating: 77, offense: 75, notes: 'keep me' }, 'test');
  const team = await upsertIntelligence('guild-merge', 'teams', { name: 'Merge Team', league: 'NBA', form: 63, powerRating: null, offense: null, notes: null }, 'test');
  assert.equal(team.powerRating, 77);
  assert.equal(team.offense, 75);
  assert.equal(team.form, 63);
  assert.equal(team.notes, 'keep me');

  await upsertIntelligence('guild-merge', 'players', { name: 'Merge Player', team: 'Merge Team', league: 'NBA', impact: 8, availability: 100, stats: { plusMinus: 5 } }, 'test');
  const player = await upsertIntelligence('guild-merge', 'players', { name: 'Merge Player', team: 'Merge Team', league: 'NBA', availability: 25, impact: null, stats: null }, 'test');
  assert.equal(player.impact, 8);
  assert.equal(player.availability, 25);
  assert.equal(player.stats.plusMinus, 5);
});

test('corrupt intelligence JSON fails closed instead of being silently overwritten', async () => {
  const file = path.join(testDataDir, 'intelligence-guild-corrupt.json');
  await fs.writeFile(file, '{broken json', 'utf8');
  await assert.rejects(() => readIntelligenceStore('guild-corrupt'), /Could not read valid JSON/);
  await assert.rejects(() => upsertIntelligence('guild-corrupt', 'teams', { name: 'Must Not Overwrite', league: 'NBA' }), /Could not read valid JSON/);
  assert.equal(await fs.readFile(file, 'utf8'), '{broken json');
});

test.after(async () => {
  await fs.rm(testDataDir, { recursive: true, force: true });
});


test('actual targeted slate builder journals provisionally until the scheduler accepts fresh evidence', async () => {
  const { readPredictionJournal, predictionJournalFile } = await import('../src/predictionJournal.js');
  const { completeAndJournalPregameRefresh } = await import('../src/pregameRefresh.js');
  const id='targeted-journal-integration';
  await importIntelligence(id, { games: [{ id, dateKey:'2099-02-01',startTime:'2099-02-01T19:00:00-06:00',
    league:'NBA',leagueKey:'nba',sportGroup:'Basketball',awayTeam:'Integration Away',homeTeam:'Integration Home' }] }, {actor:'test'});
  const before=new Date().toISOString();
  const rebuilt=await buildDailySlate(new Date('2099-02-01T18:00:00Z'),{guildId:id,localOnly:true,targetedPregame:true,refreshGameIds:[id]});
  assert.equal(rebuilt.predictions.length,1);
  let records=(await readPredictionJournal()).filter(row=>row.payload.guildId===id);
  assert.equal(records.filter(row=>row.type==='forecast').length,0);
  assert.equal(records.filter(row=>row.type==='provisional_forecast').length,1);
  const attempt=await completeAndJournalPregameRefresh({},rebuilt,[{gameId:id,dueWindows:[30]}],before,new Date().toISOString());
  assert.equal(attempt.completed.length,0);
  const all=await readPredictionJournal(predictionJournalFile);
  const forecastIds=new Set(records.map(row=>row.payload.forecastId));
  records=all.filter(row=>forecastIds.has(row.payload.forecastId));
  assert.equal(records.filter(row=>row.type==='forecast').length,0);
  assert.ok(records.some(row=>row.type==='forecast_lifecycle'&&row.payload.state==='REJECTED'));
});
