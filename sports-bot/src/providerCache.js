import crypto from 'node:crypto';
import path from 'node:path';
import { dataDir } from './config.js';
import { readJson, writeJson } from './storage.js';

const inFlight = new Map();

function sanitizedUrl(rawUrl, secretParams = ['apiKey', 'key', 'token']) {
  const url = new URL(rawUrl);
  for (const name of secretParams) url.searchParams.delete(name);
  url.searchParams.sort();
  return url.toString();
}

function cachePath(namespace, rawUrl, secretParams, cacheDir = dataDir) {
  const safeNamespace = String(namespace || 'provider').replace(/[^a-z0-9_-]/gi, '').slice(0, 60) || 'provider';
  const digest = crypto.createHash('sha256').update(`${safeNamespace}:${sanitizedUrl(rawUrl, secretParams)}`).digest('hex');
  return path.join(cacheDir, 'provider-cache', `${safeNamespace}-${digest}.json`);
}

function publicHeaders(headers) {
  const allowed = [
    'etag',
    'last-modified',
    'x-requests-remaining',
    'x-requests-used',
    'x-requests-last'
  ];
  return Object.fromEntries(allowed.map((name) => [name, headers.get(name)]).filter(([, value]) => value !== null));
}

function fromCache(entry, state) {
  return {
    ok: true,
    status: Number(entry.status) || 200,
    json: entry.json,
    headers: entry.headers || {},
    error: '',
    cacheState: state,
    fetchedAt: entry.fetchedAt || '',
    cachedAt: entry.cachedAt || entry.fetchedAt || ''
  };
}

function fromNegativeCache(entry, state) {
  return {
    ok: false,
    status: Number(entry.status) || 0,
    json: null,
    headers: entry.headers || {},
    error: entry.error || `HTTP ${Number(entry.status) || 0}`,
    cacheState: state,
    fetchedAt: entry.fetchedAt || '',
    cachedAt: entry.cachedAt || entry.fetchedAt || ''
  };
}

export async function cachedFetchJson(rawUrl, options = {}) {
  const namespace = options.namespace || 'provider';
  const secretParams = options.secretParams || ['apiKey', 'key', 'token'];
  const file = cachePath(namespace, rawUrl, secretParams, options.cacheDir || dataDir);
  const key = file;
  if (inFlight.has(key)) return inFlight.get(key);

  const promise = (async () => {
    const now = Date.now();
    const ttlMs = Math.max(0, Number(options.ttlMs) || 0);
    const staleMs = Math.max(ttlMs, Number(options.staleMs) || ttlMs);
    const cached = await readJson(file, null);
    const fetchedTime = new Date(cached?.fetchedAt || '').getTime();
    const age = Number.isFinite(fetchedTime) && fetchedTime <= now ? now - fetchedTime : Infinity;
    if (!options.force && cached?.json !== undefined && age <= ttlMs) return fromCache(cached, 'fresh');
    const negativeTtlMs = Math.max(0, Number(options.negativeTtlMs) || 0);
    if (!options.force && cached?.failure === true && negativeTtlMs > 0 && age <= negativeTtlMs) {
      return fromNegativeCache(cached, 'negative_cache');
    }
    if (options.offline) {
      if (cached?.json !== undefined && age <= staleMs) return fromCache(cached, 'stale');
      return { ok: false, status: 0, json: null, headers: {}, error: 'offline mode and no usable provider cache', cacheState: 'miss', fetchedAt: '' };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(1000, Number(options.timeoutMs) || 12_000));
    try {
      const headers = {
        accept: 'application/json',
        'user-agent': 'OmniModSportsBot/6.0 (+https://omnimod.cc)'
      };
      if (Number.isFinite(age) && cached?.headers?.etag) headers['if-none-match'] = cached.headers.etag;
      if (Number.isFinite(age) && cached?.headers?.['last-modified']) headers['if-modified-since'] = cached.headers['last-modified'];
      const fetcher = options.fetch || globalThis.fetch;
      const response = await fetcher(rawUrl, { signal: controller.signal, headers });
      if (response.status === 304 && cached?.json !== undefined && Number.isFinite(age)) {
        const refreshed = {
          ...cached,
          json: typeof options.transformJson === 'function' ? options.transformJson(cached.json) : cached.json,
          fetchedAt: new Date().toISOString(),
          cachedAt: new Date().toISOString()
        };
        await writeJson(file, refreshed, { mode: 0o600, compact: true });
        return fromCache(refreshed, 'revalidated');
      }
      const text = await response.text();
      let json = null;
      try { json = text ? JSON.parse(text) : null; } catch { json = null; }
      if (response.ok && json !== null) {
        const storedJson = typeof options.transformJson === 'function' ? options.transformJson(json) : json;
        const entry = {
          version: 1,
          request: sanitizedUrl(rawUrl, secretParams),
          status: response.status,
          headers: publicHeaders(response.headers),
          json: storedJson,
          fetchedAt: new Date().toISOString(),
          cachedAt: new Date().toISOString()
        };
        await writeJson(file, entry, { mode: 0o600, compact: true });
        return fromCache(entry, 'network');
      }
      if ([401, 403, 404].includes(response.status) && negativeTtlMs > 0) {
        const entry = {
          version: 1,
          request: sanitizedUrl(rawUrl, secretParams),
          failure: true,
          status: response.status,
          headers: publicHeaders(response.headers),
          error: `HTTP ${response.status}`,
          fetchedAt: new Date().toISOString(),
          cachedAt: new Date().toISOString()
        };
        await writeJson(file, entry, { mode: 0o600, compact: true });
        return fromNegativeCache(entry, 'network');
      }
      if (cached?.json !== undefined && age <= staleMs) {
        return { ...fromCache(cached, 'stale'), upstreamError: `HTTP ${response.status}`, upstreamStatus: response.status };
      }
      return {
        ok: false,
        status: response.status,
        json,
        headers: publicHeaders(response.headers),
        error: `HTTP ${response.status}`,
        cacheState: 'miss',
        fetchedAt: ''
      };
    } catch (error) {
      if (cached?.json !== undefined && age <= staleMs) {
        return { ...fromCache(cached, 'stale'), upstreamError: error instanceof Error ? error.message : String(error), upstreamStatus: 0 };
      }
      return {
        ok: false,
        status: 0,
        json: null,
        headers: {},
        error: error instanceof Error ? error.message : String(error),
        cacheState: 'miss',
        fetchedAt: ''
      };
    } finally {
      clearTimeout(timer);
    }
  })();

  inFlight.set(key, promise);
  try {
    return await promise;
  } finally {
    inFlight.delete(key);
  }
}
