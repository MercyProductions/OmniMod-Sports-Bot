import path from 'node:path';
import { dataDir } from './config.js';
import { readFeatureWarehouse } from './featureWarehouse.js';
import { normalizeMlFeatureVector } from './localMl.js';
import { blendProbabilityVectors, buildSportModelPrediction } from './sportModels.js';
import { sportProfile } from './sportProfiles.js';
import { writeJson } from './storage.js';
import { scoreOutcome } from './dataValidation.js';

const reportFile = path.join(dataDir, 'historical-replay.json');

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function logistic(value) {
  return 1 / (1 + Math.exp(-clamp(value, -10, 10)));
}

function teamKey(league, team) {
  return `${String(league || '').toLowerCase()}::${String(team || '').toLowerCase().replace(/[^a-z0-9]+/g, '')}`;
}

function stateFor(states, league, team) {
  const key = teamKey(league, team);
  if (!states.has(key)) states.set(key, { elo: 1500, games: 0, scored: 0, allowed: 0, wins: 0 });
  return states.get(key);
}

function vectorFromLogit(modelLogit, profile) {
  const binaryHome = logistic(modelLogit);
  if (profile.twoWay) return { away: 1 - binaryHome, home: binaryHome, draw: 0 };
  const parity = 1 - Math.abs(binaryHome - 0.5) * 2;
  const draw = clamp(profile.baseDrawProbability + parity * 0.035, 0.16, 0.34);
  return { away: (1 - binaryHome) * (1 - draw), home: binaryHome * (1 - draw), draw };
}

function resultSide(row) {
  return scoreOutcome(row.awayScore, row.homeScore);
}

function scoreCandidates(rows) {
  const modelNames = ['evidence', 'hybrid'];
  return Object.fromEntries(modelNames.map((name) => {
    const eligible = rows.filter((row) => row.actualSide && row.candidateProbabilities?.[name]);
    if (!eligible.length) return [name, { sampleSize: 0, brierScore: null, logLoss: null }];
    let brier = 0;
    let logLoss = 0;
    for (const row of eligible) {
      const vector = row.candidateProbabilities[name];
      const sides = row.actualSide === 'draw' || Number(vector.draw) > 0 ? ['away', 'home', 'draw'] : ['away', 'home'];
      brier += sides.reduce((sum, side) => sum + (Number(vector[side] || 0) - Number(side === row.actualSide)) ** 2, 0) / sides.length;
      logLoss += -Math.log(clamp(Number(vector[row.actualSide] || 0), 0.001, 0.999));
    }
    return [name, { sampleSize: eligible.length, brierScore: brier / eligible.length, logLoss: logLoss / eligible.length }];
  }));
}

export function replayHistoricalResults(results = [], options = {}) {
  const maxRows = Math.max(50, Number(options.maxRows) || 8_000);
  const cutoffDateKey = String(options.asOfDateKey || '9999-12-31');
  const sorted = [...results]
    .filter((row) => String(row.dateKey || '').slice(0, 10) < cutoffDateKey && resultSide(row))
    .sort((a, b) => String(a.startTime || a.dateKey).localeCompare(String(b.startTime || b.dateKey)))
    .slice(-maxRows);
  const states = new Map();
  const predictions = [];
  let pendingTime = '';
  let pendingUpdates = [];
  const applyPendingUpdates = () => {
    for (const update of pendingUpdates) {
      const { away, home, row, profile, homeAdvantage } = update;
      const expectedHome = logistic(((home.elo + homeAdvantage - away.elo) * Math.LN10) / 400);
      const actualHome = resultSide(row) === 'draw' ? 0.5 : resultSide(row) === 'home' ? 1 : 0;
      const k = profile.key === 'football' ? 28 : profile.key === 'combat' || profile.key === 'tennis' ? 24 : 18;
      const change = k * (actualHome - expectedHome);
      home.elo += change;
      away.elo -= change;
      home.games += 1;
      away.games += 1;
      home.scored += Number(row.homeScore);
      home.allowed += Number(row.awayScore);
      away.scored += Number(row.awayScore);
      away.allowed += Number(row.homeScore);
      home.wins += actualHome;
      away.wins += 1 - actualHome;
    }
    pendingUpdates = [];
  };
  for (const row of sorted) {
    // Start order does not establish when a result became available. Never
    // feed an earlier-starting same-day game's final into a later kickoff.
    const rowTime = String(row.dateKey || String(row.startTime || '').slice(0, 10));
    if (pendingTime && rowTime !== pendingTime) applyPendingUpdates();
    pendingTime = rowTime;
    const profile = sportProfile({ leagueKey: row.leagueKey, sportGroup: row.sportGroup });
    const away = stateFor(states, row.leagueKey || row.league, row.awayTeam);
    const home = stateFor(states, row.leagueKey || row.league, row.homeTeam);
    const homeAdvantage = row.neutralSite ? 0 : profile.homeAdvantageElo;
    const modelLogit = ((home.elo + homeAdvantage - away.elo) * Math.LN10) / 400;
    const evidence = vectorFromLogit(modelLogit, profile);
    const game = {
      id: row.id,
      league: row.league,
      leagueKey: row.leagueKey,
      sportGroup: row.sportGroup,
      neutralSite: row.neutralSite,
      away: { name: row.awayTeam },
      home: { name: row.homeTeam },
      autoTeamMetrics: {
        away: { sampleSize: away.games, stats: { averageScored: away.games ? away.scored / away.games : null, averageAllowed: away.games ? away.allowed / away.games : null } },
        home: { sampleSize: home.games, stats: { averageScored: home.games ? home.scored / home.games : null, averageAllowed: home.games ? home.allowed / home.games : null } }
      },
      autoPlayers: [],
      autoContext: null
    };
    const specialist = buildSportModelPrediction(game, { modelLogit });
    const hybrid = specialist.available ? blendProbabilityVectors(evidence, specialist.probabilities, 0.38, profile.twoWay) : evidence;
    const awayWinRate = away.games ? away.wins / away.games : 0.5;
    const homeWinRate = home.games ? home.wins / home.games : 0.5;
    const awayScored = away.games ? away.scored / away.games : 0;
    const homeScored = home.games ? home.scored / home.games : 0;
    const awayAllowed = away.games ? away.allowed / away.games : 0;
    const homeAllowed = home.games ? home.allowed / home.games : 0;
    const mlFeatureVector = normalizeMlFeatureVector({
      elo: modelLogit,
      record: homeWinRate - awayWinRate,
      offenseDefense: ((homeScored - awayAllowed) - (awayScored - homeAllowed)) / Math.max(1, profile.key === 'basketball' ? 18 : profile.key === 'football' ? 10 : 3),
      evidenceHome: evidence.home,
      evidenceDraw: evidence.draw,
      specialistHome: specialist.probabilities?.home || evidence.home,
      specialistDraw: specialist.probabilities?.draw || evidence.draw,
      sampleReliability: Math.min(away.games, home.games) / (Math.min(away.games, home.games) + 12),
      sourceQuality: Math.min(away.games, home.games) / 30
    });
    if (away.games >= 2 && home.games >= 2) {
      predictions.push({
        dateKey: String(row.dateKey || '').slice(0, 10),
        startTime: row.startTime || `${row.dateKey}T12:00:00Z`,
        gameId: String(row.id || `${row.dateKey}:${row.awayTeam}:${row.homeTeam}`),
        leagueKey: row.leagueKey,
        sport: profile.key,
        actualSide: resultSide(row),
        priorAwayGames: away.games,
        priorHomeGames: home.games,
        candidateProbabilities: { evidence, hybrid, specialist: specialist.probabilities },
        mlFeatureVector,
        source: 'historical-replay'
      });
    }

    // Conservative prior-date research boundary; true available-at times are
    // still missing, so this replay is not prospective promotion evidence.
    pendingUpdates.push({ away, home, row, profile, homeAdvantage });
  }
  applyPendingUpdates();
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    asOfDateKey: cutoffDateKey,
    resultCount: sorted.length,
    predictionCount: predictions.length,
    timeIntegrity: 'Only earlier dateKey results are used. Actual historical result-availability times remain unverified; research replay is not prospective promotion evidence.',
    overall: scoreCandidates(predictions),
    sports: Object.fromEntries([...new Set(predictions.map((row) => row.sport))].map((sport) => [sport, scoreCandidates(predictions.filter((row) => row.sport === sport))])),
    predictions
  };
}

export async function runHistoricalReplay(options = {}) {
  const warehouse = await readFeatureWarehouse();
  const report = replayHistoricalResults(warehouse.results, options);
  await writeJson(reportFile, report, { compact: true, backup: true, mode: 0o600 });
  return report;
}

export { reportFile as historicalReplayFile };
