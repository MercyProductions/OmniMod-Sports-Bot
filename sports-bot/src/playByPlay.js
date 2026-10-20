import { normalizeEntityName } from './intelligenceStore.js';
import { sportProfile } from './sportProfiles.js';

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function finite(value, fallback = null) {
  if (value === null || value === undefined || value === '') return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function compactEspnPlay(play = {}, index = 0) {
  const type = play.type || {};
  const period = play.period || {};
  const clock = play.clock || {};
  const start = play.start || {};
  const end = play.end || {};
  return {
    id: String(play.id || play.sequenceNumber || index),
    sequence: finite(play.sequenceNumber, index),
    type: String(type.text || type.abbreviation || type.id || '').slice(0, 80),
    text: String(play.text || play.shortText || '').slice(0, 240),
    teamId: String(play.team?.id || play.teamId || start.team?.id || start.teamId || ''),
    scoring: Boolean(play.scoringPlay),
    scoreValue: finite(play.scoreValue, 0),
    period: finite(period.number ?? period, 0),
    clock: String(clock.displayValue || play.clock?.value || '').slice(0, 16),
    awayScore: finite(play.awayScore),
    homeScore: finite(play.homeScore),
    startDown: finite(start.down),
    startDistance: finite(start.distance),
    startYardLine: finite(start.yardLine),
    endYardLine: finite(end.yardLine),
    wallclock: String(play.wallclock || '').slice(0, 32)
  };
}

export function compactEspnPlays(plays = []) {
  return (Array.isArray(plays) ? plays : []).slice(-1_500).map(compactEspnPlay);
}

function creditedSide(play, result) {
  if (play.teamId && String(play.teamId) === String(result.awayTeamId || result.away?.id || '')) return 'away';
  if (play.teamId && String(play.teamId) === String(result.homeTeamId || result.home?.id || '')) return 'home';
  const text = normalizeEntityName(play.text);
  const awayNames = [result.awayTeam, result.away?.name, result.awayAbbr, result.away?.abbr].map(normalizeEntityName).filter(Boolean);
  const homeNames = [result.homeTeam, result.home?.name, result.homeAbbr, result.home?.abbr].map(normalizeEntityName).filter(Boolean);
  if (awayNames.some((name) => name.length >= 3 && text.includes(name))) return 'away';
  if (homeNames.some((name) => name.length >= 3 && text.includes(name))) return 'home';
  return '';
}

function playSignals(play, profileKey) {
  const text = `${play.type} ${play.text}`.toLowerCase();
  const scoring = play.scoring || /touchdown|field goal|three point|3-pt|goal|home run|scores|made shot/.test(text);
  const turnover = /turnover|intercept|fumble|double fault|caught stealing|pickoff|giveaway/.test(text);
  const pressure = /sack|pressure|hurry|blocked|tackle for loss|strikeout/.test(text);
  const explosive = /touchdown|home run|triple|double|fast break|breakaway|20-yard|30-yard|40-yard|50-yard/.test(text) ||
    (play.startYardLine !== null && play.endYardLine !== null && Math.abs(play.endYardLine - play.startYardLine) >= 20);
  const shot = /shot|jumper|layup|dunk|three point|3-pt|goal|header|wrist|slap/.test(text);
  const highValueChance = /penalty shot|penalty kick|breakaway|dunk|layup|shot on target|in the paint|red zone/.test(text);
  const setPiece = /corner|free kick|power play|penalty kick|faceoff/.test(text);
  const success = scoring || explosive || /first down|complete|single|double|triple|walk|hit by pitch|shot on target|ace|takedown/.test(text);
  let value = finite(play.scoreValue, 0);
  if (profileKey === 'football') value += (success ? 0.7 : 0) + (explosive ? 0.8 : 0) - (turnover ? 2.2 : 0) - (pressure ? 0.18 : 0);
  else if (profileKey === 'baseball') value += /home run/.test(text) ? 1.4 : /triple/.test(text) ? 1.05 : /double/.test(text) ? 0.75 : /single/.test(text) ? 0.48 : /walk|hit by pitch/.test(text) ? 0.32 : /out|strikeout/.test(text) ? -0.1 : 0;
  else if (profileKey === 'basketball') value += (highValueChance ? 0.15 : 0) - (turnover ? 0.65 : 0);
  else if (profileKey === 'hockey' || profileKey === 'soccer') value += scoring ? 0.8 : highValueChance ? 0.22 : shot ? 0.08 : 0;
  else value += success ? 0.12 : 0;
  return { scoring, turnover, pressure, explosive, shot, highValueChance, setPiece, success, value };
}

function emptySide() {
  return { events: 0, scoringEvents: 0, turnovers: 0, pressures: 0, explosives: 0, shots: 0, highValueChances: 0, setPieces: 0, successes: 0, playValue: 0 };
}

export function buildPlayByPlayEvidence(plays = [], result = {}) {
  const profileKey = sportProfile(result).key;
  const sides = { away: emptySide(), home: emptySide() };
  let assigned = 0;
  for (const play of plays || []) {
    const side = creditedSide(play, result);
    if (!side) continue;
    assigned += 1;
    const signals = playSignals(play, profileKey);
    const target = sides[side];
    target.events += 1;
    target.scoringEvents += Number(signals.scoring);
    target.turnovers += Number(signals.turnover);
    target.pressures += Number(signals.pressure);
    target.explosives += Number(signals.explosive);
    target.shots += Number(signals.shot);
    target.highValueChances += Number(signals.highValueChance);
    target.setPieces += Number(signals.setPiece);
    target.successes += Number(signals.success);
    target.playValue += signals.value;
  }
  for (const target of Object.values(sides)) {
    const events = Math.max(1, target.events);
    target.successRate = target.successes / events;
    target.turnoverRate = target.turnovers / events;
    target.explosiveRate = target.explosives / events;
    target.pressureRate = target.pressures / events;
    target.shotQuality = target.shots ? target.highValueChances / target.shots : null;
    target.playValuePerEvent = target.playValue / events;
    target.possessionShare = target.events / Math.max(1, sides.away.events + sides.home.events);
    target.playValue = Number(target.playValue.toFixed(3));
  }
  return {
    profileKey,
    totalPlays: plays.length,
    assignedPlays: assigned,
    coverage: plays.length ? assigned / plays.length : 0,
    away: sides.away,
    home: sides.home,
    differential: Number((sides.home.playValuePerEvent - sides.away.playValuePerEvent).toFixed(4))
  };
}

export function warehousePlayRows(sample = {}) {
  return (sample.plays || []).map((play) => ({
    ...play,
    gameId: String(sample.gameId || sample.id || ''),
    dateKey: sample.dateKey || '',
    startTime: sample.startTime || '',
    league: sample.league || '',
    leagueKey: sample.leagueKey || '',
    sportGroup: sample.sportGroup || '',
    awayTeam: sample.awayTeam || '',
    homeTeam: sample.homeTeam || ''
  }));
}
