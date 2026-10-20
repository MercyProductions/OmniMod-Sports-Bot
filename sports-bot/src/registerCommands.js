import { REST, Routes } from 'discord.js';
import { config, requireRuntimeConfig } from './config.js';
import { buildCommands } from './commands.js';

requireRuntimeConfig();

const rest = new REST({ version: '10' }).setToken(config.discordToken);
const commands = buildCommands();

if (config.guildId) {
  await rest.put(
    Routes.applicationGuildCommands(config.clientId, config.guildId),
    { body: commands }
  );
  console.log(`Registered ${commands.length} OmniMod Sports command group(s) for guild ${config.guildId}.`);
} else {
  await rest.put(
    Routes.applicationCommands(config.clientId),
    { body: commands }
  );
  console.log(`Registered ${commands.length} OmniMod Sports command group(s) globally.`);
}

