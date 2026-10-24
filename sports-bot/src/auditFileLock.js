import fs, { mkdir, unlink } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { dirname } from 'node:path';
import { hostname } from 'node:os';

// Windows can deny CREATE_NEW while an earlier closed file is delete-pending.
// Retry only creation, always with wx; never inspect, delete or reclaim another owner.
async function openOwnerLock(file) {
  for (let attempt = 0; ; attempt++) {
    try { return await fs.open(file, 'wx', 0o600); }
    catch (error) {
      if (process.platform !== 'win32' || error.code !== 'EPERM' || attempt >= 4) throw error;
      await delay(10 * 2 ** attempt);
    }
  }
}

// Compatible with the existing journal writer's .lock protocol; never steal an owner lock.
export async function withAuditFileLock(file, operation) {
  await mkdir(dirname(file), { recursive: true });
  let lock;
  try { lock = await openOwnerLock(`${file}.lock`); }
  catch (error) {
    if (error.code === 'EEXIST') throw new Error('Audit store is locked; preserve its owner lock and retry later.');
    throw error;
  }
  try {
    await lock.writeFile(JSON.stringify({ pid: process.pid, host: hostname(), acquiredAt: new Date().toISOString() }) + '\n');
    return await operation();
  } finally {
    await lock.close();
    await unlink(`${file}.lock`);
  }
}
