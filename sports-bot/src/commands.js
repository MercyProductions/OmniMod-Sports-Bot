import { ChannelType, SlashCommandBuilder } from 'discord.js';

export function buildCommands() {
  return [
    new SlashCommandBuilder()
      .setName('sports')
      .setDescription('OmniMod Sports daily slate and prediction tools.')
      .addSubcommand((subcommand) =>
        subcommand
          .setName('help')
          .setDescription('Show the private owner/admin setup and model guide. Admin only.'))
      .addSubcommand((subcommand) =>
        subcommand
          .setName('today')
          .setDescription("Show today's cached OmniMod Sports slate."))
      .addSubcommand((subcommand) =>
        subcommand
          .setName('live')
          .setDescription('Show live games from the current cached or refreshed slate.'))
      .addSubcommand((subcommand) =>
        subcommand
          .setName('leagues')
          .setDescription('Show supported leagues and odds-feed coverage.'))
      .addSubcommand((subcommand) =>
        subcommand
          .setName('report')
          .setDescription('Show one consolidated OmniMod Sports snapshot for the current slate.')
          .addStringOption((option) =>
            option
              .setName('league')
              .setDescription('Optional league or sport group filter.')
              .setMaxLength(40)))
      .addSubcommand((subcommand) =>
        subcommand
          .setName('best')
          .setDescription("Show today's strongest OmniMod Sports model picks.")
          .addIntegerOption((option) =>
            option
              .setName('count')
              .setDescription('Number of picks to show.')
              .setMinValue(1)
              .setMaxValue(10)))
      .addSubcommand((subcommand) =>
        subcommand
          .setName('value')
          .setDescription('Compare fresh bookmaker prices by payout EV and uncertainty checks.')
          .addBooleanOption((option) => option.setName('refresh').setDescription('Admin opt-in paid h2h refresh; requires an enabled daily budget.'))
          .addStringOption((option) => option.setName('league').setDescription('League key for refresh, e.g. nba; defaults to the next upcoming league.').setMaxLength(40))
          .addIntegerOption((option) =>
            option
              .setName('count')
              .setDescription('Number of value picks to show.')
              .setMinValue(1)
              .setMaxValue(10)))
      .addSubcommand((subcommand) =>
        subcommand
          .setName('low-risk')
          .setDescription('Show the lowest-risk pregame picks by probability and evidence quality.')
          .addIntegerOption((option) =>
            option
              .setName('count')
              .setDescription('Number of lower-risk picks to show.')
              .setMinValue(1)
              .setMaxValue(10)))
      .addSubcommand((subcommand) =>
        subcommand
          .setName('upcoming')
          .setDescription('Show upcoming games within the next set of hours.')
          .addIntegerOption((option) =>
            option
              .setName('hours')
              .setDescription('Upcoming time window in hours.')
              .setMinValue(1)
              .setMaxValue(72)))
      .addSubcommand((subcommand) =>
        subcommand
          .setName('league')
          .setDescription('Filter the current slate by league or sport group.')
          .addStringOption((option) =>
            option
              .setName('league')
              .setDescription('League or sport group, like NBA, MLB, NFL, soccer, or hockey.')
              .setMaxLength(40)
              .setRequired(true))
          .addIntegerOption((option) =>
            option
              .setName('count')
              .setDescription('Number of games to show.')
              .setMinValue(1)
              .setMaxValue(12)))
      .addSubcommand((subcommand) =>
        subcommand
          .setName('game')
          .setDescription('Look up one game from the cached slate.')
          .addStringOption((option) =>
            option
              .setName('query')
              .setDescription('Team, league, or matchup text.')
              .setMaxLength(80)
              .setRequired(true)))
      .addSubcommand((subcommand) =>
        subcommand
          .setName('compare')
          .setDescription('Compare two teams from the current cached slate.')
          .addStringOption((option) =>
            option
              .setName('team_a')
              .setDescription('First team name or abbreviation.')
              .setMaxLength(80)
              .setRequired(true))
          .addStringOption((option) =>
            option
              .setName('team_b')
              .setDescription('Second team name or abbreviation.')
              .setMaxLength(80)
              .setRequired(true)))
      .addSubcommand((subcommand) =>
        subcommand
          .setName('explain')
          .setDescription('Explain how OmniMod Sports predictions, edge, risk, and grading work.'))
      .addSubcommand((subcommand) =>
        subcommand
          .setName('upsets')
          .setDescription('Show underdog or longer-price picks worth watching.')
          .addIntegerOption((option) =>
            option
              .setName('count')
              .setDescription('Number of upset watches to show.')
              .setMinValue(1)
              .setMaxValue(10)))
      .addSubcommand((subcommand) =>
        subcommand
          .setName('recap')
          .setDescription('Show recent prediction grading results.')
          .addIntegerOption((option) =>
            option
              .setName('days')
              .setDescription('How many cached days to include.')
              .setMinValue(1)
              .setMaxValue(30)))
      .addSubcommand((subcommand) =>
        subcommand
          .setName('watch-add')
          .setDescription('Add a team or keyword to your personal sports watchlist.')
          .addStringOption((option) =>
            option
              .setName('team')
              .setDescription('Team, league, or matchup keyword to watch.')
              .setMaxLength(80)
              .setRequired(true)))
      .addSubcommand((subcommand) =>
        subcommand
          .setName('watch-remove')
          .setDescription('Remove a team or keyword from your personal sports watchlist.')
          .addStringOption((option) =>
            option
              .setName('team')
              .setDescription('Exact watchlist entry to remove.')
              .setMaxLength(80)
              .setRequired(true)))
      .addSubcommand((subcommand) =>
        subcommand
          .setName('watch-list')
          .setDescription('Show your watchlist and matching games from the current slate.'))
      .addSubcommand((subcommand) =>
        subcommand
          .setName('refresh')
          .setDescription("Repost today's cache or recalculate it without another paid provider request.")
          .addBooleanOption((option) =>
            option
              .setName('recalculate')
              .setDescription('Re-run the model with current local team/player/context data.')))
      .addSubcommand((subcommand) =>
        subcommand
          .setName('setup')
          .setDescription('Assign OmniMod Sports channels and optional alert role. Admin only.')
          .addChannelOption((option) =>
            option
              .setName('sports_channel')
              .setDescription('Channel for daily prediction slates.')
              .addChannelTypes(ChannelType.GuildText)
              .setRequired(true))
          .addChannelOption((option) =>
            option
              .setName('results_channel')
              .setDescription('Optional channel for final-score grading posts.')
              .addChannelTypes(ChannelType.GuildText))
          .addChannelOption((option) =>
            option
              .setName('logs_channel')
              .setDescription('Optional private/admin channel for bot logs.')
              .addChannelTypes(ChannelType.GuildText))
          .addRoleOption((option) =>
            option
              .setName('alert_role')
              .setDescription('Optional role to ping on daily slates and manage via /sports role.'))
          .addRoleOption((option) =>
            option
              .setName('admin_role')
              .setDescription('Optional admin role to ping for provider or scheduler alerts.'))
          .addBooleanOption((option) =>
            option
              .setName('post_now')
              .setDescription('Post a fresh slate after saving setup.')))
      .addSubcommand((subcommand) =>
        subcommand
          .setName('api-key')
          .setDescription('Save a server-specific sports data API key. Admin only.')
          .addStringOption((option) =>
            option
              .setName('provider')
              .setDescription('Sports data provider.')
              .addChoices({ name: 'The Odds API', value: 'odds-api' })
              .setRequired(true))
          .addStringOption((option) =>
            option
              .setName('key')
              .setDescription('API key. Stored server-side and never posted back.')
              .setMaxLength(256)
              .setRequired(true))
          .addStringOption((option) =>
            option
              .setName('region')
              .setDescription('Odds region, usually us.')
              .addChoices(
                { name: 'US', value: 'us' },
                { name: 'US2', value: 'us2' },
                { name: 'UK', value: 'uk' },
                { name: 'EU', value: 'eu' },
                { name: 'AU', value: 'au' }
              )))
      .addSubcommand((subcommand) =>
        subcommand
          .setName('api-clear')
          .setDescription('Remove a saved server-specific sports API key. Admin only.')
          .addStringOption((option) =>
            option
              .setName('provider')
              .setDescription('Sports data provider.')
              .addChoices({ name: 'The Odds API', value: 'odds-api' })
              .setRequired(true)))
      .addSubcommand((subcommand) =>
        subcommand
          .setName('api-status')
          .setDescription('Show whether this server has sports API keys configured. Admin only.'))
      .addSubcommand((subcommand) =>
        subcommand
          .setName('status')
          .setDescription('Show bot scheduler, cache, and data-source status.'))
      .addSubcommand((subcommand) =>
        subcommand
          .setName('role')
          .setDescription('Post the Sports Alerts opt-in panel. Admin only.'))
      .toJSON(),
    new SlashCommandBuilder()
      .setName('sportsdata')
      .setDescription('Manage OmniMod local prediction intelligence and model evaluation.')
      .addSubcommand((subcommand) =>
        subcommand
          .setName('team-set')
          .setDescription('Create or update an offline team profile. Admin only.')
          .addStringOption((option) => option.setName('name').setDescription('Canonical team name.').setMaxLength(120).setRequired(true))
          .addStringOption((option) => option.setName('league').setDescription('League, such as NBA or EPL.').setMaxLength(50).setRequired(true))
          .addNumberOption((option) => option.setName('power').setDescription('Overall power rating, 0-100.').setMinValue(0).setMaxValue(100))
          .addNumberOption((option) => option.setName('elo').setDescription('Optional Elo seed, 800-2400.').setMinValue(800).setMaxValue(2400))
          .addNumberOption((option) => option.setName('offense').setDescription('Offense rating, 0-100.').setMinValue(0).setMaxValue(100))
          .addNumberOption((option) => option.setName('defense').setDescription('Defense rating, 0-100; higher is better.').setMinValue(0).setMaxValue(100))
          .addNumberOption((option) => option.setName('form').setDescription('Recent-form rating, 0-100.').setMinValue(0).setMaxValue(100))
          .addNumberOption((option) => option.setName('coaching').setDescription('Coaching rating, 0-100.').setMinValue(0).setMaxValue(100))
          .addNumberOption((option) => option.setName('chemistry').setDescription('Lineup continuity/chemistry, 0-100.').setMinValue(0).setMaxValue(100))
          .addStringOption((option) => option.setName('aliases').setDescription('Comma-separated alternate names.').setMaxLength(500))
          .addStringOption((option) => option.setName('notes').setDescription('Source or scouting notes.').setMaxLength(1000)))
      .addSubcommand((subcommand) =>
        subcommand
          .setName('player-set')
          .setDescription('Create or update an offline player profile. Admin only.')
          .addStringOption((option) => option.setName('name').setDescription('Player or athlete name.').setMaxLength(120).setRequired(true))
          .addStringOption((option) => option.setName('team').setDescription('Current team or competitor name.').setMaxLength(120).setRequired(true))
          .addStringOption((option) => option.setName('league').setDescription('League, such as MLB, NFL, UFC, or ATP.').setMaxLength(50).setRequired(true))
          .addStringOption((option) => option.setName('role').setDescription('Role or position, such as quarterback or starting goalie.').setMaxLength(80))
          .addNumberOption((option) => option.setName('impact').setDescription('Expected impact from -10 to +10.').setMinValue(-10).setMaxValue(10))
          .addIntegerOption((option) => option.setName('availability').setDescription('Expected availability percentage.').setMinValue(0).setMaxValue(100))
          .addStringOption((option) => option.setName('status').setDescription('Available, probable, questionable, doubtful, out, etc.').setMaxLength(80))
          .addIntegerOption((option) => option.setName('form').setDescription('Recent form, 0-100.').setMinValue(0).setMaxValue(100))
          .addBooleanOption((option) => option.setName('starter').setDescription('Whether this athlete is normally a starter.'))
          .addStringOption((option) => option.setName('stats_json').setDescription('Optional sport-specific stats as a compact JSON object.').setMaxLength(2000))
          .addStringOption((option) => option.setName('notes').setDescription('Injury/source/scouting notes.').setMaxLength(1000)))
      .addSubcommand((subcommand) =>
        subcommand
          .setName('context-set')
          .setDescription('Set game-specific rest, travel, weather, motivation, or matchup factors. Admin only.')
          .addStringOption((option) => option.setName('game_id').setDescription('Provider game ID from /sports game.').setMaxLength(180).setRequired(true))
          .addStringOption((option) => option.setName('factors_json').setDescription('JSON object of factors; normalized subjective values should use -1 to +1.').setMaxLength(3000).setRequired(true))
          .addStringOption((option) => option.setName('notes').setDescription('Context source and timestamp notes.').setMaxLength(1000))
          .addStringOption((option) => option.setName('expires_at').setDescription('Optional ISO expiry time.').setMaxLength(40)))
      .addSubcommand((subcommand) =>
        subcommand
          .setName('result-add')
          .setDescription('Add a historical/final result for Elo learning. Admin only.')
          .addStringOption((option) => option.setName('date').setDescription('Date in YYYY-MM-DD format.').setMaxLength(10).setRequired(true))
          .addStringOption((option) => option.setName('league').setDescription('League.').setMaxLength(50).setRequired(true))
          .addStringOption((option) => option.setName('away').setDescription('Away/first competitor.').setMaxLength(120).setRequired(true))
          .addStringOption((option) => option.setName('home').setDescription('Home/second competitor.').setMaxLength(120).setRequired(true))
          .addNumberOption((option) => option.setName('away_score').setDescription('Away/first final score.').setRequired(true))
          .addNumberOption((option) => option.setName('home_score').setDescription('Home/second final score.').setRequired(true))
          .addBooleanOption((option) => option.setName('neutral').setDescription('Whether the event was at a neutral site.'))
          .addStringOption((option) => option.setName('result_id').setDescription('Existing result record ID when correcting an import.').setMaxLength(180))
          .addStringOption((option) => option.setName('game_id').setDescription('Exact provider/local event ID to distinguish repeated matchups.').setMaxLength(180))
          .addStringOption((option) => option.setName('start_time').setDescription('Scheduled start timestamp with Z or explicit UTC offset.').setMaxLength(40))
          .addStringOption((option) => option.setName('score_basis').setDescription('Which scoring period these final scores represent.').addChoices({name:'Unknown',value:'unknown'},{name:'Regulation',value:'regulation'},{name:'Full game',value:'full_game'}))
          .addStringOption((option) => option.setName('source_reference').setDescription('Public URL of the score source you checked.').setMaxLength(1500))
          .addBooleanOption((option) => option.setName('source_checked').setDescription('Confirm that you checked this result against the cited source.'))
          .addStringOption((option) => option.setName('observed_at').setDescription('When you observed the result, with Z or explicit UTC offset.').setMaxLength(40)))
      .addSubcommand((subcommand) =>
        subcommand
          .setName('remove')
          .setDescription('Remove one local intelligence record. Admin only.')
          .addStringOption((option) => option.setName('collection').setDescription('Record type.').addChoices(
            { name: 'Teams', value: 'teams' }, { name: 'Players', value: 'players' },
            { name: 'Contexts', value: 'contexts' }, { name: 'Games', value: 'games' },
            { name: 'Results', value: 'results' }).setRequired(true))
          .addStringOption((option) => option.setName('id').setDescription('Exact record ID or canonical name.').setMaxLength(240).setRequired(true)))
      .addSubcommand((subcommand) =>
        subcommand
          .setName('list')
          .setDescription('List local team, player, context, schedule, or result records.')
          .addStringOption((option) => option.setName('collection').setDescription('Record type.').addChoices(
            { name: 'Teams', value: 'teams' }, { name: 'Players', value: 'players' },
            { name: 'Contexts', value: 'contexts' }, { name: 'Games', value: 'games' },
            { name: 'Results', value: 'results' }).setRequired(true))
          .addStringOption((option) => option.setName('league').setDescription('Optional league filter.').setMaxLength(50))
          .addStringOption((option) => option.setName('query').setDescription('Optional name or text filter.').setMaxLength(120)))
      .addSubcommand((subcommand) =>
        subcommand
          .setName('import')
          .setDescription('Import JSON or CSV intelligence without an external API. Admin only.')
          .addAttachmentOption((option) => option.setName('file').setDescription('JSON bundle or CSV file, maximum 5 MB.').setRequired(true))
          .addStringOption((option) => option.setName('kind').setDescription('CSV row type, or auto for a JSON bundle.').addChoices(
            { name: 'Auto / JSON bundle', value: 'auto' }, { name: 'Teams', value: 'team' },
            { name: 'Players', value: 'player' }, { name: 'Contexts', value: 'context' },
            { name: 'Games', value: 'game' }, { name: 'Results', value: 'result' })))
      .addSubcommand((subcommand) => subcommand.setName('export').setDescription('Export this server’s local intelligence as JSON. Admin only.'))
      .addSubcommand((subcommand) => subcommand.setName('inventory').setDescription('Show local intelligence coverage and current model history.'))
      .addSubcommand((subcommand) =>
        subcommand
          .setName('evaluate')
          .setDescription('Report accuracy, Brier score, log loss, and calibration error.')
          .addIntegerOption((option) => option.setName('days').setDescription('History window.').setMinValue(7).setMaxValue(1095)))
      .addSubcommand((subcommand) => subcommand.setName('schema').setDescription('Download an example offline intelligence import schema.'))
      .toJSON()
  ];
}
