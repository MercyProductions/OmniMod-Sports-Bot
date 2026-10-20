import test from 'node:test';
import assert from 'node:assert/strict';
import { postingConfigurationStatus } from '../src/guildSettings.js';

test('posting diagnostics explain when the bot has no configured destination', () => {
  assert.deepEqual(postingConfigurationStatus([]), {
    postingConfigured: false,
    postingGuildCount: 0,
    postingConfiguration: 'No posting destination configured. Run /sports setup or set a channel ID in the environment.'
  });
});

test('posting diagnostics count unique configured guilds without exposing IDs', () => {
  const status = postingConfigurationStatus(['123456789012345', '123456789012345', '987654321098765']);
  assert.equal(status.postingConfigured, true);
  assert.equal(status.postingGuildCount, 2);
  assert.equal(status.postingConfiguration, '2 guilds configured for posting.');
  assert.equal(JSON.stringify(status).includes('123456789012345'), false);
});

test('posting diagnostics ignore blank and malformed list entries', () => {
  assert.equal(postingConfigurationStatus(['', null, undefined]).postingGuildCount, 0);
  assert.equal(postingConfigurationStatus('not-an-array').postingConfigured, false);
});
