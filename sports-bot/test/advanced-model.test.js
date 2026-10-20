import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const testDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'omnimod-sports-v4-'));
process.env.OMNIMOD_SPORTS_DATA_DIR = testDataDir;
process.env.AUTO_OFFICIAL_SOURCES = 'true';
process.env.AUTO_LEARNING_ENABLED = 'true';
process.env.AUTO_LEARNING_MIN_SAMPLES = '20';

const {
  applyPlayerProfilesAndLineups,
  buildAutomaticPlayerProfiles,
  enhanceTeamProfiles,
  parseHistoricalEventSummary
} = await import('../src/advancedMetrics.js');
const { applyHistoricalStarterRest } = await import('../src/autoEnrichment.js');
const { buildAutomaticScheduleContext } = await import('../src/situationalAutomation.js');
const { corroborateOfficialSources } = await import('../src/officialSources.js');
const {
  buildDriftReport,
  buildEloRatings,
  buildWalkForwardFeatureModels,
  loadModelContext
} = await import('../src/modelEvaluation.js');
const { writeDailyCache } = await import('../src/storage.js');

function basketballResult(id, dateKey, awayTeam = 'Road Club', homeTeam = 'Home Club', awayScore = 98, homeScore = 112) {
  return {
    id, dateKey, startTime: `${dateKey}T20:00:00Z`, league: 'NBA', leagueKey: 'nba', sportGroup: 'Basketball',
    awayTeam, homeTeam, awayScore, homeScore, seasonYear: 2099, seasonType: 2
  };
}

function basketballSummary(dateIndex = 1) {
  const teamPlayerGroup = (team, starId, starName, benchId, benchName, home) => ({
    team: { displayName: team },
    statistics: [{
      name: 'players', labels: ['MIN', 'PTS', 'REB', 'AST', 'STL', 'BLK', 'TO', '+/-'],
      athletes: [
        {
          starter: true, active: true,
          athlete: { id: starId, displayName: starName, position: { displayName: 'Point Guard' } },
          stats: ['36:00', home ? '28' : '24', '7', '9', '2', '1', '2', home ? '12' : '5']
        },
        {
          starter: false, active: true,
          athlete: { id: benchId, displayName: benchName, position: { displayName: 'Guard' } },
          stats: ['08:00', String(2 + (dateIndex % 2)), '1', '1', '0', '0', '1', '-3']
        }
      ]
    }]
  });
  return {
    boxscore: {
      teams: [
        { team: { displayName: 'Road Club' }, statistics: [
          { name: 'fieldGoals', displayValue: '38-88' }, { name: 'freeThrows', displayValue: '14-18' },
          { name: 'offensiveRebounds', displayValue: '8' }, { name: 'turnovers', displayValue: '13' }
        ] },
        { team: { displayName: 'Home Club' }, statistics: [
          { name: 'fieldGoals', displayValue: '45-90' }, { name: 'freeThrows', displayValue: '16-20' },
          { name: 'offensiveRebounds', displayValue: '11' }, { name: 'turnovers', displayValue: '9' }
        ] }
      ],
      players: [
        teamPlayerGroup('Road Club', 'r-star', 'Road Star', 'r-bench', 'Road Bench', false),
        teamPlayerGroup('Home Club', 'h-star', 'Home Star', 'h-bench', 'Home Bench', true)
      ]
    }
  };
}

test('historical box scores learn evidence-based player value and advanced team efficiency', () => {
  const samples = Array.from({ length: 6 }, (_, index) => parseHistoricalEventSummary(
    basketballSummary(index),
    basketballResult(`box-${index}`, `2099-01-${String(index + 1).padStart(2, '0')}`),
    { fetchedAt: '2099-02-01T00:00:00Z', cacheState: index ? 'fresh' : 'network' }
  ));
  const profiles = buildAutomaticPlayerProfiles(samples);
  const homeStar = Object.values(profiles).find((row) => row.name === 'Home Star');
  const homeBench = Object.values(profiles).find((row) => row.name === 'Home Bench');
  assert.equal(samples[0].players.length, 4);
  assert.equal(homeStar.sampleSize, 6);
  assert.ok(homeStar.impact > homeBench.impact + 1.5);
  assert.ok(homeStar.participation > homeBench.participation);

  const teamProfiles = {
    road: { name: 'Road Club', leagueKey: 'nba', powerRating: 48, offense: 48, defense: 48, stats: {} },
    home: { name: 'Home Club', leagueKey: 'nba', powerRating: 52, offense: 52, defense: 52, stats: {} }
  };
  enhanceTeamProfiles(teamProfiles, samples.map((sample) => ({ ...sample })), samples);
  assert.ok(Number.isFinite(teamProfiles.home.advancedRating));
  assert.equal(teamProfiles.home.stats.advancedBoxscoreSample, 6);
  assert.ok(teamProfiles.home.advancedOffense > teamProfiles.road.advancedOffense);
});

test('baseball innings use outs notation and roster-only nonparticipants do not become player evidence', () => {
  const sample = parseHistoricalEventSummary({ boxscore: { players: [{
    team: { displayName: 'Road Nine' }, statistics: [{ name: 'pitching', labels: ['IP', 'K', 'ER'], athletes: [{
      starter: true, athlete: { id: 'ace', displayName: 'Road Ace', position: { displayName: 'Pitcher' } }, stats: ['5.2', '8', '2']
    }] }]
  }] }, rosters: [{ team: { displayName: 'Road Nine' }, roster: [{
    starter: false, active: true, athlete: { id: 'unused', displayName: 'Unused Reliever' }, position: { displayName: 'Pitcher' }
  }] }] }, {
    id: 'mlb-box', dateKey: '2099-06-01', league: 'MLB', leagueKey: 'mlb', sportGroup: 'Baseball',
    awayTeam: 'Road Nine', homeTeam: 'Home Nine', awayScore: 4, homeScore: 2
  });
  assert.ok(Math.abs(sample.players[0].stats.ip - (5 + 2 / 3)) < 1e-9);
  const profiles = buildAutomaticPlayerProfiles([sample]);
  assert.ok(Object.values(profiles).some((row) => row.name === 'Road Ace'));
  assert.ok(!Object.values(profiles).some((row) => row.name === 'Unused Reliever'));
});

test('opponent adjustment distinguishes schedule strength from raw results', () => {
  const results = [
    basketballResult('1', '2099-01-01', 'Strong', 'Elite', 96, 100),
    basketballResult('2', '2099-01-02', 'Elite', 'Strong', 100, 98),
    basketballResult('3', '2099-01-03', 'Strong', 'Weak', 118, 88),
    basketballResult('4', '2099-01-04', 'Elite', 'Weak', 120, 86),
    basketballResult('5', '2099-01-05', 'Weak', 'Soft', 90, 94),
    basketballResult('6', '2099-01-06', 'Soft', 'Weak', 91, 93)
  ];
  const profiles = Object.fromEntries(['Strong', 'Elite', 'Weak', 'Soft'].map((name) => [name, {
    name, leagueKey: 'nba', powerRating: 50, offense: 50, defense: 50, stats: {}
  }]));
  enhanceTeamProfiles(profiles, results, []);
  assert.ok(profiles.Strong.scheduleStrength > profiles.Weak.scheduleStrength);
  assert.ok(profiles.Elite.opponentAdjustedRating > profiles.Soft.opponentAdjustedRating);
  assert.ok(profiles.Strong.stats.opponentAdjustedSample >= 3);
});

test('current lineups inherit learned player impact and report confirmed coverage', () => {
  const samples = Array.from({ length: 5 }, (_, index) => parseHistoricalEventSummary(
    basketballSummary(index), basketballResult(`line-${index}`, `2099-01-${String(index + 1).padStart(2, '0')}`)
  ));
  const profiles = buildAutomaticPlayerProfiles(samples);
  const extraProfiles = {};
  for (const side of ['Road', 'Home']) {
    for (let index = 2; index <= 5; index += 1) {
      const name = `${side} Starter ${index}`;
      const team = `${side} Club`;
      const athleteId = `${side.toLowerCase()}-${index}`;
      extraProfiles[`nba__${team.toLowerCase()}__${athleteId}`] = {
        athleteId, name, team, leagueKey: 'nba', impact: 4, form: side === 'Home' ? 62 : 45,
        starterRate: 0.9, participation: 0.9, sampleSize: 5, source: 'test history'
      };
    }
  }
  Object.assign(profiles, extraProfiles);
  const homeStarProfile = Object.values(profiles).find((row) => row.name === 'Home Star');
  homeStarProfile.teammateInteractions = { 'home-2': { name: 'Home Starter 2', score: 0.3, sampleSize: 8 } };
  const game = {
    id: 'lineup-game', league: 'NBA', leagueKey: 'nba', sportGroup: 'Basketball',
    away: { name: 'Road Club', abbr: 'ROAD' }, home: { name: 'Home Club', abbr: 'HOME' },
    autoLineups: [
      { athleteId: 'r-star', name: 'Road Star', team: 'Road Club', starter: true, active: true },
      { athleteId: 'h-star', name: 'Home Star', team: 'Home Club', starter: true, active: true },
      ...['Road', 'Home'].flatMap((side) => Array.from({ length: 4 }, (_, index) => ({
        athleteId: `${side.toLowerCase()}-${index + 2}`, name: `${side} Starter ${index + 2}`,
        team: `${side} Club`, starter: true, active: true
      }))),
      { athleteId: 'home-new', name: 'Home Rookie', team: 'Home Club', starter: false, active: true }
    ],
    autoPlayers: [{
      athleteId: 'h-star', name: 'Home Star', team: 'Home Club', starter: true,
      availability: 0, impact: 2, form: 50, stats: {}, source: 'ESPN injury report'
    }]
  };
  const outcome = applyPlayerProfilesAndLineups([game], profiles);
  const learnedHomeStar = game.autoPlayers[0];
  assert.equal(outcome.learnedInjuries, 1);
  assert.equal(outcome.confirmedLineups, 2);
  assert.ok(learnedHomeStar.impact > 4);
  assert.equal(game.autoLineup.confirmedSides, 2);
  assert.equal(game.autoLineup.away.coverage, 1);
  assert.ok(game.autoLineup.home.pairCoverage > 0);
  assert.ok(game.autoLineup.home.interactionRating > 50);
  assert.ok(game.autoLineup.rosterTransitionRisk > 0);
  assert.ok(Number.isFinite(game.autoLineup.ratingDifference));
});

test('schedule automation derives travel, time zones, altitude, fatigue, and playoff context locally', () => {
  const game = {
    leagueKey: 'nba', sportGroup: 'Basketball', seasonType: 3,
    away: { abbr: 'LAX' }, home: { abbr: 'DEN' }, venueDetails: { address: { city: 'Denver' } }
  };
  const context = buildAutomaticScheduleContext(game,
    { restDays: 0, lastVenue: { address: { city: 'Los Angeles' } }, stats: { gamesLast3: 3, gamesLast7: 6, awayStreak: 4 } },
    { restDays: 3, lastVenue: { address: { city: 'Denver' } }, stats: { gamesLast3: 1, gamesLast7: 3, awayStreak: 0 } }
  );
  assert.ok(context.factors.awayTravelKm > 1_000);
  assert.equal(context.factors.homeTravelKm, 0);
  assert.equal(context.factors.awayTimeZoneShift, 1);
  assert.ok(context.factors.awayAltitudeChangeM > 1_400);
  assert.ok(context.factors.awayFatigue > context.factors.homeFatigue);
  assert.equal(context.factors.playoffGame, 1);
});

test('travel time-zone shifts respect daylight-saving time', () => {
  const summer = buildAutomaticScheduleContext({
    startTime: '2099-07-10T20:00:00Z', leagueKey: 'nba', sportGroup: 'Basketball',
    away: { abbr: 'LA' }, home: { abbr: 'PHX' }, venueDetails: { address: { city: 'Phoenix' } }
  }, { lastVenue: { address: { city: 'Los Angeles' } }, stats: {}, restDays: 2 },
  { lastVenue: { address: { city: 'Phoenix' } }, stats: {}, restDays: 2 });
  assert.equal(summer.factors.awayTimeZoneShift, 0);
});

test('starting-pitcher rest is matched from cached historical probables without another API', () => {
  const game = {
    id: 'mlb-rest', startTime: '2099-07-10T20:00:00Z', leagueKey: 'mlb', sportGroup: 'Baseball',
    away: { name: 'Road Nine', abbr: 'RDN' }, home: { name: 'Home Nine', abbr: 'HMN' },
    venueDetails: { address: { city: 'Chicago' } },
    autoPlayers: [
      { sourceAthleteId: '11', name: 'Road Ace', team: 'Road Nine', role: 'Starting Pitcher', starter: true, stats: {} },
      { sourceAthleteId: '22', name: 'Home Ace', team: 'Home Nine', role: 'Starting Pitcher', starter: true, stats: {} }
    ]
  };
  const results = [
    { startTime: '2099-07-07T20:00:00Z', probableStarters: [{ athleteId: '11', name: 'Road Ace', team: 'Road Nine' }] },
    { startTime: '2099-07-05T20:00:00Z', probableStarters: [{ athleteId: '22', name: 'Home Ace', team: 'Home Nine' }] }
  ];
  assert.equal(applyHistoricalStarterRest([game], results), 2);
  assert.equal(game.autoPlayers[0].stats.daysSinceLastStart, 3);
  assert.equal(game.autoPlayers[1].stats.daysSinceLastStart, 5);
  const context = buildAutomaticScheduleContext(game,
    { restDays: 1, stats: {}, lastVenue: { address: { city: 'Chicago' } } },
    { restDays: 1, stats: {}, lastVenue: { address: { city: 'Chicago' } } }
  );
  assert.equal(context.factors.awayStarterRestDays, 3);
  assert.equal(context.factors.homeStarterRestDays, 5);
});

test('official MLB source corroborates games and probable starters, then reuses its cache', async (t) => {
  const originalFetch = global.fetch;
  let calls = 0;
  global.fetch = async () => {
    calls += 1;
    return new Response(JSON.stringify({ dates: [{ games: [{
      gamePk: 9001, gameDate: '2099-07-01T19:10:00Z', status: { abstractGameState: 'Preview' },
      teams: {
        away: { team: { name: 'Road Nine', abbreviation: 'RDN' }, probablePitcher: { id: 11, fullName: 'Road Ace' } },
        home: { team: { name: 'Home Nine', abbreviation: 'HMN' }, probablePitcher: { id: 22, fullName: 'Home Ace' } }
      }
    }] }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  t.after(() => { global.fetch = originalFetch; });
  const makeGame = () => ({
    id: 'mlb-1', league: 'MLB', leagueKey: 'mlb', sportGroup: 'Baseball',
    startTime: '2099-07-01T19:10:00Z', statusKey: 'scheduled',
    away: { name: 'Road Nine', abbr: 'RDN' }, home: { name: 'Home Nine', abbr: 'HMN' }, autoPlayers: []
  });
  const firstGame = makeGame();
  const first = await corroborateOfficialSources([firstGame], '2099-07-01');
  const second = await corroborateOfficialSources([makeGame()], '2099-07-01');
  assert.equal(first.matched, 1);
  assert.equal(first.confirmedStarters, 2);
  assert.equal(firstGame.sourceCorroboration.conflicts.length, 0);
  assert.equal(firstGame.autoPlayers.filter((row) => row.starter).length, 2);
  assert.equal(calls, 1);
  assert.equal(second.externalCalls, 0);
});

test('official NHL source records status conflicts instead of silently agreeing', async (t) => {
  const originalFetch = global.fetch;
  global.fetch = async () => new Response(JSON.stringify({ games: [{
    id: 7001, startTimeUTC: '2099-12-01T20:00:00Z', gameState: 'LIVE',
    awayTeam: { name: { default: 'Road Skaters' }, abbrev: 'RDS' },
    homeTeam: { name: { default: 'Home Skaters' }, abbrev: 'HMS' }
  }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  t.after(() => { global.fetch = originalFetch; });
  const game = {
    id: 'nhl-1', league: 'NHL', leagueKey: 'nhl', sportGroup: 'Hockey',
    startTime: '2099-12-01T20:00:00Z', statusKey: 'scheduled',
    away: { name: 'Road Skaters', abbr: 'RDS' }, home: { name: 'Home Skaters', abbr: 'HMS' }
  };
  const result = await corroborateOfficialSources([game], '2099-12-01');
  assert.equal(result.matched, 1);
  assert.equal(game.sourceCorroboration.matches.length, 0);
  assert.equal(game.sourceCorroboration.conflicts.length, 1);
});

test('sport-specific feature learning is accepted only after walk-forward improvement', () => {
  const rows = Array.from({ length: 100 }, (_, index) => {
    const outcome = index % 2;
    return {
      dateKey: `2099-${String(Math.floor(index / 28) + 1).padStart(2, '0')}-${String(index % 28 + 1).padStart(2, '0')}`,
      sport: 'basketball', outcome,
      factors: { 'Useful signal': outcome ? 0.35 : -0.35, 'Misleading signal': outcome ? -0.75 : 0.75 }
    };
  });
  const model = buildWalkForwardFeatureModels(rows, { minSamples: 20 }).basketball;
  assert.equal(model.trained, true);
  assert.equal(model.accepted, true);
  assert.ok(model.learnedBrier < model.baselineBrier);
  assert.ok(model.weights['Misleading signal'] < 1);
});

test('drift monitoring reduces trust when recent calibration and accuracy collapse', () => {
  const rows = Array.from({ length: 60 }, (_, index) => {
    const recent = index >= 45;
    return {
      dateKey: `2099-01-${String(index + 1).padStart(2, '0')}`,
      correct: !recent,
      prediction: { predictionProbability: 0.8, sportProfile: 'basketball' }
    };
  });
  const drift = buildDriftReport(rows, { recentSize: 15 }).basketball;
  assert.equal(drift.status, 'degraded');
  assert.ok(drift.penalty >= 0.18);
  assert.ok(drift.recent.brierScore > drift.baseline.brierScore);
});

test('historical rebuild excludes same-day and future caches to prevent leakage', async () => {
  const makeSlate = (dateKey, id) => ({
    schemaVersion: 4,
    games: [{ id, statusKey: 'final', leagueKey: 'nba', sportGroup: 'Basketball', away: { name: 'A', score: 90 }, home: { name: 'H', score: 100 } }],
    predictions: [{
      gameId: id, predictionCorrect: true, eligibleForCalibration: true, predictionMode: 'pregame',
      modelVersion: 'OmniMod Evidence Ensemble v4.0.0', predictionProbability: 0.7,
      sportProfile: 'basketball', factors: [{ label: 'Power', value: 0.2 }]
    }]
  });
  await writeDailyCache('2099-03-01', makeSlate('2099-03-01', 'past'));
  await writeDailyCache('2099-03-02', makeSlate('2099-03-02', 'same'));
  await writeDailyCache('2099-03-03', makeSlate('2099-03-03', 'future'));
  const context = await loadModelContext('', 365, { asOfDateKey: '2099-03-02', intelligence: { teams: {}, players: {}, results: {} } });
  assert.equal(context.cacheCount, 1);
  assert.equal(context.history.rows, 1);
  assert.equal(context.featureLearning.basketball.sampleSize, 1);
});

test('Elo ratings regress toward neutral when a new season begins', () => {
  const older = Array.from({ length: 8 }, (_, index) => ({
    id: `old-${index}`, dateKey: `2098-01-${String(index + 1).padStart(2, '0')}`,
    leagueKey: 'nba', sportGroup: 'Basketball', awayTeam: 'Away', homeTeam: 'Home', awayScore: 90, homeScore: 115,
    seasonYear: 2098
  }));
  const continuation = { id: 'next', dateKey: '2099-01-01', leagueKey: 'nba', sportGroup: 'Basketball', awayTeam: 'Away', homeTeam: 'Home', awayScore: 99, homeScore: 100 };
  const sameSeason = buildEloRatings({}, [], [...older, { ...continuation, seasonYear: 2098 }]);
  const newSeason = buildEloRatings({}, [], [...older, { ...continuation, seasonYear: 2099 }]);
  assert.ok(newSeason.nba__home < sameSeason.nba__home);
  assert.ok(Math.abs(newSeason.nba__home - 1500) < Math.abs(sameSeason.nba__home - 1500));
});
