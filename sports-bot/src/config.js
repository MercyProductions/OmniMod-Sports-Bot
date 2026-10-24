import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const rootDir = path.resolve(__dirname, '..');
export const legacyDataDir = path.join(rootDir, 'data');

// cPanel can launch the same bot from more than one application root. Keep one
// shared state directory on Linux so restarts or duplicate app definitions
// cannot each consume a fresh daily Odds API batch.
const configuredDataDir = String(process.env.OMNIMOD_SPORTS_DATA_DIR || '').trim();
export const dataDir = configuredDataDir
  ? path.resolve(configuredDataDir)
  : process.platform === 'win32'
    ? legacyDataDir
    : path.join(process.env.HOME || rootDir, '.omnimod-sports-data');

function intEnv(name, fallback, min, max) {
  const parsed = Number.parseInt(process.env[name] ?? '', 10);
  const value = Number.isFinite(parsed) ? parsed : fallback;
  return Math.max(min, Math.min(max, value));
}

function boolEnv(name, fallback = false) {
  const raw = String(process.env[name] ?? '').trim().toLowerCase();
  if (!raw) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw);
}

function integerListEnv(name, fallback = []) {
  const values = String(process.env[name] || '').split(',')
    .map((value) => Number.parseInt(value.trim(), 10))
    .filter((value) => Number.isFinite(value) && value >= 1 && value <= 720);
  return [...new Set(values.length ? values : fallback)].sort((a, b) => b - a);
}

export const config = {
  discordToken: process.env.DISCORD_TOKEN || '',
  clientId: process.env.DISCORD_CLIENT_ID || '',
  guildId: process.env.DISCORD_GUILD_ID || '',
  sportsChannelId: process.env.SPORTS_CHANNEL_ID || '',
  resultsChannelId: process.env.SPORTS_RESULTS_CHANNEL_ID || '',
  logChannelId: process.env.SPORTS_LOG_CHANNEL_ID || '',
  notifyRoleId: process.env.SPORTS_NOTIFY_ROLE_ID || '',
  adminRoleId: process.env.SPORTS_ADMIN_ROLE_ID || '',
  oddsApiKey: process.env.ODDS_API_KEY || '',
  oddsApiRegion: process.env.ODDS_API_REGION || 'us',
  timezone: process.env.TIMEZONE || 'America/Chicago',
  dailyPostHour: intEnv('DAILY_POST_HOUR', 8, 0, 23),
  dailyPostMinute: intEnv('DAILY_POST_MINUTE', 0, 0, 59),
  finalCheckMinutes: intEnv('FINAL_CHECK_MINUTES', 10, 2, 180),
  finalLookbackDays: intEnv('FINAL_LOOKBACK_DAYS', 7, 1, 30),
  finalCorrectionHours: intEnv('FINAL_CORRECTION_CHECK_HOURS',24,0,168),
  finalCorrectionMinutes: intEnv('FINAL_CORRECTION_CHECK_MINUTES',60,10,1440),
  postOnStart: boolEnv('POST_ON_START', true),
  registerCommands: boolEnv('REGISTER_COMMANDS', true),
  maxGamesPerPost: intEnv('MAX_GAMES_PER_POST', 75, 1, 200),
  maxLeaguesPerRefresh: intEnv('MAX_LEAGUES_PER_REFRESH', 24, 4, 36),
  scoreboardCacheMinutes: intEnv('SCOREBOARD_CACHE_MINUTES', 10, 1, 180),
  scoreboardStaleHours: intEnv('SCOREBOARD_STALE_HOURS', 48, 1, 720),
  oddsCacheHours: intEnv('ODDS_CACHE_HOURS', 6, 1, 24),
  valueRefreshDailyCap: intEnv('SPORTS_VALUE_REFRESH_DAILY_CAP', 0, 0, 100),
  valueRefreshCooldownMinutes: intEnv('SPORTS_VALUE_REFRESH_COOLDOWN_MINUTES', 5, 1, 1440),
  predictionHistoryDays: intEnv('PREDICTION_HISTORY_DAYS', 365, 30, 1095),
  autoEnrichEnabled: boolEnv('AUTO_ENRICH_ENABLED', true),
  autoSummaryMaxGames: intEnv('AUTO_SUMMARY_MAX_GAMES', 24, 0, 75),
  autoSummaryCacheMinutes: intEnv('AUTO_SUMMARY_CACHE_MINUTES', 180, 15, 1440),
  autoHistoryMaxLeagues: intEnv('AUTO_HISTORY_MAX_LEAGUES', 10, 0, 24),
  autoHistoryCacheHours: intEnv('AUTO_HISTORY_CACHE_HOURS', 12, 1, 168),
  nativeHistoryFallbackDays: intEnv('NATIVE_NHL_HISTORY_DAYS', 7, 0, 14),
  autoHistoryMaxDays: intEnv('AUTO_HISTORY_MAX_DAYS', 365, 14, 730),
  autoBoxscoreMaxEvents: intEnv('AUTO_BOXSCORE_MAX_EVENTS', 36, 0, 75),
  autoBoxscoreCacheDays: intEnv('AUTO_BOXSCORE_CACHE_DAYS', 30, 1, 365),
  autoOfficialSources: boolEnv('AUTO_OFFICIAL_SOURCES', true),
  autoLearningEnabled: boolEnv('AUTO_LEARNING_ENABLED', true),
  autoLearningMinSamples: intEnv('AUTO_LEARNING_MIN_SAMPLES', 30, 20, 500),
  driftRecentSamples: intEnv('DRIFT_RECENT_SAMPLES', 30, 15, 200),
  pregameRefreshEnabled: boolEnv('PREGAME_REFRESH_ENABLED', true),
  pregameRefreshWindows: integerListEnv('PREGAME_REFRESH_WINDOWS', [90, 30, 10]),
  featureWarehouseEnabled: boolEnv('FEATURE_WAREHOUSE_ENABLED', true),
  historicalReplayEnabled: boolEnv('HISTORICAL_REPLAY_ENABLED', true),
  historicalReplayMaxRows: intEnv('HISTORICAL_REPLAY_MAX_ROWS', 8000, 100, 20000),
  challengerMinSamples: intEnv('CHALLENGER_MIN_SAMPLES', 75, 30, 1000),
  localMlEnabled: boolEnv('LOCAL_ML_ENABLED', true),
  localMlMinSamples: intEnv('LOCAL_ML_MIN_SAMPLES', 150, 60, 5000),
  playByPlayEnabled: boolEnv('PLAY_BY_PLAY_ENABLED', true),
  horizonEvaluationEnabled: boolEnv('HORIZON_EVALUATION_ENABLED', true),
  sourceRedundancyEnabled: boolEnv('SOURCE_REDUNDANCY_ENABLED', true),
  advancedDatasetsEnabled: boolEnv('ADVANCED_DATASETS_ENABLED', true),
  advancedDatasetSyncDays: intEnv('ADVANCED_DATASET_SYNC_DAYS', 7, 1, 30),
  advancedNbaStatsEnabled: boolEnv('ADVANCED_NBA_STATS_ENABLED', false),
  localOnly: boolEnv('LOCAL_ONLY', false)
};

export function requireRuntimeConfig() {
  if (!config.discordToken) {
    throw new Error('DISCORD_TOKEN is missing. Copy .env.example to .env or run scripts/setup-env.ps1.');
  }
  if (!config.clientId) throw new Error('DISCORD_CLIENT_ID is missing. Set your own Discord application ID in the local .env.');
}
