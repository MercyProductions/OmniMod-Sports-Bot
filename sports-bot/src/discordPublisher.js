import {prepareFinalRevision} from './finalResultRevision.js';
import {finalResultFooter,finalResultKey,legacyFinalMessageMatches,matchesFinalResultFooter} from './finalResultIdentity.js';
import {journalGameIndex} from './journalEventMatch.js';
import {resolveSlateGame} from './slateEventIdentity.js';
import { recordPredictionJournal } from './predictionJournal.js';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits,
  RESTJSONErrorCodes
} from 'discord.js';
import { config } from './config.js';
import { writeDailyCache } from './storage.js';
import { withDailyPublication } from './dailyPublication.js';
import { getGuildSettings } from './guildSettings.js';
import { refreshPredictionValue, valueOpportunityLine } from './oddsValue.js';

const SPORTS_CHANNEL_NAME = 'omnimod-sports';
const RESULTS_CHANNEL_NAME = 'omnimod-sports-results';
const LOG_CHANNEL_NAME = 'omnimod-sports-logs';
const ROLE_NAME = 'Sports Alerts';
const BRAND_COLOR = 0x8b5cf6;
const SUCCESS_COLOR = 0x22c55e;
const DANGER_COLOR = 0xef4444;
const WARN_COLOR = 0xf59e0b;
const QUOTA_COLOR = 0xf97316;
const DISCORD_EMBED_TOTAL_LIMIT = 6000;
const DAILY_SLATE_CORE_BUDGET = 5200;
const DAILY_SLATE_TOTAL_BUDGET = 5900;

export const LOG_COLORS = {
  brand: BRAND_COLOR,
  success: SUCCESS_COLOR,
  danger: DANGER_COLOR,
  warn: WARN_COLOR,
  quota: QUOTA_COLOR
};

export function finalResultColor(predictionCorrect) {
  if (predictionCorrect === true) return SUCCESS_COLOR;
  if (predictionCorrect === false) return DANGER_COLOR;
  return WARN_COLOR;
}

function canManageGuild(member) {
  return Boolean(member?.permissions?.has(PermissionFlagsBits.ManageGuild));
}

export function isAdminInteraction(interaction) {
  if (!interaction.guild || !interaction.member) return false;
  return canManageGuild(interaction.member);
}

export async function resolveGuild(client, guildId = '') {
  const desiredGuildId = guildId || config.guildId;
  if (desiredGuildId) {
    const guild = await client.guilds.fetch(desiredGuildId);
    if (guild) return guild;
  }

  const guilds = await client.guilds.fetch();
  const first = guilds.first();
  return first ? client.guilds.fetch(first.id) : null;
}

async function fetchConfiguredChannel(client, id, guildId = '') {
  if (!id) return null;
  try {
    const channel = await client.channels.fetch(id);
    if (guildId && channel?.guildId && channel.guildId !== guildId) return null;
    return channel?.isTextBased?.() ? channel : null;
  } catch {
    return null;
  }
}

async function findTextChannel(guild, name) {
  const channels = await guild.channels.fetch();
  return channels.find((channel) =>
    channel &&
    channel.type === ChannelType.GuildText &&
    channel.name.toLowerCase() === name.toLowerCase()
  ) ?? null;
}

async function findConfiguredRole(guild, roleId = '') {
  if (roleId) {
    try {
      const role = await guild.roles.fetch(roleId);
      if (role) return role;
    } catch {
      // Continue to existing-name lookup.
    }
  }

  const roles = await guild.roles.fetch();
  return roles.find((role) => role.name.toLowerCase() === ROLE_NAME.toLowerCase()) ?? null;
}

async function findRoleById(guild, roleId = '') {
  if (!roleId) return null;
  try {
    return await guild.roles.fetch(roleId);
  } catch {
    return null;
  }
}

export async function setupGuildResources(client, guildId = '') {
  const guild = await resolveGuild(client, guildId);
  if (!guild) {
    throw new Error('The sports bot is not in any Discord server yet.');
  }

  const settings = await getGuildSettings(guild.id);
  const sportsChannel =
    await fetchConfiguredChannel(client, settings.sportsChannelId, guild.id) ||
    await findTextChannel(guild, SPORTS_CHANNEL_NAME);

  const resultsChannel =
    await fetchConfiguredChannel(client, settings.resultsChannelId, guild.id) ||
    await findTextChannel(guild, RESULTS_CHANNEL_NAME) ||
    sportsChannel;

  const logChannel =
    await fetchConfiguredChannel(client, settings.logChannelId, guild.id) ||
    await findTextChannel(guild, LOG_CHANNEL_NAME);

  const notifyRole = await findConfiguredRole(guild, settings.notifyRoleId);
  const adminRole = await findRoleById(guild, settings.adminRoleId);

  if (!sportsChannel) {
    throw new Error('OmniMod Sports is not configured for this server. Run /sports setup and assign a sports channel.');
  }

  return { guild, settings, sportsChannel, resultsChannel, logChannel, notifyRole, adminRole };
}

export async function logBotEvent(client, message, guildId = '', options = {}) {
  try {
    const resources = await setupGuildResources(client, guildId);
    if (resources.logChannel) {
      const pingAdmin = Boolean(options.pingAdmin && resources.adminRole);
      await resources.logChannel.send({
        content: pingAdmin ? `<@&${resources.adminRole.id}>` : '',
        embeds: [
          new EmbedBuilder()
            .setColor(options.color ?? BRAND_COLOR)
            .setTitle(options.title ?? 'OmniMod Sports bot event')
            .setDescription(message.slice(0, 3900))
            .setTimestamp(new Date())
        ],
        allowedMentions: pingAdmin ? { roles: [resources.adminRole.id] } : { parse: [] }
      });
    }
  } catch {
    // Avoid recursive logging failures.
  }
}

function compactText(value, maxLength, fallback = 'n/a') {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim() || fallback;
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 3))}...`;
}

function predictionField(prediction, game = null) {
  if(prediction.eventAssociationRejected)return {name:compactText(`#${prediction.index} ${prediction.league||'Sports'} | Event data unavailable`,120),value:`${compactText(prediction.matchup,72)}\nEvent observations could not be matched uniquely. Forecast and price details are hidden pending reconciliation.`,inline:false};
  if (['retrospective_ungraded', 'late_pregame', 'in_play'].includes(prediction.predictionMode)) {
    const score = game?.statusKey === 'final' && Number.isFinite(game.away?.score) && Number.isFinite(game.home?.score)
      ? `${game.away.abbr} ${game.away.score} - ${game.home.abbr} ${game.home.score}`
      : '';
    return {
      name: compactText(`#${prediction.index} ${compactText(prediction.league, 40, 'Sports')} | ${compactText(prediction.startTimeLocal, 32, 'TBD')}`, 120),
      value: `${compactText(prediction.matchup, 72)}\nNo pregame pick was recorded before this event started. Retrospective probabilities are hidden.${score ? `\nFinal: ${score} | Not eligible for grading` : ''}`,
      inline: false
    };
  }
  const statusSuffix = prediction.statusKey === 'final'
    ? `\nFinal: ${compactText(prediction.finalScore, 60, 'score unavailable')} | ${prediction.predictionCorrect === true ? 'Correct' : prediction.predictionCorrect === false ? 'Missed' : 'Not eligible for grading'}`
    : '';
  const uncertainty = Number.isFinite(Number(prediction.predictionUncertaintyPoints))
    ? ` | Unc: Ã‚Â±${Number(prediction.predictionUncertaintyPoints).toFixed(1)}pt`
    : '';
  const qualityNote = prediction.recommendationStatus === 'withheld'
    ? `\nHigh uncertainty: ${compactText(prediction.abstentionReason, 170, 'The leading outcome did not clear the uncertainty and evidence checks.')}`
    : prediction.recommendationStatus === 'lean_only' ? '\nDirectional lean: uncertainty is wider than a normal-strength forecast.' : '';
  return {
    name: compactText(`#${prediction.index} ${compactText(prediction.league, 40, 'Sports')} | ${compactText(prediction.startTimeLocal, 32, 'TBD')}`, 120),
    value:
      `${compactText(prediction.matchup, 72)}\n` +
      `Pick: **${compactText(prediction.predictedWinner, 64)}** | Win est.: **${compactText(prediction.predictionConfidence || prediction.confidence, 24)}** | API data: **${compactText(prediction.apiConfidence, 24)}**\n` +
      `Risk: ${compactText(prediction.riskTier, 32, 'Unknown')}${uncertainty} | Evidence: ${compactText(prediction.evidenceQuality || prediction.dataQuality, 32)} | Model vs consensus: ${compactText(prediction.edge, 32)}${qualityNote}${statusSuffix}` +
      (prediction.valueAnalysis ? `\n${compactText(valueOpportunityLine(prediction), 240)}` : ''),
    inline: false
  };
}

function formatSlatePresentation(slate) {
  const games=journalGameIndex(slate.games||[]);
  const predictions=(slate.predictions??[]).map(prediction=>{
    const association=resolveSlateGame(games,prediction);
    return association.game?refreshPredictionValue(prediction,association.game):{...prediction,eventAssociationRejected:association.reason};
  });
  const displayedPredictions = predictions.slice(0, 25);
  const embeds = [];
  const total = predictions.length;
  const chunks = [];
  for (let i = 0; i < displayedPredictions.length; i += 8) {
    chunks.push(displayedPredictions.slice(i, i + 8));
  }

  if (chunks.length === 0) {
    chunks.push([]);
  }

  chunks.forEach((chunk, chunkIndex) => {
    const embed = new EmbedBuilder()
      .setColor(BRAND_COLOR)
      .setTitle(chunkIndex === 0 ? `OmniMod Sports Daily Slate | ${slate.dateKey}` : `OmniMod Sports Daily Slate | Part ${chunkIndex + 1}`)
      .setDescription(
        chunkIndex === 0
          ? `Games tracked: **${total}**${total > displayedPredictions.length ? ` (showing ${displayedPredictions.length}; use /sports league, /sports upcoming, or /sports game for more)` : ''}\nSource: ${compactText(slate.source, 280)}\n${compactText(slate.disclaimer, 320, 'Informational research only.')}`
          : `More games from the ${slate.dateKey} slate.`
      )
      .setTimestamp(new Date(slate.generatedAt || Date.now()))
      .setFooter({ text: `Timezone: ${compactText(slate.timezone, 80, 'configured server timezone')}` });

    if (chunk.length === 0) {
      const sourceFailed = (slate.diagnostics || []).some((line) => /(?:HTTP 403|primary .*unavailable|CDN HTTP|official source: unavailable)/i.test(line));
      embed.addFields({
        name: sourceFailed ? 'Schedule data unavailable' : 'No games found',
        value: sourceFailed
          ? 'One or more schedule providers could not be reached. Zero tracked games does not establish that there are no games today; check the data-source diagnostics.'
          : 'No supported games were found for today. The bot will keep checking for final-score updates if a cached slate exists.',
        inline: false
      });
    } else {
      embed.addFields(chunk.map((prediction) => predictionField(prediction, resolveSlateGame(games,prediction).game)));
    }

    embeds.push(embed);
  });

  const embedLength = (embed) => {
    const data = embed.toJSON();
    return (data.title?.length || 0) + (data.description?.length || 0) +
      (data.author?.name?.length || 0) + (data.footer?.text?.length || 0) +
      (data.fields || []).reduce((total, field) => total + field.name.length + field.value.length, 0);
  };
  let shownCount = embeds.reduce((total, embed) => total + (embed.toJSON().fields || []).filter((field) => !['No games found', 'Schedule data unavailable'].includes(field.name)).length, 0);
  const updateOverview = () => {
    embeds[0].setDescription(
      `Games tracked: **${total}**${total > shownCount ? ` (showing ${shownCount}; use /sports league, /sports upcoming, or /sports game for more)` : ''}\n` +
      `Source: ${compactText(slate.source, 280)}\n` +
      compactText(slate.disclaimer, 320, 'Informational research only.')
    );
  };

  let usedCharacters = embeds.reduce((total, embed) => total + embedLength(embed), 0);
  while (usedCharacters > DAILY_SLATE_CORE_BUDGET && shownCount > 1) {
    const lastEmbed = embeds.at(-1);
    const fieldCount = lastEmbed.toJSON().fields?.length || 0;
    if (fieldCount > 0) {
      lastEmbed.spliceFields(fieldCount - 1, 1);
      shownCount -= 1;
    }
    if (lastEmbed !== embeds[0] && (lastEmbed.toJSON().fields?.length || 0) === 0) {
      embeds.pop();
    }
    updateOverview();
    usedCharacters = embeds.reduce((total, embed) => total + embedLength(embed), 0);
  }

  const diagnosticsBudget = Math.max(0, DAILY_SLATE_TOTAL_BUDGET - usedCharacters - 80);
  const diagnostics = (slate.diagnostics ?? []).slice(0, 12);
  if (diagnostics.length > 0 && diagnosticsBudget >= 120) {
    const description = diagnostics
      .map((line) => `- ${compactText(line, 500)}`)
      .join('\n')
      .slice(0, Math.min(3900, diagnosticsBudget));
    embeds.push(
      new EmbedBuilder()
        .setColor(0x6d28d9)
        .setTitle('Data-source diagnostics')
        .setDescription(description)
        .setTimestamp(new Date())
    );
  }

  const finalLength = embeds.reduce((total, embed) => total + embedLength(embed), 0);
  if (finalLength > DISCORD_EMBED_TOTAL_LIMIT) {
    throw new Error(`Daily slate formatter exceeded Discord's embed limit (${finalLength}/${DISCORD_EMBED_TOTAL_LIMIT}).`);
  }

  return { embeds, displayedPredictions: predictions.slice(0, shownCount).filter(row=>!row.eventAssociationRejected) };
}

export function formatSlateEmbeds(slate) {
  return formatSlatePresentation(slate).embeds;
}

export function alertRoleButtons() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('sports_alerts_opt_in')
        .setLabel('Notify me')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId('sports_alerts_opt_out')
        .setLabel('Remove alerts')
        .setStyle(ButtonStyle.Secondary)
    )
  ];
}

export async function findDailySlateMessage(client, dateKey, guildId = '', { strict = false } = {}) {
  try {
    const resources = await setupGuildResources(client, guildId);
    const expectedTitle = `OmniMod Sports Daily Slate | ${dateKey}`;
    let before;
    for (let page = 0; page < 5; page += 1) {
      const messages = await resources.sportsChannel.messages.fetch({ limit: 100, before });
      const match = messages.find((message) =>
        message.author?.id === client.user?.id &&
        message.embeds?.some((embed) => embed.title === expectedTitle)
      );
      if (match) return match;
      if (messages.size < 100) return null;
      before = messages.last()?.id;
      if (!before) {
        if (strict) throw new Error('Daily slate history search could not establish completeness.');
        return null;
      }
    }
    if (strict) throw new Error('Daily slate history search limit reached; publication deferred.');
    return null;
  } catch (error) {
    if (strict) throw new Error('Cannot verify daily slate history; publication deferred.', { cause: error });
    return null;
  }
}

export async function postDailySlate(client, slate, options = {}) {
  const snapshot = structuredClone(slate), settings = structuredClone(options);
  const resources = await setupGuildResources(client, settings.guildId || snapshot.guildId);
  return withDailyPublication(snapshot.dateKey, resources.guild.id, snapshot.cacheRevision ?? 0,
    verify => publishDailySlate(client, snapshot, settings, resources, verify));
}

async function publishDailySlate(client, slate, options, resources, verify) {
  const presentation = formatSlatePresentation(slate);
  const mention = resources.notifyRole ? `<@&${resources.notifyRole.id}> ` : '';
  const content = `${mention}Daily OmniMod Sports slate for **${slate.dateKey}**. Informational only; not wagering advice.`;
  const payload = {
    content,
    embeds: presentation.embeds,
    components: alertRoleButtons(),
    allowedMentions: resources.notifyRole ? { roles: [resources.notifyRole.id] } : { parse: [] }
  };

  let message = null;
  let created = false;
  let payloadWritten = false;
  if (!options.forceNew && slate.messageId && slate.channelId) {
    let existing;
    try {
      const channel = await client.channels.fetch(slate.channelId);
      existing = await channel.messages.fetch(slate.messageId);
    } catch (error) {
      // Only a confirmed missing resource permits discovery/replacement.
      if (![RESTJSONErrorCodes.UnknownChannel, RESTJSONErrorCodes.UnknownMessage].includes(Number(error?.code))) {
        throw new Error('Cannot verify cached slate message; publication deferred.', { cause: error });
      }
    }
    if (existing) {
      if (options.reuseExisting === false) await verify();
      message = options.reuseExisting === false ? await existing.edit(payload) : existing;
      payloadWritten = options.reuseExisting === false;
    }
  }

  // The Discord channel is the final duplicate guard when a cache file is
  // missing, moved, or a second app root starts with the same token.
  if (!message && options.allowDuplicate !== true) {
    const existing = await findDailySlateMessage(client, slate.dateKey, resources.guild.id, { strict: true });
    if (existing) {
      if (options.reuseExisting === false) await verify();
      message = options.reuseExisting === false ? await existing.edit(payload) : existing;
      payloadWritten = options.reuseExisting === false;
    }
  }

  if (!message) {
    await verify();
    message = await resources.sportsChannel.send(payload);
    created = true;
    payloadWritten = true;
  }

  let updated = {
    ...slate,
    guildId: resources.guild.id,
    messageId: message.id,
    channelId: message.channelId,
    notifyRoleId: resources.notifyRole?.id ?? slate.notifyRoleId ?? '',
    postedAt: new Date().toISOString()
  };
  // Transport evidence must survive a subsequent cache conflict.
  if (payloadWritten) await recordPredictionJournal({ ...updated, predictions: presentation.displayedPredictions }, { lifecycle: 'delivered' });
  updated = await writeDailyCache(updated.dateKey, updated, updated.guildId);
  if (created) {
    await logBotEvent(client, `Posted OmniMod Sports slate ${updated.dateKey} with ${updated.predictions.length} prediction(s).`, updated.guildId);
  }
  return updated;
}

export async function findFinalResultMessage(client, slate, prediction, existingResources = null) {
  let resources;
  try { resources = existingResources || await setupGuildResources(client, slate.guildId); }
  catch { throw new Error('Final-result history is unavailable; a new send is blocked'); }
  const channels = [];
  let uncertain=false;
  for (const channelId of [slate.channelId, resources.resultsChannel?.id]) {
    if (!channelId || channels.some((channel) => channel.id === channelId)) continue;
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if(channel?.isTextBased?.()&&(!channel.guildId||channel.guildId===slate.guildId))channels.push(channel);else uncertain=true;
  }
  if(!channels.length)throw new Error('Final-result history has no readable channel; a new send is blocked');
  for (const channel of channels) {
    try {
      let before;
      for (let page = 0; page < 5; page += 1) {
        const messages = await channel.messages.fetch({ limit: 100, before });
        const found = messages.find((message) => {
          if (message.author?.id !== client.user?.id) return false;
          return message.embeds.some((embed) => {
            if (matchesFinalResultFooter(embed.footer?.text,slate,prediction)) return true;
            if(legacyFinalMessageMatches(message,embed,slate,prediction))return true;
            if(embed.footer?.text===`OmniMod Sports result | ${slate.dateKey} | ${prediction.gameId}`){
              const fields=embed.fields||[],league=fields.find(row=>row.name==='League')?.value,started=fields.find(row=>row.name==='Started')?.value;
              const game=resolveSlateGame(journalGameIndex(slate.games||[]),prediction).game;
              if(!game||!league||!started||(league===game.league&&started===prediction.startTimeLocal))uncertain=true;
            }
            return false;
          });
        });
        if (found) return found;
        if (messages.size < 100) break;
        before = messages.last()?.id;
        if(!before||page===4)uncertain=true;
      }
    } catch {
      uncertain=true; // Still search the other channel for a definitive match.
    }
  }
  if(uncertain)throw new Error('Final-result history is incomplete; a new send is blocked');
  return null;
}

export async function postFinalResult(client, slate, final) {
  finalResultKey(slate,final.prediction);
  const resources = await setupGuildResources(client, slate.guildId);
  const prediction = final.prediction;
  const game = final.game;
  const correct = prediction.predictionCorrect === true;
  const graded = typeof prediction.predictionCorrect === 'boolean';
  const highUncertainty = prediction.recommendationStatus === 'withheld';
  const revision=prepareFinalRevision(slate,final),context=final.deliveryRevision||{};
  if(context.digest&&context.digest!==revision.digest)throw new Error('Final revision digest does not match the frozen result');
  const revisionFooter=finalResultFooter(slate,prediction)+' | result: '+revision.digest;
  if(context.editOnly&&(!context.previousMessageId||!context.previousChannelId||!/^[a-f0-9]{64}$/.test(context.previousResultDigest||''))){const error=new Error('Correction requires its bound previous revision');error.code='CORRECTION_BASELINE_UNVERIFIED';throw error;}
  let duplicate;
  if(context.previousMessageId&&context.previousChannelId){
    const channel=await client.channels.fetch(context.previousChannelId);
    if(channel.guildId&&channel.guildId!==slate.guildId)throw new Error('Correction target guild mismatch');
    duplicate=await channel.messages.fetch(context.previousMessageId);
    if(duplicate.author?.id!==client.user?.id||!duplicate.embeds.some(embed=>matchesFinalResultFooter(embed.footer?.text,slate,prediction)))throw new Error('Correction target does not match this event');
  }else duplicate=await findFinalResultMessage(client,slate,prediction,resources);
  if(duplicate?.embeds.some(embed=>embed.footer?.text===revisionFooter))return duplicate;
  if(duplicate&&context.editOnly&&!duplicate.embeds.some(embed=>embed.footer?.text===finalResultFooter(slate,prediction)+' | result: '+context.previousResultDigest)){const error=new Error('Correction target is not the verified preceding revision');error.code='CORRECTION_BASELINE_UNVERIFIED';throw error;}
  if(duplicate&&!context.editOnly){const error=new Error('Existing final result lacks a verified correction baseline; preserve the original message for review');error.code='CORRECTION_BASELINE_UNVERIFIED';throw error;}
  if(context.editOnly&&!duplicate)throw new Error('Original final message is unavailable; a correction cannot create a replacement');
  const uncertaintyWhy = [prediction.abstentionReason, ...(prediction.uncertaintyReasons || []).slice(0, 3)]
    .filter(Boolean).join(' ').slice(0, 1024) || 'The leading outcome did not clear the uncertainty and evidence gates.';
  const embed = new EmbedBuilder()
    .setColor(finalResultColor(prediction.predictionCorrect))
    .setTitle(`Final result #${prediction.index}: ${prediction.matchup}`)
    .setDescription(
      `Final score: **${prediction.finalScore}**\n` +
      `Pregame model pick: **${prediction.predictedWinner}** (${prediction.predictionConfidence || prediction.confidence}; ${prediction.predictionUncertainty || 'uncertainty not measured'})\n` +
      `API data quality at prediction time: **${prediction.apiConfidence || 'not measured'}**\n` +
      `Actual winner: **${prediction.actualWinner}**\n` +
      `Result: **${!graded ? 'Not gradeable' : correct ? 'Pregame forecast matched' : 'Pregame forecast missed'}**${highUncertainty ? ' (high uncertainty at prediction time)' : ''}` +
      (context.editOnly?'\nUpdated after a later final-score observation.':'')
    )
    .addFields(
      { name: 'League', value: game.league, inline: true },
      { name: 'Started', value: prediction.startTimeLocal, inline: true },
      { name: 'Evidence quality', value: prediction.evidenceQuality || prediction.dataQuality, inline: true },
      { name: 'Edge', value: prediction.edge ?? 'No market edge', inline: true },
      { name: 'Risk', value: prediction.riskTier ?? 'Unknown', inline: true },
      ...(highUncertainty ? [{ name: 'Pregame uncertainty', value: uncertaintyWhy, inline: false }] : [])
    )
    .setFooter({ text: revisionFooter })
    .setTimestamp(new Date());

  if(duplicate)return duplicate.edit({embeds:[embed],allowedMentions:{parse:[]}});
  let replyMessage = null;
  if (slate.messageId && slate.channelId) {
    let dailyMessage;
    try {
      const channel=await client.channels.fetch(slate.channelId);
      if(channel.guildId&&channel.guildId!==slate.guildId)throw new Error('Final result channel guild mismatch');
      dailyMessage=await channel.messages.fetch(slate.messageId);
    } catch(error) {
      if(error?.code!==RESTJSONErrorCodes.UnknownMessage)throw new Error('Daily-message access is uncertain; final-result send is blocked');
    }
    // A reply rejection can follow remote acceptance. Never turn it into another send.
    if(dailyMessage)replyMessage=await dailyMessage.reply({embeds:[embed],allowedMentions:{parse:[]}});
  }
  if(!replyMessage)replyMessage=await resources.resultsChannel.send({embeds:[embed],allowedMentions:{parse:[]}});

  return replyMessage;
}

export async function postRolePanel(client, guildId = '') {
  const resources = await setupGuildResources(client, guildId);
  const roleText = resources.notifyRole
    ? `Use these buttons to opt into or out of <@&${resources.notifyRole.id}> notifications.`
    : 'No Sports Alerts role is configured. Ask an admin to run /sports setup with an alert role.';
  const embed = new EmbedBuilder()
    .setColor(WARN_COLOR)
    .setTitle('OmniMod Sports alerts')
    .setDescription(`${roleText}\n\nYou will be pinged when the daily slate is posted.`)
    .setTimestamp(new Date());
  return resources.sportsChannel.send({
    embeds: [embed],
    components: alertRoleButtons(),
    allowedMentions: { parse: [] }
  });
}

export async function handleAlertButton(interaction) {
  if (!interaction.inGuild()) {
    await interaction.reply({ content: 'Sports alert roles only work inside the OmniMod Discord server.', ephemeral: true });
    return;
  }

  const resources = await setupGuildResources(interaction.client, interaction.guildId);
  if (!resources.notifyRole) {
    await interaction.reply({
      content: 'The Sports Alerts role is not configured yet. Ask an admin to run /sports setup.',
      ephemeral: true
    });
    return;
  }

  const member = await interaction.guild.members.fetch(interaction.user.id);
  if (interaction.customId === 'sports_alerts_opt_in') {
    await member.roles.add(resources.notifyRole, 'OmniMod Sports alert opt-in');
    await interaction.reply({ content: 'You will now receive OmniMod Sports daily slate alerts.', ephemeral: true });
    return;
  }

  await member.roles.remove(resources.notifyRole, 'OmniMod Sports alert opt-out');
  await interaction.reply({ content: 'Sports alerts removed.', ephemeral: true });
}
