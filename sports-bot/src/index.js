import {recordPredictionJournal} from './predictionJournal.js';
import {
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits
} from 'discord.js';
import { config, requireRuntimeConfig } from './config.js';
import { buildCommands } from './commands.js';
import { formatValueDetails, refreshPredictionValue, valueOpportunityLine } from './oddsValue.js';
import { refreshValueQuotes } from './valueQuoteRefresh.js';
import { buildDailySlate, refreshFinalGrades, supportedLeagues } from './sportsData.js';
import { duePregameRefreshes, completeAndJournalPregameRefresh, nextPregameRefresh } from './pregameRefresh.js';
import { recordSlateSnapshot } from './featureWarehouse.js';
import { pendingFinalDateKeys } from './finalReconciliation.js';
import { localDateKey, isDailyPostTime } from './time.js';
import {
  claimFinalResult,
  claimDailyProviderUsage,
  finishFinalResult,
  finishDailyProviderUsage,
  listDailyCaches,
  readDailyCache,
  readDailyProviderUsage,
  releaseFinalResultClaim,
  writeDailyCache
} from './storage.js';
import { addWatch, listWatch, removeWatch } from './watchStore.js';
import { getGuildSettings, listConfiguredGuildIds, maskSecret, postingConfigurationStatus, updateGuildSettings } from './guildSettings.js';
import { handleSportsDataCommand } from './dataCommandHandler.js';
import {
  handleAlertButton,
  isAdminInteraction,
  LOG_COLORS,
  findDailySlateMessage,
  logBotEvent,
  postDailySlate,
  postFinalResult,
  postRolePanel
} from './discordPublisher.js';

requireRuntimeConfig();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds
  ]
});

const runtimeState = {
  state: 'booting',
  phase: 'initializing',
  discordReady: false,
  discordUser: '',
  guildCount: 0,
  postingConfigured: null,
  postingGuildCount: 0,
  postingConfiguration: 'Posting destinations have not been checked yet.',
  wsStatus: 'unknown',
  loginAttempts: 0,
  lastReadyAt: '',
  lastDisconnectAt: '',
  lastInteractionAt: '',
  lastSchedulerAt: '',
  lastPregameRefreshAt: '',
  nextPregameRefreshAt: '',
  lastError: '',
  updatedAt: new Date().toISOString()
};

const slateRefreshRunning = new Set();
const finalRefreshRunning = new Set();
const pregameRefreshRunning = new Set();
const dailyBuildPromises = new Map();
const lastScheduledPostKey = new Map();
const lastFinalCheckAt = new Map();
const lastProviderAlertAt = new Map();
let shutdownRequested = false;
let resolveWorkerReady = () => {};
let rejectWorkerReady = () => {};
let postingConfigurationWarningLogged = false;

export const workerReady = new Promise((resolve, reject) => {
  resolveWorkerReady = resolve;
  rejectWorkerReady = reject;
});

function nowLabel() {
  return new Date().toISOString();
}

function safeIsoLabel(value, fallback = 'Unavailable') {
  const date = new Date(value || '');
  return Number.isFinite(date.getTime()) ? date.toISOString() : fallback;
}

function updateRuntimeState(patch = {}) {
  Object.assign(runtimeState, patch, {
    discordReady: client.isReady(),
    discordUser: client.user?.tag ?? runtimeState.discordUser,
    guildCount: client.guilds.cache.size,
    wsStatus: String(client.ws?.status ?? 'unknown'),
    updatedAt: nowLabel()
  });
}

function serializeError(error) {
  return error instanceof Error ? error.stack || error.message : String(error);
}

function recordWorkerError(label, error) {
  const message = serializeError(error);
  updateRuntimeState({
    state: client.isReady() ? 'degraded' : 'error',
    phase: label,
    lastError: `${label}: ${message}`
  });
  console.error(`[${nowLabel()}] ${label}:`, error);
}

async function runBackgroundTask(label, task) {
  try {
    updateRuntimeState({ phase: label });
    await task();
  } catch (error) {
    recordWorkerError(label, error);
  }
}

export function getRuntimeState() {
  updateRuntimeState();
  return { ...runtimeState };
}

function recordPostingConfiguration(guildIds) {
  const status = postingConfigurationStatus(guildIds);
  if (!status.postingConfigured && !postingConfigurationWarningLogged) {
    console.warn(`[${nowLabel()}] ${status.postingConfiguration}`);
    postingConfigurationWarningLogged = true;
  } else if (status.postingConfigured && postingConfigurationWarningLogged) {
    console.log(`[${nowLabel()}] ${status.postingConfiguration}`);
    postingConfigurationWarningLogged = false;
  }
  updateRuntimeState(status);
}

function providerAlertSummary(alerts) {
  const sports = [...new Set(alerts.map((alert) => alert.sportKey).filter(Boolean))];
  const statuses = [...new Set(alerts.map((alert) => alert.status).filter(Boolean))];
  const messages = [...new Set(alerts.map((alert) => String(alert.message || '').trim()).filter(Boolean))];
  return {
    sports: sports.length ? sports.join(', ') : 'unknown sport feeds',
    statuses: statuses.length ? statuses.join(', ') : 'unknown',
    message: messages[0] || 'The sports provider reported a degraded state.'
  };
}

async function emitProviderAlertGroup(type, alerts, reason, guildId = '') {
  if (!alerts.length) return;
  const summary = providerAlertSummary(alerts);
  const key = `${guildId || 'default'}:${type}:${summary.sports}:${localDateKey()}`;
  const now = Date.now();
  const previous = lastProviderAlertAt.get(key) || 0;
  if (now - previous < 6 * 60 * 60 * 1000) return;
  lastProviderAlertAt.set(key, now);

  const isLimit = type === 'odds_api_limit';
  const title = isLimit ? 'Odds API quota alert' : 'Sports provider authorization alert';
  const action = isLimit
    ? 'The bot will continue with cached scoreboards and local intelligence. Update the Odds API plan/key only if optional market consensus is desired.'
    : 'The saved provider key may be invalid or unauthorized. Rotate it with `/sports api-key` or clear it with `/sports api-clear`.';

  await logBotEvent(
    client,
    `Provider: **The Odds API**\n` +
      `Reason: ${reason}\n` +
      `Affected feeds: ${summary.sports}\n` +
      `Provider status: ${summary.statuses}\n` +
      `Provider message: ${summary.message}\n\n` +
      action,
    guildId,
    {
      title,
      color: isLimit ? LOG_COLORS.quota : LOG_COLORS.warn,
      pingAdmin: true
    }
  );
}

async function emitProviderAlerts(slate, reason, guildId = '') {
  const alerts = Array.isArray(slate?.alerts) ? slate.alerts : [];
  if (!alerts.length) return;
  await emitProviderAlertGroup('odds_api_limit', alerts.filter((alert) => alert.type === 'odds_api_limit'), reason, guildId || slate.guildId);
  await emitProviderAlertGroup('odds_api_auth', alerts.filter((alert) => alert.type === 'odds_api_auth'), reason, guildId || slate.guildId);
}

async function registerCommandsForConnectedGuilds() {
  if (!config.registerCommands) return;
  const commands = buildCommands();

  if (config.guildId) {
    const guild = await client.guilds.fetch(config.guildId);
    await guild.commands.set(commands);
    console.log(`[${nowLabel()}] Registered OmniMod Sports commands in ${guild.name}.`);
    return;
  }

  const guilds = await client.guilds.fetch();
  for (const partial of guilds.values()) {
    const guild = await client.guilds.fetch(partial.id);
    await guild.commands.set(commands);
    console.log(`[${nowLabel()}] Registered OmniMod Sports commands in ${guild.name}.`);
  }
}

async function buildDailySlateOnce(reason, guildId = '', options = {}) {
  const dateKey = localDateKey();
  const buildKey = `${guildId || 'default'}:${dateKey}`;
  const inFlight = dailyBuildPromises.get(buildKey);
  if (inFlight) return inFlight;

  const buildPromise = (async () => {
    const cached = await readDailyCache(dateKey, guildId);
    const cacheUsesCurrentModel = Number(cached?.schemaVersion || 0) >= 6;
    if (cached && cacheUsesCurrentModel && !options.recalculate) return cached;

    const channelMessage = await findDailySlateMessage(client, dateKey, guildId);
    const settings = await getGuildSettings(guildId);
    const previousUsage = await readDailyProviderUsage(dateKey, guildId);
    let providerClaim = { claimed: false, usage: previousUsage };

    if (!cached && !options.recalculate && !channelMessage && settings.oddsApiKey && !previousUsage) {
      providerClaim = await claimDailyProviderUsage(dateKey, guildId, 'odds-api', {
        reason,
        processId: process.pid
      });
    }

    const slate = await buildDailySlate(new Date(), {
      guildId,
      includeOdds: providerClaim.claimed,
      cachedSlate: cached
    });
    const completedUsage = providerClaim.claimed
      ? await finishDailyProviderUsage(dateKey, guildId, 'odds-api', {
          result: slate.alerts?.length ? 'provider_alert' : 'completed',
          alertTypes: [...new Set((slate.alerts ?? []).map((alert) => alert.type).filter(Boolean))],
          predictionCount: slate.predictions?.length ?? 0
        })
      : providerClaim.usage;

    const durableSlate = {
      ...slate,
      guildId,
      messageId: cached?.messageId || channelMessage?.id || '',
      channelId: cached?.channelId || channelMessage?.channelId || '',
      postedAt: cached?.postedAt || channelMessage?.createdAt?.toISOString?.() || '',
      finalReplies: cached?.finalReplies || {},
      providerDailyUsage: completedUsage || cached?.providerDailyUsage || {
        provider: 'odds-api',
        dateKey,
        state: channelMessage ? 'skipped_existing_discord_post' : 'skipped_no_key',
        reason
      }
    };
    await writeDailyCache(dateKey, durableSlate, guildId);
    console.log(
      `[${nowLabel()}] Created durable daily cache for ${dateKey}, guild=${guildId || 'default'}, ` +
      `providerBatch=${providerClaim.claimed ? 'claimed' : 'skipped'}, discordPost=${channelMessage ? 'recovered' : 'none'}, reason=${reason}.`
    );
    return durableSlate;
  })();

  dailyBuildPromises.set(buildKey, buildPromise);
  try {
    return await buildPromise;
  } finally {
    dailyBuildPromises.delete(buildKey);
  }
}

async function refreshAndPostDailySlate(reason, options = {}) {
  const guildId = options.guildId || config.guildId || '';
  const runningKey = guildId || 'global';
  if (slateRefreshRunning.has(runningKey)) {
    console.log(`[${nowLabel()}] Slate refresh skipped for ${runningKey}; another refresh is already running.`);
    return null;
  }

  slateRefreshRunning.add(runningKey);
  try {
    const slate = await buildDailySlateOnce(reason, guildId, { recalculate: options.recalculate === true });
    const posted = await postDailySlate(client, slate, {
      forceNew: false,
      reuseExisting: options.updateExisting !== true,
      guildId
    });
    if (!slate.messageId) {
      await emitProviderAlerts(posted, reason, posted.guildId || guildId);
    }
    console.log(`[${nowLabel()}] Daily slate ready with ${posted.predictions.length} prediction(s), guild=${posted.guildId || guildId || 'default'}, reason=${reason}.`);
    return posted;
  } catch (error) {
    const message = error instanceof Error ? error.stack || error.message : String(error);
    console.error(`[${nowLabel()}] Daily slate post failed: ${message}`);
    await logBotEvent(client, `Daily slate post failed (${reason}): ${message}`, guildId);
    return null;
  } finally {
    slateRefreshRunning.delete(runningKey);
  }
}

async function checkFinalScores(reason = 'timer', guildId = config.guildId || '', targetDateKey = localDateKey()) {
  const runningKey = guildId || 'global';
  if (finalRefreshRunning.has(runningKey) || pregameRefreshRunning.has(runningKey) || slateRefreshRunning.has(runningKey)) return;
  finalRefreshRunning.add(runningKey);
  try {
    const dateKey = targetDateKey;
    const cached = await readDailyCache(dateKey, guildId);
    if (!cached) return;
    const now = Date.now();
    const gamesThatCouldHaveFinished = (cached.games ?? []).filter((game) => {
      if (game.statusKey === 'alert') return false;
      if (game.statusKey === 'final') return !cached.finalReplies?.[game.id]
        && (cached.predictions || []).some(row => String(row.gameId) === String(game.id) && row.predictionMode === 'pregame');
      const start = new Date(game.startTime).getTime();
      return Number.isFinite(start) && start <= now;
    });
    if (!gamesThatCouldHaveFinished.length) return;

    const refreshed = await refreshFinalGrades(cached, { guildId });
    const finalReplies = { ...(cached.finalReplies ?? {}) };
    let postedCount = 0;

    for (const final of refreshed.newFinals ?? []) {
      const gameId = final.prediction.gameId;
      if (finalReplies[gameId]) continue;
      const resultClaim = await claimFinalResult(dateKey, guildId, gameId, { reason });
      if (!resultClaim.claimed) continue;
      try {
        const message = await postFinalResult(client, refreshed, final);
        const reply = {
          messageId: message.id, channelId: message.channelId, postedAt: new Date().toISOString(),
          correct: final.prediction.predictionCorrect
        };
        finalReplies[gameId] = reply;
        await finishFinalResult(dateKey, guildId, gameId, reply);
        postedCount += 1;
      } catch (error) {
        await releaseFinalResultClaim(dateKey, guildId, gameId);
        throw error;
      }
    }

    const latest = await readDailyCache(dateKey, guildId) || cached;
    const durableFinals = {
      ...latest,
      games: refreshed.games,
      predictions: refreshed.predictions,
      diagnostics: refreshed.diagnostics,
      refreshedAt: refreshed.refreshedAt,
      guildId,
      finalReplies: { ...(latest.finalReplies ?? {}), ...finalReplies },
      newFinals: []
    };
    await writeDailyCache(dateKey, durableFinals, guildId);
    if (config.featureWarehouseEnabled) await recordSlateSnapshot(durableFinals);

    if (postedCount > 0) {
      console.log(`[${nowLabel()}] Posted ${postedCount} final-score update(s), reason=${reason}.`);
      await logBotEvent(client, `Posted ${postedCount} final-score update(s), reason=${reason}.`, guildId);
    }
  } catch (error) {
    const message = error instanceof Error ? error.stack || error.message : String(error);
    console.error(`[${nowLabel()}] Final-score check failed: ${message}`);
    await logBotEvent(client, `Final-score check failed (${reason}): ${message}`, guildId);
  } finally {
    finalRefreshRunning.delete(runningKey);
  }
}

async function refreshDuePregameGames(reason = 'timer', guildId = config.guildId || '') {
  if (!config.pregameRefreshEnabled) return null;
  const runningKey = guildId || 'global';
  if (pregameRefreshRunning.has(runningKey) || slateRefreshRunning.has(runningKey) || finalRefreshRunning.has(runningKey)) return null;
  pregameRefreshRunning.add(runningKey);
  try {
    const dateKey = localDateKey();
    const cached = await readDailyCache(dateKey, guildId);
    if (!cached) return null;
    if (cached.pregameRefreshDeliveryPending) {
      const delivered = await postDailySlate(client, cached, { forceNew: false, reuseExisting: false, guildId });
      const acknowledged = { ...delivered, pregameRefreshDeliveryPending: false };
      await writeDailyCache(dateKey, acknowledged, guildId);
      return acknowledged;
    }
    const due = duePregameRefreshes(cached, new Date(), { windows: config.pregameRefreshWindows });
    const next = nextPregameRefresh(cached, new Date(), { windows: config.pregameRefreshWindows });
    runtimeState.nextPregameRefreshAt = next?.dueAt || '';
    if (!due.length) return null;
    const refreshIds = due.map((row) => row.gameId);
    const dueLeagues = [...new Set((cached.games || []).filter((game) => refreshIds.includes(String(game.id))).map((game) => game.leagueKey).filter(Boolean))];
    const stages = Object.fromEntries(due.map((row) => [row.gameId, row.stage]));
    const attemptedAt = nowLabel();
    const slate = await buildDailySlate(new Date(), {
      guildId,
      includeOdds: false,
      cachedSlate: cached,
      targetedPregame: true,
      forceSummaryGameIds: refreshIds,
      refreshGameIds: refreshIds,
      leagueKeys: dueLeagues,
      marketStages: stages
    });
    const refreshedAt = nowLabel();
    const latest = await readDailyCache(dateKey, guildId) || cached;
    const attempt = await completeAndJournalPregameRefresh(latest, {
      ...slate,
      guildId,
      messageId: cached.messageId || '',
      channelId: cached.channelId || '',
      postedAt: cached.postedAt || '',
      finalReplies: latest.finalReplies || cached.finalReplies || {},
      providerDailyUsage: cached.providerDailyUsage || null
    }, due, attemptedAt, refreshedAt);
    const durable = attempt.slate;
    if (config.featureWarehouseEnabled && attempt.completed.length) {
      const accepted = new Set(attempt.completed.map(row => String(row.gameId)));
      await recordSlateSnapshot({ ...durable, predictions: durable.predictions.filter(row => accepted.has(String(row.gameId))) });
    }
    await writeDailyCache(dateKey, durable, guildId);
    if (!attempt.completed.length) {
      runtimeState.nextPregameRefreshAt = nextPregameRefresh(durable, new Date(), { windows: config.pregameRefreshWindows })?.dueAt || '';
      return durable;
    }
    const posted = await postDailySlate(client, durable, { forceNew: false, reuseExisting: false, guildId });
    posted.pregameRefreshDeliveryPending = false;
    await writeDailyCache(dateKey, posted, guildId);
    runtimeState.lastPregameRefreshAt = refreshedAt;
    const afterNext = nextPregameRefresh(posted, new Date(), { windows: config.pregameRefreshWindows });
    runtimeState.nextPregameRefreshAt = afterNext?.dueAt || '';
    console.log(`[${nowLabel()}] Pregame refresh completed ${attempt.completed.length}/${refreshIds.length} game(s), windows=${attempt.completed.flatMap((row) => row.dueWindows).join(',')}, reason=${reason}.`);
    return posted;
  } catch (error) {
    const message = error instanceof Error ? error.stack || error.message : String(error);
    console.error(`[${nowLabel()}] Pregame refresh failed: ${message}`);
    await logBotEvent(client, `Pregame refresh failed (${reason}): ${message}`, guildId);
    return null;
  } finally {
    pregameRefreshRunning.delete(runningKey);
  }
}

function startSchedulers() {
  setInterval(() => {
    if (shutdownRequested) return;
    void runBackgroundTask('daily slate scheduler', async () => {
      runtimeState.lastSchedulerAt = nowLabel();
      const guildIds = await listConfiguredGuildIds(client);
      recordPostingConfiguration(guildIds);
      for (const guildId of guildIds) {
        const settings = await getGuildSettings(guildId);
        const dateKey = localDateKey();
        const minuteKey = `${dateKey}-${guildId}-${new Date().getUTCHours()}-${new Date().getUTCMinutes()}`;
        if (!isDailyPostTime(new Date(), { hour: settings.dailyPostHour, minute: settings.dailyPostMinute })) continue;
        if (lastScheduledPostKey.get(guildId) === minuteKey) continue;

        lastScheduledPostKey.set(guildId, minuteKey);
        await refreshAndPostDailySlate('daily_schedule', { forceNew: false, guildId });
      }
    });
  }, 30_000);

  setInterval(() => {
    if (shutdownRequested) return;
    void runBackgroundTask('final-score scheduler', async () => {
      runtimeState.lastSchedulerAt = nowLabel();
      const guildIds = await listConfiguredGuildIds(client);
      recordPostingConfiguration(guildIds);
      for (const guildId of guildIds) {
        const settings = await getGuildSettings(guildId);
        const intervalMs = Math.max(2, Number(settings.finalCheckMinutes) || config.finalCheckMinutes) * 60_000;
        const last = lastFinalCheckAt.get(guildId) || 0;
        if (Date.now() - last < intervalMs) continue;
        lastFinalCheckAt.set(guildId, Date.now());
        const caches = await listDailyCaches(config.finalLookbackDays + 1, guildId);
        const dates = pendingFinalDateKeys(caches, { today: localDateKey(), now: Date.now(), lookbackDays: config.finalLookbackDays });
        for (const dateKey of dates) await checkFinalScores('interval', guildId, dateKey);
      }
    });
  }, 60_000);

  setInterval(() => {
    if (shutdownRequested || !config.pregameRefreshEnabled) return;
    void runBackgroundTask('pregame refresh scheduler', async () => {
      runtimeState.lastSchedulerAt = nowLabel();
      const guildIds = await listConfiguredGuildIds(client);
      recordPostingConfiguration(guildIds);
      for (const guildId of guildIds) await refreshDuePregameGames('interval', guildId);
    });
  }, 60_000);
}

async function readOrBuildTodaySlate(reason, guildId = '') {
  const dateKey = localDateKey();
  const cached = await readDailyCache(dateKey, guildId);
  const slate = cached && Number(cached.schemaVersion || 0) >= 6 ? cached : await buildDailySlateOnce(reason, guildId, { recalculate: Boolean(cached) });
  const games = new Map((slate.games || []).map((game) => [String(game.id), game]));
  return { ...slate, predictions: (slate.predictions || []).map((prediction) => refreshPredictionValue(prediction, games.get(String(prediction.gameId)))) };
}

function predictionScore(prediction) {
  const confidence = Number(prediction.confidenceValue || 0);
  const quality = Number(prediction.dataQualityValue || 0);
  const edge = Number.isFinite(Number(prediction.edgeValue)) ? Number(prediction.edgeValue) : 0;
  const scheduledBonus = prediction.statusKey === 'scheduled' ? 2 : 0;
  const uncertaintyPenalty = prediction.recommendationStatus === 'withheld' ? 25 : prediction.recommendationStatus === 'lean_only' ? 8 : 0;
  return confidence + quality / 4 + edge * 1.8 + scheduledBonus - uncertaintyPenalty;
}

function riskRank(prediction) {
  const risk = String(prediction.riskTier || '').toLowerCase();
  if (risk === 'lower') return 0;
  if (risk === 'medium') return 1;
  return 2;
}

function isPregamePrediction(prediction) {
  return prediction?.statusKey === 'scheduled' &&
    (!prediction.predictionMode || prediction.predictionMode === 'pregame') &&
    Number.isFinite(Date.parse(prediction.startTime || '')) && Date.parse(prediction.startTime) > Date.now();
}

function forecastQualityLine(prediction) {
  if (prediction.recommendationStatus === 'withheld') return `High uncertainty: ${prediction.abstentionReason || 'The outcome is too close to separate reliably.'}`;
  if (prediction.recommendationStatus === 'lean_only') return 'Directional lean: wider than normal uncertainty.';
  return '';
}

function americanPriceValue(value) {
  const parsed = Number.parseInt(String(value ?? '').replace(/[^0-9+-]/g, ''), 10);
  return Number.isFinite(parsed) && parsed !== 0 ? parsed : null;
}

function isLongerPricePrediction(prediction) {
  const book = americanPriceValue(prediction.bestPrice);
  const fair = americanPriceValue(prediction.fairOdds);
  return (book !== null && book > 100) || (fair !== null && fair > 100);
}

function leagueMatches(query, prediction, game) {
  const needle = String(query || '').trim().toLowerCase();
  if (!needle) return false;
  return [
    prediction?.league,
    prediction?.matchup,
    game?.league,
    game?.leagueKey,
    game?.sportGroup,
  ].filter(Boolean).some((value) => String(value).toLowerCase().includes(needle));
}

function compactPredictionLine(prediction) {
  if (['retrospective_ungraded', 'late_pregame', 'in_play'].includes(prediction.predictionMode)) {
    return `#${prediction.index} ${prediction.startTimeLocal} ${prediction.league} ${prediction.matchup}\nNo pregame pick was recorded before this event started.`;
  }
  return (
    `#${prediction.index} ${prediction.startTimeLocal} ${prediction.league} ${prediction.matchup}\n` +
    `Pick: **${prediction.predictedWinner}** | Win estimate: ${prediction.predictionConfidence || prediction.confidence} | Uncertainty: ${prediction.predictionUncertainty || 'not measured'} | API data quality: ${prediction.apiConfidence || 'n/a'}\n` +
    `Model vs consensus: ${prediction.edge ?? 'No market edge'} | Risk: ${prediction.riskTier ?? 'Unknown'} | Local data: ${prediction.localDataConfidence || prediction.dataQuality}\n` +
    `${forecastQualityLine(prediction) ? `${forecastQualityLine(prediction)}\n` : ''}` +
    `${prediction.valueSignal || prediction.marketSignal || 'Model signal unavailable.'}`
  );
}

function reportPredictionLine(prediction) {
  return (
    `#${prediction.index} ${prediction.league} ${prediction.matchup} -> ` +
    `**${prediction.predictedWinner}** ${prediction.predictionConfidence || prediction.confidence} win estimate / ${prediction.predictionUncertainty || 'uncertainty n/a'} / ${prediction.apiConfidence || 'n/a'} API data | ${prediction.edge ?? 'No edge'} | ${prediction.riskTier ?? 'Unknown'} risk${prediction.recommendationStatus === 'withheld' ? ' | HIGH UNCERTAINTY' : ''}`
  );
}

function reportSection(title, predictions) {
  return [
    `**${title}**`,
    predictions.length ? predictions.map(reportPredictionLine).join('\n') : 'No cached matches.',
  ].join('\n');
}

function searchableGameText(prediction, game) {
  return [
    prediction?.league,
    prediction?.matchup,
    prediction?.predictedWinner,
    game?.away?.name,
    game?.away?.abbr,
    game?.home?.name,
    game?.home?.abbr,
    game?.sportGroup,
  ].filter(Boolean).join(' ').toLowerCase();
}

function watchMatches(watches, prediction, game) {
  const haystack = searchableGameText(prediction, game);
  return watches.some((watch) => haystack.includes(String(watch).toLowerCase()));
}

function livePredictionLine(prediction) {
  if (['retrospective_ungraded', 'late_pregame', 'in_play'].includes(prediction.predictionMode)) {
    return `#${prediction.index} **${prediction.league}** ${prediction.matchup}\nStatus: ${prediction.statusLabel || 'Live'} | No pregame pick was recorded.`;
  }
  return (
    `#${prediction.index} **${prediction.league}** ${prediction.matchup}\n` +
    `Status: ${prediction.statusLabel || 'Live'} | Pregame pick: **${prediction.predictedWinner}** | Win estimate ${prediction.predictionConfidence || prediction.confidence} | API data ${prediction.apiConfidence || 'n/a'} | Edge: ${prediction.edge ?? 'No market edge'}`
  );
}

function upcomingPredictionLine(prediction) {
  if (['retrospective_ungraded', 'late_pregame', 'in_play'].includes(prediction.predictionMode)) {
    return `#${prediction.index} ${prediction.startTimeLocal} **${prediction.league}** ${prediction.matchup}\nNo pregame pick was recorded before the start.`;
  }
  return (
    `#${prediction.index} ${prediction.startTimeLocal} **${prediction.league}** ${prediction.matchup}\n` +
    `Pick: **${prediction.predictedWinner}** | Win estimate ${prediction.predictionConfidence || prediction.confidence} | ${prediction.predictionUncertainty || 'uncertainty n/a'} | API data ${prediction.apiConfidence || 'n/a'} | Risk: ${prediction.riskTier ?? 'Unknown'}${prediction.recommendationStatus === 'withheld' ? ' | HIGH UNCERTAINTY' : ''}`
  );
}

function teamMatches(query, team) {
  const needle = String(query || '').trim().toLowerCase();
  if (!needle) return false;
  return [team?.name, team?.abbr].filter(Boolean).some((value) => String(value).toLowerCase().includes(needle));
}

function findTeamRows(cached, query) {
  const gamesById = new Map((cached.games ?? []).map((game) => [game.id, game]));
  return (cached.predictions ?? [])
    .map((prediction) => ({ prediction, game: gamesById.get(prediction.gameId) }))
    .filter(({ game }) => game && (teamMatches(query, game.away) || teamMatches(query, game.home)));
}

function compareRowLabel(game, side, prediction) {
  const team = side === 'home' ? game.home : game.away;
  const probability = prediction?.outcomeProbabilities?.[side];
  return `${team.name} (${team.abbr}) | record ${team.record || 'n/a'} | calibrated outcome probability ${Number.isFinite(Number(probability)) ? `${probability}%` : 'n/a'}${side === 'home' ? ' | home' : ' | away'}`;
}

async function handleSportsCommand(interaction) {
  const subcommand = interaction.options.getSubcommand();
  const guildId = interaction.guildId || config.guildId || '';

  if (['help', 'refresh', 'setup', 'role', 'api-key', 'api-clear', 'api-status'].includes(subcommand) && !isAdminInteraction(interaction)) {
    await interaction.reply({
      content: 'This OmniMod Sports command is admin-only.',
      ephemeral: true
    });
    return;
  }

  if (subcommand === 'help') {
    await interaction.deferReply({ ephemeral: true });
    const dateKey = localDateKey();
    const settings = await getGuildSettings(guildId);
    const cached = await readDailyCache(dateKey, guildId);
    const setupCommand =
      '/sports setup sports_channel:#omnimod-sports results_channel:#omnimod-sports-results logs_channel:#omnimod-sports-logs alert_role:@Sports Alerts admin_role:@Admin post_now:true';

    const setupEmbed = new EmbedBuilder()
      .setColor(0x8b5cf6)
      .setTitle('OmniMod Sports admin help')
      .setDescription('Private setup guide for owners/admins. Upload, configure, verify, then let the bot handle daily predictions and final grading.')
      .addFields(
        {
          name: '1. cPanel setup',
          value:
            'Upload the sports bot files to the Node app root, run **NPM Install**, keep startup file as `app.js`, then restart the app. Keep secrets in cPanel environment variables or `.env`; never paste tokens into channels.',
          inline: false
        },
        {
          name: '2. Discord setup',
          value:
            `Create or choose your sports, results, and private logs channels. Then run:\n\`${setupCommand}\``,
          inline: false
        },
        {
          name: '3. Provider setup',
          value:
            'No paid API is required. By default the bot caches public schedules, historical finals and box scores, injuries, current lineups/probables, and any available single-book line. Keyless official MLB/NHL feeds independently corroborate supported games. The Odds API remains optional for stronger multi-book consensus. Set LOCAL_ONLY=true for no sports-provider network calls.',
          inline: false
        },
        {
          name: '4. Verify',
          value:
            'Run `/sports status`, `/sports refresh`, `/sports today`, and `/sports role`. Confirm the daily slate posts, final-score channel is configured, and admin alerts go to the private logs channel.',
          inline: false
        }
      )
      .setFooter({ text: 'Recommended: keep REGISTER_COMMANDS=true after uploads so command changes refresh automatically.' })
      .setTimestamp(new Date());

    const automationEmbed = new EmbedBuilder()
      .setColor(0x22c55e)
      .setTitle('Daily automation')
      .addFields(
        {
          name: 'Morning cache + post',
          value:
            `Every configured server gets one durable daily cache file for **${dateKey}**. Current post time: **${String(settings.dailyPostHour).padStart(2, '0')}:${String(settings.dailyPostMinute).padStart(2, '0')} ${config.timezone}**. The Odds API batch can be claimed only once for that server/date, including across restarts.`,
          inline: false
        },
        {
          name: 'Final-score checks',
          value:
            `The bot checks cached games every **${settings.finalCheckMinutes} minute(s)** using public final-score data only. It does not request Odds API data during final checks. When ESPN marks a game final, it posts a green embed for a correct prediction or a red embed for a miss.`,
          inline: false
        },
        {
          name: 'Current server state',
          value:
            `Slate channel: ${settings.sportsChannelId ? `<#${settings.sportsChannelId}>` : 'not configured'}\n` +
            `Results channel: ${settings.resultsChannelId ? `<#${settings.resultsChannelId}>` : 'not configured'}\n` +
            `Logs channel: ${settings.logChannelId ? `<#${settings.logChannelId}>` : 'not configured'}\n` +
            `Admin alerts: ${settings.adminRoleId ? `<@&${settings.adminRoleId}>` : 'not configured'}\n` +
            `Odds API: ${settings.oddsApiKey ? `configured (${maskSecret(settings.oddsApiKey)})` : 'not configured'}\n` +
            `Cached predictions today: ${cached?.predictions?.length ?? 0}`,
          inline: false
        }
      )
      .setTimestamp(new Date());

    const modelEmbed = new EmbedBuilder()
      .setColor(0xf97316)
      .setTitle('Prediction model summary')
      .setDescription('This is research/community analysis only. It does not place wagers and should not be treated as guaranteed betting advice.')
      .addFields(
        {
          name: 'Active data inputs',
          value:
            'Automatic cached schedules, historical box scores, player-value profiles, current lineups/probables, opponent-adjusted strength, advanced efficiency, Elo, recent form/head-to-head, injuries, rest/congestion, travel/time zones/altitude, season transitions, weather, and keyless official-source checks. Manual overrides and optional odds can add evidence; neither is required.',
          inline: false
        },
        {
          name: 'Confidence + risk inputs',
          value:
            '**Prediction Confidence** is the calibrated estimated probability of the displayed outcome. **API Confidence** rates only third-party feed completeness, freshness, independent corroboration, and market consensus. Walk-forward validation, drift monitoring, season-transition risk, local coverage, and source conflicts all constrain risk.',
          inline: false
        },
        {
          name: 'Offline intelligence workflow',
          value:
            'The automatic layer is the default. Manual records override it only when you know something newer or more precise. `/sportsdata evaluate` reports accuracy, Brier/log loss, calibration, sport-specific walk-forward feature learning, and drift status.',
          inline: false
        },
        {
          name: 'Best workflow',
          value:
            'Use `/sports best`, `/sports value`, `/sports low-risk`, `/sports game`, and `/sports compare` after the morning slate posts. Use `/sports recap` to inspect whether confidence bands are actually performing over time.',
          inline: false
        }
      )
      .setTimestamp(new Date());

    await interaction.editReply({
      embeds: [setupEmbed, automationEmbed, modelEmbed],
      allowedMentions: { parse: [] }
    });
    return;
  }

  if (subcommand === 'setup') {
    await interaction.deferReply({ ephemeral: true });
    if (!guildId) {
      await interaction.editReply('Setup must be run inside a Discord server.');
      return;
    }

    const sportsChannel = interaction.options.getChannel('sports_channel');
    if (!sportsChannel) {
      await interaction.editReply(
        'This server still has the older `/sports setup` command shape cached. Re-register commands from cPanel or restart the bot, then run `/sports setup sports_channel:#channel results_channel:#channel logs_channel:#channel admin_role:@Admin`.'
      );
      return;
    }

    const resultsChannel = interaction.options.getChannel('results_channel') ?? sportsChannel;
    const logChannel = interaction.options.getChannel('logs_channel');
    const alertRole = interaction.options.getRole('alert_role');
    const adminRole = interaction.options.getRole('admin_role');
    const postNow = interaction.options.getBoolean('post_now') ?? false;
    const settings = await updateGuildSettings(guildId, {
      sportsChannelId: sportsChannel.id,
      resultsChannelId: resultsChannel.id,
      logChannelId: logChannel?.id ?? '',
      notifyRoleId: alertRole?.id ?? '',
      adminRoleId: adminRole?.id ?? '',
      configuredBy: interaction.user.id
    });

    let postLine = '';
    if (postNow) {
      const posted = await refreshAndPostDailySlate(`setup:${interaction.user.id}`, { guildId });
      postLine = posted ? `\nToday's cached slate is ready with ${posted.predictions.length} prediction(s).` : '\nSaved setup, but the immediate slate post failed. Check logs.';
    }

    await interaction.editReply(
      `OmniMod Sports setup saved for this server.\n` +
      `Slate channel: <#${settings.sportsChannelId}>\n` +
      `Results channel: <#${settings.resultsChannelId}>\n` +
      `Logs channel: ${settings.logChannelId ? `<#${settings.logChannelId}>` : 'not configured'}\n` +
      `Alert role: ${settings.notifyRoleId ? `<@&${settings.notifyRoleId}>` : 'not configured'}\n` +
      `Admin alert role: ${settings.adminRoleId ? `<@&${settings.adminRoleId}>` : 'not configured'}${postLine}`
    );
    return;
  }

  if (subcommand === 'api-key') {
    await interaction.deferReply({ ephemeral: true });
    const provider = interaction.options.getString('provider', true);
    if (provider !== 'odds-api') {
      await interaction.editReply('Unsupported provider.');
      return;
    }

    const key = interaction.options.getString('key', true).trim();
    const region = interaction.options.getString('region') || 'us';
    if (key.length < 12) {
      await interaction.editReply('That API key looks too short. Re-run the command with a valid provider key.');
      return;
    }

    await updateGuildSettings(guildId, {
      oddsApiKey: key,
      oddsApiRegion: region,
      configuredBy: interaction.user.id
    });
    await interaction.editReply(`The Odds API key saved for this server (${maskSecret(key)}), region=${region}. It will be used by the next unclaimed daily provider batch; /sports refresh never spends a second batch for the same date.`);
    return;
  }

  if (subcommand === 'api-clear') {
    await interaction.deferReply({ ephemeral: true });
    const provider = interaction.options.getString('provider', true);
    if (provider !== 'odds-api') {
      await interaction.editReply('Unsupported provider.');
      return;
    }

    await updateGuildSettings(guildId, {
      oddsApiKey: '',
      configuredBy: interaction.user.id
    });
    await interaction.editReply('The Odds API key was removed for this server. The bot will continue with cached scoreboards and local intelligence; market consensus will remain optional and unavailable.');
    return;
  }

  if (subcommand === 'api-status') {
    await interaction.deferReply({ ephemeral: true });
    const settings = await getGuildSettings(guildId);
    await interaction.editReply({
      content:
        `Sports API status for this server:\n` +
        `The Odds API: ${settings.oddsApiKey ? `configured (${maskSecret(settings.oddsApiKey)})` : 'not configured'}\n` +
        `Region: ${settings.oddsApiRegion || config.oddsApiRegion}`
    });
    return;
  }

  if (subcommand === 'role') {
    await interaction.deferReply({ ephemeral: true });
    await postRolePanel(client, guildId);
    await interaction.editReply('Posted the OmniMod Sports alert opt-in panel.');
    return;
  }

  if (subcommand === 'refresh') {
    await interaction.deferReply({ ephemeral: true });
    const recalculate = interaction.options.getBoolean('recalculate') ?? false;
    const posted = await refreshAndPostDailySlate(`manual:${interaction.user.id}`, { updateExisting: true, recalculate, guildId });
    await interaction.editReply(
      posted
        ? `${recalculate ? 'Recalculated and updated' : 'Refreshed'} today's Discord post with ${posted.predictions.length} prediction(s). No second paid Odds API batch was requested.`
        : 'Refresh failed. Check the sports logs channel or console output.'
    );
    return;
  }

  if (subcommand === 'today') {
    await interaction.deferReply({ ephemeral: true });
    const dateKey = localDateKey();
    let cached = await readDailyCache(dateKey, guildId);
    if (!cached || Number(cached.schemaVersion || 0) < 6) {
      cached = await refreshAndPostDailySlate(`today_cache:${interaction.user.id}`, {
        forceNew: false,
        updateExisting: Boolean(cached),
        recalculate: Boolean(cached),
        guildId
      });
    }

    if (!cached) {
      await interaction.editReply('No OmniMod Sports slate is available yet.');
      return;
    }

    const top = (cached.predictions ?? []).slice(0, 10).map((prediction) =>
      `#${prediction.index} ${prediction.startTimeLocal} ${prediction.league} ${prediction.matchup} -> ${['retrospective_ungraded', 'late_pregame', 'in_play'].includes(prediction.predictionMode) ? 'no pregame pick recorded' : `${prediction.predictedWinner} (win estimate ${prediction.predictionConfidence || prediction.confidence}, API data ${prediction.apiConfidence || 'n/a'}${prediction.recommendationStatus === 'withheld' ? ', high uncertainty' : ''})`}`
    );
    await interaction.editReply((
      `Today's OmniMod Sports slate has ${cached.predictions.length} game(s).\n` +
      `${top.join('\n') || 'No supported games found.'}\n` +
      (cached.messageId && cached.channelId ? `\nDaily post: https://discord.com/channels/${interaction.guildId}/${cached.channelId}/${cached.messageId}` : '')
    ).slice(0, 1950));
    return;
  }

  if (subcommand === 'live') {
    await interaction.deferReply({ ephemeral: true });
    const cached = await readOrBuildTodaySlate(`live:${interaction.user.id}`, guildId);
    const live = (cached.predictions ?? [])
      .filter((prediction) => prediction.statusKey === 'live')
      .slice(0, 12);

    if (!live.length) {
      await interaction.editReply(
        `No live games are cached for ${cached.dateKey}. Use /sports today for scheduled games or ask an admin to run /sports refresh if the slate looks stale.`
      );
      return;
    }

    await interaction.editReply(
      [
        `**Live OmniMod Sports games for ${cached.dateKey}**`,
        cached.disclaimer || 'Informational only. Not wagering advice.',
        '',
        ...live.map(livePredictionLine),
      ].join('\n\n').slice(0, 1900)
    );
    return;
  }

  if (subcommand === 'leagues') {
    await interaction.deferReply({ ephemeral: true });
    const settings = await getGuildSettings(guildId);
    const rows = supportedLeagues()
      .sort((a, b) => b.priority - a.priority || a.label.localeCompare(b.label))
      .map((league) => `**${league.label}** (${league.group})${league.oddsKey && settings.oddsApiKey ? ' - optional odds consensus enabled' : ' - cached scoreboard + local intelligence'}`);
    await interaction.editReply(
      [
        '**OmniMod Sports league coverage**',
        `Odds provider: ${settings.oddsApiKey ? 'configured for this server' : 'not configured for this server'}`,
        'Every league can use offline team/player/context/history records. Optional odds consensus is a bounded signal, not a dependency.',
        '',
        ...rows,
      ].join('\n').slice(0, 1900)
    );
    return;
  }

  if (subcommand === 'report') {
    await interaction.deferReply({ ephemeral: true });
    const leagueFilter = interaction.options.getString('league')?.trim() || '';
    const cached = await readOrBuildTodaySlate(`report:${interaction.user.id}`, guildId);
    const gamesById = new Map((cached.games ?? []).map((game) => [game.id, game]));
    const active = [...(cached.predictions ?? [])]
      .filter(isPregamePrediction)
      .filter((prediction) => !leagueFilter || leagueMatches(leagueFilter, prediction, gamesById.get(prediction.gameId)));

    if (!active.length) {
      await interaction.editReply(
        leagueFilter
          ? `No active cached games matched "${leagueFilter}". Try /sports leagues or run a broader /sports report.`
          : 'No active OmniMod Sports predictions are cached right now. Try `/sports refresh` if you are an admin.'
      );
      return;
    }

    const best = [...active].sort((a, b) => predictionScore(b) - predictionScore(a)).slice(0, 3);
    const value = [...active]
      .filter((prediction) => prediction.valueAnalysis?.bestOpportunity)
      .sort((a, b) => b.valueAnalysis.bestOpportunity.stressedReturn - a.valueAnalysis.bestOpportunity.stressedReturn)
      .slice(0, 3);
    const lowRisk = [...active]
      .sort((a, b) => riskRank(a) - riskRank(b) || predictionScore(b) - predictionScore(a))
      .slice(0, 3);
    const upsets = [...active]
      .filter(isLongerPricePrediction)
      .sort((a, b) => Number(b.edgeValue || 0) - Number(a.edgeValue || 0) || predictionScore(b) - predictionScore(a))
      .slice(0, 3);

    await interaction.editReply(
      [
        `**OmniMod Sports report for ${cached.dateKey}${leagueFilter ? ` | ${leagueFilter}` : ''}**`,
        cached.disclaimer || 'Informational only. Not wagering advice.',
        '',
        reportSection('Highest-ranked model forecasts', best),
        '',
        `**Quoted price opportunities**\n${value.length ? value.map(valueOpportunityLine).join('\n') : 'None clear quote freshness, calibration and uncertainty checks.'}`,
        '',
        reportSection('Risk-ranked board', lowRisk),
        '',
        reportSection('Upset watch', upsets),
      ].join('\n').slice(0, 1900)
    );
    return;
  }

  if (subcommand === 'best') {
    await interaction.deferReply({ ephemeral: true });
    const count = interaction.options.getInteger('count') ?? 5;
    const cached = await readOrBuildTodaySlate(`best:${interaction.user.id}`, guildId);
    const picks = [...(cached.predictions ?? [])]
      .filter(isPregamePrediction)
      .sort((a, b) => predictionScore(b) - predictionScore(a))
      .slice(0, count);

    if (!picks.length) {
      await interaction.editReply('No active OmniMod Sports picks are available yet. Try `/sports refresh` if you are an admin.');
      return;
    }

    await interaction.editReply(
      [
        `**OmniMod Sports best picks for ${cached.dateKey}**`,
        cached.disclaimer || 'Informational only. Not wagering advice.',
        '',
        ...picks.map(compactPredictionLine),
      ].join('\n\n').slice(0, 1900)
    );
    return;
  }

  if (subcommand === 'value') {
    const refreshQuotes = interaction.options.getBoolean('refresh') === true;
    if (refreshQuotes && !isAdminInteraction(interaction)) {
      await interaction.reply({ content: 'Paid quote refresh is admin-only. Ordinary /sports value uses cached quotes.', ephemeral: true });
      return;
    }
    await interaction.deferReply({ ephemeral: true });
    const count = interaction.options.getInteger('count') ?? 5;
    let cached = refreshQuotes ? await readDailyCache(localDateKey(), guildId) : await readOrBuildTodaySlate(`value:${interaction.user.id}`, guildId);
    if (!cached) {
      await interaction.editReply('No model slate is cached. Run /sports refresh first; no paid quote-refresh call made.');
      return;
    }
    let quoteStatus = 'Cached price analysis; no extra paid refresh requested.';
    if (refreshQuotes) {
      const settings = await getGuildSettings(guildId);
      const refreshed = await refreshValueQuotes(cached, { refresh: true, admin: true,
        league: interaction.options.getString('league') || '', oddsApiKey: settings.oddsApiKey, oddsApiRegion: settings.oddsApiRegion });
      quoteStatus = refreshed.message;
      if (refreshed.issuedSlate) {
        // Issued price decisions get new timestamps; frozen model forecasts do not.
        await recordPredictionJournal(refreshed.issuedSlate, { lifecycle: 'prices_only' });
        await recordSlateSnapshot(refreshed.issuedSlate);
        const latest = await readDailyCache(cached.dateKey, guildId) || cached;
        const newOdds = new Map(refreshed.issuedSlate.games.map((game) => [String(game.id), game.odds]));
        const changedIds = new Set(refreshed.issuedSlate.predictions.map((prediction) => String(prediction.gameId)));
        const games = latest.games.map((game) => changedIds.has(String(game.id)) ? { ...game, odds: newOdds.get(String(game.id)) } : game);
        const byId = new Map(games.map((game) => [String(game.id), game]));
        cached = { ...latest, games, lastValueQuoteRefreshAt: refreshed.slate.lastValueQuoteRefreshAt,
          predictions: latest.predictions.map((prediction) => {
            const value = refreshPredictionValue(prediction, byId.get(String(prediction.gameId)));
            return { ...value, modelAsOf: prediction.modelAsOf || prediction.predictionGeneratedAt };
          }) };
        await writeDailyCache(cached.dateKey, cached, guildId);
      }
    }
    const gamesById = new Map((cached.games || []).map((game) => [String(game.id), game]));
    cached = { ...cached, predictions: (cached.predictions || []).map((prediction) => refreshPredictionValue(prediction, gamesById.get(String(prediction.gameId)))) };
    const picks = [...(cached.predictions ?? [])]
      .filter(isPregamePrediction)
      .filter((prediction) => prediction.valueAnalysis?.bestOpportunity)
      .sort((a, b) => b.valueAnalysis.bestOpportunity.stressedReturn - a.valueAnalysis.bestOpportunity.stressedReturn)
      .slice(0, count);

    if (!picks.length) {
      await interaction.editReply(
        `${quoteStatus}\nNo quoted price clears the EV, quote freshness, settlement, evidence and uncertainty checks. Use /sports game for withholding reasons. Admins can request /sports value refresh:true league:nba when the optional daily refresh budget is enabled.`
      );
      return;
    }

    await interaction.editReply(
      [
        `**OmniMod Sports value board for ${cached.dateKey}**`,
        quoteStatus,
        'Sorted by stressed net expected return at fresh observed prices across all outcomes. Model uses market information; profitability and available stakes are unproven. Verify price and settlement rules before acting.',
        '',
        ...picks.map(valueOpportunityLine),
      ].join('\n\n').slice(0, 1900)
    );
    return;
  }

  if (subcommand === 'low-risk') {
    await interaction.deferReply({ ephemeral: true });
    const count = interaction.options.getInteger('count') ?? 5;
    const cached = await readOrBuildTodaySlate(`low-risk:${interaction.user.id}`, guildId);
    const picks = [...(cached.predictions ?? [])]
      .filter(isPregamePrediction)
      .sort((a, b) => riskRank(a) - riskRank(b) || predictionScore(b) - predictionScore(a))
      .slice(0, count);

    if (!picks.length) {
      await interaction.editReply('No active lower-risk OmniMod Sports picks are cached right now. Try `/sports refresh` if you are an admin.');
      return;
    }

    await interaction.editReply(
      [
        `**OmniMod Sports lower-risk board for ${cached.dateKey}**`,
        'Pregame only. Sorted by risk tier, calibrated probability, evidence quality, and edge. Informational only.',
        '',
        ...picks.map(compactPredictionLine),
      ].join('\n\n').slice(0, 1900)
    );
    return;
  }

  if (subcommand === 'upcoming') {
    await interaction.deferReply({ ephemeral: true });
    const hours = interaction.options.getInteger('hours') ?? 12;
    const cached = await readOrBuildTodaySlate(`upcoming:${interaction.user.id}`, guildId);
    const now = Date.now();
    const cutoff = now + hours * 60 * 60 * 1000;
    const upcoming = [...(cached.predictions ?? [])]
      .filter((prediction) => prediction.statusKey === 'scheduled')
      .filter((prediction) => {
        const start = new Date(prediction.startTime).getTime();
        return Number.isFinite(start) && start >= now && start <= cutoff;
      })
      .sort((a, b) => new Date(a.startTime) - new Date(b.startTime))
      .slice(0, 12);

    if (!upcoming.length) {
      await interaction.editReply(`No cached games are scheduled in the next ${hours} hour(s). Try a wider window or refresh the slate.`);
      return;
    }

    await interaction.editReply(
      [
        `**Upcoming OmniMod Sports board: next ${hours} hour(s)**`,
        cached.disclaimer || 'Informational only. Not wagering advice.',
        '',
        ...upcoming.map(upcomingPredictionLine),
      ].join('\n\n').slice(0, 1900)
    );
    return;
  }

  if (subcommand === 'league') {
    await interaction.deferReply({ ephemeral: true });
    const query = interaction.options.getString('league', true);
    const count = interaction.options.getInteger('count') ?? 8;
    const cached = await readOrBuildTodaySlate(`league:${interaction.user.id}`, guildId);
    const gamesById = new Map((cached.games ?? []).map((game) => [game.id, game]));
    const rows = [...(cached.predictions ?? [])]
      .filter((prediction) => leagueMatches(query, prediction, gamesById.get(prediction.gameId)))
      .sort((a, b) => new Date(a.startTime) - new Date(b.startTime))
      .slice(0, count);

    if (!rows.length) {
      await interaction.editReply(`No cached games matched league or sport group "${query}". Try /sports leagues to see current coverage.`);
      return;
    }

    await interaction.editReply(
      [
        `**OmniMod Sports ${query} board for ${cached.dateKey}**`,
        cached.disclaimer || 'Informational only. Not wagering advice.',
        '',
        ...rows.map(upcomingPredictionLine),
      ].join('\n\n').slice(0, 1900)
    );
    return;
  }

  if (subcommand === 'game') {
    await interaction.deferReply({ ephemeral: true });
    const query = interaction.options.getString('query', true).trim().toLowerCase();
    const cached = await readOrBuildTodaySlate(`game:${interaction.user.id}`, guildId);
    const gamesById = new Map((cached.games ?? []).map((game) => [game.id, game]));
    const row = (cached.predictions ?? [])
      .map((prediction) => ({ prediction, game: gamesById.get(prediction.gameId) }))
      .find(({ prediction, game }) => searchableGameText(prediction, game).includes(query));

    if (!row) {
      await interaction.editReply(`I could not find a cached game matching "${query}". Try a team name, abbreviation, or league.`);
      return;
    }

    const { prediction, game } = row;
    if (['retrospective_ungraded', 'late_pregame', 'in_play'].includes(prediction.predictionMode)) {
      await interaction.editReply(`${prediction.league} | ${prediction.matchup}\nNo pregame pick was recorded before this event started. Retrospective estimates are unavailable as betting signals.`);
      return;
    }
    const embed = new EmbedBuilder()
      .setColor(0x8b5cf6)
      .setTitle(`${prediction.league} | ${prediction.matchup}`)
      .setDescription(prediction.reason || 'OmniMod Sports model details.')
      .addFields(
        { name: 'Game ID', value: String(prediction.gameId || game?.id || 'Unknown').slice(0, 180), inline: false },
        { name: 'Start', value: prediction.startTimeLocal || 'Unknown', inline: true },
        { name: 'Status', value: prediction.statusLabel || game?.statusLabel || 'Unknown', inline: true },
        { name: 'Model mode', value: prediction.predictionMode || 'legacy', inline: true },
        { name: 'Prediction frozen', value: `${safeIsoLabel(prediction.predictionGeneratedAt, 'Legacy timestamp unavailable')} | ${prediction.snapshotStage || 'daily'} snapshot`, inline: false },
        { name: 'Venue', value: game?.venue || 'Unknown', inline: true },
        { name: 'Pregame model pick', value: ['retrospective_ungraded', 'late_pregame', 'in_play'].includes(prediction.predictionMode) ? 'No pregame pick recorded' : prediction.predictedWinner, inline: true },
        { name: 'Prediction Confidence', value: prediction.predictionConfidence || prediction.confidence, inline: true },
        { name: 'Prediction Uncertainty', value: prediction.predictionUncertainty || 'not measured', inline: true },
        { name: 'Forecast quality', value: (forecastQualityLine(prediction) || 'Normal-strength model forecast').slice(0, 1024), inline: false },
        { name: 'API data quality (not win chance)', value: prediction.apiConfidence || 'not measured', inline: true },
        { name: 'Fair line', value: prediction.fairOdds || '--', inline: true },
        { name: 'Quoted outcome value (net return per unit)', value: formatValueDetails(prediction.valueAnalysis), inline: false },
        { name: 'Model vs consensus (not payout EV)', value: prediction.edge ?? 'No market edge', inline: true },
        { name: 'Risk', value: prediction.riskTier ?? 'Unknown', inline: true },
        { name: 'Local data confidence', value: prediction.localDataConfidence ?? 'Unknown', inline: true },
        { name: 'Evidence quality', value: prediction.evidenceQuality ?? prediction.dataQuality ?? 'Unknown', inline: true },
        { name: 'Outcome probabilities', value: Object.entries(prediction.outcomeProbabilities || {}).map(([side, value]) => `${side}: ${value}%`).join(' | ') || 'Not cached', inline: false },
        { name: 'Production model', value: `${prediction.championModel || prediction.modelVersion}${prediction.sportModel?.id ? `\nSport specialist: ${prediction.sportModel.id} (${prediction.sportModel.active ? 'active' : 'shadow testing'})` : ''}${prediction.localMlModel?.id ? `\nLocal ML: ${prediction.localMlModel.id} (${prediction.localMlModel.active ? 'active' : prediction.localMlModel.accepted ? 'validated shadow' : 'collecting/validation shadow'})` : ''}`.slice(0, 1024), inline: false },
        { name: 'Participation + play evidence', value: game?.participationSummary ? `${game.away?.abbr} projected missing impact ${game.participationSummary.away?.projectedMissingImpact || 0} / uncertainty ${Math.round((game.participationSummary.away?.uncertainty || 0) * 100)}%; ${game.home?.abbr} ${game.participationSummary.home?.projectedMissingImpact || 0} / ${Math.round((game.participationSummary.home?.uncertainty || 0) * 100)}%. Play-by-play samples: ${game.autoTeamMetrics?.away?.advancedMetrics?.playByPlay?.sampleSize || 0} away / ${game.autoTeamMetrics?.home?.advancedMetrics?.playByPlay?.sampleSize || 0} home.` : 'Projected participation or play-by-play profiles not yet available.', inline: false },
        { name: 'Market movement', value: prediction.marketMovement ? `${prediction.predictedSide}: ${prediction.marketMovement.movementPoints?.[prediction.predictedSide] >= 0 ? '+' : ''}${prediction.marketMovement.movementPoints?.[prediction.predictedSide] || 0} implied-probability pts (${prediction.marketMovement.snapshots} snapshots)` : 'No movement history yet', inline: false },
        { name: 'Signals', value: (prediction.signals ?? ['No signals cached.']).join('\n').slice(0, 1000), inline: false }
      )
      .setFooter({ text: cached.disclaimer || 'Informational only. Not wagering advice.' })
      .setTimestamp(new Date());
    await interaction.editReply({ embeds: [embed] });
    return;
  }

  if (subcommand === 'compare') {
    await interaction.deferReply({ ephemeral: true });
    const teamA = interaction.options.getString('team_a', true);
    const teamB = interaction.options.getString('team_b', true);
    const cached = await readOrBuildTodaySlate(`compare:${interaction.user.id}`, guildId);
    const gamesById = new Map((cached.games ?? []).map((game) => [game.id, game]));
    const direct = (cached.predictions ?? [])
      .map((prediction) => ({ prediction, game: gamesById.get(prediction.gameId) }))
      .find(({ game }) =>
        game &&
        ((teamMatches(teamA, game.away) && teamMatches(teamB, game.home)) ||
          (teamMatches(teamA, game.home) && teamMatches(teamB, game.away)))
      );

    if (direct) {
      const { prediction, game } = direct;
      const embed = new EmbedBuilder()
        .setColor(0x8b5cf6)
        .setTitle(`${prediction.league} comparison | ${prediction.matchup}`)
        .setDescription(prediction.reason || 'OmniMod Sports matched both teams on the current cached slate.')
        .addFields(
          { name: 'Away', value: compareRowLabel(game, 'away', prediction), inline: false },
          { name: 'Home', value: compareRowLabel(game, 'home', prediction), inline: false },
          { name: 'Start', value: prediction.startTimeLocal || 'Unknown', inline: true },
          { name: 'Status', value: prediction.statusLabel || game.statusLabel || 'Unknown', inline: true },
          { name: 'Venue', value: game.venue || 'Unknown', inline: true },
          { name: 'Model pick', value: prediction.predictedWinner, inline: true },
          { name: 'Prediction Confidence', value: prediction.predictionConfidence || prediction.confidence, inline: true },
          { name: 'Uncertainty', value: prediction.predictionUncertainty || 'not measured', inline: true },
          { name: 'API Confidence', value: prediction.apiConfidence || 'not measured', inline: true },
          { name: 'Edge', value: prediction.edge ?? 'No market edge', inline: true },
          { name: 'Risk', value: prediction.riskTier ?? 'Unknown', inline: true },
          { name: 'Signals', value: (prediction.signals ?? ['No signals cached.']).join('\n').slice(0, 1000), inline: false }
        )
        .setFooter({ text: cached.disclaimer || 'Informational only. Not wagering advice.' })
        .setTimestamp(new Date());
      await interaction.editReply({ embeds: [embed] });
      return;
    }

    const aRows = findTeamRows(cached, teamA).slice(0, 3);
    const bRows = findTeamRows(cached, teamB).slice(0, 3);
    await interaction.editReply(
      [
        `I could not find a direct cached matchup for **${teamA}** vs **${teamB}** today.`,
        '',
        `**Closest cached matches for ${teamA}**`,
        aRows.length ? aRows.map(({ prediction }) => compactPredictionLine(prediction)).join('\n\n') : 'No cached match.',
        '',
        `**Closest cached matches for ${teamB}**`,
        bRows.length ? bRows.map(({ prediction }) => compactPredictionLine(prediction)).join('\n\n') : 'No cached match.',
      ].join('\n').slice(0, 1900)
    );
    return;
  }

  if (subcommand === 'explain') {
    await interaction.deferReply({ ephemeral: true });
    await interaction.editReply(
      [
        '**How OmniMod Sports works**',
        'The bot combines cached schedules, past results, injuries, lineups, context, Elo and sport models. Manual records can override automatic inputs.',
        '',
        '**Win estimate** is the model probability for its displayed pregame pick. **Uncertainty** is a heuristic band, with no validated coverage level. Every pregame model forecast names a side, including high-uncertainty forecasts.',
        '**API data quality** rates feed completeness, freshness and source agreement. **Local data confidence** rates manual evidence. Neither is a win probability.',
        '**Model vs consensus** compares probabilities with bookmaker margin removed. A positive difference alone does not imply a profitable price.',
        '**/sports value** evaluates every outcome at actual bookmaker payouts. It requires two fresh quotes, matching settlement rules, adequate calibration history, evidence and positive return after an uncertainty stress. A less likely outcome can offer better quoted value. The model uses market information, so this is not an independent edge.',
        '**/sports game** shows offered price/book/time, break-even probability, expected and stressed net return, and withholding reasons. Verify availability and book rules; no wager or stake is confirmed.',
        '**Evaluation** uses frozen pregame records and chronological validation; `/sportsdata evaluate` shows learning and drift. Quoted-price assumptions are archived for future assessment. Profitability is unproven.',
        '**Forecast versus price**: a team can be the most likely winner and still have no qualifying bookmaker price. High-uncertainty forecasts remain visible; quoted opportunities still require fresh, comparable prices and adequate evidence.',
        '',
        'This is research and community analysis only, not financial or wagering advice.',
      ].join('\n')
    );
    return;
  }

  if (subcommand === 'upsets') {
    await interaction.deferReply({ ephemeral: true });
    const count = interaction.options.getInteger('count') ?? 5;
    const cached = await readOrBuildTodaySlate(`upsets:${interaction.user.id}`, guildId);
    const picks = [...(cached.predictions ?? [])]
      .filter(isPregamePrediction)
      .filter(isLongerPricePrediction)
      .sort((a, b) => Number(b.edgeValue || 0) - Number(a.edgeValue || 0) || predictionScore(b) - predictionScore(a))
      .slice(0, count);

    if (!picks.length) {
      await interaction.editReply(
        'No longer-price or underdog watches are cached right now. That can mean the market slate is favorite-heavy, or odds are unavailable for today.'
      );
      return;
    }

    await interaction.editReply(
      [
        `**OmniMod Sports upset watch for ${cached.dateKey}**`,
        'Longer-price picks sorted by model edge first, then confidence. Informational only. Not wagering advice.',
        '',
        ...picks.map(compactPredictionLine),
      ].join('\n\n').slice(0, 1900)
    );
    return;
  }

  if (subcommand === 'watch-add') {
    await interaction.deferReply({ ephemeral: true });
    const team = interaction.options.getString('team', true);
    const watches = await addWatch(interaction.user.id, team);
    await interaction.editReply(`Added **${team.trim()}** to your sports watchlist.\nCurrent watchlist: ${watches.join(', ') || 'empty'}`);
    return;
  }

  if (subcommand === 'watch-remove') {
    await interaction.deferReply({ ephemeral: true });
    const team = interaction.options.getString('team', true);
    const watches = await removeWatch(interaction.user.id, team);
    await interaction.editReply(`Removed **${team.trim()}** from your sports watchlist when present.\nCurrent watchlist: ${watches.join(', ') || 'empty'}`);
    return;
  }

  if (subcommand === 'watch-list') {
    await interaction.deferReply({ ephemeral: true });
    const watches = await listWatch(interaction.user.id);
    if (!watches.length) {
      await interaction.editReply('Your sports watchlist is empty. Add teams or keywords with `/sports watch-add team:TEAM`.');
      return;
    }

    const cached = await readOrBuildTodaySlate(`watch-list:${interaction.user.id}`, guildId);
    const gamesById = new Map((cached.games ?? []).map((game) => [game.id, game]));
    const matches = (cached.predictions ?? [])
      .filter((prediction) => watchMatches(watches, prediction, gamesById.get(prediction.gameId)))
      .slice(0, 10);

    await interaction.editReply(
      [
        '**Your OmniMod Sports watchlist**',
        watches.join(', '),
        '',
        `**Matching games for ${cached.dateKey}**`,
        matches.length ? matches.map(compactPredictionLine).join('\n\n') : 'No cached games match your watchlist today.',
      ].join('\n').slice(0, 1900)
    );
    return;
  }

  if (subcommand === 'recap') {
    await interaction.deferReply({ ephemeral: true });
    const days = interaction.options.getInteger('days') ?? 7;
    const caches = await listDailyCaches(days, guildId);
    const graded = [];
    for (const cache of caches) {
      for (const prediction of cache.slate.predictions ?? []) {
        if (
          (prediction.predictionCorrect === true || prediction.predictionCorrect === false) &&
          prediction.eligibleForCalibration !== false &&
          /^OmniMod Evidence Ensemble v(?:3|4|5)/.test(String(prediction.modelVersion || ''))
        ) {
          graded.push({ dateKey: cache.dateKey, prediction });
        }
      }
    }

    if (!graded.length) {
      await interaction.editReply(`No graded OmniMod Sports results are cached for the last ${days} day(s). Final-score checks will fill this as games complete.`);
      return;
    }

    const correct = graded.filter((row) => row.prediction.predictionCorrect === true).length;
    const highConfidence = graded.filter((row) => Number(row.prediction.confidenceValue || 0) >= 65);
    const highCorrect = highConfidence.filter((row) => row.prediction.predictionCorrect === true).length;
    const recent = graded.slice(0, 8).map((row) =>
      `${row.dateKey} #${row.prediction.index} ${row.prediction.matchup}: ${row.prediction.predictionCorrect ? 'hit' : 'miss'} (${row.prediction.confidence})`
    );

    await interaction.editReply(
      [
        `**OmniMod Sports recap (${days} day cache)**`,
        `Overall: ${correct}/${graded.length} correct (${Math.round((correct / graded.length) * 100)}%)`,
        `High-confidence picks: ${highCorrect}/${highConfidence.length || 0}${highConfidence.length ? ` (${Math.round((highCorrect / highConfidence.length) * 100)}%)` : ''}`,
        '',
        '**Recent graded picks**',
        recent.join('\n'),
      ].join('\n').slice(0, 1900)
    );
    return;
  }

  if (subcommand === 'status') {
    await interaction.deferReply({ ephemeral: true });
    const dateKey = localDateKey();
    const settings = await getGuildSettings(guildId);
    const cached = await readDailyCache(dateKey, guildId);
    const providerUsage = await readDailyProviderUsage(dateKey, guildId);
    const runtime = getRuntimeState();
    const learnedModels = Object.values(cached?.modelSummary?.featureLearning || {});
    const acceptedModels = learnedModels.filter((row) => row.accepted).length;
    const driftRows = Object.entries(cached?.modelSummary?.drift || {}).filter(([sport]) => sport !== 'all');
    const worstDrift = driftRows.sort((a, b) => Number(b[1]?.penalty || 0) - Number(a[1]?.penalty || 0))[0];
    const embed = new EmbedBuilder()
      .setColor(0x8b5cf6)
      .setTitle('OmniMod Sports bot status')
      .addFields(
        { name: 'Date', value: dateKey, inline: true },
        { name: 'Timezone', value: config.timezone, inline: true },
        { name: 'Daily post', value: `${String(settings.dailyPostHour).padStart(2, '0')}:${String(settings.dailyPostMinute).padStart(2, '0')}`, inline: true },
        { name: 'Cached games', value: String(cached?.predictions?.length ?? 0), inline: true },
        { name: 'Odds API', value: settings.oddsApiKey ? 'configured' : 'not configured', inline: true },
        { name: 'Network mode', value: config.localOnly ? 'strict local only' : 'cached schedule + auto intelligence', inline: true },
        { name: 'Auto enrichment', value: config.autoEnrichEnabled && !config.localOnly ? 'enabled' : 'disabled', inline: true },
        { name: 'Automatic evidence', value: `${cached?.modelSummary?.automatic?.historyFinals ?? 0} finals / ${cached?.modelSummary?.automatic?.teamProfiles ?? 0} teams / ${cached?.modelSummary?.automatic?.playerProfiles ?? 0} players / ${cached?.modelSummary?.automatic?.historicalBoxscores ?? 0} boxes / ${cached?.modelSummary?.automatic?.playByPlayGames ?? 0} play-by-play games / ${cached?.modelSummary?.automatic?.injuryRecords ?? 0} injuries`, inline: false },
        { name: 'Lineups + official checks', value: `${cached?.modelSummary?.automatic?.confirmedLineups ?? 0} lineup side(s) / ${cached?.modelSummary?.automatic?.officialStarters ?? 0} official starter(s) / ${cached?.modelSummary?.automatic?.starterRestMatches ?? 0} rest match(es) / ${cached?.modelSummary?.automatic?.officialMatches ?? 0} matched game(s)`, inline: false },
        { name: 'Learning + drift', value: `${acceptedModels}/${learnedModels.length} sport model(s) accepted; ${worstDrift ? `${worstDrift[0]} ${worstDrift[1]?.status}` : 'collecting history'}`, inline: true },
        { name: 'Today provider batch', value: providerUsage?.state ? `${providerUsage.state}${providerUsage.result ? ` (${providerUsage.result})` : ''}` : 'not claimed', inline: true },
        { name: 'Final checks', value: `${settings.finalCheckMinutes} minute(s)`, inline: true },
        { name: 'Pregame refresh', value: config.pregameRefreshEnabled ? `${config.pregameRefreshWindows.map((window) => `T-${window}`).join('/')} enabled\nLast: ${runtime.lastPregameRefreshAt || 'none'}\nNext: ${runtime.nextPregameRefreshAt || 'waiting for slate'}` : 'disabled', inline: false },
        { name: 'Feature warehouse', value: cached?.modelSummary?.warehouse ? `${cached.modelSummary.warehouse.results} finals / ${cached.modelSummary.warehouse.boxscores} boxes / ${cached.modelSummary.warehouse.plays || 0} compact plays / ${cached.modelSummary.warehouse.predictions} prediction snapshots / ${cached.modelSummary.warehouse.markets} market snapshots` : 'waiting for v6 slate', inline: false },
        { name: 'Replay + challengers', value: cached?.modelSummary?.replay ? `${cached.modelSummary.replay.predictions} leakage-safe replay predictions; ${Object.values(cached?.modelSummary?.championModels || {}).filter((row) => !/evidence/i.test(String(row.champion || ''))).length} promoted challenger(s); ${Object.values(cached?.modelSummary?.localMl || {}).filter((row) => row.accepted).length} validated local ML model(s)` : 'waiting for replay', inline: false },
        { name: 'Open datasets', value: config.advancedDatasetsEnabled ? `${cached?.modelSummary?.advancedDatasets?.matchedGames ?? 0} game match(es); snapshot ${cached?.modelSummary?.advancedDatasets?.updatedAt || 'not synced'}` : 'disabled', inline: false },
        { name: 'Provider alerts', value: String(cached?.alerts?.length ?? 0), inline: true },
        { name: 'Discord destinations', value: `Slate ${settings.sportsChannelId ? `<#${settings.sportsChannelId}>` : 'not configured'} | Results ${settings.resultsChannelId ? `<#${settings.resultsChannelId}>` : 'not configured'} | Logs ${settings.logChannelId ? `<#${settings.logChannelId}>` : 'not configured'} | Admin ${settings.adminRoleId ? `<@&${settings.adminRoleId}>` : 'not configured'}`, inline: false },
        { name: 'Discord gateway', value: runtime.discordReady ? `ready as ${runtime.discordUser || 'bot'}` : `not ready (${runtime.phase})`, inline: true },
        { name: 'Model', value: cached?.modelSummary?.version || 'waiting for v6 slate', inline: true },
        { name: 'Calibration sample', value: String(cached?.modelSummary?.calibrationSamples ?? 0), inline: true },
        { name: 'Last interaction', value: runtime.lastInteractionAt || 'none', inline: true },
        { name: 'Last error', value: runtime.lastError ? runtime.lastError.slice(0, 900) : 'none', inline: false }
      )
      .setTimestamp(new Date());
    await interaction.editReply({ embeds: [embed] });
  }
}

client.once(Events.ClientReady, async () => {
  console.log(`[${nowLabel()}] OmniMod Sports logged in as ${client.user.tag}.`);
  updateRuntimeState({
    state: 'running',
    phase: 'discord_ready',
    discordReady: true,
    discordUser: client.user.tag,
    lastReadyAt: nowLabel(),
    lastError: ''
  });
  resolveWorkerReady(client.user?.tag ?? 'ready');

  void runBackgroundTask('command registration', registerCommandsForConnectedGuilds);

  startSchedulers();

  if (config.postOnStart) {
    void runBackgroundTask('startup post and final check', async () => {
      const guildIds = await listConfiguredGuildIds(client);
      recordPostingConfiguration(guildIds);
      for (const guildId of guildIds) {
        await refreshAndPostDailySlate('startup', { forceNew: false, updateExisting: true, guildId });
        await checkFinalScores('startup', guildId);
      }
    });
  }
});

client.on('interactionCreate', async (interaction) => {
  try {
    updateRuntimeState({
      phase: 'interaction',
      lastInteractionAt: nowLabel()
    });

    if (interaction.isButton() && interaction.customId.startsWith('sports_alerts_')) {
      await handleAlertButton(interaction);
      return;
    }

    if (!interaction.isChatInputCommand()) return;
    if (interaction.commandName === 'sportsdata') {
      await handleSportsDataCommand(interaction);
      return;
    }
    if (interaction.commandName === 'sports') await handleSportsCommand(interaction);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[${nowLabel()}] Interaction failed: ${message}`);
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(`OmniMod Sports command failed: ${message}`).catch(() => {});
    } else {
      await interaction.reply({ content: `OmniMod Sports command failed: ${message}`, ephemeral: true }).catch(() => {});
    }
  }
});

client.on('error', (error) => {
  recordWorkerError('Discord client error', error);
});

client.on('shardDisconnect', (event, shardId) => {
  updateRuntimeState({
    state: 'degraded',
    phase: `shard_${shardId}_disconnect`,
    discordReady: false,
    lastDisconnectAt: nowLabel(),
    lastError: `Shard ${shardId} disconnected: ${event?.code ?? 'unknown'} ${event?.reason ?? ''}`.trim()
  });
  console.warn(`[${nowLabel()}] Discord shard ${shardId} disconnected:`, event?.code, event?.reason);
});

client.on('shardReconnecting', (shardId) => {
  updateRuntimeState({
    state: 'reconnecting',
    phase: `shard_${shardId}_reconnecting`
  });
  console.warn(`[${nowLabel()}] Discord shard ${shardId} reconnecting.`);
});

client.on('shardResume', (shardId) => {
  updateRuntimeState({
    state: 'running',
    phase: `shard_${shardId}_resumed`,
    discordReady: client.isReady(),
    lastReadyAt: nowLabel(),
    lastError: ''
  });
  console.log(`[${nowLabel()}] Discord shard ${shardId} resumed.`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    shutdownRequested = true;
    updateRuntimeState({ state: 'stopping', phase: signal });
    console.log(`[${nowLabel()}] ${signal} received; shutting down OmniMod Sports.`);
    client.destroy();
    process.exit(0);
  });
}

process.on('unhandledRejection', (reason) => {
  recordWorkerError('Unhandled promise rejection in sports worker', reason);
});

process.on('uncaughtException', (error) => {
  recordWorkerError('Uncaught exception in sports worker', error);
});

let loginRetryTimer = null;
let loginInProgress = false;

async function loginWithRetry() {
  if (shutdownRequested || loginInProgress || client.isReady()) return;
  loginInProgress = true;
  runtimeState.loginAttempts += 1;
  updateRuntimeState({
    state: 'connecting',
    phase: `discord_login_attempt_${runtimeState.loginAttempts}`
  });

  try {
    await client.login(config.discordToken);
  } catch (error) {
    recordWorkerError('Discord login failed', error);
    loginRetryTimer = setTimeout(() => {
      loginRetryTimer = null;
      void loginWithRetry();
    }, 60_000);
    loginRetryTimer.unref?.();
  } finally {
    loginInProgress = false;
  }
}

void loginWithRetry();
