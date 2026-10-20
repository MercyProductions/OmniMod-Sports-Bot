import test from 'node:test';
import assert from 'node:assert/strict';
import { enhanceTeamProfiles } from '../src/advancedMetrics.js';
import { attachAdvancedDatasetContext, advancedDatasetSnapshotFile } from '../src/advancedDatasets.js';
import { normalizeEntityName } from '../src/intelligenceStore.js';
import { writeJson } from '../src/storage.js';

test('one-sided MLB lineup coverage cannot manufacture an xwOBA difference against zero', async () => {
  await writeJson(advancedDatasetSnapshotFile, { version: 2, updatedAt: new Date().toISOString(), sources: [], footballSchedules: [],
    baseballPlayers: { [normalizeEntityName('Only Hitter')]: { role: 'batter', expectedWoba: 0.35 } } });
  const game = { id: 'mlb', leagueKey: 'mlb', away: { name: 'Away' }, home: { name: 'Home' },
    autoPlayers: [{ team: 'Home', name: 'Only Hitter' }] };
  await attachAdvancedDatasetContext([game], { localOnly: true });
  assert.equal(game.advancedDataset.homeLineupXwoba, 0.35);
  assert.equal(game.advancedDataset.awayLineupXwoba, null);
  assert.equal(game.advancedDataset.lineupXwobaDifference, null);
});

function soccerMetrics(stats) {
  const home = { name: 'Home', leagueKey: 'epl', powerRating: 50, offense: 50, defense: 50 };
  const sample = { gameId: 'soccer', leagueKey: 'epl', sportGroup: 'Soccer', awayTeam: 'Away', homeTeam: 'Home',
    awayScore: 0, homeScore: 1, teams: { [normalizeEntityName('Home')]: { stats } } };
  enhanceTeamProfiles({ home }, [], [sample]);
  return home.advancedMetrics;
}

test('reported zero xG stays zero rather than becoming a shots or scored-goal proxy', () => {
  const result = soccerMetrics({ expectedgoals: 0, totalshots: 4, shotsontarget: 0 });
  assert.equal(result.expectedGoals, 0);
  assert.equal(result.shotQuality, 0);
});

test('missing soccer xG and shot data remain unknown rather than the final score', () => {
  assert.equal(soccerMetrics({}).expectedGoals, null);
});
