import {createHash} from 'node:crypto';
import {validScore} from './dataValidation.js';
import path from 'node:path';
import { dataDir } from './config.js';
import { readJson, writeJson } from './storage.js';

const STORE_VERSION = 2;
const MAX_ROWS_PER_COLLECTION = 10_000;
const writeQueues = new Map();

function cleanText(value, max = 160) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function finiteOrNull(value) {
  if (value === '' || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function bounded(value, min, max, fallback = null) {
  const number = finiteOrNull(value);
  return number === null ? fallback : Math.max(min, Math.min(max, number));
}

function booleanValue(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  const text = String(value ?? '').trim().toLowerCase();
  if (!text) return fallback;
  if (['1', 'true', 'yes', 'y', 'on'].includes(text)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(text)) return false;
  return fallback;
}

export function normalizeEntityName(value) {
  return cleanText(value, 180)
    .toLowerCase()
    .replace(/\b(the|team|club|university|college|fc|sc|cf)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, '')
    .slice(0, 120);
}

function safeGuildId(guildId) {
  return cleanText(guildId, 100).replace(/[^0-9a-z_-]/gi, '') || 'default';
}

function storePath(guildId = '') {
  return path.join(dataDir, `intelligence-${safeGuildId(guildId)}.json`);
}

function emptyStore(guildId = '') {
  return {
    version: STORE_VERSION,
    guildId: String(guildId || ''),
    updatedAt: '',
    teams: {},
    players: {},
    contexts: {},
    games: {},
    results: {}
  };
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function recordKey(parts) {
  return parts.map(normalizeEntityName).filter(Boolean).join('__').slice(0, 240);
}

function teamKey(row) {
  return cleanText(row.id, 160) || recordKey([row.league || row.leagueKey, row.name || row.team]);
}

function playerKey(row) {
  return cleanText(row.id, 160) || recordKey([row.league || row.leagueKey, row.team, row.name || row.player]);
}

function contextKey(row) {
  return cleanText(row.id, 180) || cleanText(row.gameId, 180) || recordKey([
    row.dateKey || row.date,
    row.league || row.leagueKey,
    row.awayTeam || row.away,
    row.homeTeam || row.home
  ]);
}

function gameKey(row) {
  return cleanText(row.id, 180) || recordKey([
    row.dateKey || row.date || row.startTime,
    row.league || row.leagueKey,
    row.awayTeam || row.away,
    row.homeTeam || row.home
  ]);
}

function resultKey(row) {
  if(row.id)return cleanText(row.id,180);
  if(row.gameId||row.startTime)return 'manual-result-v2-'+createHash('sha256').update(JSON.stringify([row.dateKey,normalizeEntityName(row.leagueKey||row.league),normalizeEntityName(row.awayTeam),normalizeEntityName(row.homeTeam),row.gameId||null,row.startTime||null,row.awayScore,row.homeScore])).digest('hex');
  return recordKey([
    row.dateKey || row.date,
    row.league || row.leagueKey,
    row.awayTeam || row.away,
    row.homeTeam || row.home,
    row.awayScore,
    row.homeScore
  ]);
}

function normalizeStats(value) {
  if (!value) return {};
  let candidate = value;
  if (typeof value === 'string') {
    try { candidate = JSON.parse(value); } catch { return {}; }
  }
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return {};
  return Object.fromEntries(Object.entries(candidate).slice(0, 80).map(([key, item]) => {
    const cleanKey = cleanText(key, 60);
    const number = finiteOrNull(item);
    return [cleanKey, number === null ? cleanText(item, 120) : number];
  }).filter(([key]) => key));
}

function normalizeFactors(value) {
  if (!value) return {};
  let candidate = value;
  if (typeof value === 'string') {
    try { candidate = JSON.parse(value); } catch { throw new Error('Context factors must be valid JSON.'); }
  }
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    throw new Error('Context factors must be a JSON object.');
  }
  return Object.fromEntries(Object.entries(candidate).slice(0, 100).map(([key, item]) => {
    const cleanKey = cleanText(key, 60);
    if (typeof item === 'boolean') return [cleanKey, item];
    const number = finiteOrNull(item);
    return [cleanKey, number === null ? cleanText(item, 300) : number];
  }).filter(([key]) => key));
}

function normalizeTeam(row = {}, actor = '') {
  const name = cleanText(row.name ?? row.team, 120);
  const league = cleanText(row.league ?? row.leagueKey, 50);
  if (!name || !league) throw new Error('Every team row needs name and league.');
  const normalized = {
    id: teamKey({ ...row, name, league }),
    name,
    league,
    aliases: Array.isArray(row.aliases)
      ? row.aliases.map((item) => cleanText(item, 80)).filter(Boolean).slice(0, 20)
      : cleanText(row.aliases, 500).split(/[|,;]/).map((item) => cleanText(item, 80)).filter(Boolean).slice(0, 20),
    powerRating: bounded(row.powerRating ?? row.power ?? row.rating, 0, 100),
    elo: bounded(row.elo, 800, 2400),
    offense: bounded(row.offense, 0, 100),
    defense: bounded(row.defense, 0, 100),
    form: bounded(row.form ?? row.recentForm, 0, 100),
    coaching: bounded(row.coaching, 0, 100),
    chemistry: bounded(row.chemistry ?? row.lineupContinuity, 0, 100),
    homeAdvantage: bounded(row.homeAdvantage, -100, 100),
    restDays: bounded(row.restDays, 0, 30),
    travelKm: bounded(row.travelKm ?? row.travel, 0, 30_000),
    stats: normalizeStats(row.stats),
    notes: cleanText(row.notes, 1000),
    source: cleanText(row.source, 120) || 'manual',
    updatedAt: new Date().toISOString(),
    updatedBy: cleanText(actor || row.updatedBy, 100)
  };
  return normalized;
}

function normalizePlayer(row = {}, actor = '') {
  const name = cleanText(row.name ?? row.player, 120);
  const team = cleanText(row.team, 120);
  const league = cleanText(row.league ?? row.leagueKey, 50);
  if (!name || !team || !league) throw new Error('Every player row needs name, team, and league.');
  const availabilityInput = row.availability ?? row.availablePct ?? row.availabilityPct;
  let availability = bounded(availabilityInput, 0, 100, 100);
  const parsedAvailability = finiteOrNull(availabilityInput);
  if (parsedAvailability !== null && parsedAvailability <= 1) availability *= 100;
  return {
    id: playerKey({ ...row, name, team, league }),
    name,
    team,
    league,
    role: cleanText(row.role ?? row.position, 80),
    impact: bounded(row.impact ?? row.impactRating, -10, 10),
    rating: bounded(row.rating, 0, 100),
    availability,
    status: cleanText(row.status, 80) || (availability < 100 ? 'limited' : 'available'),
    form: bounded(row.form ?? row.recentForm, 0, 100),
    starter: booleanValue(row.starter, false),
    projectedMinutes: bounded(row.projectedMinutes ?? row.minutes, 0, 100),
    stats: normalizeStats(row.stats),
    notes: cleanText(row.notes, 1000),
    source: cleanText(row.source, 120) || 'manual',
    updatedAt: new Date().toISOString(),
    updatedBy: cleanText(actor || row.updatedBy, 100)
  };
}

function normalizeContext(row = {}, actor = '') {
  const id = contextKey(row);
  if (!id) throw new Error('Every context row needs gameId or date/league/away/home identifiers.');
  const expiresAt = cleanText(row.expiresAt, 40);
  if (expiresAt && !Number.isFinite(new Date(expiresAt).getTime())) throw new Error('Context expiresAt must be a valid ISO date/time.');
  return {
    id,
    gameId: cleanText(row.gameId, 180),
    dateKey: cleanText(row.dateKey ?? row.date, 20),
    league: cleanText(row.league ?? row.leagueKey, 50),
    awayTeam: cleanText(row.awayTeam ?? row.away, 120),
    homeTeam: cleanText(row.homeTeam ?? row.home, 120),
    factors: normalizeFactors(row.factors ?? row.context ?? row.data ?? row.json ?? {}),
    notes: cleanText(row.notes, 1000),
    source: cleanText(row.source, 120) || 'manual',
    expiresAt,
    updatedAt: new Date().toISOString(),
    updatedBy: cleanText(actor || row.updatedBy, 100)
  };
}

function normalizeGame(row = {}, actor = '') {
  const awayName = cleanText(row.awayTeam ?? row.away?.name ?? row.away, 120);
  const homeName = cleanText(row.homeTeam ?? row.home?.name ?? row.home, 120);
  const league = cleanText(row.league ?? row.leagueKey, 50);
  const startTime = cleanText(row.startTime ?? row.dateTime, 50);
  const dateKey = cleanText(row.dateKey ?? row.date, 20) || (startTime ? startTime.slice(0, 10) : '');
  if (!awayName || !homeName || !league || (!startTime && !dateKey)) {
    throw new Error('Every game row needs league, awayTeam, homeTeam, and startTime or dateKey.');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) throw new Error('Game dateKey must use YYYY-MM-DD format.');
  if (startTime && !Number.isFinite(new Date(startTime).getTime())) throw new Error('Game startTime must be a valid ISO date/time.');
  const id = gameKey({ ...row, awayTeam: awayName, homeTeam: homeName, league, dateKey, startTime });
  return {
    id,
    league,
    leagueKey: cleanText(row.leagueKey, 50) || league.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    sportGroup: cleanText(row.sportGroup ?? row.sport, 50),
    awayTeam: awayName,
    awayAbbr: cleanText(row.awayAbbr ?? row.away?.abbr, 20),
    awayRecord: cleanText(row.awayRecord ?? row.away?.record, 40),
    homeTeam: homeName,
    homeAbbr: cleanText(row.homeAbbr ?? row.home?.abbr, 20),
    homeRecord: cleanText(row.homeRecord ?? row.home?.record, 40),
    startTime: startTime || `${dateKey}T12:00:00`,
    dateKey,
    venue: cleanText(row.venue, 180),
    neutralSite: booleanValue(row.neutralSite, false),
    statusKey: cleanText(row.statusKey, 30) || 'scheduled',
    statusLabel: cleanText(row.statusLabel, 50) || 'Upcoming',
    notes: cleanText(row.notes, 1000),
    source: cleanText(row.source, 120) || 'manual schedule',
    updatedAt: new Date().toISOString(),
    updatedBy: cleanText(actor || row.updatedBy, 100)
  };
}

function normalizeResult(row = {}, actor = '') {
  const awayTeam = cleanText(row.awayTeam ?? row.away, 120);
  const homeTeam = cleanText(row.homeTeam ?? row.home, 120);
  const league = cleanText(row.league ?? row.leagueKey, 50);
  const dateKey = cleanText(row.dateKey ?? row.date, 20);
  const awayScore = validScore(row.awayScore);
  const homeScore = validScore(row.homeScore);
  if (!awayTeam || !homeTeam || !league || !dateKey || awayScore === null || homeScore === null) {
    throw new Error('Every result row needs dateKey, league, awayTeam, homeTeam, awayScore, and homeScore.');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) throw new Error('Result dateKey must use YYYY-MM-DD format.');
  const time=(value,label)=>{
    if(value===undefined||value===null||value==='')return null;
    if(typeof value!=='string'||!/[Tt].*(?:[Zz]|[+-]\d{2}:\d{2})$/.test(value)||!Number.isFinite(Date.parse(value)))throw new Error(label+' must be a timestamp with an explicit timezone');
    return new Date(value).toISOString();
  };
  const gameId=cleanText(row.gameId,180)||null,startTime=time(row.startTime,'Result startTime'),observedAt=time(row.observedAt,'Result observedAt');
  if(observedAt&&Date.parse(observedAt)>Date.now())throw new Error('Result observedAt cannot be in the future');
  const scoreBasis=cleanText(row.scoreBasis||'unknown',30).toLowerCase();
  if(!['unknown','regulation','full_game'].includes(scoreBasis))throw new Error('Result scoreBasis must be unknown, regulation or full_game');
  const sourceReference=cleanText(row.sourceReference,1500);
  if(sourceReference){let reference;try{reference=new URL(sourceReference);}catch{throw new Error('Result sourceReference must be a public HTTP(S) URL');}
    if(!['http:','https:'].includes(reference.protocol)||reference.username||reference.password)throw new Error('Result sourceReference must be HTTP(S) without embedded credentials');}

  return {
    id: resultKey({ ...row,gameId,startTime, awayTeam, homeTeam, league, dateKey, awayScore, homeScore }),
    gameId,startTime,observedAt,scoreBasis,sourceReference,sourceChecked:booleanValue(row.sourceChecked,false),
    dateKey,
    league,
    leagueKey: cleanText(row.leagueKey, 50) || league.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    sportGroup: cleanText(row.sportGroup ?? row.sport, 50),
    awayTeam,
    homeTeam,
    awayScore,
    homeScore,
    neutralSite: booleanValue(row.neutralSite, null),
    source: cleanText(row.source, 120) || 'manual result',
    notes: cleanText(row.notes, 1000),
    recordedAt: new Date().toISOString(),
    recordedBy: cleanText(actor || row.recordedBy, 100)
  };
}

const NORMALIZERS = {
  teams: normalizeTeam,
  players: normalizePlayer,
  contexts: normalizeContext,
  games: normalizeGame,
  results: normalizeResult
};

export async function readIntelligenceStore(guildId = '') {
  const raw = await readJson(storePath(guildId), null, { throwOnError: true });
  if (!raw || typeof raw !== 'object') return emptyStore(guildId);
  return {
    ...emptyStore(guildId),
    ...raw,
    teams: asObject(raw.teams),
    players: asObject(raw.players),
    contexts: asObject(raw.contexts),
    games: asObject(raw.games),
    results: asObject(raw.results)
  };
}

async function saveStore(guildId, store) {
  const next = { ...store, version: STORE_VERSION, guildId: String(guildId || ''), updatedAt: new Date().toISOString() };
  await writeJson(storePath(guildId), next, { mode: 0o600, backup: true });
  return next;
}

async function withStoreWriteLock(guildId, task) {
  const key = safeGuildId(guildId);
  const previous = writeQueues.get(key) || Promise.resolve();
  const next = previous.catch(() => {}).then(task);
  writeQueues.set(key, next);
  try {
    return await next;
  } finally {
    if (writeQueues.get(key) === next) writeQueues.delete(key);
  }
}

export async function upsertIntelligence(guildId, collection, row, actor = '') {
  const normalizer = NORMALIZERS[collection];
  if (!normalizer) throw new Error(`Unsupported intelligence collection: ${collection}`);
  return withStoreWriteLock(guildId, async () => {
    const store = await readIntelligenceStore(guildId);
    const candidate = normalizer(row, actor);
    const existing = store[collection][candidate.id];
    const normalized = existing
      ? normalizer({ ...existing, ...nonEmptyPatch(row), ...(collection==='results'?{sourceChecked:booleanValue(row.sourceChecked,false)}:{}),id: existing.id }, actor)
      : candidate;
    store[collection][normalized.id] = normalized;
    await saveStore(guildId, store);
    return normalized;
  });
}

export async function removeIntelligence(guildId, collection, idOrQuery) {
  if (!NORMALIZERS[collection]) throw new Error(`Unsupported intelligence collection: ${collection}`);
  return withStoreWriteLock(guildId, async () => {
    const store = await readIntelligenceStore(guildId);
    const query = normalizeEntityName(idOrQuery);
    const ids = Object.keys(store[collection]);
    const found = ids.find((id) => id === idOrQuery || normalizeEntityName(id) === query) || ids.find((id) => {
      const row = store[collection][id];
      return [row.name, row.team, row.gameId, row.awayTeam, row.homeTeam].some((value) => normalizeEntityName(value) === query);
    });
    if (!found) return null;
    const removed = store[collection][found];
    delete store[collection][found];
    await saveStore(guildId, store);
    return removed;
  });
}

export async function listIntelligence(guildId, collection, options = {}) {
  if (!NORMALIZERS[collection]) throw new Error(`Unsupported intelligence collection: ${collection}`);
  const store = await readIntelligenceStore(guildId);
  const query = normalizeEntityName(options.query || '');
  const league = normalizeEntityName(options.league || '');
  return Object.values(store[collection])
    .filter((row) => !league || normalizeEntityName(row.league || row.leagueKey) === league)
    .filter((row) => !query || JSON.stringify(row).toLowerCase().includes(String(options.query).toLowerCase()) || Object.values(row).some((value) => normalizeEntityName(value).includes(query)))
    .sort((a, b) => String(a.league || '').localeCompare(String(b.league || '')) || String(a.name || a.team || a.dateKey || '').localeCompare(String(b.name || b.team || b.dateKey || '')))
    .slice(0, Math.max(1, Math.min(500, Number(options.limit) || 100)));
}

function collectionRows(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return Object.values(value);
  return [];
}

function nonEmptyPatch(row) {
  return Object.fromEntries(Object.entries(row || {}).filter(([, value]) => value !== null && value !== undefined && value !== ''));
}

export async function importIntelligence(guildId, payload, options = {}) {
  return withStoreWriteLock(guildId, async () => {
    const store = await readIntelligenceStore(guildId);
    const actor = options.actor || '';
    const kind = options.kind && options.kind !== 'auto' ? `${options.kind}${String(options.kind).endsWith('s') ? '' : 's'}` : '';
    const source = kind ? { [kind]: Array.isArray(payload) ? payload : payload?.[kind] ?? [payload] } : payload;
    if (!source || typeof source !== 'object') throw new Error('Import payload must be a JSON object or array.');

    const counts = { teams: 0, players: 0, contexts: 0, games: 0, results: 0 };
    const errors = [];
    for (const [collection, normalizer] of Object.entries(NORMALIZERS)) {
      const rows = collectionRows(source[collection]).slice(0, MAX_ROWS_PER_COLLECTION);
      for (let index = 0; index < rows.length; index += 1) {
        try {
          const normalized = normalizer(rows[index], actor);
          store[collection][normalized.id] = normalized;
          counts[collection] += 1;
        } catch (error) {
          if (errors.length < 25) errors.push(`${collection}[${index}]: ${error.message}`);
        }
      }
    }
    if (!Object.values(counts).some(Boolean) && errors.length === 0) {
      throw new Error('No recognized collections found. Use teams, players, contexts, games, or results.');
    }
    await saveStore(guildId, store);
    return { counts, errors };
  });
}

export async function intelligenceInventory(guildId = '') {
  const store = await readIntelligenceStore(guildId);
  return {
    version: store.version,
    updatedAt: store.updatedAt,
    teams: Object.keys(store.teams).length,
    players: Object.keys(store.players).length,
    contexts: Object.keys(store.contexts).length,
    games: Object.keys(store.games).length,
    results: Object.keys(store.results).length
  };
}

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  const input = String(text ?? '').replace(/^\uFEFF/, '');
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (char === '"') {
      if (quoted && input[index + 1] === '"') { field += '"'; index += 1; }
      else quoted = !quoted;
    } else if (char === ',' && !quoted) {
      row.push(field); field = '';
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && input[index + 1] === '\n') index += 1;
      row.push(field); field = '';
      if (row.some((item) => item.trim())) rows.push(row);
      row = [];
    } else {
      field += char;
    }
  }
  row.push(field);
  if (row.some((item) => item.trim())) rows.push(row);
  if (rows.length < 2) return [];
  const headers = rows[0].map((item) => cleanText(item, 80));
  return rows.slice(1).map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ''])));
}

export function intelligenceSchemaExample() {
  return {
    teams: [{ name: 'Example Team', league: 'NBA', powerRating: 73, elo: 1580, offense: 76, defense: 70, form: 68, coaching: 75, chemistry: 80, notes: 'Update after material roster changes.' }],
    players: [{ name: 'Example Player', team: 'Example Team', league: 'NBA', role: 'starter', impact: 7.5, availability: 100, status: 'available', starter: true, form: 72, stats: { minutes: 34, plusMinus: 4.2 } }],
    contexts: [{ gameId: 'provider-game-id', factors: { homeRestDays: 2, awayRestDays: 1, homeTravelKm: 0, awayTravelKm: 900, weatherSeverity: 0, homeMotivation: 0.2, awayMotivation: 0 }, notes: 'Factors are optional; normalized values in -1..1 are preferred for subjective inputs.' }],
    games: [{ dateKey: '2099-01-02', startTime: '2099-01-02T19:00:00-06:00', league: 'NBA', leagueKey: 'nba', sportGroup: 'Basketball', awayTeam: 'Away Team', homeTeam: 'Home Team', venue: 'Example Arena' }],
    results: [{ dateKey: '2098-12-20', league: 'NBA', leagueKey: 'nba', awayTeam: 'Away Team', homeTeam: 'Home Team', awayScore: 101, homeScore: 108 }]
  };
}
