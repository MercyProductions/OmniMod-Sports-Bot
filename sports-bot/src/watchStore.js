import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { dataDir } from './config.js';

const storePath = resolve(dataDir, 'watchlist.json');
let writeQueue = Promise.resolve();

function cleanTeam(value) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

function normalize(value) {
  return cleanTeam(value).toLowerCase();
}

async function readStore() {
  try {
    const raw = await readFile(storePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') throw new Error('invalid watch store');
    return { version: 1, users: parsed.users && typeof parsed.users === 'object' ? parsed.users : {} };
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      throw new Error('Could not read sports watchlist store; existing state was preserved.', { cause: error });
    }
    return { version: 1, users: {} };
  }
}

async function writeStore(store) {
  await mkdir(dataDir, { recursive: true });
  const tmpPath = `${storePath}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
  await writeFile(tmpPath, `${JSON.stringify({
    version: 1,
    updatedAt: new Date().toISOString(),
    users: store.users,
  }, null, 2)}\n`, 'utf8');
  await rename(tmpPath, storePath);
}

function withWriteLock(task) {
  const operation = writeQueue.catch(() => {}).then(task);
  writeQueue = operation;
  return operation;
}

export async function addWatch(userId, team) {
  const clean = cleanTeam(team);
  if (!clean) return [];
  return withWriteLock(async () => {
    const store = await readStore();
    const key = String(userId);
    const current = Array.isArray(store.users[key]) ? store.users[key] : [];
    const existing = new Set(current.map(normalize));
    if (!existing.has(normalize(clean))) current.push(clean);
    store.users[key] = current.slice(0, 25);
    await writeStore(store);
    return store.users[key];
  });
}

export async function removeWatch(userId, team) {
  const needle = normalize(team);
  return withWriteLock(async () => {
    const store = await readStore();
    const key = String(userId);
    const current = Array.isArray(store.users[key]) ? store.users[key] : [];
    store.users[key] = current.filter((item) => normalize(item) !== needle);
    await writeStore(store);
    return store.users[key];
  });
}

export async function listWatch(userId) {
  const store = await readStore();
  return Array.isArray(store.users[String(userId)]) ? store.users[String(userId)] : [];
}
