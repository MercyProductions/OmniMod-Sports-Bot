import path from 'node:path';
import { config, dataDir } from './config.js';
import { readJson, writeJson } from './storage.js';

const settingsPath = path.join(dataDir, 'guild-settings.json');
let settingsWriteQueue = Promise.resolve();

function emptyGuildSettings() {
  return {
    sportsChannelId: '',
    resultsChannelId: '',
    logChannelId: '',
    notifyRoleId: '',
    adminRoleId: '',
    oddsApiKey: '',
    oddsApiRegion: config.oddsApiRegion,
    dailyPostHour: config.dailyPostHour,
    dailyPostMinute: config.dailyPostMinute,
    finalCheckMinutes: config.finalCheckMinutes,
    configuredAt: '',
    configuredBy: ''
  };
}

function normalizeGuildSettings(value = {}) {
  return {
    ...emptyGuildSettings(),
    ...value,
    sportsChannelId: String(value.sportsChannelId ?? ''),
    resultsChannelId: String(value.resultsChannelId ?? ''),
    logChannelId: String(value.logChannelId ?? ''),
    notifyRoleId: String(value.notifyRoleId ?? ''),
    adminRoleId: String(value.adminRoleId ?? ''),
    oddsApiKey: String(value.oddsApiKey ?? ''),
    oddsApiRegion: String(value.oddsApiRegion || config.oddsApiRegion || 'us'),
    dailyPostHour: Number.isFinite(Number(value.dailyPostHour)) ? Number(value.dailyPostHour) : config.dailyPostHour,
    dailyPostMinute: Number.isFinite(Number(value.dailyPostMinute)) ? Number(value.dailyPostMinute) : config.dailyPostMinute,
    finalCheckMinutes: Number.isFinite(Number(value.finalCheckMinutes)) ? Number(value.finalCheckMinutes) : config.finalCheckMinutes,
    configuredAt: String(value.configuredAt ?? ''),
    configuredBy: String(value.configuredBy ?? '')
  };
}

function envFallbackSettings() {
  return normalizeGuildSettings({
    sportsChannelId: config.sportsChannelId,
    resultsChannelId: config.resultsChannelId,
    logChannelId: config.logChannelId,
    notifyRoleId: config.notifyRoleId,
    adminRoleId: config.adminRoleId,
    oddsApiKey: config.oddsApiKey,
    oddsApiRegion: config.oddsApiRegion,
    dailyPostHour: config.dailyPostHour,
    dailyPostMinute: config.dailyPostMinute,
    finalCheckMinutes: config.finalCheckMinutes
  });
}

export async function readGuildSettingsStore() {
  const store = await readJson(settingsPath, {}, { throwOnError: true });
  return store && typeof store === 'object' && !Array.isArray(store) ? store : {};
}

export async function getGuildSettings(guildId) {
  const base = envFallbackSettings();
  if (!guildId) return base;

  const store = await readGuildSettingsStore();
  return normalizeGuildSettings({
    ...base,
    ...(store[String(guildId)] ?? {})
  });
}

export async function updateGuildSettings(guildId, patch) {
  if (!guildId) throw new Error('Guild settings require a guild id.');
  const operation = settingsWriteQueue.catch(() => {}).then(async () => {
    const store = await readGuildSettingsStore();
    const current = store[String(guildId)] && typeof store[String(guildId)] === 'object'
      ? store[String(guildId)]
      : {};
    const next = {
      ...current,
      ...patch,
      configuredAt: new Date().toISOString()
    };
    store[String(guildId)] = next;
    await writeJson(settingsPath, store, { mode: 0o600, backup: true });
    return getGuildSettings(guildId);
  });
  settingsWriteQueue = operation;
  return operation;
}

export async function listConfiguredGuildIds(client) {
  const store = await readGuildSettingsStore();
  const saved = Object.entries(store)
    .filter(([, value]) => value?.sportsChannelId || value?.resultsChannelId || value?.logChannelId)
    .map(([guildId]) => guildId);

  if (saved.length) return [...new Set(saved)];
  if (config.guildId && (config.sportsChannelId || config.resultsChannelId || config.logChannelId)) {
    return [config.guildId];
  }

  const guilds = client ? await client.guilds.fetch().catch(() => null) : null;
  if (!guilds) return [];
  const ids = [];
  for (const partial of guilds.values()) {
    const settings = await getGuildSettings(partial.id);
    if (settings.sportsChannelId || settings.resultsChannelId || settings.logChannelId) {
      ids.push(partial.id);
    }
  }
  return [...new Set(ids)];
}

export function postingConfigurationStatus(guildIds = []) {
  const configuredGuildCount = new Set((Array.isArray(guildIds) ? guildIds : [])
    .map((value) => String(value || '').trim())
    .filter(Boolean)).size;
  return {
    postingConfigured: configuredGuildCount > 0,
    postingGuildCount: configuredGuildCount,
    postingConfiguration: configuredGuildCount
      ? `${configuredGuildCount} guild${configuredGuildCount === 1 ? '' : 's'} configured for posting.`
      : 'No posting destination configured. Run /sports setup or set a channel ID in the environment.'
  };
}

export function maskSecret(value) {
  const text = String(value ?? '');
  if (!text) return 'not configured';
  if (text.length <= 8) return `${text.slice(0, 2)}...${text.slice(-2)}`;
  return `${text.slice(0, 4)}...${text.slice(-4)}`;
}
