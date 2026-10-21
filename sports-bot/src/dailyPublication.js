import path from 'node:path';
import { acquireFinalClaim, abandonFinalClaim, verifyFinalClaim } from './finalClaimStore.js';
import { dailyCachePath, readJson } from './storage.js';

const pending = new Map();

// Keep this ledger below a subdirectory: legacy root-level JSON migration must
// not copy an ownership guard without its immutable generation records.
export function dailyPublicationPath(dateKey, guildId) {
  const cache = dailyCachePath(dateKey, guildId);
  return path.join(path.dirname(cache), 'daily-publication-claims', path.basename(cache));
}

export async function withDailyPublication(dateKey, guildId, expectedRevision, operation) {
  const identity = { dateKey, guildId: String(guildId), gameId: 'daily-slate-publication' };
  const file = dailyPublicationPath(dateKey, guildId);
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw new Error('Invalid daily publication revision.');
  const previous = pending.get(file) ?? Promise.resolve();
  const task = previous.catch(() => {}).then(async () => {
    const claim = await acquireFinalClaim(file, identity, { expectedRevision });
    if (!claim.claimed) {
      const error = new Error('Daily publication has an active or unverified owner; reload and retry later.');
      error.code = 'DAILY_PUBLICATION_BUSY';
      throw error;
    }
    const verify = () => verifyFinalClaim(file, identity, claim.lease);
    try {
      const current = await readJson(dailyCachePath(dateKey, guildId), null, { throwOnError: true, redactErrors: true });
      const revision = current?.cacheRevision ?? 0;
      if (!Number.isSafeInteger(revision) || revision < 0) throw new Error('Invalid daily cache revision.');
      if (revision !== expectedRevision) {
        const error = new Error('Daily cache changed before publication; reload before retrying.');
        error.code = 'DAILY_CACHE_CONFLICT';
        throw error;
      }
      return await operation(verify);
    } finally {
      await abandonFinalClaim(file, identity, claim.lease);
    }
  });
  pending.set(file, task);
  try { return await task; }
  finally { if (pending.get(file) === task) pending.delete(file); }
}
