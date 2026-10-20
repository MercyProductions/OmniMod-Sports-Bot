const BASE_PROFILE = Object.freeze({
  key: 'default',
  twoWay: true,
  baseDrawProbability: 0,
  homeAdvantageElo: 35,
  marketWeight: 0.28,
  volatility: 0.16,
  seasonRegression: 0.24,
  weights: Object.freeze({
    elo: 0.31,
    record: 0.16,
    power: 0.18,
    offenseDefense: 0.09,
    form: 0.10,
    players: 0.10,
    situation: 0.06
  }),
  importantRoles: Object.freeze([])
});

const PROFILES = Object.freeze({
  baseball: {
    homeAdvantageElo: 24,
    marketWeight: 0.32,
    volatility: 0.21,
    seasonRegression: 0.22,
    weights: { elo: 0.27, record: 0.12, power: 0.14, offenseDefense: 0.12, form: 0.08, players: 0.18, situation: 0.09 },
    importantRoles: ['starting pitcher', 'pitcher', 'closer', 'catcher']
  },
  basketball: {
    homeAdvantageElo: 48,
    marketWeight: 0.30,
    volatility: 0.14,
    seasonRegression: 0.28,
    weights: { elo: 0.28, record: 0.14, power: 0.16, offenseDefense: 0.11, form: 0.11, players: 0.14, situation: 0.06 },
    importantRoles: ['starter', 'point guard', 'center', 'primary scorer']
  },
  football: {
    homeAdvantageElo: 42,
    marketWeight: 0.30,
    volatility: 0.17,
    seasonRegression: 0.36,
    weights: { elo: 0.28, record: 0.14, power: 0.17, offenseDefense: 0.11, form: 0.08, players: 0.15, situation: 0.07 },
    importantRoles: ['quarterback', 'qb', 'left tackle', 'edge', 'cornerback', 'kicker']
  },
  hockey: {
    homeAdvantageElo: 34,
    marketWeight: 0.34,
    volatility: 0.20,
    seasonRegression: 0.27,
    weights: { elo: 0.27, record: 0.13, power: 0.15, offenseDefense: 0.10, form: 0.10, players: 0.17, situation: 0.08 },
    importantRoles: ['starting goalie', 'goalie', 'center', 'defenseman']
  },
  soccer: {
    twoWay: false,
    baseDrawProbability: 0.26,
    homeAdvantageElo: 52,
    marketWeight: 0.34,
    volatility: 0.18,
    seasonRegression: 0.20,
    weights: { elo: 0.27, record: 0.13, power: 0.15, offenseDefense: 0.13, form: 0.10, players: 0.13, situation: 0.09 },
    importantRoles: ['goalkeeper', 'striker', 'center back', 'playmaker']
  },
  combat: {
    homeAdvantageElo: 0,
    marketWeight: 0.30,
    volatility: 0.24,
    seasonRegression: 0.12,
    weights: { elo: 0.24, record: 0.12, power: 0.19, offenseDefense: 0.14, form: 0.11, players: 0.03, situation: 0.17 },
    importantRoles: []
  },
  tennis: {
    homeAdvantageElo: 0,
    marketWeight: 0.32,
    volatility: 0.17,
    seasonRegression: 0.10,
    weights: { elo: 0.30, record: 0.10, power: 0.18, offenseDefense: 0.15, form: 0.13, players: 0.02, situation: 0.12 },
    importantRoles: []
  }
});

const LEAGUE_PROFILE = Object.freeze({
  mlb: 'baseball',
  nba: 'basketball',
  wnba: 'basketball',
  ncaab: 'basketball',
  ncaaw: 'basketball',
  nfl: 'football',
  ncaaf: 'football',
  nhl: 'hockey',
  epl: 'soccer',
  mls: 'soccer',
  laliga: 'soccer',
  'serie-a': 'soccer',
  bundesliga: 'soccer',
  'ligue-1': 'soccer',
  'liga-mx': 'soccer',
  ucl: 'soccer',
  uel: 'soccer',
  ufc: 'combat',
  atp: 'tennis',
  wta: 'tennis'
});

export function sportProfile(gameOrKey = {}) {
  const leagueKey = typeof gameOrKey === 'string' ? gameOrKey : gameOrKey.leagueKey;
  const group = typeof gameOrKey === 'object' ? String(gameOrKey.sportGroup || '').toLowerCase() : '';
  const key = LEAGUE_PROFILE[String(leagueKey || '').toLowerCase()] || group || 'default';
  const override = PROFILES[key] || {};
  return {
    ...BASE_PROFILE,
    ...override,
    key,
    weights: { ...BASE_PROFILE.weights, ...(override.weights || {}) },
    importantRoles: [...(override.importantRoles || BASE_PROFILE.importantRoles)]
  };
}

export function supportedProfileKeys() {
  return Object.keys(PROFILES);
}
