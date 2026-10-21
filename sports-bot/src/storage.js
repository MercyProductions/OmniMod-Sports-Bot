import fs from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import path from 'node:path';
import { dataDir, legacyDataDir } from './config.js';

let migrationChecked = false;

async function ensureDataDir({skipMigration=false} = {}) {
  await fs.mkdir(dataDir, { recursive: true });
  if (skipMigration || process.env.NODE_ENV === 'test' || process.env.OMNIMOD_DISABLE_DATA_MIGRATION === 'true'
    || migrationChecked || path.resolve(dataDir) === path.resolve(legacyDataDir)) return;
  migrationChecked = true;

  // Preserve settings and caches created by an earlier app-root-local build.
  const entries = await fs.readdir(legacyDataDir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const source = path.join(legacyDataDir, entry.name);
    const destination = path.join(dataDir, entry.name);
    await fs.copyFile(source, destination, fsConstants.COPYFILE_EXCL).catch((error) => {
      if (error?.code !== 'EEXIST') throw error;
    });
  }
}

function safeGuildId(guildId) {
  const text = String(guildId ?? '').trim();
  return text ? text.replace(/[^0-9a-z_-]/gi, '') : '';
}

function providerUsagePath(dateKey, guildId = '', provider = 'odds-api') {
  const safeId = safeGuildId(guildId) || 'default';
  const safeProvider = String(provider).replace(/[^0-9a-z_-]/gi, '') || 'provider';
  return path.join(dataDir, `provider-${safeProvider}-${safeId}-${dateKey}.json`);
}

function finalResultClaimPath(dateKey, guildId = '', gameId = '') {
  const safeId = safeGuildId(guildId) || 'default';
  const safeGame = String(gameId || '').replace(/[^0-9a-z_-]/gi, '') || 'unknown';
  return path.join(dataDir, `final-result-${safeId}-${dateKey}-${safeGame}.json`);
}

export function dailyCachePath(dateKey, guildId = '') {
  const safeId = safeGuildId(guildId);
  return path.join(dataDir, safeId ? `daily-${safeId}-${dateKey}.json` : `daily-${dateKey}.json`);
}

export async function readJson(file, fallback = null, options = {}) {
  if(!options.readOnly)await ensureDataDir();
  try {
    const raw = await fs.readFile(file, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    if (options.throwOnError && error?.code !== 'ENOENT') {
      if(options.redactErrors)throw new Error(`Could not read valid JSON from ${path.basename(file)}`);
      throw new Error(`Could not read valid JSON from ${path.basename(file)}: ${error.message}`, { cause: error });
    }
    return fallback;
  }
}

export async function writeJson(file, value, options = {}) {
  await ensureDataDir({skipMigration:options.skipDataMigration===true});
  await fs.mkdir(path.dirname(file), { recursive: true });
  if (options.backup) {
    await fs.copyFile(file, `${file}.bak`).catch((error) => {
      if (error?.code !== 'ENOENT') throw error;
    });
    if (options.mode) await fs.chmod(`${file}.bak`, options.mode).catch(() => {});
  }
  const tmp = `${file}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
  const serialized = options.compact ? JSON.stringify(value) : JSON.stringify(value, null, 2);
  await fs.writeFile(tmp, `${serialized}\n`, { encoding: 'utf8', mode: options.mode });
  try {
    await fs.rename(tmp, file);
  } catch (error) {
    await fs.unlink(tmp).catch(() => {});
    throw error;
  }
}

export async function readDailyProviderUsage(dateKey, guildId = '', provider = 'odds-api') {
  await ensureDataDir();
  return readJson(providerUsagePath(dateKey, guildId, provider), null, { throwOnError: true });
}

export async function claimDailyProviderUsage(dateKey, guildId = '', provider = 'odds-api', details = {}) {
  await ensureDataDir();
  const file = providerUsagePath(dateKey, guildId, provider);
  const claim = {
    provider,
    dateKey,
    guildId: String(guildId || ''),
    state: 'claimed',
    claimedAt: new Date().toISOString(),
    ...details
  };

  try {
    const handle = await fs.open(file, 'wx', 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(claim, null, 2)}\n`, 'utf8');
    } finally {
      await handle.close();
    }
    return { claimed: true, usage: claim };
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    return { claimed: false, usage: await readJson(file, null, { throwOnError: true }) };
  }
}

export async function finishDailyProviderUsage(dateKey, guildId = '', provider = 'odds-api', patch = {}) {
  const file = providerUsagePath(dateKey, guildId, provider);
  const current = await readJson(file, null, { throwOnError: true });
  if (!current) return null;
  const updated = {
    ...current,
    ...patch,
    state: 'completed',
    completedAt: new Date().toISOString()
  };
  await writeJson(file, updated, { mode: 0o600 });
  return updated;
}

export async function claimFinalResult(dateKey, guildId, gameId, details = {}, options = {}) {
  await ensureDataDir();
  const file = finalResultClaimPath(dateKey, guildId, gameId);
  const staleMs = Math.max(60_000, Number(options.staleMs) || 30 * 60_000);
  const now = new Date();
  const claim = {
    dateKey, guildId: String(guildId || ''), gameId: String(gameId || ''),
    state: 'claimed', claimedAt: now.toISOString(), processId: process.pid, ...details
  };

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = await fs.open(file, 'wx', 0o600);
      try { await handle.writeFile(`${JSON.stringify(claim, null, 2)}\n`, 'utf8'); }
      finally { await handle.close(); }
      return { claimed: true, claim };
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      const current = await readJson(file, null, { throwOnError: true });
      const claimedAt = Date.parse(current?.claimedAt || '');
      if (current?.state === 'posted' || !Number.isFinite(claimedAt) || now.getTime() - claimedAt < staleMs) {
        return { claimed: false, claim: current };
      }
      const stale = `${file}.stale-${process.pid}-${Date.now()}`;
      try { await fs.rename(file, stale); }
      catch (renameError) {
        if (renameError?.code === 'ENOENT') continue;
        return { claimed: false, claim: await readJson(file, current) };
      }
    }
  }
  return { claimed: false, claim: await readJson(file, null) };
}

export async function finishFinalResult(dateKey, guildId, gameId, patch = {}) {
  const file = finalResultClaimPath(dateKey, guildId, gameId);
  const current = await readJson(file, null, { throwOnError: true });
  if (!current) return null;
  const updated = { ...current, ...patch, state: 'posted', postedAt: patch.postedAt || new Date().toISOString() };
  await writeJson(file, updated, { mode: 0o600 });
  return updated;
}

export async function releaseFinalResultClaim(dateKey, guildId, gameId) {
  const file = finalResultClaimPath(dateKey, guildId, gameId);
  const current = await readJson(file, null).catch(() => null);
  if (current?.state === 'claimed' && Number(current.processId) === process.pid) await fs.unlink(file).catch(() => {});
}

export async function readDailyCache(dateKey, guildId = '') {
  const guildCache = await readJson(dailyCachePath(dateKey, guildId), null, { throwOnError: true });
  if (guildCache || !guildId) return guildCache;
  return readJson(dailyCachePath(dateKey), null, { throwOnError: true });
}

export async function writeDailyCache(dateKey, slate, guildId = slate?.guildId ?? '') {
  await writeJson(dailyCachePath(dateKey, guildId), slate);
}

export async function listDailyCaches(limit = 30, guildId = '') {
  await ensureDataDir();
  const safeId = safeGuildId(guildId);
  const pattern = safeId
    ? new RegExp(`^daily-${safeId}-\\d{4}-\\d{2}-\\d{2}\\.json$`, 'i')
    : /^daily-(?:[0-9a-z_-]+-)?\d{4}-\d{2}-\d{2}\.json$/i;
  const entries = await fs.readdir(dataDir).catch(() => []);
  const files = entries
    .filter((file) => pattern.test(file))
    .sort()
    .reverse()
    .slice(0, Math.max(1, Math.min(1095, Number(limit) || 30)));
  const rows = [];
  for (const file of files) {
    const slate = await readJson(path.join(dataDir, file), null, { throwOnError: true });
    if (slate) {
      const match = file.match(/(\d{4}-\d{2}-\d{2})\.json$/);
      rows.push({ file, dateKey: match?.[1] ?? String(file).slice(6, 16), slate });
    }
  }
  return rows;
}
