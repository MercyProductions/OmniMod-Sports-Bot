import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const testDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'omnimod-sports-cache-'));
process.env.OMNIMOD_SPORTS_DATA_DIR = testDataDir;

const {
  claimDailyProviderUsage,
  finishDailyProviderUsage,
  readDailyProviderUsage
} = await import('../src/storage.js');
const { cachedFetchJson } = await import('../src/providerCache.js');

test('Odds API provider batch can only be claimed once per guild and date', async () => {
  const dateKey = '2099-01-02';
  const guildId = 'guild-test';

  const first = await claimDailyProviderUsage(dateKey, guildId, 'odds-api', { reason: 'test-first' });
  const second = await claimDailyProviderUsage(dateKey, guildId, 'odds-api', { reason: 'test-second' });

  assert.equal(first.claimed, true);
  assert.equal(second.claimed, false);
  assert.equal(second.usage.reason, 'test-first');

  await finishDailyProviderUsage(dateKey, guildId, 'odds-api', { result: 'completed' });
  const completed = await readDailyProviderUsage(dateKey, guildId, 'odds-api');
  assert.equal(completed.state, 'completed');
  assert.equal(completed.result, 'completed');

  const nextDay = await claimDailyProviderUsage('2099-01-03', guildId, 'odds-api', { reason: 'next-day' });
  assert.equal(nextDay.claimed, true);
});

test('stable scoreboard access errors are cached briefly instead of retried on every refresh', async () => {
  let calls = 0;
  const fetch = async () => {
    calls += 1;
    return new Response('Forbidden', { status: 403, headers: { 'content-type': 'text/plain' } });
  };
  const options = { namespace: `negative-cache-${Date.now()}`, negativeTtlMs: 60_000, timeoutMs: 1000, cacheDir: testDataDir, fetch };
  const first = await cachedFetchJson('https://example.test/scoreboard?date=20260924', options);
  const second = await cachedFetchJson('https://example.test/scoreboard?date=20260924', options);
  assert.equal(first.ok, false);
  assert.equal(first.status, 403);
  assert.equal(first.cacheState, 'network');
  assert.equal(second.ok, false);
  assert.equal(second.status, 403);
  assert.equal(second.cacheState, 'negative_cache');
  assert.equal(calls, 1);
});

test('the failure cooldown does not cache transient server errors', async () => {
  let calls = 0;
  const fetch = async () => {
    calls += 1;
    return new Response('Unavailable', { status: 503 });
  };
  const options = { namespace: `transient-error-${Date.now()}`, negativeTtlMs: 60_000, timeoutMs: 1000, cacheDir: testDataDir, fetch };
  await cachedFetchJson('https://example.test/scoreboard?date=20260925', options);
  await cachedFetchJson('https://example.test/scoreboard?date=20260925', options);
  assert.equal(calls, 2);
});

test.after(async () => {
  await fs.rm(testDataDir, { recursive: true, force: true });
});
