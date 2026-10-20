import test from 'node:test';
import assert from 'node:assert/strict';
import { pendingFinalDateKeys } from '../src/finalReconciliation.js';
import { config, requireRuntimeConfig } from '../src/config.js';

test('final reconciliation includes unresolved prior-date games after midnight and excludes future or old windows', () => {
  const now = Date.parse('2026-10-21T06:00:00Z');
  const cache = (dateKey, patch = {}) => ({ dateKey, slate: { predictions: [{ gameId: dateKey,
    predictionMode: 'pregame', startTime: `${dateKey}T23:00:00Z`, ...patch }], finalReplies: {} } });
  const dates = pendingFinalDateKeys([cache('2026-10-20'), cache('2026-10-19'), cache('2026-10-01'), cache('2026-10-22')],
    { today: '2026-10-21', now, lookbackDays: 7 });
  assert.deepEqual(dates, ['2026-10-20', '2026-10-19']);
});

test('unposted known finals remain pending, while acknowledged finals and retrospective estimates do not', () => {
  const now = Date.parse('2026-10-21T06:00:00Z');
  const cache = { dateKey: '2026-10-20', slate: { predictions: [{ gameId: 'game', predictionMode: 'pregame',
    startTime: '2026-10-20T23:00:00Z', predictionCorrect: true }], finalReplies: {} } };
  assert.equal(pendingFinalDateKeys([cache], { today: '2026-10-21', now }).length, 1);
  cache.slate.finalReplies.game = { messageId: 'fixture' };
  assert.equal(pendingFinalDateKeys([cache], { today: '2026-10-21', now }).length, 0);
  cache.slate.finalReplies = {}; cache.slate.predictions[0].predictionMode = 'retrospective_ungraded';
  assert.equal(pendingFinalDateKeys([cache], { today: '2026-10-21', now }).length, 0);
});

test('a friend must configure their own application ID instead of inheriting the maintainer identity', () => {
  const token = config.discordToken, client = config.clientId;
  try {
    config.discordToken = 'fixture-local-only'; config.clientId = '';
    assert.throws(requireRuntimeConfig, /DISCORD_CLIENT_ID is missing/);
  } finally { config.discordToken = token; config.clientId = client; }
});
