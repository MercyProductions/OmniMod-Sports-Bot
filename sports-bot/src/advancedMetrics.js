import { isConfirmedStarter } from './evidenceCoverage.js';
import { normalizeEntityName } from './intelligenceStore.js';
import { sportProfile } from './sportProfiles.js';
import { buildPlayByPlayEvidence } from './playByPlay.js';
import { attachParticipationProjections, samePlayerIdentity, summarizeTeamParticipation, roleParticipationPrior, basketballWorkloadBasis } from './participationProjection.js';
import { extractEventEnvironment } from './sourceIntelligence.js';
import { finiteNumber, hasAvailabilityObservation, validScore, measuredCalculation } from './dataValidation.js';
import { reconcilePlayerEvidence } from './playerEvidence.js';

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
  const text = String(value || '').trim().toLowerCase();
  return text === '+/-' ? 'plusminus' : text.replaceAll('%', 'pct').replace(/[^a-z0-9]+/g, '');
}

function parseClock(value) {
  const match = String(value || '').match(/^(\d+):(\d{2})$/);
  return match && Number(match[2]) < 60 ? Number(match[1]) + Number(match[2]) / 60 : null;
}

function addStat(target, rawName, rawValue) {
  const key = statKey(rawName);
  if (!key) return;
  const text = String(rawValue ?? '').trim();
  // Baseball innings use .1/.2 to mean one/two outs, not decimal tenths.
  // Normalize before generic numeric parsing so pitcher workload is accurate.
  if (['ip', 'inningspitched'].includes(key)) {
    if (!/^\d+(?:\.[012])?$/.test(text)) return;
    const [innings, outs = 0] = text.split('.').map(Number);
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
    target[key] = second > 0 ? first / second : null;
    return;
  }
  const number = finite(text.replace(/[%,$]/g, ''));
  if (number !== null) target[key] = ['svpct','savepct'].includes(key) && text.endsWith('%') ? number / 100 : number;
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
  let complete = true;
  const observedMetric = (values, ...names) => {
    const value = optionalMetric(values, ...names);
    if (value === null) complete = false;
    return value ?? 0;
  };
  const score = performanceFormula(profileKey, groupName, stats, observedMetric);
  return complete ? score : null;
}

function performanceFormula(profileKey, groupName, stats, observedMetric) {
  const group = String(groupName || '').toLowerCase();
  if (profileKey === 'basketball') {
    return clamp(
      observedMetric(stats, 'PTS', 'points') * 0.11 + observedMetric(stats, 'REB', 'rebounds') * 0.055 +
      observedMetric(stats, 'AST', 'assists') * 0.075 + observedMetric(stats, 'STL', 'steals') * 0.18 +
      observedMetric(stats, 'BLK', 'blocks') * 0.16 - observedMetric(stats, 'TO', 'turnovers') * 0.09 +
      observedMetric(stats, '+/-', 'plusMinus') * 0.025,
      -2, 7
    );
  }
  if (profileKey === 'baseball') {
    if (/pitch/.test(group)) {
      return clamp(
        observedMetric(stats, 'IP', 'inningsPitched') * 0.32 + observedMetric(stats, 'K', 'strikeouts') * 0.11 -
        observedMetric(stats, 'ER', 'earnedRuns') * 0.34 - observedMetric(stats, 'BB', 'walks') * 0.08 -
        observedMetric(stats, 'HR', 'homeRuns') * 0.18,
        -2, 6
      );
    }
    return clamp(
      observedMetric(stats, 'TB', 'totalBases') * 0.19 + observedMetric(stats, 'RBI', 'RBIs') * 0.13 +
      observedMetric(stats, 'BB', 'walks') * 0.09 + observedMetric(stats, 'HR', 'homeRuns') * 0.28 -
      observedMetric(stats, 'K', 'strikeouts') * 0.045,
      -1.5, 5
    );
  }
  if (profileKey === 'football') {
    return clamp(
      observedMetric(stats, 'YDS', 'passingYards', 'rushingYards', 'receivingYards') * 0.006 +
      observedMetric(stats, 'TD', 'passingTouchdowns', 'rushingTouchdowns', 'receivingTouchdowns') * 0.48 -
      observedMetric(stats, 'INT', 'interceptions') * 0.5 + observedMetric(stats, 'SACKS', 'sacks') * 0.22 +
      observedMetric(stats, 'QBR') * 0.012,
      -2, 7
    );
  }
  if (profileKey === 'hockey') {
    if (/goalie/.test(group)) {
      return clamp((observedMetric(stats, 'SV%', 'savePct') - 0.9) * 22 + observedMetric(stats, 'SV', 'saves') * 0.025, -2, 5);
    }
    return clamp(
      observedMetric(stats, 'G', 'goals') * 1.15 + observedMetric(stats, 'A', 'assists') * 0.65 +
      observedMetric(stats, 'S', 'shots') * 0.07 + observedMetric(stats, '+/-', 'plusMinus') * 0.12 +
      observedMetric(stats, 'TK', 'takeaways') * 0.06 - observedMetric(stats, 'GV', 'giveaways') * 0.05,
      -2, 6
    );
  }
  if (profileKey === 'soccer') {
    return clamp(
      observedMetric(stats, 'goals', 'G') * 1.35 + observedMetric(stats, 'assists', 'A') * 0.72 +
      observedMetric(stats, 'shotsOnTarget') * 0.1 + (observedMetric(stats, 'rating') - 6.5) * 0.35,
      -2, 6
    );
  }
  if (profileKey === 'tennis') return clamp(observedMetric(stats, 'aces') * 0.08 - observedMetric(stats, 'doubleFaults') * 0.08, -2, 5);
  if (profileKey === 'combat') return clamp(observedMetric(stats, 'significantStrikes') * 0.025 + observedMetric(stats, 'takedowns') * 0.18, -2, 5);
  return null;
}

function participationScore(profileKey, groupName, stats, leagueKey = '') {
  const group = String(groupName || '').toLowerCase();
  let observed = null, denominator = null;
  if (profileKey === 'basketball') { observed = optionalMetric(stats, 'MIN', 'minutes'); denominator = basketballWorkloadBasis(leagueKey).minutes; }
  if (profileKey === 'soccer') { observed = optionalMetric(stats, 'MIN', 'minutes'); denominator = 90; }
  if (profileKey === 'hockey') { observed = optionalMetric(stats, 'TOI', 'minutes'); denominator = /goalie/.test(group) ? 60 : 22; }
  if (profileKey === 'baseball') {
    observed = /pitch/.test(group) ? optionalMetric(stats, 'IP', 'inningsPitched') : optionalMetric(stats, 'PA', 'plateAppearances', 'AB', 'atBats');
    denominator = /pitch/.test(group) ? 6 : 4.5;
  }
  // Attempts/receptions/tackles and starter status do not measure football snaps.
  // Other unobserved workloads use explicit projection priors, never fake history.
  return observed !== null && observed >= 0 && denominator ? clamp(observed / denominator, 0, 1) : null;
}

function mergePlayerRow(map, row) {
  const key = `${normalizeEntityName(row.team)}__${row.athleteId || normalizeEntityName(row.name)}`;
  const existing = map.get(key);
  if (!existing) {
    map.set(key, { ...row, starterObservations: typeof row.starter === 'boolean' ? [row.starter] : [], starterEvidenceConflict: false, statConflicts: [], statGroups: [{ name: row.groupName || row.role || '', stats: { ...row.stats } }] });
    return;
  }
  const starterObservations = [...new Set([...(existing.starterObservations || []), ...(typeof row.starter === 'boolean' ? [row.starter] : [])])].sort();
  const statConflicts = new Set(existing.statConflicts || []);
  const combinedStats = { ...existing.stats, ...row.stats };
  const groupFamily = name => String(name || '').toLowerCase().match(/passing|rushing|receiving|pitching|batting/)?.[0];
  const incomingFamily = groupFamily(row.groupName);
  const semanticConflict = incomingFamily && existing.statGroups.some(group => groupFamily(group.name) && groupFamily(group.name) !== incomingFamily);
  for (const [stat, value] of Object.entries(row.stats || {})) {
    if (Object.hasOwn(existing.stats || {}, stat) && (existing.stats[stat] !== value || semanticConflict)) statConflicts.add(stat);
  }
  for (const stat of statConflicts) combinedStats[stat] = null;
  map.set(key, {
    ...existing,
    ...row,
    starter: starterObservations.length === 1 ? starterObservations[0] : null,
    starterObservations, starterEvidenceConflict: starterObservations.length > 1,
    active: existing.active !== false && row.active !== false,
    appeared: existing.appeared || row.appeared,
    stats: combinedStats, statConflicts: [...statConflicts].sort(),
    statGroups: [...existing.statGroups, { name: row.groupName || row.role || '', stats: { ...row.stats } }],
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
          starter: typeof athleteRow.starter === 'boolean' ? athleteRow.starter : null, starterContract: 'historical-starter-v1', active: athleteRow.active !== false,
          appeared: Boolean(athleteRow.starter === true || Object.keys(stats).length),
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
        starter: typeof rosterRow.starter === 'boolean' ? rosterRow.starter : null, starterContract: 'historical-starter-v1', active: rosterRow.active !== false,
        appeared: Boolean(rosterRow.starter === true || Object.keys(stats).length),
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
    participation: participationScore(profile.key, row.groupName || row.role, row.stats, result.leagueKey || result.league),
    participationContract: 'observed-workload-v2',
    performance: performanceScore(profile.key, row.groupName || row.role, row.stats),
    performanceContract: 'complete-player-performance-v1',
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
    const participationRows = rows.map(row => row.stats && typeof row.stats === 'object'
      ? participationScore(sportProfile(row).key, row.groupName || row.role, row.stats, row.leagueKey || row.league)
      : row.participationContract === 'observed-workload-v2' ? finite(row.participation) : null)
      .filter(value => value !== null && value >= 0 && value <= 1);
    const participation = participationRows.length ? mean(participationRows) : null;
    const observedPerformance = row => row.stats && typeof row.stats === 'object'
      ? performanceScore(sportProfile(row).key, row.groupName || row.role, row.stats)
      : row.performanceContract === 'complete-player-performance-v1' ? finite(row.performance) : null;
    const performanceValues = rows.map(observedPerformance).filter(Number.isFinite);
    const recentValues = recent.map(observedPerformance).filter(Number.isFinite);
    const performance = performanceValues.length ? mean(performanceValues) : null;
    const recentPerformance = recentValues.length ? mean(recentValues) : null;
    const starterValues = rows.filter(row => row.starterContract === 'historical-starter-v1'
      && typeof row.starter === 'boolean' && !row.starterEvidenceConflict).map(row => row.starter ? 1 : 0);
    const starterRate = starterValues.length ? mean(starterValues) : null;
    const reliability = participationRows.length / (participationRows.length + 3);
    const profile = sportProfile(latest);
    const participationPrior = roleParticipationPrior(profile.key, latest.role);
    const rawImpact = 0.8 + (participation ?? participationPrior) * 3.7 + (starterRate ?? 0.5) * 1.1 + clamp(performance ?? 0, -1, 5) * 0.3 + criticalRoleBonus(profile, latest.role);
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
      form: performance !== null && recentPerformance !== null ? clamp(50 + (recentPerformance - performance) * 6, 28, 76) : 50,
      formEvidence: performance !== null && recentPerformance !== null ? 'complete_performance_proxy' : 'neutral_prior',
      starter: starterRate === null ? null : starterRate >= 0.5,
      starterRate, starterSamples: starterValues.length,
      starterConflictSamples: rows.filter(row => row.starterEvidenceConflict).length,
      participation, participationSamples: participationRows.length,
      participationUnitContract: profile.key === 'basketball' ? basketballWorkloadBasis(latest.leagueKey || latest.league).contract : null,
      participationEvidence: participationRows.length ? 'boxscore_workload_proxy' : 'unknown',
      impactEvidence: participationRows.length ? 'heuristic_with_workload_proxy' : 'heuristic_with_role_prior',
      performance, performanceSamples: performanceValues.length,
      statConflicts: [...new Set(rows.flatMap(row => row.statConflicts || []))].sort(),
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
        .filter((row) => normalizeEntityName(row.team) === normalizeEntityName(team) && row.starter === true && row.starterContract === 'historical-starter-v1' && !row.starterEvidenceConflict && row.active !== false)
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

function measuredHistoricalGame(row) {
  return validScore(row?.awayScore) !== null && validScore(row?.homeScore) !== null
    && Boolean(normalizeEntityName(row?.awayTeam)) && Boolean(normalizeEntityName(row?.homeTeam))
    && normalizeEntityName(row.awayTeam) !== normalizeEntityName(row.homeTeam);
}

export function opponentAdjustedRatings(results) {
  const output = new Map();
  for (const [league, rows] of resultTeamRows(results.filter(measuredHistoricalGame))) {
    const gamesByTeam = new Map();
    const ensure = (name) => {
      const key = normalizeEntityName(name);
      if (!gamesByTeam.has(key)) gamesByTeam.set(key, []);
      return key;
    };
    const homeMargins = rows.filter(row => row.neutralSite === false).map(row => validScore(row.homeScore) - validScore(row.awayScore));
    const observedHomeEdge = homeMargins.length ? mean(homeMargins) : null;
    for (const row of rows) {
      const away = ensure(row.awayTeam);
      const home = ensure(row.homeTeam);
      const margin = validScore(row.homeScore) - validScore(row.awayScore);
      const homeCorrection = row.neutralSite === false ? observedHomeEdge ?? 0 : 0;
      gamesByTeam.get(home).push({ opponent: away, margin: margin - homeCorrection });
      gamesByTeam.get(away).push({ opponent: home, margin: -margin + homeCorrection });
    }
    let ratings = new Map([...gamesByTeam.keys()].map((key) => [key, 0]));
    let solverConverged = false, solverIterations = 0;
    // Damping prevents the sign-flip mode of an undamped bipartite schedule graph.
    // Centering fixes the arbitrary additive offset; residuals verify the equations.
    const residual = values => Math.max(...[...gamesByTeam].map(([team, games]) =>
      Math.abs(values.get(team) - mean(games.map(game => game.margin + values.get(game.opponent))))));
    for (let iteration = 0; iteration < 1000; iteration += 1) {
      const next = new Map();
      for (const [team, games] of gamesByTeam) next.set(team,
        0.5 * ratings.get(team) + 0.5 * mean(games.map(game => game.margin + ratings.get(game.opponent))));
      const center = mean([...next.values()]);
      ratings = new Map([...next].map(([team, value]) => [team, value - center]));
      solverIterations = iteration + 1;
      if (residual(ratings) <= 1e-7) { solverConverged = true; break; }
    }
    if (!solverConverged) continue;
    const ratingValues = [...ratings.values()];
    const ratingSd = standardDeviation(ratingValues);
    const schedules = new Map([...gamesByTeam].map(([team, games]) => [team, mean(games.map((game) => ratings.get(game.opponent) || 0))]));
    const scheduleSd = standardDeviation([...schedules.values()]);
    for (const team of gamesByTeam.keys()) {
      output.set(teamKey(league, team), {
        rating: clamp(50 + (ratings.get(team) / ratingSd) * 10, 22, 78),
        scheduleStrength: clamp(50 + ((schedules.get(team) || 0) / scheduleSd) * 10, 22, 78),
        rawRating: ratings.get(team),
        observedHomeEdge, homeEdgeSampleSize: homeMargins.length, solverConverged, solverIterations,
        sampleSize: gamesByTeam.get(team).length
      });
    }
  }
  return output;
}

const observedCount = (stats, ...names) => {
  const value = optionalMetric(stats, ...names);
  return value !== null && value >= 0 ? value : null;
};
function teamPossessions(stats) {
  const result = measuredCalculation([
    observedCount(stats, 'fieldGoalsAttempted', 'fieldGoalsMadefieldGoalsAttemptedattempted'),
    observedCount(stats, 'freeThrowsAttempted', 'freeThrowsMadefreeThrowsAttemptedattempted'),
    observedCount(stats, 'offensiveRebounds'), observedCount(stats, 'turnovers')
  ], (shots, freeThrows, rebounds, turnovers) => shots + .44 * freeThrows - rebounds + turnovers);
  return result !== null && result >= 0 ? result : null;
}
function advancedOffense(profileKey, stats, score) {
  const points = validScore(score);
  if (profileKey === 'basketball') {
    const possessions = teamPossessions(stats);
    return possessions !== null && possessions > 20 ? measuredCalculation([points, possessions], (p, count) => p / count * 100) : null;
  }
  if (profileKey === 'football') return measuredCalculation([points, optionalMetric(stats, 'yardsPerPlay'), observedCount(stats, 'thirdDownPct', 'thirdDownEfficiencyPct'), observedCount(stats, 'turnovers')],
    (p, yards, thirdDown, turnovers) => yards * 7 + thirdDown * .12 - turnovers * 4 + p);
  if (profileKey === 'baseball') return measuredCalculation([points, observedCount(stats, 'plateAppearances', 'atBats'), observedCount(stats, 'totalBases'), observedCount(stats, 'walks')],
    (p, count, bases, walks) => count > 0 ? p * 2 + (bases + walks * .7) / count * 10 : null);
  if (profileKey === 'hockey') return measuredCalculation([points, observedCount(stats, 'shotsTotal', 'shots'), observedCount(stats, 'powerPlayPct')],
    (p, shots, powerPlay) => p * 4 + shots * .18 + powerPlay * .025);
  if (profileKey === 'soccer') return measuredCalculation([points, observedCount(stats, 'shotsOnTarget'), observedCount(stats, 'totalShots'), observedCount(stats, 'expectedGoals', 'xg')],
    (p, onTarget, shots, xg) => p * 4 + onTarget * .6 + shots * .12 + xg * 1.5);
  return null;
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
      events: finite(playByPlay.events),
      successRate: finite(playByPlay.successRate),
      turnoverRate: finite(playByPlay.turnoverRate),
      explosiveRate: finite(playByPlay.explosiveRate),
      pressureRate: finite(playByPlay.pressureRate),
      shotQuality: finite(playByPlay.shotQuality),
      playValuePerEvent: finite(playByPlay.playValuePerEvent)
    }
  } : {};
  if (profileKey === 'basketball') {
    const count = teamPossessions(stats), possessions = count === 0 || count > 20 ? count : null;
    return { ...playMetrics, possessions,
      offensiveEfficiency: possessions !== null && possessions > 20 ? measuredCalculation([score, possessions], (p, n) => p / n * 100) : null,
      turnoverRate: possessions !== null && possessions > 20 ? measuredCalculation([observedCount(stats, 'turnovers'), possessions], (t, n) => t / n) : null };
  }
  if (profileKey === 'football') {
    const yardsPerPlay = optionalMetric(stats, 'yardsPerPlay'), thirdDownPct = observedCount(stats, 'thirdDownPct', 'thirdDownEfficiencyPct');
    return { ...playMetrics, yardsPerPlay,
      epaProxy: measuredCalculation([yardsPerPlay, thirdDownPct, observedCount(stats, 'turnovers')], (yards, thirdDown, turnovers) => yards * .075 + thirdDown * .003 - turnovers * .12),
      driveEfficiency: measuredCalculation([score, observedCount(stats, 'totalDrives')], (p, drives) => drives > 0 ? p / drives : null) };
  }
  if (profileKey === 'hockey') {
    const shots = observedCount(stats, 'shotsTotal', 'shots'), powerPlay = observedCount(stats, 'powerPlayPct');
    return { ...playMetrics, shotVolume: shots,
      expectedGoalsProxy: measuredCalculation([shots, powerPlay], (n, pct) => n * (.082 + clamp(pct / 100, 0, .5) * .035)),
      goalPreventionProxy: null, teamGoalsAllowed: validScore(opponentScore) };
  }
  if (profileKey === 'soccer') {
    const directXg = observedCount(stats, 'expectedGoals', 'xg'), shotsOnTarget = observedCount(stats, 'shotsOnTarget'), shots = observedCount(stats, 'totalShots');
    const proxy = measuredCalculation([shotsOnTarget, shots], (onTarget, total) => onTarget <= total ? onTarget * .24 + (total - onTarget) * .055 : null);
    const expectedGoals = directXg ?? proxy;
    return { ...playMetrics, expectedGoals, reportedXgCoverage: directXg !== null ? 1 : 0,
      shotProxyCoverage: directXg === null && proxy !== null ? 1 : 0, shotsOnTarget,
      shotQuality: shots !== null && shots > 0 ? measuredCalculation([expectedGoals, shots], (xg, n) => xg / n) : null };
  }
  if (profileKey === 'baseball') {
    return { ...playMetrics,
      expectedRunsProxy: measuredCalculation([score, observedCount(stats, 'plateAppearances', 'atBats'), observedCount(stats, 'totalBases'), observedCount(stats, 'walks')],
        (runs, count, bases, walks) => count > 0 ? runs * .55 + (bases + walks * .7) / count * 5 : null),
      bullpenRunsAllowedProxy: null, teamRunsAllowed: validScore(opponentScore) };
  }
  return playMetrics;
}

function advancedTeamRatings(samples) {
  const rows = [];
  for (const sample of samples.filter(measuredHistoricalGame)) {
    const awayStats = sample.teams?.[normalizeEntityName(sample.awayTeam)]?.stats || {};
    const homeStats = sample.teams?.[normalizeEntityName(sample.homeTeam)]?.stats || {};
    const profile = sportProfile(sample);
    const awayOffense = advancedOffense(profile.key, awayStats, Number(sample.awayScore));
    const homeOffense = advancedOffense(profile.key, homeStats, Number(sample.homeScore));
    rows.push({ league: sample.leagueKey || sample.league, team: sample.awayTeam, offense: awayOffense, defense: homeOffense === null ? null : -homeOffense, metrics: specializedTeamMetrics(profile.key, awayStats, Number(sample.awayScore), Number(sample.homeScore), sample.playByPlay?.away) });
    rows.push({ league: sample.leagueKey || sample.league, team: sample.homeTeam, offense: homeOffense, defense: awayOffense === null ? null : -awayOffense, metrics: specializedTeamMetrics(profile.key, homeStats, Number(sample.homeScore), Number(sample.awayScore), sample.playByPlay?.home) });
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
    const metricSamples = {};
    const metrics = Object.fromEntries(metricNames.map((name) => {
      const values = teamRows.map((row) => finite(row.metrics?.[name])).filter((value) => value !== null);
      metricSamples[name] = values.length;
      return [name, values.length ? mean(values) : null];
    }));
    if (teamRows.some((row) => row.metrics?.playByPlay)) {
      const eventCounts = teamRows.map(row => finite(row.metrics?.playByPlay?.events)).filter(value => value !== null);
      metrics.playByPlay = {
        sampleSize: teamRows.filter((row) => row.metrics?.playByPlay).length,
        events: eventCounts.length ? Math.round(mean(eventCounts)) : null, eventSamples: eventCounts.length,
        successRate: metrics.playSuccessRate,
        turnoverRate: metrics.playTurnoverRate,
        explosiveRate: metrics.playExplosiveRate,
        pressureRate: metrics.playPressureRate,
        shotQuality: metrics.playShotQuality,
        playValuePerEvent: metrics.playValue
      };
    }
    const offenses = teamRows.map(row => row.offense).filter(Number.isFinite), defenses = teamRows.map(row => row.defense).filter(Number.isFinite);
    const summary = { key, league: teamRows[0].league, offense: offenses.length ? mean(offenses) : null, defense: defenses.length ? mean(defenses) : null,
      offenseSamples: offenses.length, defenseSamples: defenses.length, metrics, metricSamples, sampleSize: teamRows.length };
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
      const offense = row.offense === null ? null : clamp(50 + ((row.offense - offenseMean) / offenseSd) * 10 * row.offenseSamples / (row.offenseSamples + 4), 25, 75);
      const defense = row.defense === null ? null : clamp(50 + ((row.defense - defenseMean) / defenseSd) * 10 * row.defenseSamples / (row.defenseSamples + 4), 25, 75);
      output.set(row.key, {
        offense, defense,
        rating: measuredCalculation([offense, defense], (o, d) => (o + d) / 2), metrics: row.metrics, metricSamples: row.metricSamples,
        offenseSamples: row.offenseSamples, defenseSamples: row.defenseSamples, sampleSize: row.sampleSize
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
      profile.stats = { ...profile.stats, opponentAdjustedSample: opponent.sampleSize, scheduleStrength: opponent.scheduleStrength,
        observedHomeEdge: opponent.observedHomeEdge, homeEdgeSampleSize: opponent.homeEdgeSampleSize,
        opponentAdjustedSolverConverged: opponent.solverConverged, opponentAdjustedSolverIterations: opponent.solverIterations };
    }
    if (advanced) {
      profile.advancedOffense = advanced.offense;
      profile.advancedDefense = advanced.defense;
      profile.advancedRating = advanced.rating;
      profile.advancedMetrics = advanced.metrics;
      if (advanced.offense !== null) profile.offense = clamp(profile.offense * 0.84 + advanced.offense * 0.16, 20, 80);
      if (advanced.defense !== null) profile.defense = clamp(profile.defense * 0.84 + advanced.defense * 0.16, 20, 80);
      profile.stats = { ...profile.stats, advancedBoxscoreSample: advanced.sampleSize, advancedOffenseSamples: advanced.offenseSamples,
        advancedDefenseSamples: advanced.defenseSamples, advancedMetricSamples: advanced.metricSamples };
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
  return Object.values(profiles).find((row) =>
    normalizeEntityName(row.leagueKey || row.league) === league &&
    normalizeEntityName(row.team) === teamName &&
    samePlayerIdentity(player, row)
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
      player.stats = { ...(player.stats || {}), historicalBoxscoreGames: learned.sampleSize, historicalParticipation: learned.participation, historicalParticipationUnitContract: learned.participationUnitContract || null, historicalParticipationSamples: learned.participationSamples ?? null, historicalPerformanceSamples: learned.performanceSamples ?? null, historicalStarterRate: learned.starterRate, historicalStarterSamples: learned.starterSamples ?? null, historicalStarterConflicts: learned.starterConflictSamples ?? null };
      player.valueSource = learned.source;
      player.historicalStatConflicts = learned.statConflicts || [];
      player.historicalFormEvidence = learned.formEvidence || 'unknown';
      learnedInjuries += finiteNumber(player.availability) !== null && finiteNumber(player.availability) < 100 ? 1 : 0;
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
      const lineupRows = reconcilePlayerEvidence((game.autoLineups || []).filter((row) => matchesTeam(team, row.team)), game.autoPlayers || []);
      const starters = lineupRows.filter(isConfirmedStarter);
      const teamProfiles = Object.values(playerProfiles)
        .filter((row) => normalizeEntityName(row.leagueKey || row.league) === normalizeEntityName(game.leagueKey || game.league) && normalizeEntityName(row.team) === normalizeEntityName(team.name))
        .sort((a, b) => b.impact * (0.6 + (finite(b.starterRate) ?? 0.5) * 0.4) - a.impact * (0.6 + (finite(a.starterRate) ?? 0.5) * 0.4));
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
      const continuityRates = matched.map(row => finite(row.profile.starterRate)).filter(value => value !== null);
      const continuity = continuityRates.length ? mean(continuityRates) : null;
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
      const criticalPlayers = reconcilePlayerEvidence(game.autoPlayers || [], game.autoLineups || [])
        .filter((row) => matchesTeam(team, row.team) && row.active !== false && row.starter && row.availability >= 80);
      const criticalForm = criticalPlayers.length ? mean(criticalPlayers.map((row) => finite(row.form, 50))) : 50;
      const criticalRole={hockey:/goalie|goaltender|\bg\b/i,football:/quarterback|\bqb\b/i,baseball:/starting pitcher|\bsp\b/i}[profile.key];
      const roleRows=criticalRole?reconcilePlayerEvidence([...(game.autoPlayers||[]),...(game.autoLineups||[])])
        .filter(row=>matchesTeam(team,row.team)&&criticalRole.test(row.role||'')&&row.active!==false):[];
      const criticalRoleEvidence={confirmed:roleRows.filter(isConfirmedStarter).length,
        projected:roleRows.filter(row=>row.starter&&!isConfirmedStarter(row)).length,
        healthUnknown:roleRows.filter(row=>!hasAvailabilityObservation(row)).length,
        policy:'Role evidence only; unknown health cannot qualify a usable critical-player input.'};
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
        criticalRoleEvidence,
        criticalStarterCount: criticalPlayers.length,
        criticalConfirmedStarterCount: criticalPlayers.filter(isConfirmedStarter).length,
        criticalProjectedStarterCount: criticalPlayers.filter(row => !isConfirmedStarter(row)).length,
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
