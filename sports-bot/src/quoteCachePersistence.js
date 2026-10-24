import { readDailyCache, writeDailyCache } from './storage.js';
import { mergeValueQuoteRefresh } from './quoteRefreshIdentity.js';

/** Retry only cache reconciliation, never provider requests or price issuance. */
export async function persistValueQuoteRefresh(base, refreshed, { read = readDailyCache, write = writeDailyCache, clock = Date.now, attempts = 3 } = {}) {
  base = structuredClone(base); refreshed = structuredClone(refreshed);
  const issued = refreshed?.issuedSlate;
  if (!issued || issued.dateKey !== base.dateKey || String(issued.guildId || '') !== String(base.guildId || '')) throw new Error('Price cache scope mismatch.');
  if (!Number.isSafeInteger(attempts) || attempts < 1 || attempts > 5) throw new Error('Invalid price cache retry bound.');
  for (let attempt = 0; attempt < attempts; attempt++) {
    const current = await read(base.dateKey, base.guildId);
    if (!current) throw new Error('Price cache disappeared; preserve issued evidence and reload.');
    if (current.dateKey !== base.dateKey || String(current.guildId || '') !== String(base.guildId || '')) throw new Error('Price cache scope mismatch.');
    const now = clock();
    if (!Number.isFinite(now)) throw new Error('Valid price reconciliation time is required.');
    const proposal = mergeValueQuoteRefresh(current, refreshed, now);
    try { return await write(base.dateKey, proposal, base.guildId); }
    catch (error) { if (error.code !== 'DAILY_CACHE_CONFLICT' || attempt + 1 === attempts) throw error; }
  }
}
