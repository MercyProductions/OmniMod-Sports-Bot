// One-time maintenance: correct existing final-result colors without changing
// any forecast, score, wording, or message order. Dry-run unless --apply.
import 'dotenv/config';

const dateKey = process.argv.find((arg) => /^--date=\d{4}-\d{2}-\d{2}$/.test(arg))?.slice(7);
const channelId = process.argv.find((arg) => /^--channel=\d+$/.test(arg))?.slice(10);
const apply = process.argv.includes('--apply');
const token = process.env.DISCORD_TOKEN;
const botId = process.env.DISCORD_CLIENT_ID || '1522283367767212255';

if (!dateKey || !channelId || !token) {
  throw new Error('Usage: node scripts/recolor-final-results.js --date=YYYY-MM-DD --channel=ID [--apply] (DISCORD_TOKEN required)');
}

const base = `https://discord.com/api/v10/channels/${channelId}/messages`;
const headers = { Authorization: `Bot ${token}` };
async function discordRequest(url, options = {}) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const response = await fetch(url, { ...options, headers: { ...headers, ...options.headers } });
    if (response.status !== 429) return response;
    const body = await response.json();
    const seconds = Number(body.retry_after);
    if (!Number.isFinite(seconds) || seconds < 0 || seconds > 60 || attempt === 5) {
      throw new Error('Discord rate limit did not provide a safe retry window');
    }
    await new Promise((resolve) => setTimeout(resolve, Math.ceil(seconds * 1000) + 250));
  }
}
let before = '';
let examined = 0;
let planned = 0;
let changed = 0;
for (let page = 0; page < 5; page += 1) {
  const response = await discordRequest(`${base}?limit=100${before ? `&before=${before}` : ''}`);
  if (!response.ok) throw new Error(`Discord message list failed: HTTP ${response.status}`);
  const messages = await response.json();
  if (!messages.length) break;
  for (const message of messages) {
    if (message.author?.id !== botId) continue;
    const embed = message.embeds?.find((item) => item.footer?.text?.startsWith(`OmniMod Sports result | ${dateKey} | `));
    if (!embed) continue;
    examined += 1;
    const description = embed.description || '';
    const pick = description.match(/Pregame model pick: \*\*(.*?)\*\*/)?.[1];
    const actual = description.match(/Actual winner: \*\*(.*?)\*\*/)?.[1];
    const grade = description.match(/Result: \*\*(Pregame forecast matched|Pregame forecast missed)\*\*/)?.[1];
    if (!pick || !actual || !grade) throw new Error(`Unrecognized result message ${message.id}`);
    const matched = pick === actual;
    if (matched !== (grade === 'Pregame forecast matched')) {
      throw new Error(`Pick, winner, and grade disagree in message ${message.id}`);
    }
    const color = matched ? 0x22c55e : 0xef4444;
    if (embed.color === color) continue;
    planned += 1;
    console.log(`${apply ? 'Updating' : 'Would update'} ${message.id}: ${embed.title} -> ${matched ? 'green' : 'red'}`);
    if (!apply) continue;
    const { type, content_scan_version, ...original } = embed;
    const edited = { ...original, color };
    const update = await discordRequest(`${base}/${message.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ embeds: [edited] })
    });
    if (!update.ok) throw new Error(`Discord message update failed: HTTP ${update.status} for ${message.id}`);
    const saved = await update.json();
    if (saved.embeds?.[0]?.color !== color) throw new Error(`Discord did not save expected color for ${message.id}`);
    changed += 1;
  }
  if (messages.length < 100) break;
  before = messages.at(-1).id;
}
console.log(`${apply ? 'Updated' : 'Would update'} ${apply ? changed : planned} messages; examined ${examined} matching results.`);
