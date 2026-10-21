import {acquireFinalClaim,completeFinalClaim,abandonFinalClaim,verifyFinalClaim,preserveFinalClaimMigration,inspectFinalClaim} from './finalClaimStore.js';
import fs from 'node:fs/promises';
import { withAuditFileLock } from './auditFileLock.js';
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
    if(entry.name.startsWith('final-result-')&&await preserveFinalClaimMigration(source,destination))continue;
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

// options.staleMs is retained for compatibility; time does not authorize ownership transfer.
export async function claimFinalResult(dateKey,guildId,gameId,details={},options={}){
  const frozenDetails=structuredClone(details),frozenOptions=structuredClone(options);
  await ensureDataDir();
  return acquireFinalClaim(finalResultClaimPath(dateKey,guildId,gameId),{dateKey,guildId:String(guildId||''),gameId:String(gameId||'')},frozenDetails,frozenOptions);
}
export async function readFinalResultClaim(dateKey,guildId,gameId){
  return inspectFinalClaim(finalResultClaimPath(dateKey,guildId,gameId),{dateKey,guildId:String(guildId||''),gameId:String(gameId||'')});
}
export async function verifyFinalResultClaim(dateKey,guildId,gameId,lease){
  return verifyFinalClaim(finalResultClaimPath(dateKey,guildId,gameId),{dateKey,guildId:String(guildId||''),gameId:String(gameId||'')},lease);
}
export async function finishFinalResult(dateKey,guildId,gameId,patch={},lease){
  return completeFinalClaim(finalResultClaimPath(dateKey,guildId,gameId),{dateKey,guildId:String(guildId||''),gameId:String(gameId||'')},patch,lease);
}
export async function releaseFinalResultClaim(dateKey,guildId,gameId,lease){
  return abandonFinalClaim(finalResultClaimPath(dateKey,guildId,gameId),{dateKey,guildId:String(guildId||''),gameId:String(gameId||'')},lease);
}

export async function readDailyCache(dateKey, guildId = '') {
  const guildCache = await readJson(dailyCachePath(dateKey, guildId), null, { throwOnError: true });
  if (guildCache || !guildId) return guildCache;
  return readJson(dailyCachePath(dateKey), null, { throwOnError: true });
}

const dailyCacheWrites = new Map();

function cacheRevision(slate) {
  const revision = slate?.cacheRevision ?? 0;
  if (!Number.isSafeInteger(revision) || revision < 0) throw new Error('Invalid daily cache revision.');
  return revision;
}

// Serialize local writers; the owner lock excludes other processes. A revision
// check is still required: locking a stale whole-object write would lose updates.
export async function writeDailyCache(dateKey, slate, guildId = slate?.guildId ?? '', options = {}) {
  const snapshot = structuredClone(slate);
  const expected = options.expectedRevision ?? cacheRevision(snapshot);
  if (!Number.isSafeInteger(expected) || expected < 0) throw new Error('Invalid expected daily cache revision.');
  const file = dailyCachePath(dateKey, guildId);
  const previous = dailyCacheWrites.get(file) ?? Promise.resolve();
  const operation = previous.catch(() => {}).then(() => withAuditFileLock(file, async () => {
    const current = await readJson(file, null, { throwOnError: true, redactErrors: true });
    const revision = cacheRevision(current);
    if (expected !== revision) {
      const error = new Error('Daily cache changed during this operation; reload before retrying.');
      error.code = 'DAILY_CACHE_CONFLICT';
      throw error;
    }
    if (revision === Number.MAX_SAFE_INTEGER) throw new Error('Daily cache revision exhausted.');
    const persisted = { ...snapshot, cacheRevision: revision + 1 };
    await writeJson(file, persisted);
    return persisted;
  }));
  dailyCacheWrites.set(file, operation);
  try { return await operation; }
  finally { if (dailyCacheWrites.get(file) === operation) dailyCacheWrites.delete(file); }
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
