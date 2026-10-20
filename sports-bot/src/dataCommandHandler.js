import { AttachmentBuilder, EmbedBuilder } from 'discord.js';
import { promisify } from 'node:util';
import { gunzip, gzip } from 'node:zlib';
import { isAdminInteraction } from './discordPublisher.js';
import {
  importIntelligence,
  intelligenceInventory,
  intelligenceSchemaExample,
  listIntelligence,
  parseCsv,
  readIntelligenceStore,
  removeIntelligence,
  upsertIntelligence
} from './intelligenceStore.js';
import { evaluateGuildModel, loadModelContext } from './modelEvaluation.js';
import { warehouseInventory } from './featureWarehouse.js';
import { readModelRegistry } from './modelRegistry.js';

const MUTATING_COMMANDS = new Set(['team-set', 'player-set', 'context-set', 'result-add', 'remove', 'import', 'export', 'list']);
const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

function option(interaction, type, name) {
  return interaction.options[type](name);
}

function percent(value) {
  return Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : 'insufficient data';
}

function metric(value, digits = 3) {
  return Number.isFinite(value) ? value.toFixed(digits) : 'insufficient data';
}

function interval(range, formatter) {
  return Array.isArray(range) && range.length === 2 && range.every(Number.isFinite)
    ? `${formatter(range[0])}-${formatter(range[1])}`
    : 'n/a';
}

function compactJson(value) {
  return JSON.stringify(value, null, 2);
}

function formatRow(collection, row) {
  if (collection === 'teams') return `- **${row.name}** (${row.league}) | power ${row.powerRating ?? '--'} | Elo ${row.elo ?? '--'} | O/D ${row.offense ?? '--'}/${row.defense ?? '--'} | form ${row.form ?? '--'} | id ${row.id}`;
  if (collection === 'players') return `- **${row.name}** - ${row.team} (${row.league}) | ${row.role || 'role n/a'} | impact ${row.impact ?? '--'} | availability ${row.availability ?? '--'}% | ${row.status} | id ${row.id}`;
  if (collection === 'contexts') return `- **${row.gameId || row.id}** | ${Object.keys(row.factors || {}).length} factor(s) | updated ${row.updatedAt?.slice(0, 10) || '--'} | id ${row.id}`;
  if (collection === 'games') return `- **${row.awayTeam} @ ${row.homeTeam}** (${row.league}) | ${row.startTime} | id ${row.id}`;
  return `- **${row.awayTeam} ${row.awayScore} - ${row.homeTeam} ${row.homeScore}** (${row.league}, ${row.dateKey}) | id ${row.id}`;
}

async function fetchAttachmentText(attachment) {
  if (!attachment?.url) throw new Error('The attachment URL is missing.');
  if (Number(attachment.size || 0) > 5 * 1024 * 1024) throw new Error('Import files are limited to 5 MB.');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(attachment.url, { signal: controller.signal });
    if (!response.ok) throw new Error(`Could not download attachment (HTTP ${response.status}).`);
    const length = Number(response.headers.get('content-length') || 0);
    if (length > 5 * 1024 * 1024) throw new Error('Import files are limited to 5 MB.');
    const downloaded = Buffer.from(await response.arrayBuffer());
    if (downloaded.length > 5 * 1024 * 1024) throw new Error('Import files are limited to 5 MB compressed.');
    const body = /\.gz$/i.test(attachment.name || '') ? await gunzipAsync(downloaded) : downloaded;
    if (body.length > 50 * 1024 * 1024) throw new Error('Decompressed imports are limited to 50 MB.');
    return body.toString('utf8');
  } finally {
    clearTimeout(timer);
  }
}

export async function handleSportsDataCommand(interaction) {
  const subcommand = interaction.options.getSubcommand();
  const guildId = interaction.guildId || '';
  if (!guildId) {
    await interaction.reply({ content: 'Sports intelligence is stored per Discord server; run this command inside a server.', ephemeral: true });
    return;
  }
  if (MUTATING_COMMANDS.has(subcommand) && !isAdminInteraction(interaction)) {
    await interaction.reply({ content: 'This sports intelligence command is admin-only.', ephemeral: true });
    return;
  }
  await interaction.deferReply({ ephemeral: true });

  if (subcommand === 'team-set') {
    const row = await upsertIntelligence(guildId, 'teams', {
      name: option(interaction, 'getString', 'name'),
      league: option(interaction, 'getString', 'league'),
      powerRating: option(interaction, 'getNumber', 'power'),
      elo: option(interaction, 'getNumber', 'elo'),
      offense: option(interaction, 'getNumber', 'offense'),
      defense: option(interaction, 'getNumber', 'defense'),
      form: option(interaction, 'getNumber', 'form'),
      coaching: option(interaction, 'getNumber', 'coaching'),
      chemistry: option(interaction, 'getNumber', 'chemistry'),
      aliases: option(interaction, 'getString', 'aliases'),
      notes: option(interaction, 'getString', 'notes')
    }, interaction.user.id);
    await interaction.editReply(`Saved offline team profile **${row.name}** (${row.league}), id ${row.id}. Run /sports refresh recalculate:true to apply it to today's frozen slate without another paid provider request.`);
    return;
  }

  if (subcommand === 'player-set') {
    const statsText = option(interaction, 'getString', 'stats_json');
    if (statsText) {
      try { JSON.parse(statsText); } catch { throw new Error('stats_json must be a valid JSON object.'); }
    }
    const row = await upsertIntelligence(guildId, 'players', {
      name: option(interaction, 'getString', 'name'),
      team: option(interaction, 'getString', 'team'),
      league: option(interaction, 'getString', 'league'),
      role: option(interaction, 'getString', 'role'),
      impact: option(interaction, 'getNumber', 'impact'),
      availability: option(interaction, 'getInteger', 'availability'),
      status: option(interaction, 'getString', 'status'),
      form: option(interaction, 'getInteger', 'form'),
      starter: option(interaction, 'getBoolean', 'starter'),
      stats: statsText || null,
      notes: option(interaction, 'getString', 'notes')
    }, interaction.user.id);
    await interaction.editReply(`Saved offline player profile **${row.name}** for **${row.team}**: impact ${row.impact ?? 'derived from stats'}, availability ${row.availability}%. Run /sports refresh recalculate:true to apply it.`);
    return;
  }

  if (subcommand === 'context-set') {
    const factorsText = option(interaction, 'getString', 'factors_json');
    let factors;
    try { factors = JSON.parse(factorsText); } catch { throw new Error('factors_json must be valid JSON.'); }
    const row = await upsertIntelligence(guildId, 'contexts', {
      gameId: option(interaction, 'getString', 'game_id'),
      factors,
      notes: option(interaction, 'getString', 'notes'),
      expiresAt: option(interaction, 'getString', 'expires_at')
    }, interaction.user.id);
    await interaction.editReply(`Saved ${Object.keys(row.factors).length} context factor(s) for game ${row.gameId}. Run /sports refresh recalculate:true to apply them.`);
    return;
  }

  if (subcommand === 'result-add') {
    const dateKey = option(interaction, 'getString', 'date');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) throw new Error('date must use YYYY-MM-DD format.');
    const row = await upsertIntelligence(guildId, 'results', {
      dateKey,
      league: option(interaction, 'getString', 'league'),
      awayTeam: option(interaction, 'getString', 'away'),
      homeTeam: option(interaction, 'getString', 'home'),
      awayScore: option(interaction, 'getNumber', 'away_score'),
      homeScore: option(interaction, 'getNumber', 'home_score'),
      neutralSite: option(interaction, 'getBoolean', 'neutral')
    }, interaction.user.id);
    await interaction.editReply(`Added historical result **${row.awayTeam} ${row.awayScore} - ${row.homeTeam} ${row.homeScore}**. It will feed the next Elo/model recalculation.`);
    return;
  }

  if (subcommand === 'remove') {
    const collection = option(interaction, 'getString', 'collection');
    const id = option(interaction, 'getString', 'id');
    const removed = await removeIntelligence(guildId, collection, id);
    await interaction.editReply(removed ? `Removed ${removed.id} from ${collection}.` : `No ${collection} record matched ${id}.`);
    return;
  }

  if (subcommand === 'list') {
    const collection = option(interaction, 'getString', 'collection');
    const rows = await listIntelligence(guildId, collection, {
      league: option(interaction, 'getString', 'league'),
      query: option(interaction, 'getString', 'query'),
      limit: 25
    });
    await interaction.editReply([
      `**Local ${collection} (${rows.length} shown)**`,
      rows.length ? rows.map((row) => formatRow(collection, row)).join('\n') : 'No matching records.',
      '',
      'Use `/sportsdata export` for the full untruncated database.'
    ].join('\n').slice(0, 1950));
    return;
  }

  if (subcommand === 'import') {
    const attachment = interaction.options.getAttachment('file', true);
    const kind = option(interaction, 'getString', 'kind') || 'auto';
    const text = await fetchAttachmentText(attachment);
    const isCsv = /\.csv$/i.test(attachment.name || '') || /csv/i.test(attachment.contentType || '');
    let payload;
    if (isCsv) {
      if (kind === 'auto') throw new Error('Choose the CSV row kind (Teams, Players, Contexts, Games, or Results).');
      payload = parseCsv(text);
      if (!payload.length) throw new Error('The CSV needs a header row and at least one data row.');
    } else {
      try { payload = JSON.parse(text); } catch { throw new Error('The attachment is not valid JSON. Use UTF-8 JSON or choose a CSV file.'); }
    }
    const result = await importIntelligence(guildId, payload, { kind, actor: interaction.user.id });
    const summary = Object.entries(result.counts).filter(([, count]) => count).map(([name, count]) => `${name}=${count}`).join(', ') || 'no rows';
    await interaction.editReply(`Offline intelligence import complete: **${summary}**.${result.errors.length ? `\nSkipped rows:\n${result.errors.slice(0, 8).join('\n')}` : ''}\nRun /sports refresh recalculate:true to apply current-game changes.`);
    return;
  }

  if (subcommand === 'export') {
    const store = await readIntelligenceStore(guildId);
    const raw = Buffer.from(`${compactJson(store)}\n`, 'utf8');
    const compressed = raw.length > 4_000_000;
    const body = compressed ? await gzipAsync(raw, { level: 9 }) : raw;
    if (body.length > 5_000_000) throw new Error('The intelligence export is too large for a safe Discord attachment. Copy it directly from the private data directory instead.');
    const name = `omnimod-sports-intelligence-${guildId}.json${compressed ? '.gz' : ''}`;
    const file = new AttachmentBuilder(body, { name });
    await interaction.editReply({ content: `Offline intelligence export${compressed ? ' (gzip-compressed)' : ''}. It contains model inputs and notes but no Discord token or provider key.`, files: [file] });
    return;
  }

  if (subcommand === 'schema') {
    const schema = intelligenceSchemaExample();
    const file = new AttachmentBuilder(Buffer.from(`${compactJson(schema)}\n`, 'utf8'), { name: 'omnimod-sports-intelligence-example.json' });
    await interaction.editReply({ content: 'Example import schema. Delete example rows, add your verified data, then use `/sportsdata import`.', files: [file] });
    return;
  }

  if (subcommand === 'inventory') {
    const [inventory, context, warehouse] = await Promise.all([intelligenceInventory(guildId), loadModelContext(guildId), warehouseInventory()]);
    const embed = new EmbedBuilder()
      .setColor(0x2563eb)
      .setTitle('OmniMod offline intelligence coverage')
      .addFields(
        { name: 'Teams', value: String(inventory.teams), inline: true },
        { name: 'Players', value: String(inventory.players), inline: true },
        { name: 'Game contexts', value: String(inventory.contexts), inline: true },
        { name: 'Manual games', value: String(inventory.games), inline: true },
        { name: 'Historical results', value: String(inventory.results), inline: true },
        { name: 'Daily caches read', value: String(context.cacheCount), inline: true },
        { name: 'Eligible graded picks', value: String(context.history.overall.sampleSize), inline: true },
        { name: 'Historical accuracy', value: percent(context.history.overall.accuracy), inline: true },
        { name: 'Brier score', value: metric(context.history.overall.brierScore), inline: true },
        { name: 'Feature warehouse', value: `${warehouse.results} finals / ${warehouse.boxscores} boxes / ${warehouse.plays || 0} compact plays / ${warehouse.players} player snapshots / ${warehouse.lineups} lineup snapshots / ${warehouse.predictions} prediction snapshots / ${warehouse.markets} markets`, inline: false }
      )
      .setDescription('More rows do not automatically mean better predictions. Keep entries current, sourced, consistently scaled, and backtest calibration before trusting high confidence.')
      .setTimestamp(new Date());
    await interaction.editReply({ embeds: [embed] });
    return;
  }

  if (subcommand === 'evaluate') {
    const days = option(interaction, 'getInteger', 'days') || 365;
    const [report, registry] = await Promise.all([evaluateGuildModel(guildId, days), readModelRegistry()]);
    const challengerLines = Object.entries(registry.sports || {})
      .sort((a, b) => Number(b[1]?.evaluation?.evidence?.sampleSize || 0) - Number(a[1]?.evaluation?.evidence?.sampleSize || 0))
      .slice(0, 8)
      .map(([sport, row]) => `• ${sport}: champion=${row.championModelId}, n=${row.evaluation?.models?.[row.champion]?.sampleSize || row.evaluation?.evidence?.sampleSize || 0}, best ΔBrier=${Number.isFinite(row.evaluation?.bestBrierImprovement) ? row.evaluation.bestBrierImprovement.toFixed(4) : Number.isFinite(row.evaluation?.brierImprovement) ? row.evaluation.brierImprovement.toFixed(4) : 'n/a'}, ${row.status}`);
    const horizonLines = Object.entries(report.horizons?.byHorizon || {})
      .sort((a, b) => b[1].sampleSize - a[1].sampleSize)
      .map(([horizon, row]) => `• ${horizon}: n=${row.sampleSize}, accuracy=${percent(row.accuracy)} [95% ${interval(row.bootstrap95?.accuracy, percent)}], Brier=${metric(row.brierScore)} [${interval(row.bootstrap95?.brier, (value) => metric(value))}], model-close=${row.meanModelVsCloseEdge === null ? 'n/a' : `${(row.meanModelVsCloseEdge * 100).toFixed(1)}pt`}`);
    const seasonLines = Object.entries(report.horizons?.bySeasonPhase || {})
      .sort((a, b) => b[1].sampleSize - a[1].sampleSize)
      .map(([phase, row]) => `• ${phase}: n=${row.sampleSize}, accuracy=${percent(row.accuracy)}, Brier=${metric(row.brierScore)}, ECE=${percent(row.calibrationError)}`);
    const favoriteLines = Object.entries(report.horizons?.byFavoriteClass || {})
      .sort((a, b) => b[1].sampleSize - a[1].sampleSize)
      .map(([classification, row]) => `• ${classification}: n=${row.sampleSize}, accuracy=${percent(row.accuracy)}, Brier=${metric(row.brierScore)}, model-close=${row.meanModelVsCloseEdge === null ? 'n/a' : `${(row.meanModelVsCloseEdge * 100).toFixed(1)}pt`}`);
    const learningLines = Object.entries(report.featureLearning || {})
      .sort((a, b) => b[1].sampleSize - a[1].sampleSize)
      .slice(0, 8)
      .map(([sport, row]) => `• ${sport}: n=${row.sampleSize}, ${row.accepted ? 'accepted' : row.trained ? 'trained/not proven' : 'collecting'}, walk-forward ΔBrier=${row.brierImprovement === null ? 'n/a' : row.brierImprovement.toFixed(4)}`);
    const driftLines = Object.entries(report.drift || {})
      .filter(([sport]) => sport !== 'all')
      .sort((a, b) => (b[1].penalty || 0) - (a[1].penalty || 0))
      .slice(0, 8)
      .map(([sport, row]) => `• ${sport}: ${row.status}${row.penalty ? `, shrink ${(row.penalty * 100).toFixed(1)}%` : ''}`);
    const lines = Object.entries(report.bySport)
      .sort((a, b) => b[1].sampleSize - a[1].sampleSize)
      .slice(0, 8)
      .map(([sport, row]) => `• ${sport}: n=${row.sampleSize}, accuracy=${percent(row.accuracy)}, Brier=${metric(row.brierScore)}, ECE=${percent(row.calibrationError)}`);
    const embed = new EmbedBuilder()
      .setColor(0x7c3aed)
      .setTitle(`OmniMod model evaluation — ${days} days`)
      .setDescription(report.overall.sampleSize
        ? 'Lower Brier/log-loss/calibration error is better. Accuracy alone is not enough; a trustworthy 70% band should win about 70% over a large sample.'
        : 'No eligible frozen pregame predictions are graded yet. Live or retrospective predictions are deliberately excluded to prevent data leakage.')
      .addFields(
        { name: 'Eligible sample', value: String(report.overall.sampleSize), inline: true },
        { name: 'Accuracy', value: percent(report.overall.accuracy), inline: true },
        { name: 'Average confidence', value: percent(report.overall.averageConfidence), inline: true },
        { name: 'Brier score', value: metric(report.overall.brierScore), inline: true },
        { name: 'Log loss', value: metric(report.overall.logLoss), inline: true },
        { name: 'Calibration error (ECE)', value: percent(report.overall.calibrationError), inline: true },
        { name: 'By sport', value: lines.join('\n') || 'No sport has an eligible sample yet.', inline: false },
        { name: 'Walk-forward feature learning', value: learningLines.join('\n') || 'No learnable factor history yet.', inline: false },
        { name: 'Champion/challenger replay', value: challengerLines.join('\n') || 'No chronological replay comparisons yet.', inline: false },
        { name: 'Prediction horizon / closing line', value: horizonLines.join('\n').slice(0, 1024) || 'No graded T-90/T-30/T-10 warehouse snapshots yet.', inline: false },
        { name: 'Season phase', value: seasonLines.join('\n').slice(0, 1024) || 'No graded season-phase snapshots yet.', inline: false },
        { name: 'Favorite / underdog at close', value: favoriteLines.join('\n').slice(0, 1024) || 'No comparable closing snapshots yet.', inline: false },
        { name: 'Drift monitor', value: driftLines.join('\n') || 'Insufficient per-sport history.', inline: false }
      )
      .setTimestamp(new Date());
    await interaction.editReply({ embeds: [embed] });
  }
}
