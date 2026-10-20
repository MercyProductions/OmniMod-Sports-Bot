import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.NODE_ENV = 'test';
process.env.OMNIMOD_DISABLE_DATA_MIGRATION = 'true';

// Never let tests inherit the owner's live Discord destination or runtime data.
for (const name of [
  'DISCORD_TOKEN',
  'DISCORD_CLIENT_ID',
  'DISCORD_GUILD_ID',
  'SPORTS_CHANNEL_ID',
  'SPORTS_RESULTS_CHANNEL_ID',
  'SPORTS_LOG_CHANNEL_ID'
]) process.env[name] = '';
process.env.POST_ON_START = 'false';
process.env.REGISTER_COMMANDS = 'false';

const isolatedDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omnimod-sports-suite-'));
process.env.OMNIMOD_SPORTS_DATA_DIR = isolatedDataDir;
process.once('exit', () => fs.rmSync(isolatedDataDir, { recursive: true, force: true }));
