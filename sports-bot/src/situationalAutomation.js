import { normalizeEntityName } from './intelligenceStore.js';
import { sportProfile } from './sportProfiles.js';

const CITY_ROWS = [
  ['atlanta', 33.75, -84.39, -5, 320], ['baltimore', 39.29, -76.61, -5, 10],
  ['boston', 42.36, -71.06, -5, 43], ['buffalo', 42.89, -78.87, -5, 183],
  ['charlotte', 35.23, -80.84, -5, 229], ['chicago', 41.88, -87.63, -6, 181],
  ['cincinnati', 39.10, -84.51, -5, 147], ['cleveland', 41.50, -81.69, -5, 199],
  ['dallas', 32.78, -96.80, -6, 131], ['arlington', 32.74, -97.11, -6, 184],
  ['denver', 39.74, -104.99, -7, 1609], ['detroit', 42.33, -83.05, -5, 183],
  ['houston', 29.76, -95.37, -6, 13], ['indianapolis', 39.77, -86.16, -5, 218],
  ['jacksonville', 30.33, -81.66, -5, 5], ['kansas city', 39.10, -94.58, -6, 277],
  ['las vegas', 36.17, -115.14, -8, 610], ['los angeles', 34.05, -118.24, -8, 71],
  ['anaheim', 33.84, -117.91, -8, 48], ['miami', 25.76, -80.19, -5, 2],
  ['milwaukee', 43.04, -87.91, -6, 188], ['minneapolis', 44.98, -93.27, -6, 253],
  ['new orleans', 29.95, -90.07, -6, 1], ['new york', 40.71, -74.01, -5, 10],
  ['brooklyn', 40.68, -73.94, -5, 15], ['newark', 40.74, -74.17, -5, 9],
  ['nashville', 36.16, -86.78, -6, 182], ['memphis', 35.15, -90.05, -6, 103],
  ['oklahoma city', 35.47, -97.52, -6, 366], ['orlando', 28.54, -81.38, -5, 25],
  ['philadelphia', 39.95, -75.17, -5, 12], ['phoenix', 33.45, -112.07, -7, 331],
  ['pittsburgh', 40.44, -79.99, -5, 233], ['portland', 45.52, -122.68, -8, 15],
  ['sacramento', 38.58, -121.49, -8, 9], ['salt lake city', 40.76, -111.89, -7, 1288],
  ['san antonio', 29.42, -98.49, -6, 198], ['san diego', 32.72, -117.16, -8, 19],
  ['san francisco', 37.77, -122.42, -8, 16], ['oakland', 37.80, -122.27, -8, 13],
  ['san jose', 37.34, -121.89, -8, 25], ['seattle', 47.61, -122.33, -8, 56],
  ['st louis', 38.63, -90.20, -6, 142], ['tampa', 27.95, -82.46, -5, 15],
  ['washington', 38.91, -77.04, -5, 7], ['college park', 33.65, -84.45, -5, 290],
  ['toronto', 43.65, -79.38, -5, 76], ['montreal', 45.50, -73.57, -5, 36],
  ['vancouver', 49.28, -123.12, -8, 2], ['calgary', 51.05, -114.07, -7, 1045],
  ['edmonton', 53.55, -113.49, -7, 645], ['ottawa', 45.42, -75.70, -5, 70],
  ['winnipeg', 49.90, -97.14, -6, 239],
  ['london', 51.51, -0.13, 0, 11], ['falmer', 50.86, -0.09, 0, 35],
  ['brighton', 50.82, -0.14, 0, 22], ['manchester', 53.48, -2.24, 0, 38],
  ['liverpool', 53.41, -2.99, 0, 70], ['birmingham', 52.49, -1.89, 0, 140],
  ['newcastle', 54.98, -1.62, 0, 50], ['nottingham', 52.95, -1.15, 0, 61],
  ['bournemouth', 50.72, -1.88, 0, 12], ['burnley', 53.79, -2.24, 0, 118],
  ['leeds', 53.80, -1.55, 0, 63], ['sunderland', 54.91, -1.38, 0, 50],
  ['wolverhampton', 52.59, -2.13, 0, 163],
  ['madrid', 40.42, -3.70, 1, 667], ['barcelona', 41.39, 2.17, 1, 12],
  ['seville', 37.39, -5.98, 1, 7], ['sevilla', 37.39, -5.98, 1, 7],
  ['valencia', 39.47, -0.38, 1, 15], ['bilbao', 43.26, -2.94, 1, 19],
  ['villarreal', 39.94, -0.10, 1, 42], ['san sebastian', 43.32, -1.98, 1, 12],
  ['girona', 41.98, 2.82, 1, 75], ['milan', 45.46, 9.19, 1, 122],
  ['rome', 41.90, 12.50, 1, 21], ['turin', 45.07, 7.69, 1, 239],
  ['naples', 40.85, 14.27, 1, 17], ['bologna', 44.49, 11.34, 1, 54],
  ['florence', 43.77, 11.25, 1, 50], ['munich', 48.14, 11.58, 1, 520],
  ['dortmund', 51.51, 7.47, 1, 86], ['leipzig', 51.34, 12.37, 1, 113],
  ['frankfurt', 50.11, 8.68, 1, 112], ['stuttgart', 48.78, 9.18, 1, 247],
  ['leverkusen', 51.05, 7.02, 1, 60], ['berlin', 52.52, 13.41, 1, 34],
  ['bremen', 53.08, 8.80, 1, 12], ['hamburg', 53.55, 10.00, 1, 8],
  ['paris', 48.86, 2.35, 1, 35], ['marseille', 43.30, 5.37, 1, 12],
  ['lyon', 45.76, 4.84, 1, 173], ['monaco', 43.74, 7.42, 1, 20],
  ['lille', 50.63, 3.06, 1, 21], ['nice', 43.71, 7.26, 1, 10],
  ['mexico city', 19.43, -99.13, -6, 2240], ['guadalajara', 20.67, -103.35, -6, 1566],
  ['monterrey', 25.69, -100.32, -6, 540]
];

function timeZoneFor(city, utcOffset) {
  const key = normalizeEntityName(city);
  if (key === 'phoenix') return 'America/Phoenix';
  if (['mexico city', 'guadalajara', 'monterrey'].includes(key)) return 'America/Mexico_City';
  if (utcOffset === -8) return 'America/Los_Angeles';
  if (utcOffset === -7) return 'America/Denver';
  if (utcOffset === -6) return 'America/Chicago';
  if (utcOffset === -5) return 'America/New_York';
  if (utcOffset === 0) return 'Europe/London';
  if (utcOffset === 1) return 'Europe/Paris';
  return 'UTC';
}

const CITY_DATA = new Map(CITY_ROWS.map(([city, lat, lon, utcOffset, altitudeM]) => [normalizeEntityName(city), {
  city, lat, lon, utcOffset, altitudeM, timeZone: timeZoneFor(city, utcOffset)
}]));

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function finite(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function pointForVenue(venue) {
  const city = venue?.address?.city || venue?.city || '';
  return CITY_DATA.get(normalizeEntityName(city)) || null;
}

function haversineKm(left, right) {
  if (!left || !right) return null;
  const radius = 6371;
  const toRadians = (degrees) => degrees * Math.PI / 180;
  const dLat = toRadians(right.lat - left.lat);
  const dLon = toRadians(right.lon - left.lon);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRadians(left.lat)) * Math.cos(toRadians(right.lat)) * Math.sin(dLon / 2) ** 2;
  return radius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function utcOffsetAt(point, date) {
  if (!point?.timeZone || !Number.isFinite(date?.getTime?.())) return point?.utcOffset ?? null;
  try {
    const part = new Intl.DateTimeFormat('en-US', {
      timeZone: point.timeZone,
      timeZoneName: 'longOffset',
      hour: '2-digit'
    }).formatToParts(date).find((row) => row.type === 'timeZoneName')?.value || '';
    const match = part.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/i);
    if (!match) return part === 'GMT' ? 0 : point.utcOffset;
    const value = Number(match[2]) + Number(match[3] || 0) / 60;
    return match[1] === '-' ? -value : value;
  } catch {
    return point.utcOffset;
  }
}

function fatigueFor(profileKey, team) {
  const gamesLast7 = finite(team?.stats?.gamesLast7, 0);
  const gamesLast3 = finite(team?.stats?.gamesLast3, 0);
  const rest = finite(team?.restDays, 3);
  const expected = { baseball: 6, basketball: 3.5, football: 1, hockey: 3.5, soccer: 2, tennis: 2, combat: 1 }[profileKey] || 3;
  const congestion = Math.max(0, gamesLast7 - expected) / Math.max(1, expected);
  const acute = Math.max(0, gamesLast3 - Math.max(1, expected * 0.45)) / Math.max(1, expected * 0.45);
  const shortRest = rest <= 0 ? 0.65 : rest === 1 ? 0.3 : 0;
  return clamp(congestion * 0.45 + acute * 0.35 + shortRest, 0, 1);
}

function starterRestFor(game, team) {
  const rows = (game.autoPlayers || []).filter((row) =>
    row.starter && matchesTeamName(team, row.team) && /pitcher|goalie|goaltender|quarterback|\bqb\b/i.test(String(row.role || ''))
  );
  const values = rows.map((row) => finite(row.stats?.daysSinceLastStart)).filter((value) => value !== null);
  return values.length ? Math.min(...values) : null;
}

function matchesTeamName(team, value) {
  const target = normalizeEntityName(value);
  return [team?.name, team?.abbr].map(normalizeEntityName).filter(Boolean).some((name) => name === target || (name.length >= 5 && target.includes(name)) || (target.length >= 5 && name.includes(target)));
}

export function buildAutomaticScheduleContext(game, awayTeam, homeTeam) {
  const profile = sportProfile(game);
  const currentPoint = pointForVenue(game.venueDetails);
  const awayPreviousPoint = pointForVenue(awayTeam?.lastVenue);
  const homePreviousPoint = pointForVenue(homeTeam?.lastVenue);
  const awayTravel = haversineKm(awayPreviousPoint, currentPoint);
  const homeTravel = haversineKm(homePreviousPoint, currentPoint);
  const eventDate = new Date(game.startTime || game.dateKey || Date.now());
  const currentOffset = utcOffsetAt(currentPoint, eventDate);
  const awayPreviousOffset = utcOffsetAt(awayPreviousPoint, eventDate);
  const homePreviousOffset = utcOffsetAt(homePreviousPoint, eventDate);
  const awayShift = currentOffset !== null && awayPreviousOffset !== null ? Math.abs(currentOffset - awayPreviousOffset) : null;
  const homeShift = currentOffset !== null && homePreviousOffset !== null ? Math.abs(currentOffset - homePreviousOffset) : null;
  const currentAltitude = currentPoint?.altitudeM ?? null;
  const awayPreviousAltitude = awayPreviousPoint?.altitudeM ?? null;
  const homePreviousAltitude = homePreviousPoint?.altitudeM ?? null;
  const factors = {
    awayRestDays: finite(awayTeam?.restDays),
    homeRestDays: finite(homeTeam?.restDays),
    awayFatigue: fatigueFor(profile.key, awayTeam),
    homeFatigue: fatigueFor(profile.key, homeTeam),
    awayRoadStreak: finite(awayTeam?.stats?.awayStreak, 0),
    homeRoadStreak: finite(homeTeam?.stats?.awayStreak, 0),
    playoffGame: Number(game.seasonType === 3 || /postseason|playoff/i.test(String(game.seasonSlug || '')))
  };
  const awayStarterRest = starterRestFor(game, game.away);
  const homeStarterRest = starterRestFor(game, game.home);
  if (awayStarterRest !== null) factors.awayStarterRestDays = awayStarterRest;
  if (homeStarterRest !== null) factors.homeStarterRestDays = homeStarterRest;
  if (awayTravel !== null) factors.awayTravelKm = Math.round(awayTravel);
  if (homeTravel !== null) factors.homeTravelKm = Math.round(homeTravel);
  if (awayShift !== null) factors.awayTimeZoneShift = awayShift;
  if (homeShift !== null) factors.homeTimeZoneShift = homeShift;
  if (currentAltitude !== null && awayPreviousAltitude !== null) factors.awayAltitudeChangeM = currentAltitude - awayPreviousAltitude;
  if (currentAltitude !== null && homePreviousAltitude !== null) factors.homeAltitudeChangeM = currentAltitude - homePreviousAltitude;
  return {
    factors,
    notes: [
      awayTravel === null ? '' : `${game.away?.abbr || 'Away'} travel ${Math.round(awayTravel)} km`,
      homeTravel === null ? '' : `${game.home?.abbr || 'Home'} travel ${Math.round(homeTravel)} km`,
      currentAltitude && currentAltitude >= 1000 ? `venue altitude ${currentAltitude} m` : '',
      awayStarterRest === null && homeStarterRest === null ? '' : `starter rest ${awayStarterRest ?? 'unknown'} away / ${homeStarterRest ?? 'unknown'} home day(s)`,
      factors.playoffGame ? 'postseason/high-stakes event' : ''
    ].filter(Boolean).join('; '),
    autoGenerated: true,
    source: 'Cached schedule geometry and congestion',
    updatedAt: new Date().toISOString(),
    coverage: {
      travel: Number(awayTravel !== null) + Number(homeTravel !== null),
      cityKnown: Boolean(currentPoint)
    }
  };
}

export function knownVenueCityCount() {
  return CITY_DATA.size;
}
