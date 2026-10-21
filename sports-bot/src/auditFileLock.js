import { open, mkdir, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { hostname } from 'node:os';

// Compatible with the existing journal writer's .lock protocol; never steal an owner lock.
export async function withAuditFileLock(file, operation) {
  await mkdir(dirname(file), { recursive: true });
  let lock;
  try { lock = await open(`${file}.lock`, 'wx', 0o600); }
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
