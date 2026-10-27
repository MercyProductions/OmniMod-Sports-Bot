import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readDailyCache, writeDailyCache, dailyCachePath } from '../src/storage.js';

const date = '2099-08-01';
const run = promisify(execFile);
const conflict = { code: 'DAILY_CACHE_CONFLICT' };

test('delayed forecast, quote and delivery snapshots cannot roll back a newer final acknowledgement', async () => {
  const guild = 'cache-stale';
  await writeDailyCache(date, { dateKey: date, guildId: guild, predictions: [{ probability: .6 }] }, guild);
  const initial = await readDailyCache(date, guild);
  const delayed = ['forecast', 'quote', 'delivery'].map(kind => ({ ...structuredClone(initial), kind }));
  await writeDailyCache(date, { ...initial, finalReplies: { game: { claimGeneration: 3 } } }, guild);
  const final = await readDailyCache(date, guild);
  for (const snapshot of delayed) await assert.rejects(writeDailyCache(date, snapshot, guild), conflict);
  assert.deepEqual(await readDailyCache(date, guild), final);
  const next = await writeDailyCache(date, { ...final, quotedAt: '2099-08-01T12:00:00Z' }, guild);
  assert.equal(next.cacheRevision, 3);
  assert.deepEqual(next.finalReplies, final.finalReplies);
});

test('simultaneous local writers elect exactly one revision and leave their inputs untouched', async () => {
  const guild = 'cache-race';
  const initial = await writeDailyCache(date, { dateKey: date }, guild);
  const outcomes = await Promise.allSettled(Array.from({ length: 12 }, (_, i) => writeDailyCache(date, { ...initial, winner: i }, guild)));
  assert.equal(outcomes.filter(row => row.status === 'fulfilled').length, 1);
  assert.equal(outcomes.filter(row => row.status === 'rejected' && row.reason.code === conflict.code).length, 11);
  assert.equal(initial.cacheRevision, 1);
  assert.equal((await readDailyCache(date, guild)).cacheRevision, 2);
});

test('a separate process cannot replace a newer revision using an earlier snapshot', async () => {
  const guild = 'cache-child';
  const old = await writeDailyCache(date, { dateKey: date }, guild);
  const latest = await writeDailyCache(date, { ...old, prediction: 'new' }, guild);
  const module = new URL('../src/storage.js', import.meta.url).href;
  const source = `import {writeDailyCache} from ${JSON.stringify(module)};
    try { await writeDailyCache(${JSON.stringify(date)}, ${JSON.stringify(old)}, ${JSON.stringify(guild)}); process.exitCode=2; }
    catch (error) { if(error.code!=='DAILY_CACHE_CONFLICT')throw error; }`;
  await run(process.execPath, ['--input-type=module', '-e', source], { env: process.env });
  assert.deepEqual(await readDailyCache(date, guild), latest);
});

test('owner locks and malformed cache data fail closed without changing bytes', async () => {
  const guild = 'cache-corrupt', file = dailyCachePath(date, guild);
  await fs.writeFile(file, '{broken');
  await assert.rejects(writeDailyCache(date, { dateKey: date }, guild), /valid JSON/);
  assert.equal(await fs.readFile(file, 'utf8'), '{broken');
  await fs.unlink(file);
  await fs.writeFile(`${file}.lock`, 'existing owner');
  await assert.rejects(writeDailyCache(date, { dateKey: date }, guild), /locked/);
  assert.equal(await fs.readFile(`${file}.lock`, 'utf8'), 'existing owner');
  await fs.unlink(`${file}.lock`);
});

test('legacy revision zero upgrades once and invalid revisions cannot bypass comparison', async () => {
  const guild = 'cache-legacy', file = dailyCachePath(date, guild);
  await fs.writeFile(file, JSON.stringify({ dateKey: date, legacy: true }));
  const upgraded = await writeDailyCache(date, { dateKey: date, migrated: true }, guild);
  assert.equal(upgraded.cacheRevision, 1);
  await assert.rejects(writeDailyCache(date, { dateKey: date }, guild), conflict);
  for (const cacheRevision of [-1, .5, '1', Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(writeDailyCache(date, { cacheRevision }, guild), /Invalid/);
  }
  assert.deepEqual(await readDailyCache(date, guild), upgraded);
});
