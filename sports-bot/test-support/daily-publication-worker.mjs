import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fakeDiscord } from './discord-transport.mjs';
import { postDailySlate } from '../src/discordPublisher.js';

const [directory] = process.argv.slice(2);
if (!directory || process.env.NODE_ENV !== 'test') throw new Error('Synthetic publication worker requires isolated test configuration.');
const slate = JSON.parse(await readFile(join(directory, 'slate.json'), 'utf8'));
const remote = await fakeDiscord(directory), send = remote.channel.send;
remote.channel.send = async payload => {
  const released = new Promise(resolve => process.stdin.once('data', resolve));
  process.stdout.write('ready\n');
  await released;
  return send(payload);
};
await postDailySlate(remote.client, slate);
process.stdin.pause();
