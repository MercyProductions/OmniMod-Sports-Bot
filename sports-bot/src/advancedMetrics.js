import { normalizeEntityName } from './intelligenceStore.js';
import { sportProfile } from './sportProfiles.js';
import { buildPlayByPlayEvidence } from './playByPlay.js';
import { attachParticipationProjections, summarizeTeamParticipation } from './participationProjection.js';
import { extractEventEnvironment } from './sourceIntelligence.js';
import { finiteNumber } from './dataValidation.js';

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function finite(value, fallback = null) {
  return finiteNumber(value, fallback);
}

function mean(values) {
  const clean = values.filter(Number.isFinite);
  return clean.length ? clean.reduce((total, value) => total + value, 0) / clean.length : 0;
}

function standardDeviation(values) {
  const clean = values.filter(Number.isFinite);
  if (clean.length < 2) return 1;
  const average = mean(clean);
  return Math.max(0.01, Math.sqrt(mean(clean.map((value) => (value - average) ** 2))));
}

function statKey(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function parseClock(value) {
  const match = String(value || '').match(/^(\d+):(\d{2})$/);
  return match ? Number(match[1]) + Number(match[2]) / 60 : null;
}

function addStat(target, rawName, rawValue) {
  const key = statKey(rawName);
  if (!key) return;
  if (typeof rawValue === 'number' && Number.isFinite(rawValue)) {
    target[key] = rawValue;
    return;
  }
  const text = String(rawValue ?? '').trim();
  // Baseball innings use .1/.2 to mean one/two outs, not decimal tenths.
  // Normalize before generic numeric parsing so pitcher workload is accurate.
  if (['ip', 'inningspitched'].includes(key) && /^\d+\.[012]$/.test(text)) {
    const [innings, outs] = text.split('.').map(Number);
    target[key] = innings + outs / 3;
    return;
  }
  const clock = parseClock(text);
  if (clock !== null) {
    target[key] = clock;
    return;
  }
  const pair = text.match(/^(-?\d+(?:\.\d+)?)\s*[-/]\s*(-?\d+(?:\.\d+)?)$/);
  if (pair) {
    const first = Number(pair[1]);
    const second = Number(pair[2]);
    target[`${key}made`] = first;
    target[`${key}attempted`] = second;
    target[key] = second ? first / second : 0;
    return;
  }
  const number = Number.parseFloat(text.replace(/[%,$]/g, ''));
  if (Number.isFinite(number)) target[key] = number;
}

function statMap(rows = []) {
  const output = {};
  for (const row of rows || []) {
    if (Array.isArray(row?.stats)) {
      Object.assign(output, statMap(row.stats));
      continue;
    }
    addStat(output, row?.name || row?.abbreviation || row?.label, row?.value ?? row?.displayValue);
  }
  return output;
}

function athleteStatMap(group, athleteRow) {
  const names = group?.names?.length ? group.names : group?.labels || [];
  const output = {};
  for (let index = 0; index < names.length; index += 1) addStat(output, names[index], athleteRow?.stats?.[index]);
  return output;
}

function metric(stats, ...names) {
  return optionalMetric(stats, ...names) ?? 0;
}

function optionalMetric(stats, ...names) {
  for (const name of names) {
    const value = finite(stats?.[statKey(name)]);
    if (value !== null) return value;
  }
  return null;
}

function teamKey(league, team) {
  return `${normalizeEntityName(league)}__${normalizeEntityName(team)}`;
}

function playerKey(league, team, id, name) {
  return `${normalizeEntityName(league)}__${normalizeEntityName(team)}__${id || normalizeEntityName(name)}`;
}

function performanceScore(profileKey, groupName, stats) {
  const group = String(groupName || '').toLowerCase();
  if (profileKey === 'basketball') {
    return clamp(
      metric(stats, 'PTS', 'points') * 0.11 + metric(stats, 'REB', 'rebounds') * 0.055 +
      metric(stats, 'AST', 'assists') * 0.075 + metric(stats, 'STL', 'steals') * 0.18 +
      metric(stats, 'BLK', 'blocks') * 0.16 - metric(stats, 'TO', 'turnovers') * 0.09 +
      metric(stats, '+/-', 'plusMinus') * 0.025,
      -2, 7
    );
  }
  if (profileKey === 'baseball') {
    if (/pitch/.test(group)) {
      return clamp(
        metric(stats, 'IP', 'inningsPitched') * 0.32 + metric(stats, 'K', 'strikeouts') * 0.11 -
        metric(stats, 'ER', 'earnedRuns') * 0.34 - metric(stats, 'BB', 'walks') * 0.08 -
        metric(stats, 'HR', 'homeRuns') * 0.18,
        -2, 6
      );
    }
    return clamp(
      metric(stats, 'TB', 'totalBases') * 0.19 + metric(stats, 'RBI', 'RBIs') * 0.13 +
      metric(stats, 'BB', 'walks') * 0.09 + metric(stats, 'HR', 'homeRuns') * 0.28 -
      metric(stats, 'K', 'strikeouts') * 0.045,
      -1.5, 5
    );
  }
  if (profileKey === 'football') {
    return clamp(
      metric(stats, 'YDS', 'passingYards', 'rushingYards', 'receivingYards') * 0.006 +
      metric(stats, 'TD', 'passingTouchdowns', 'rushingTouchdowns', 'receivingTouchdowns') * 0.48 -
      metric(stats, 'INT', 'interceptions') * 0.5 + metric(stats, 'SACKS', 'sacks') * 0.22 +
      metric(stats, 'QBR') * 0.012,
      -2, 7
    );
  }
  if (profileKey === 'hockey') {
    if (/goalie/.test(group)) {
      return clamp((metric(stats, 'SV%', 'savePct') - 0.9) * 22 + metric(stats, 'SV', 'saves') * 0.025, -2, 5);
    }
    return clamp(
      metric(stats, 'G', 'goals') * 1.15 + metric(stats, 'A', 'assists') * 0.65 +
      metric(stats, 'S', 'shots') * 0.07 + metric(stats, '+/-', 'plusMinus') * 0.12 +
      metric(stats, 'TK', 'takeaways') * 0.06 - metric(stats, 'GV', 'giveaways') * 0.05,
      -2, 6
    );
  }
  if (profileKey === 'soccer') {
    return clamp(
      metric(stats, 'goals', 'G') * 1.35 + metric(stats, 'assists', 'A') * 0.72 +
      metric(stats, 'shotsOnTarget') * 0.1 + (metric(stats, 'rating') - 6.5) * 0.35,
      -2, 6
    );
  }
  if (profileKey === 'tennis') return clamp(metric(stats, 'aces') * 0.08 - metric(stats, 'doubleFaults') * 0.08, -2, 5);
  if (profileKey === 'combat') return clamp(metric(stats, 'significantStrikes') * 0.025 + metric(stats, 'takedowns') * 0.18, -2, 5);
  return 0;
}

function participationScore(profileKey, groupName, stats, starter) {
  const group = String(groupName || '').toLowerCase();
  if (profileKey === 'basketball') return clamp(metric(stats, 'MIN', 'minutes') / 40, 0.08, 1);
  if (profileKey === 'baseball') {
    if (/pitch/.test(group)) return clamp(metric(stats, 'IP', 'inningsPitched') / 6, 0.08, 1);
    return clamp(metric(stats, 'AB', 'atBats', 'PA', 'plateAppearances') / 4.5, 0.08, 1);
  }
  if (profileKey === 'football') {
    const opportunities = metric(stats, 'cattattempted', 'ATT', 'attempts') + metric(stats, 'REC', 'receptions') + metric(stats, 'TACKLES', 'totalTackles');
    return clamp((starter ? 0.65 : 0.2) + Math.min(0.35, opportunities / 80), 0.08, 1);
  }
  if (profileKey === 'hockey') return clamp(metric(stats, 'TOI', 'minutes') / (/goalie/.test(group) ? 60 : 22), 0.08, 1);
  if (profileKey === 'soccer') return clamp(metric(stats, 'MIN', 'minutes') / 90 || (starter ? 0.85 : 0.3), 0.08, 1);
  return starter ? 0.85 : 0.35;
}

function mergePlayerRow(map, row) {
  const key = `${normalizeEntityName(row.team)}__${row.athleteId || normalizeEntityName(row.name)}`;
  const existing = map.get(key);
  if (!existing) {
    map.set(key, row);
    return;
  }
  map.set(key, {
    ...existing,
    ...row,
    starter: existing.starter || row.starter,
    active: existing.active !== false && row.active !== false,
    appeared: existing.appeared || row.appeared,
    stats: { ...existing.stats, ...row.stats },
    role: row.role || existing.role
  });
}

export function parseHistoricalEventSummary(summary, result, sourceMeta = {}) {
  const profile = sportProfile(result);
  const teams = {};
  for (const row of summary?.boxscore?.teams || []) {
    const name = row.team?.displayName || row.team?.name || '';
    if (name) teams[normalizeEntityName(name)] = { name, stats: statMap(row.statistics || []) };
  }

  const playerMap = new Map();
  for (const teamGroup of summary?.boxscore?.players || []) {
    const team = teamGroup.team?.displayName || teamGroup.team?.name || '';
    for (const group of teamGroup.statistics || []) {
      for (const athleteRow of group.athletes || []) {
        const athlete = athleteRow.athlete || {};
        const name = athlete.displayName || athlete.fullName || athlete.shortName || '';
        if (!team || !name) continue;
        const stats = athleteStatMap(group, athleteRow);
        const role = athlete.position?.displayName || athlete.position?.name || athlete.position?.abbreviation || group.displayName || group.name || '';
        mergePlayerRow(playerMap, {
          athleteId: String(athlete.id || ''), name, team, role,
          starter: Boolean(athleteRow.starter), active: athleteRow.active !== false,
          appeared: Boolean(athleteRow.starter || Object.keys(stats).length),
          stats, groupName: group.name || group.displayName || role
        });
      }
    }
  }

  // Soccer and baseball commonly expose the authoritative lineup in rosters
  // rather than boxscore.players. Merge it without duplicating athletes.
  for (const group of summary?.rosters || []) {
    const team = group.team?.displayName || group.team?.name || '';
    for (const rosterRow of group.roster || []) {
      const athlete = rosterRow.athlete || {};
      const name = athlete.displayName || athlete.fullName || athlete.shortName || '';
      if (!team || !name) continue;
      const stats = statMap(rosterRow.stats || []);
      mergePlayerRow(playerMap, {
        athleteId: String(athlete.id || ''), name, team,
        role: rosterRow.position?.displayName || rosterRow.position?.name || rosterRow.position?.abbreviation || athlete.position?.displayName || '',
        starter: Boolean(rosterRow.starter), active: rosterRow.active !== false,
        appeared: Boolean(rosterRow.starter || Object.keys(stats).length),
        stats, groupName: rosterRow.position?.displayName || ''
      });
    }
  }

  const players = [...playerMap.values()].map((row) => ({
    ...row,
    gameId: result.id,
    dateKey: result.dateKey,
    league: result.league,
    leagueKey: result.leagueKey,
    sportGroup: result.sportGroup,
    participation: participationScore(profile.key, row.groupName || row.role, row.stats, row.starter),
    performance: performanceScore(profile.key, row.groupName || row.role, row.stats),
    source: 'ESPN historical box score'
  }));
  const plays = Array.isArray(summary?.plays) ? summary.plays : [];
  const playByPlay = buildPlayByPlayEvidence(plays, result);
  const environment = extractEventEnvironment(summary);

  return {
    gameId: result.id,
    dateKey: result.dateKey,
    startTime: result.startTime,
    league: result.league,
    leagueKey: result.leagueKey,
    sportGroup: result.sportGroup,
    awayTeam: result.awayTeam,
    homeTeam: result.homeTeam,
    awayScore: result.awayScore,
    homeScore: result.homeScore,
    teams,
    players,
    plays,
    playByPlay,
    officials: environment.officials,
    environment,
    sourceMeta: { fetchedAt: sourceMeta.fetchedAt || '', cacheState: sourceMeta.cacheState || 'unknown' }
  };
}

function criticalRoleBonus(profile, role) {
  const normalized = String(role || '').toLowerCase();
  return profile.importantRoles.some((item) => normalized.includes(item)) ? 0.8 : 0;
}

export function buildAutomaticPlayerProfiles(samples = []) {
  const appearances = samples.flatMap((sample) => sample.players || []).filter((row) => row.appeared !== false);
  const groups = new Map();
  for (const row of appearances) {
    const key = playerKey(row.leagueKey || row.league, row.team, row.athleteId, row.name);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  const profiles = {};
  for (const [key, rows] of groups) {
    rows.sort((a, b) => String(a.dateKey).localeCompare(String(b.dateKey)));
    const latest = rows.at(-1);
    const recent = rows.slice(-5);
    const participation = mean(rows.map((row) => row.participation));
    const performance = mean(rows.map((row) => row.performance));
    const recentPerformance = mean(recent.map((row) => row.performance));
    const starterRate = mean(rows.map((row) => row.starter ? 1 : 0));
    const reliability = rows.length / (rows.length + 3);
    const profile = sportProfile(latest);
    const rawImpact = 0.8 + participation * 3.7 + starterRate * 1.1 + clamp(performance, -1, 5) * 0.3 + criticalRoleBonus(profile, latest.role);
    const impact = clamp(1.1 + (rawImpact - 1.1) * (0.4 + reliability * 0.6), 0.6, 8.5);
    profiles[key] = {
      id: `auto-player__${key}`,
      athleteId: latest.athleteId,
      name: latest.name,
      team: latest.team,
      league: latest.league,
      leagueKey: latest.leagueKey,
      role: latest.role,
      impact,
      form: clamp(50 + (recentPerformance - performance) * 6, 28, 76),
      starter: starterRate >= 0.5,
      starterRate,
      participation,
      performance,
      sampleSize: rows.length,
      lastSeen: latest.dateKey,
      autoGenerated: true,
      source: 'ESPN cached historical box scores',
      updatedAt: latest.dateKey
    };
  }

  // Learn a deliberately small pair-level residual for players who start
  // together. The team baseline is removed first and sparse pairs are heavily
  // shrunk, so ordinary team strength is not relabeled as "chemistry".
  const teamGames = new Map();
  const pairGames = new Map();
  const marginScale = { baseball: 3, basketball: 12, football: 10, hockey: 2, soccer: 1.4, tennis: 1, combat: 1 };
  for (const sample of samples) {
    const profile = sportProfile(sample);
    for (const side of ['away', 'home']) {
      const team = sample[`${side}Team`];
      const ownScore = finite(sample[`${side}Score`]);
      const opponentScore = finite(sample[side === 'away' ? 'homeScore' : 'awayScore']);
      if (!team || ownScore === null || opponentScore === null) continue;
      const resultValue = Math.tanh((ownScore - opponentScore) / (marginScale[profile.key] || 5));
      const teamId = teamKey(sample.leagueKey || sample.league, team);
      if (!teamGames.has(teamId)) teamGames.set(teamId, []);
      teamGames.get(teamId).push(resultValue);
      const starters = (sample.players || [])
        .filter((row) => normalizeEntityName(row.team) === normalizeEntityName(team) && row.starter && row.active !== false)
        .map((row) => playerKey(row.leagueKey || row.league, row.team, row.athleteId, row.name))
        .filter((key) => profiles[key]);
      for (let left = 0; left < starters.length; left += 1) {
        for (let right = left + 1; right < starters.length; right += 1) {
          const pair = [starters[left], starters[right]].sort();
          const pairId = `${pair[0]}|||${pair[1]}`;
          if (!pairGames.has(pairId)) pairGames.set(pairId, { teamId, left: pair[0], right: pair[1], values: [] });
          pairGames.get(pairId).values.push(resultValue);
        }
      }
    }
  }
  for (const pair of pairGames.values()) {
    const teamBaseline = mean(teamGames.get(pair.teamId) || []);
    const pairAverage = mean(pair.values);
    const reliability = pair.values.length / (pair.values.length + 6);
    const score = clamp((pairAverage - teamBaseline) * reliability, -0.35, 0.35);
    for (const [profileKeyValue, teammateKey] of [[pair.left, pair.right], [pair.right, pair.left]]) {
      const player = profiles[profileKeyValue];
      const teammate = profiles[teammateKey];
      if (!player || !teammate) continue;
      player.teammateInteractions ||= {};
      player.teammateInteractions[teammate.athleteId || normalizeEntityName(teammate.name)] = {
        name: teammate.name,
        score,
        sampleSize: pair.values.length
      };
    }
  }
  return profiles;
}

function resultTeamRows(results) {
  const byLeague = new Map();
  for (const result of results) {
    const league = result.leagueKey || result.league;
    if (!byLeague.has(league)) byLeague.set(league, []);
    byLeague.get(league).push(result);
  }
  return byLeague;
}

function opponentAdjustedRatings(results) {
  const output = new Map();
  for (const [league, rows] of resultTeamRows(results)) {
    const gamesByTeam = new Map();
    const ensure = (name) => {
      const key = normalizeEntityName(name);
      if (!gamesByTeam.has(key)) gamesByTeam.set(key, []);
      return key;
    };
    const homeMargins = rows.map((row) => Number(row.homeScore) - Number(row.awayScore)).filter(Number.isFinite);
    const observedHomeEdge = mean(homeMargins);
    for (const row of rows) {
      const away = ensure(row.awayTeam);
      const home = ensure(row.homeTeam);
      const margin = Number(row.homeScore) - Number(row.awayScore);
      if (!Number.isFinite(margin)) continue;
      gamesByTeam.get(home).push({ opponent: away, margin: margin - (row.neutralSite ? 0 : observedHomeEdge) });
      gamesByTeam.get(away).push({ opponent: home, margin: -margin + (row.neutralSite ? 0 : observedHomeEdge) });
    }
    let ratings = new Map([...gamesByTeam.keys()].map((key) => [key, 0]));
    for (let iteration = 0; iteration < 10; iteration += 1) {
      const next = new Map();
      for (const [team, games] of gamesByTeam) next.set(team, mean(games.map((game) => game.margin + (ratings.get(game.opponent) || 0))));
      const center = mean([...next.values()]);
      ratings = new Map([...next].map(([team, value]) => [team, value - center]));
    }
    const ratingValues = [...ratings.values()];
    const ratingSd = standardDeviation(ratingValues);
    const schedules = new Map([...gamesByTeam].map(([team, games]) => [team, mean(games.map((game) => ratings.get(game.opponent) || 0))]));
    const scheduleSd = standardDeviation([...schedules.values()]);
    for (const team of gamesByTeam.keys()) {
      output.set(teamKey(league, team), {
        rating: clamp(50 + (ratings.get(team) / ratingSd) * 10, 22, 78),
        scheduleStrength: clamp(50 + ((schedules.get(team) || 0) / scheduleSd) * 10, 22, 78),
        rawRating: ratings.get(team),
        sampleSize: gamesByTeam.get(team).length
      });
    }
  }
  return output;
}

function advancedOffense(profileKey, stats, score) {
  if (profileKey === 'basketball') {
    const possessions = metric(stats, 'fieldGoalsAttempted', 'fieldGoalsMadefieldGoalsAttemptedattempted') +
      0.44 * metric(stats, 'freeThrowsAttempted', 'freeThrowsMadefreeThrowsAttemptedattempted') -
      metric(stats, 'offensiveRebounds') + metric(stats, 'turnovers');
    return possessions > 20 ? (score / possessions) * 100 : score;
  }
  if (profileKey === 'football') return metric(stats, 'yardsPerPlay') * 7 + metric(stats, 'thirdDownPct') * 0.12 - metric(stats, 'turnovers') * 4 + score;
  if (profileKey === 'baseball') {
    const appearances = metric(stats, 'plateAppearances') || metric(stats, 'atBats') || 1;
    return score * 2 + (metric(stats, 'totalBases') + metric(stats, 'walks') * 0.7) / appearances * 10;
  }
  if (profileKey === 'hockey') return score * 4 + metric(stats, 'shotsTotal') * 0.18 + metric(stats, 'powerPlayPct') * 0.025;
  if (profileKey === 'soccer') return score * 4 + metric(stats, 'shotsOnTarget') * 0.6 + metric(stats, 'totalShots') * 0.12 + metric(stats, 'expectedGoals', 'xg') * 1.5;
  return score;
}

function specializedTeamMetrics(profileKey, stats, score, opponentScore, playByPlay = null) {
  const playMetrics = playByPlay ? {
    playValue: finite(playByPlay.playValuePerEvent),
    playSuccessRate: finite(playByPlay.successRate),
    playTurnoverRate: finite(playByPlay.turnoverRate),
    playExplosiveRate: finite(playByPlay.explosiveRate),
    playPressureRate: finite(playByPlay.pressureRate),
    playShotQuality: finite(playByPlay.shotQuality),
    playPossessionShare: finite(playByPlay.possessionShare),
    playByPlay: {
      events: playByPlay.events || 0,
      successRate: finite(playByPlay.successRate),
      turnoverRate: finite(playByPlay.turnoverRate),
      explosiveRate: finite(playByPlay.explosiveRate),
      pressureRate: finite(playByPlay.pressureRate),
      shotQuality: finite(playByPlay.shotQuality),
      playValuePerEvent: finite(playByPlay.playValuePerEvent)
    }
  } : {};
  if (profileKey === 'basketball') {
    const possessions = metric(stats, 'fieldGoalsAttempted') + 0.44 * metric(stats, 'freeThrowsAttempted') - metric(stats, 'offensiveRebounds') + metric(stats, 'turnovers');
    return {
      ...playMetrics,
      possessions: possessions > 20 ? possessions : null,
      offensiveEfficiency: possessions > 20 ? (score / possessions) * 100 : null,
      turnoverRate: possessions > 20 ? metric(stats, 'turnovers') / possessions : null
    };
  }
  if (profileKey === 'football') {
    const yardsPerPlay = metric(stats, 'yardsPerPlay');
    const thirdDownPct = metric(stats, 'thirdDownPct', 'thirdDownEfficiencyPct');
    const turnovers = metric(stats, 'turnovers');
    return {
      ...playMetrics,
      yardsPerPlay: yardsPerPlay || null,
      epaProxy: yardsPerPlay ? yardsPerPlay * 0.075 + thirdDownPct * 0.003 - turnovers * 0.12 : null,
      driveEfficiency: score / Math.max(6, metric(stats, 'totalDrives') || 10)
    };
  }
  if (profileKey === 'hockey') {
    const shots = metric(stats, 'shotsTotal', 'shots');
    const powerPlayPct = metric(stats, 'powerPlayPct');
    return {
      ...playMetrics,
      shotVolume: shots || null,
      expectedGoalsProxy: shots ? shots * (0.082 + clamp(powerPlayPct / 100, 0, 0.5) * 0.035) : score,
      goalPreventionProxy: -opponentScore
    };
  }
  if (profileKey === 'soccer') {
    const directXg = optionalMetric(stats, 'expectedGoals', 'xg');
    const shotsOnTarget = optionalMetric(stats, 'shotsOnTarget');
    const shots = optionalMetric(stats, 'totalShots');
    const proxy = shotsOnTarget !== null || shots !== null
      ? (shotsOnTarget || 0) * 0.24 + Math.max(0, (shots || 0) - (shotsOnTarget || 0)) * 0.055 : null;
    const expectedGoals = directXg ?? proxy;
    return {
      ...playMetrics,
      expectedGoals,
      reportedXgCoverage: directXg !== null ? 1 : 0,
      shotProxyCoverage: directXg === null && proxy !== null ? 1 : 0,
      shotsOnTarget,
      shotQuality: shots > 0 && expectedGoals !== null ? expectedGoals / shots : null
    };
  }
  if (profileKey === 'baseball') {
    const plateAppearances = metric(stats, 'plateAppearances') || metric(stats, 'atBats');
    return {
      ...playMetrics,
      expectedRunsProxy: plateAppearances ? score * 0.55 + ((metric(stats, 'totalBases') + metric(stats, 'walks') * 0.7) / plateAppearances) * 5 : score,
      bullpenRunsAllowedProxy: opponentScore
    };
  }
  return playMetrics;
}

function advancedTeamRatings(samples) {
  const rows = [];
  for (const sample of samples) {
    const awayStats = sample.teams?.[normalizeEntityName(sample.awayTeam)]?.stats || {};
    const homeStats = sample.teams?.[normalizeEntityName(sample.homeTeam)]?.stats || {};
    const profile = sportProfile(sample);
    const awayOffense = advancedOffense(profile.key, awayStats, Number(sample.awayScore));
    const homeOffense = advancedOffense(profile.key, homeStats, Number(sample.homeScore));
    rows.push({ league: sample.leagueKey || sample.league, team: sample.awayTeam, offense: awayOffense, defense: -homeOffense, metrics: specializedTeamMetrics(profile.key, awayStats, Number(sample.awayScore), Number(sample.homeScore), sample.playByPlay?.away) });
    rows.push({ league: sample.leagueKey || sample.league, team: sample.homeTeam, offense: homeOffense, defense: -awayOffense, metrics: specializedTeamMetrics(profile.key, homeStats, Number(sample.homeScore), Number(sample.awayScore), sample.playByPlay?.home) });
  }
  const groups = new Map();
  for (const row of rows) {
    const key = teamKey(row.league, row.team);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  const byLeague = new Map();
  for (const [key, teamRows] of groups) {
    const metricNames = [...new Set(teamRows.flatMap((row) => Object.keys(row.metrics || {})))].filter((name) => name !== 'playByPlay');
    const metrics = Object.fromEntries(metricNames.map((name) => {
      const values = teamRows.map((row) => finite(row.metrics?.[name])).filter((value) => value !== null);
      return [name, values.length ? mean(values) : null];
    }));
    if (teamRows.some((row) => row.metrics?.playByPlay)) {
      metrics.playByPlay = {
        sampleSize: teamRows.filter((row) => row.metrics?.playByPlay).length,
        events: Math.round(mean(teamRows.map((row) => finite(row.metrics?.playByPlay?.events)).filter((value) => value !== null))),
        successRate: metrics.playSuccessRate,
        turnoverRate: metrics.playTurnoverRate,
        explosiveRate: metrics.playExplosiveRate,
        pressureRate: metrics.playPressureRate,
        shotQuality: metrics.playShotQuality,
        playValuePerEvent: metrics.playValue
      };
    }
    const summary = { key, league: teamRows[0].league, offense: mean(teamRows.map((row) => row.offense)), defense: mean(teamRows.map((row) => row.defense)), metrics, sampleSize: teamRows.length };
    if (!byLeague.has(summary.league)) byLeague.set(summary.league, []);
    byLeague.get(summary.league).push(summary);
  }
  const output = new Map();
  for (const summaries of byLeague.values()) {
    const offenseMean = mean(summaries.map((row) => row.offense));
    const defenseMean = mean(summaries.map((row) => row.defense));
    const offenseSd = standardDeviation(summaries.map((row) => row.offense));
    const defenseSd = standardDeviation(summaries.map((row) => row.defense));
    for (const row of summaries) {
      const reliability = row.sampleSize / (row.sampleSize + 4);
      const offense = 50 + ((row.offense - offenseMean) / offenseSd) * 10 * reliability;
      const defense = 50 + ((row.defense - defenseMean) / defenseSd) * 10 * reliability;
      output.set(row.key, {
        offense: clamp(offense, 25, 75), defense: clamp(defense, 25, 75),
        rating: clamp((offense + defense) / 2, 25, 75), metrics: row.metrics, sampleSize: row.sampleSize
      });
    }
  }
  return output;
}

export function enhanceTeamProfiles(teamProfiles = {}, results = [], samples = []) {
  const opponentRatings = opponentAdjustedRatings(results);
  const advancedRatings = advancedTeamRatings(samples);
  for (const profile of Object.values(teamProfiles)) {
    const key = teamKey(profile.leagueKey || profile.league, profile.name);
    const opponent = opponentRatings.get(key);
    const advanced = advancedRatings.get(key);
    if (opponent) {
      profile.opponentAdjustedRating = opponent.rating;
      profile.scheduleStrength = opponent.scheduleStrength;
      profile.powerRating = clamp(profile.powerRating * 0.74 + opponent.rating * 0.26, 20, 80);
      profile.stats = { ...profile.stats, opponentAdjustedSample: opponent.sampleSize, scheduleStrength: opponent.scheduleStrength };
    }
    if (advanced) {
      profile.advancedOffense = advanced.offense;
      profile.advancedDefense = advanced.defense;
      profile.advancedRating = advanced.rating;
      profile.advancedMetrics = advanced.metrics;
      profile.offense = clamp(profile.offense * 0.84 + advanced.offense * 0.16, 20, 80);
      profile.defense = clamp(profile.defense * 0.84 + advanced.defense * 0.16, 20, 80);
      profile.stats = { ...profile.stats, advancedBoxscoreSample: advanced.sampleSize };
    }
  }
  return teamProfiles;
}

function matchesTeam(team, value) {
  const target = normalizeEntityName(value);
  return [team?.name, team?.abbr].map(normalizeEntityName).filter(Boolean).some((name) => name === target || (name.length >= 5 && target.includes(name)) || (target.length >= 5 && name.includes(target)));
}

function findPlayerProfile(profiles, game, team, player) {
  const league = normalizeEntityName(game.leagueKey || game.league);
  const teamName = normalizeEntityName(team?.name);
  const id = String(player.athleteId || player.sourceAthleteId || '');
  const name = normalizeEntityName(player.name);
  return Object.values(profiles).find((row) =>
    normalizeEntityName(row.leagueKey || row.league) === league &&
    normalizeEntityName(row.team) === teamName &&
    ((id && String(row.athleteId) === id) || normalizeEntityName(row.name) === name)
  ) || null;
}

function expectedStarterCount(profileKey) {
  return { baseball: 9, basketball: 5, football: 11, hockey: 6, soccer: 11, tennis: 1, combat: 1 }[profileKey] || 5;
}

export function applyPlayerProfilesAndLineups(games = [], playerProfiles = {}) {
  let learnedInjuries = 0;
  let confirmedLineups = 0;
  for (const game of games) {
    for (const player of game.autoPlayers || []) {
      const team = matchesTeam(game.away, player.team) ? game.away : matchesTeam(game.home, player.team) ? game.home : null;
      const learned = team ? findPlayerProfile(playerProfiles, game, team, player) : null;
      if (!learned) continue;
      player.impact = learned.impact;
      player.form = learned.form;
      player.stats = { ...(player.stats || {}), historicalBoxscoreGames: learned.sampleSize, historicalParticipation: learned.participation };
      player.valueSource = learned.source;
      learnedInjuries += player.availability < 100 ? 1 : 0;
    }

    const profile = sportProfile(game);
    const participationProjections = attachParticipationProjections(game, playerProfiles, (row) => {
      const team = matchesTeam(game.away, row.team) ? game.away : matchesTeam(game.home, row.team) ? game.home : null;
      return team ? findPlayerProfile(playerProfiles, game, team, row) : null;
    });
    game.participationSummary = {
      away: summarizeTeamParticipation(participationProjections, game.away?.name),
      home: summarizeTeamParticipation(participationProjections, game.home?.name)
    };
    const required = expectedStarterCount(profile.key);
    const sides = {};
    for (const side of ['away', 'home']) {
      const team = game[side];
      const lineupRows = (game.autoLineups || []).filter((row) => matchesTeam(team, row.team));
      const starters = lineupRows.filter((row) => row.starter && row.active !== false);
      const teamProfiles = Object.values(playerProfiles)
        .filter((row) => normalizeEntityName(row.leagueKey || row.league) === normalizeEntityName(game.leagueKey || game.league) && normalizeEntityName(row.team) === normalizeEntityName(team.name))
        .sort((a, b) => b.impact * (0.6 + b.starterRate * 0.4) - a.impact * (0.6 + a.starterRate * 0.4));
      const expected = teamProfiles.slice(0, required);
      const matched = starters.map((row) => ({ row, profile: findPlayerProfile(playerProfiles, game, team, row) })).filter((row) => row.profile);
      const activeRoster = lineupRows.filter((row) => row.active !== false);
      const learnedRosterCount = activeRoster.filter((row) => findPlayerProfile(playerProfiles, game, team, row)).length;
      const learnedRosterCoverage = activeRoster.length ? learnedRosterCount / activeRoster.length : 0;
      const rosterHistorySufficient = teamProfiles.length >= required && activeRoster.length >= required;
      const rosterTransitionRisk = rosterHistorySufficient ? clamp((1 - learnedRosterCoverage) * 0.75, 0, 0.75) : 0;
      const confirmed = starters.length >= required;
      if (confirmed) confirmedLineups += 1;
      const expectedValue = expected.reduce((total, row) => total + row.impact, 0);
      const currentValue = matched.reduce((total, row) => total + row.profile.impact * (0.85 + row.profile.form / 330), 0);
      const coverage = clamp(starters.length / required, 0, 1);
      const learnedCoverage = starters.length ? matched.length / starters.length : 0;
      const continuity = matched.length ? mean(matched.map((row) => row.profile.starterRate)) : null;
      const pairScores = [];
      const possiblePairs = matched.length * (matched.length - 1) / 2;
      for (let left = 0; left < matched.length; left += 1) {
        for (let right = left + 1; right < matched.length; right += 1) {
          const teammate = matched[right].profile;
          const interaction = matched[left].profile.teammateInteractions?.[teammate.athleteId || normalizeEntityName(teammate.name)] ||
            teammate.teammateInteractions?.[matched[left].profile.athleteId || normalizeEntityName(matched[left].profile.name)];
          if (interaction && Number.isFinite(Number(interaction.score))) pairScores.push(Number(interaction.score));
        }
      }
      const interactionScore = pairScores.length ? mean(pairScores) : 0;
      const interactionRating = clamp(50 + interactionScore * 20, 43, 57);
      const lineupRatingBase = confirmed && expectedValue > 0
        ? clamp(50 + ((currentValue - expectedValue) / expectedValue) * 32, 30, 70)
        : 50;
      const lineupRating = clamp(lineupRatingBase + (interactionRating - 50) * 0.55, 30, 70);
      const criticalPlayers = (game.autoPlayers || []).filter((row) => matchesTeam(team, row.team) && row.starter && row.availability >= 80);
      const criticalForm = criticalPlayers.length ? mean(criticalPlayers.map((row) => finite(row.form, 50))) : 50;
      sides[side] = {
        confirmed,
        starterCount: starters.length,
        expectedStarterCount: required,
        coverage,
        learnedCoverage,
        rosterCount: activeRoster.length,
        learnedRosterCoverage,
        rosterTransitionRisk,
        continuity,
        pairCoverage: possiblePairs ? pairScores.length / possiblePairs : 0,
        interactionRating,
        lineupRating,
        criticalStarterCount: criticalPlayers.length,
        criticalForm,
        source: 'ESPN current roster/probables + cached historical box scores and starter-pair residuals'
      };
    }
    game.autoLineup = {
      away: sides.away,
      home: sides.home,
      ratingDifference: (sides.home.lineupRating - sides.away.lineupRating) + (sides.home.criticalForm - sides.away.criticalForm) * 0.18,
      confirmedSides: Number(sides.away.confirmed) + Number(sides.home.confirmed),
      rosterTransitionRisk: Math.max(sides.away.rosterTransitionRisk, sides.home.rosterTransitionRisk)
    };
  }
  return { games, learnedInjuries, confirmedLineups };
}
