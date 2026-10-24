import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCommands } from '../src/commands.js';
import { finalResultColor, findFinalResultMessage, formatSlateEmbeds, LOG_COLORS } from '../src/discordPublisher.js';

function embedLength(data) {
  return (data.title?.length || 0) + (data.description?.length || 0) + (data.footer?.text?.length || 0) +
    (data.fields || []).reduce((total, field) => total + field.name.length + field.value.length, 0);
}

test('Discord command groups stay within option limits', () => {
  const commands = buildCommands();
  assert.deepEqual(commands.map((command) => command.name), ['sports', 'sportsdata']);
  for (const command of commands) assert.ok(command.options.length <= 25);
});

test('late first sightings never publish a retrospective pick as a pregame signal', () => {
  const [embed] = formatSlateEmbeds({
    dateKey: '2026-09-19', timezone: 'America/Chicago', generatedAt: new Date().toISOString(),
    games: [{ id: 'late', statusKey: 'final', away: { abbr: 'AWY', score: 3 }, home: { abbr: 'HOM', score: 1 } }],
    predictions: [{ index: 1, gameId: 'late', league: 'MLB', matchup: 'AWY @ HOM', startTimeLocal: '1:00 PM',
      statusKey: 'final', predictionMode: 'retrospective_ungraded', predictedWinner: 'Away', predictionConfidence: '90%' }]
  });
  const value = embed.toJSON().fields[0].value;
  assert.match(value, /No pregame pick was recorded/);
  assert.match(value, /AWY 3 - HOM 1/);
  assert.doesNotMatch(value, /90%|Pick: \*\*Away\*\*/);
});

test('high-uncertainty pregame rows identify the projected winner and distinguish feed quality', () => {
  const [embed] = formatSlateEmbeds({
    dateKey: '2026-09-20', timezone: 'America/Chicago', generatedAt: new Date().toISOString(),
    games: [{ id: 'nfl-game',leagueKey:'nfl', statusKey: 'scheduled' }],
    predictions: [{ index: 9, gameId: 'nfl-game', league: 'NFL', matchup: 'NYG @ LAR', startTimeLocal: '7:15 PM',
      statusKey: 'scheduled', predictionMode: 'pregame', recommendationStatus: 'withheld', predictedWinner: 'Rams',
      predictionConfidence: '52.7%', predictionUncertaintyPoints: 21, apiConfidence: '94%', riskTier: 'Higher',
      evidenceQuality: '56%', edge: '-19.7 pts', abstentionReason: 'The uncertainty interval does not reliably separate the leading outcomes.' }]
  });
  const value = embed.toJSON().fields[0].value;
  assert.match(value, /Pick: \*\*Rams\*\* \| Win est\.: \*\*52\.7%\*\* \| API data: \*\*94%\*\*/);
  assert.match(value, /High uncertainty: The uncertainty interval does not reliably separate/);
  assert.doesNotMatch(value, /Pick: \*\*WITHHELD\*\*/);
});

test('final result color is green for a match and red for a miss, with unknown kept amber', () => {
  assert.equal(finalResultColor(true), LOG_COLORS.success);
  assert.equal(finalResultColor(false), LOG_COLORS.danger);
  assert.equal(finalResultColor(null), LOG_COLORS.warn);
});

test('final-result dedupe checks the second channel when the first channel history is unavailable', async () => {
  const existing = { id: 'found-result', author: { id: 'sports-bot' }, embeds: [{
    fields:[{name:'League',value:'NHL'},{name:'Started',value:'4:00 PM'}],title: 'Final result #18: NSH @ TBL', footer: { text: 'OmniMod Sports result | 2026-09-20 | game-18' }
  }] };
  const client = {
    user: { id: 'sports-bot' },
    channels: { fetch: async (id) => ({
      id, isTextBased: () => true,
      messages: { fetch: async () => {
        if (id === 'slate-channel') throw new Error('Missing Read Message History permission.');
        const messages = new Map([[existing.id, existing]]);
        messages.find = (predicate) => [...messages.values()].find(predicate);
        return messages;
      } }
    }) }
  };
  const found = await findFinalResultMessage(client,
    { dateKey: '2026-09-20', guildId: 'guild', channelId: 'slate-channel',games:[{id:'game-18',leagueKey:'nhl',league:'NHL',startTime:'2026-09-20T21:00:00Z'}] },
    { gameId: 'game-18',leagueKey:'nhl',startTime:'2026-09-20T21:00:00Z',startTimeLocal:'4:00 PM', index: 18, matchup: 'NSH @ TBL' },
    { resultsChannel: { id: 'results-channel' } });
  assert.equal(found, existing);
});

test('large daily slate stays within Discord aggregate embed limits', () => {
  const predictions = Array.from({ length: 50 }, (_, index) => ({
    index: index + 1,
    league: 'A very long custom league name that must be clipped',
    startTimeLocal: '10:30 PM',
    matchup: 'LONGAWAY @ LONGHOME',
    predictedWinner: 'A very long competitor name that must be safely clipped before publishing',
    predictionConfidence: '61.2%',
    apiConfidence: '63%',
    riskTier: 'Medium',
    evidenceQuality: '72%',
    edge: '+2.1 pts',
    statusKey: 'scheduled'
  }));
  const embeds = formatSlateEmbeds({
    dateKey: '2099-01-02',
    timezone: 'America/Chicago',
    generatedAt: new Date().toISOString(),
    source: 'offline-first model',
    disclaimer: 'Probabilistic research only.',
    predictions,
    diagnostics: Array.from({ length: 30 }, (_, index) => `Diagnostic ${index}: ${'x'.repeat(200)}`)
  }).map((embed) => embed.toJSON());
  assert.ok(embeds.length <= 10);
  assert.ok(embeds.reduce((total, embed) => total + embedLength(embed), 0) <= 6000);
  assert.ok(embeds.flatMap((embed) => embed.fields || []).length > 0);
  assert.ok(embeds.flatMap((embed) => embed.fields || []).length <= 25);
  for (const embed of embeds) {
    assert.ok((embed.fields || []).length <= 25);
    for (const field of embed.fields || []) assert.ok(field.value.length <= 1024);
  }
});

test('daily slate clips extreme model output before Discord rejects the payload', () => {
  const huge = 'Long model output '.repeat(250);
  const predictions = Array.from({ length: 25 }, (_, index) => ({
    index: index + 1,
    league: huge,
    startTimeLocal: huge,
    matchup: huge,
    predictedWinner: huge,
    predictionConfidence: huge,
    apiConfidence: huge,
    riskTier: huge,
    evidenceQuality: huge,
    edge: huge,
    finalScore: huge,
    statusKey: 'final'
  }));
  const embeds = formatSlateEmbeds({
    dateKey: '2099-01-03',
    timezone: huge,
    generatedAt: new Date().toISOString(),
    source: huge,
    disclaimer: huge,
    predictions,
    diagnostics: Array.from({ length: 20 }, () => huge)
  }).map((embed) => embed.toJSON());

  assert.ok(embeds.reduce((total, embed) => total + embedLength(embed), 0) <= 6000);
  assert.match(embeds[0].description, /showing \d+/);
  for (const embed of embeds) {
    assert.ok((embed.title || '').length <= 256);
    assert.ok((embed.description || '').length <= 4096);
    for (const field of embed.fields || []) {
      assert.ok(field.name.length <= 256);
      assert.ok(field.value.length <= 1024);
    }
  }
});
