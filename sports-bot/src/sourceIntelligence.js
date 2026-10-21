import { normalizeEntityName } from './intelligenceStore.js';
import { sportProfile } from './sportProfiles.js';

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function finite(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function extractOfficials(summary = {}) {
  const competition = summary?.header?.competitions?.[0] || {};
  const rows = [
    ...(summary?.gameInfo?.officials || []),
    ...(competition.officials || [])
  ];
  const deduped = new Map();
  for (const row of rows) {
    const name = row.displayName || row.fullName || row.name || row.official?.displayName || '';
    if (!name) continue;
    deduped.set(normalizeEntityName(name), {
      id: String(row.id || row.official?.id || ''),
      name,
      role: row.position?.displayName || row.position?.name || row.role || row.order || 'official'
    });
  }
  return [...deduped.values()];
}

export function extractEventEnvironment(summary = {}) {
  const competition = summary?.header?.competitions?.[0] || {};
  const venue = competition.venue || summary?.gameInfo?.venue || {};
  const weather = summary?.gameInfo?.weather || {};
  const condition = String(weather.displayValue || weather.condition || weather.conditionId || '');
  const roof = String(venue.roofType || venue.roof || competition.roof || '').toLowerCase();
  const surface = String(venue.grass ? 'grass' : venue.surface || competition.surface || '').toLowerCase();
  return {
    officials: extractOfficials(summary),
    venueName: venue.fullName || venue.name || '',
    indoor: Boolean(venue.indoor || /dome|closed/.test(roof)),
    roof,
    surface,
    temperatureF: finite(weather.temperature),
    windSpeedMph: finite(weather.windSpeed),
    windDirection: String(weather.windDirection || weather.wind || '').slice(0, 40),
    precipitation: /rain|snow|storm|sleet|freez/i.test(condition),
    condition
  };
}

export function buildOfficialProfiles(samples = []) {
  const leagueRows = new Map();
  for (const sample of samples) {
    const league = String(sample.leagueKey || sample.league || '').toLowerCase();
    if (!leagueRows.has(league)) leagueRows.set(league, []);
    leagueRows.get(league).push(sample);
  }
  const profiles = {};
  for (const [league, rows] of leagueRows) {
    const baselineHome = rows.reduce((sum, row) => sum + (Number(row.homeScore) === Number(row.awayScore) ? 0.5 : Number(row.homeScore) > Number(row.awayScore) ? 1 : 0), 0) / Math.max(1, rows.length);
    const baselineTotal = rows.reduce((sum, row) => sum + Number(row.homeScore || 0) + Number(row.awayScore || 0), 0) / Math.max(1, rows.length);
    const byOfficial = new Map();
    for (const row of rows) {
      for (const official of row.officials || row.environment?.officials || []) {
        const key = `${league}::${normalizeEntityName(official.name)}`;
        if (!byOfficial.has(key)) byOfficial.set(key, { official, outcomes: [], totals: [] });
        const target = byOfficial.get(key);
        target.outcomes.push(Number(row.homeScore) === Number(row.awayScore) ? 0.5 : Number(row.homeScore) > Number(row.awayScore) ? 1 : 0);
        target.totals.push(Number(row.homeScore || 0) + Number(row.awayScore || 0));
      }
    }
    for (const [key, row] of byOfficial) {
      const sampleSize = row.outcomes.length;
      const reliability = sampleSize / (sampleSize + 25);
      const homeRate = row.outcomes.reduce((sum, value) => sum + value, 0) / sampleSize;
      const averageTotal = row.totals.reduce((sum, value) => sum + value, 0) / sampleSize;
      profiles[key] = {
        name: row.official.name,
        role: row.official.role,
        league,
        sampleSize,
        homeBias: clamp((homeRate - baselineHome) * 2 * reliability, -0.32, 0.32),
        totalTendency: clamp(((averageTotal - baselineTotal) / Math.max(1, baselineTotal)) * reliability, -0.25, 0.25),
        observational: true
      };
    }
  }
  return profiles;
}

function mergeContext(game, addition) {
  const current = game.autoContext || {};
  game.autoContext = {
    ...current,
    ...addition,
    factors: { ...(current.factors || {}), ...(addition.factors || {}) },
    notes: [current.notes, addition.notes].filter(Boolean).join('; '),
    source: [current.source, addition.source].filter(Boolean).join(' + ')
  };
}

export function applyOfficialAndEnvironmentContext(games = [], profiles = {}) {
  let matchedOfficials = 0;
  for (const game of games) {
    const environment = game.eventEnvironment || {};
    const league = String(game.leagueKey || game.league || '').toLowerCase();
    const rows = (environment.officials || []).map((official) => profiles[`${league}::${normalizeEntityName(official.name)}`]).filter(Boolean);
    const homeBias = rows.length ? rows.reduce((sum, row) => sum + row.homeBias, 0) / rows.length : null;
    const totalTendency = rows.length ? rows.reduce((sum, row) => sum + row.totalTendency, 0) / rows.length : null;
    matchedOfficials += rows.length;
    const factors = {};
    if (homeBias !== null) factors.officialHomeBias = homeBias;
    if (totalTendency !== null) factors.officialTotalTendency = totalTendency;
    if (environment.indoor) factors.indoorVenue = 1;
    if (environment.surface) factors.playingSurfaceKnown = 1;
    if (environment.windSpeedMph !== null && environment.windSpeedMph !== undefined) factors.windSpeedMph = environment.windSpeedMph;
    if (environment.precipitation) factors.precipitation = 1;
    if (Object.keys(factors).length || environment.officials?.length) {
      mergeContext(game, {
        factors,
        officials: environment.officials || [],
        environment,
        notes: [
          rows.length ? `${rows.length} official tendency profile(s), observational/shrunk` : '',
          environment.surface ? `surface ${environment.surface}` : '',
          environment.indoor ? 'indoor/closed-roof venue' : '',
          environment.windDirection ? `wind ${environment.windDirection}` : ''
        ].filter(Boolean).join(', '),
        autoGenerated: true,
        source: 'Event environment + historical official profiles',
        updatedAt: new Date().toISOString()
      });
    }
  }
  return matchedOfficials;
}

export function corroborateScheduleRows(games = [], rows = [], options = {}) {
  let matched = 0;
  for (const game of games) {
    const dateKey = String(game.dateKey || game.startTime || '').slice(0, 10);
    const row = rows.find((candidate) => {
      const candidateDate = String(candidate.gameday || candidate.date || '').slice(0, 10);
      const away = normalizeEntityName(candidate.away_team || candidate.awayTeam);
      const home = normalizeEntityName(candidate.home_team || candidate.homeTeam);
      const awayTargets = [game.away?.abbr, game.away?.name].map(normalizeEntityName);
      const homeTargets = [game.home?.abbr, game.home?.name].map(normalizeEntityName);
      return candidateDate === dateKey && awayTargets.some((value) => value === away) && homeTargets.some((value) => value === home);
    });
    if (!row) continue;
    matched += 1;
    game.sourceCorroboration ||= { providers: [], matches: [], conflicts: [] };
    const provider = options.provider || 'independent schedule dataset';
    if (!game.sourceCorroboration.providers.includes(provider)) game.sourceCorroboration.providers.push(provider);
    const receipt = row.sourceFetchedAt || options.fetchedAt || '';
    game.sourceCorroboration.matches.push({ provider, eventId: row.game_id || row.id || '', fetchedAt: receipt, conflict: false });
    const factors = {};
    if (row.roof) factors.roofTypeKnown = 1;
    if (row.surface) factors.playingSurfaceKnown = 1;
    game.eventEnvironment = {
      ...(game.eventEnvironment || {}),
      sourceReceiptTimes: [...(game.eventEnvironment?.sourceReceiptTimes || []), receipt || null],
      roof: row.roof || game.eventEnvironment?.roof || '',
      surface: row.surface || game.eventEnvironment?.surface || '',
      indoor: /closed|dome|indoors/i.test(String(row.roof || '')) || game.eventEnvironment?.indoor || false,
      independentOfficials: row.referee ? [{ name: row.referee, role: 'referee' }] : [],
      temperatureF: finite(row.temp, game.eventEnvironment?.temperatureF),
      windSpeedMph: finite(row.wind, game.eventEnvironment?.windSpeedMph)
    };
    if (Object.keys(factors).length) mergeContext(game, { factors, source: provider,
      sourceReceiptTimes: [...(game.autoContext?.sourceReceiptTimes || []), receipt || null],
      notes: [row.roof, row.surface].filter(Boolean).join(', ') });
  }
  return matched;
}

export function contextualVolatility(game = {}) {
  const factors = game.autoContext?.factors || {};
  const profile = sportProfile(game);
  let value = 0;
  if (Number(factors.precipitation)) value += 0.08;
  if (Number(factors.windSpeedMph) >= 20) value += 0.08;
  if (Number(factors.homeTravelDisruption) || Number(factors.awayTravelDisruption)) value += 0.1;
  if (Number(factors.homeCoachingChange) || Number(factors.awayCoachingChange)) value += 0.08;
  if (profile.key === 'baseball' && Number(factors.umpireUnknown)) value += 0.04;
  return clamp(value, 0, 0.3);
}
