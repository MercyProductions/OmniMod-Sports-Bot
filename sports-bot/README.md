> Deployment update: follow REVIEWED_DEPLOYMENT.md in the parent upload folder (also included in reviewed archives). It supersedes older hosting steps below; the Crypto host runs both Crypto and Stocks.

# OmniMod Sports Bot

OmniMod Sports is an offline-first Discord prediction-assistance system for head-to-head and team sports. It produces calibrated outcome probabilities, keeps third-party data confidence separate from model probability, freezes predictions before grading, and learns from locally stored results.

It is designed to require almost no data entry and no paid sports API. Public schedules, historical finals and box scores, player/lineup evidence, injuries, team form, Elo inputs, travel geometry, rest/congestion, available weather, and supported keyless official feeds are fetched within strict request caps and cached aggressively. Paid odds are optional. Server-entered teams, players, schedules, context, and results remain available as authoritative overrides when public data misses something.

No sports model can guarantee outcomes. Predictions are probabilistic research, not wagering advice. Accuracy improves only when inputs are current, consistently scaled, and evaluated over a large out-of-sample history.

## What changed in version 6.0

- Every available player now receives a projected participation distribution instead of a binary in/out assumption. Status, historical participation, starter rate, and expected sport-specific workload (minutes, snaps, plate appearances, or pitches) determine both lineup impact and uncertainty.
- Compact play-by-play evidence is retained in the local warehouse. Sport-specific play summaries add success/explosiveness, pressure/turnover, shot quality, and play-value evidence without storing raw commentary payloads.
- A dependency-free, per-sport gradient-boosted challenger trains only on chronological local prediction snapshots. It uses a fixed time-ordered holdout, reliability shrinkage, and the same Brier/log-loss promotion gates as every other challenger; it cannot silently replace the transparent champion.
- Frozen T-90, T-30, and T-10 snapshots now retain the complete compact feature state used by the model. A final result grades every eligible horizon, enabling like-for-like horizon, league, season-phase, favorite/underdog, and closing-line evaluations.
- Evaluation now reports multiclass Brier score, log loss, accuracy, calibration error, deterministic bootstrap confidence intervals, and model-versus-closing-probability edge when closing market evidence exists.
- The situational layer now records available officials, roof, playing surface, precipitation, wind direction, verified travel disruption, and coaching-change context. Official tendencies are observational, league-relative, and reliability-shrunk rather than treated as causal facts.
- NFL schedules gain an independently cached nflverse corroboration layer in addition to the existing keyless MLB and NHL sources. Source matches improve API Confidence conservatively; conflicts and stale evidence reduce it.

Version 6 retains and extends the version 5 architecture:

- Every scheduled game now receives targeted T-90, T-30, and T-10 refreshes. Missed windows collapse into one refresh, only due event summaries are forced, and no second paid Odds API batch is claimed.
- A durable local feature warehouse retains deduplicated finals, historical box scores, player/lineup snapshots, frozen predictions, and timestamped market snapshots across restarts. Strict local mode can reuse this evidence without a provider call.
- A leakage-safe chronological replay predicts each historical event before applying its result. Events sharing a start timestamp are all predicted before any result in that timestamp is learned.
- Seven distinct specialist models now run: MLB expected-runs/SP/bullpen/park, basketball possessions/efficiency/lineup, football EPA/drive/QB/OL, hockey xG/shot-quality/GSAx, soccer xG-Poisson, tennis surface-Elo/serve-return, and combat opponent/style adjustment.
- The existing evidence ensemble remains the default champion. Each specialist hybrid runs in shadow, is promoted per sport only after enough chronological comparisons improve Brier score without materially worsening log loss, and is automatically rolled back if recent performance degrades.
- Every result displays Prediction Uncertainty as an heuristic uncertainty band (coverage not validated). When the leading outcomes cannot be separated or critical evidence is unreliable, the bot explicitly withholds its official pick while retaining the probability for honest calibration.
- Opening, current, and T-10 closing-candidate market snapshots are stored locally. Discord game detail shows implied-probability movement; late refreshes reuse free/cached lines and do not spend another paid request.
- Weekly cached, keyless dataset adapters cover Baseball Savant expected statistics, nflverse team EPA, MoneyPuck team xG, the StatsBomb open-data catalog, and ATP/WTA surface/serve-return data when their non-commercial source is reachable. NBA.com advanced-team sync is implemented but disabled by default because its public endpoint often blocks hosted servers; cached ESPN possession/efficiency features remain active.

It also retains and extends all version 4 controls:

- Prediction Confidence is an estimated, historically calibrated outcome probability.
- API Confidence is a separate measure of third-party feed completeness, freshness, official-source agreement, bookmaker coverage, and consensus.
- Local Data Confidence measures the coverage and freshness of server-owned team, player, context, and history records.
- Evidence Quality combines independent data coverage without pretending missing inputs exist.
- Historical boxes automatically create evidence-based player impact, participation, starter rate, recent form, and starter-pair interaction profiles. Sparse samples are heavily shrunk.
- Current rosters, probable starters, lineups, and late injury rows are matched to those player profiles. Confirmed-lineup coverage, continuity, learned value, and recurring starter-pair performance become separate evidence.
- Team intelligence now includes iterative opponent adjustment, schedule strength, sport-specific box-score efficiency, season/offseason regression, and roster-transition uncertainty.
- Travel distance, daylight-saving-aware time-zone change, altitude change, team rest, back-to-backs, recent schedule congestion, road streaks, postseason context, and available starting-pitcher/critical-starter rest are calculated from cached data without a geocoding or player-log API.
- MLB StatsAPI and the NHL's public official feed provide cached, keyless schedule/status corroboration; MLB probable pitchers are merged with ESPN evidence. Conflicts lower API Confidence.
- Each sport learns feature multipliers only from earlier frozen predictions. A multiplier is activated only after chronological walk-forward evaluation shows an out-of-sample Brier-score improvement; otherwise the hand-audited sport defaults remain active.
- Per-sport drift monitoring compares recent accuracy, Brier score, and calibration against prior history and automatically reduces confidence/risk tier when performance degrades.
- Prediction rebuilds exclude same-day and future caches. This prevents later results or weights from leaking into an earlier prediction.
- Manual team, player, and context rows override matching automatic records. Automatic records raise API Confidence, never Local Data Confidence.
- Sport-specific profiles cover baseball, basketball (including NCAAB/NCAAW), football, hockey, soccer, combat sports, and tennis. Custom/manual leagues fall back to a conservative generic profile.
- The prediction engine combines sport-specific Elo, Bayesian record strength, opponent-adjusted team power, advanced offense/defense, recent form, player availability, confirmed-lineup value/interactions, season transitions, rest, travel/time zones/altitude, congestion, weather, coaching, chemistry, motivation, matchup adjustments, recent head-to-head, and optional market evidence.
- Moneyline consensus is de-vigged per bookmaker and aggregated across books. Without a paid provider, an available free single-book line may be used at a deliberately smaller weight. Market data is never the entire model.
- Soccer uses an explicit draw probability instead of forcing every game into a two-way winner.
- Single-book extreme/outlier prices do not steer the ensemble without independent confirmation.
- Live and retrospective predictions are excluded from calibration reports to prevent data leakage.
- Historical results update sport-aware Elo ratings with offseason regression. Finished frozen predictions feed calibration, walk-forward feature validation, accuracy, Brier score, log loss, expected calibration error, and drift monitoring.
- Provider responses are cached locally with stale fallback. Secret query values are never written into cache metadata.
- Strict local mode disables scoreboard and odds network requests entirely.

## Confidence semantics

These values answer different questions and must not be merged:

| Display | Meaning | Does not mean |
| --- | --- | --- |
| Prediction Confidence | Estimated probability of the displayed outcome after model blending and calibration | Guaranteed accuracy or data completeness |
| Prediction Uncertainty | heuristic uncertainty band (coverage not validated) around the selected-outcome probability | A guarantee that the true probability lies inside the interval |
| API Confidence | Quality/freshness/consensus of third-party scoreboard and optional market feeds | Probability that the pick wins |
| Local Data Confidence | Coverage/freshness of local teams, players, context, and history | That local judgments are correct |
| Evidence Quality | Combined independent coverage used for risk classification | A substitute for backtesting |
| Recommendation | Prediction, lean only, or withheld based on separation and evidence risk | A wagering instruction |

A prediction can have 64% Prediction Confidence and 0% API Confidence when it is based entirely on strong local data. It can also have high API Confidence but weak Prediction Confidence when reliable feeds describe an evenly matched event.

## Install and start

Requirements: Node.js 20 or newer.

    cd "C:\Users\gabri\Desktop\OmniMod Discord Bots - Upload Ready\sports-bot"
    npm install
    .\scripts\setup-env.ps1
    npm run check
    npm test
    npm run preview
    npm start

The default preview never calls the odds provider. To explicitly test optional odds enrichment:

    npm run preview:odds

The bot registers two Discord command groups: /sports for community predictions and /sportsdata for local intelligence and evaluation.

## Discord setup

Invite the bot with:

- View Channels
- Send Messages
- Embed Links
- Attach Files
- Read Message History
- Use Slash Commands
- Manage Roles, only if alert opt-in buttons are used

Create or choose sports, results, and private logs channels, then run:

    /sports setup sports_channel:#omnimod-sports results_channel:#omnimod-sports-results logs_channel:#omnimod-sports-logs alert_role:@Sports Alerts admin_role:@Admin post_now:true

Use /sports status to verify the scheduler, channels, cache, and provider state.

## Community commands

- /sports today: current frozen slate. Up to 25 games are shown in the compact post while the cache can retain a larger balanced multi-league board.
- /sports live: live events from the current slate.
- /sports report: consolidated strongest/value/lower-risk/upset view.
- /sports best: strongest cached probabilities after evidence/risk scoring.
- /sports value: positive model-versus-de-vigged-market differences.
- /sports low-risk: best evidence, probability, and agreement first.
- /sports upcoming: events in the selected time window.
- /sports league: filter by league or sport group.
- /sports game: complete probability, uncertainty, recommendation, snapshot stage, champion/challenger/local-ML state, line movement, projected participation, play-by-play, factor, and signal detail.
- /sports compare: current-slate team comparison.
- /sports upsets: longer-price outcome watches.
- /sports recap: eligible frozen-pregame grading only.
- /sports explain: plain-language model and confidence guide.
- /sports watch-add, watch-remove, watch-list: personal local watchlists.
- /sports refresh: edit the existing post from durable cache.
- /sports refresh recalculate:true: rerun current local inputs without another paid odds batch.
- /sports leagues, status, role, setup, api-key, api-clear, api-status, help: administration and coverage.

## Optional manual intelligence commands

Mutation/export/list commands require Discord Manage Server permission.

- /sportsdata team-set: power, Elo seed, offense, defense, form, coaching, chemistry, aliases, and notes.
- /sportsdata player-set: team, role, impact, availability, injury/status, starter state, form, and arbitrary sport-specific stats JSON.
- /sportsdata context-set: game-specific rest, travel, weather, fatigue, motivation, style matchup, or direct adjustments.
- /sportsdata result-add: historical/final result for Elo learning.
- /sportsdata import: JSON bundle or typed CSV, up to 5 MB.
- /sportsdata export: full server-owned intelligence JSON; large exports are gzip-compressed and secrets are not included. JSON.gz exports can be imported again.
- /sportsdata list and remove: inspect or remove records.
- /sportsdata inventory: coverage and history counts.
- /sportsdata evaluate: accuracy, Brier score, log loss, calibration error, horizon/season/favorite splits with confidence intervals and closing-line edge, per-sport walk-forward learning, champion/challenger/local-ML replay, and drift status.
- /sportsdata schema: downloadable example JSON bundle.

After changing current-game data, run /sports refresh recalculate:true. This preserves the original daily market snapshot and never claims a second paid provider batch.

## Recommended workflow

1. Let the normal daily refresh populate schedules, historical boxes, team/player profiles, lineups/probables, official corroboration, and situational context automatically.
2. Inspect `/sports game` signals. Add manual data only when you have fresher or more precise information; matching manual rows take precedence.
3. Recalculate the slate if you added a late injury, confirmed lineup, travel, weather-fit, coaching, or matchup override.
4. Let frozen pregame predictions grade automatically.
5. Review `/sportsdata evaluate` by sport. Neither an automatically trained factor nor a specialist challenger is used until chronological holdout/replay results improve proper scoring; trust calibration only after a meaningful sample exists.
6. Improve missing data collection before changing model weights or interpreting a high displayed probability as certainty.

Ready-to-import files are in the examples directory. Detailed field guidance is in docs/DATA.md and model behavior is in docs/MODEL.md.

## Local data scales

Team fields use 0-100 unless noted:

- powerRating: overall strength relative to the same league.
- elo: optional 800-2400 starting seed; imported and cached results update it.
- offense and defense: higher is better.
- form: recent form, with 50 neutral.
- coaching and chemistry: higher is better.
- homeAdvantage: optional -100 to +100 adjustment converted conservatively into Elo points.
- restDays and travelKm: objective situational inputs.

Player fields:

- impact: -10 to +10; positive means the team is stronger when the athlete is fully available.
- availability: 0-100.
- status: available, probable, limited, questionable, game-time, doubtful, out, suspended, or similar.
- starter: increases the importance of an availability change.
- form: 0-100, with 50 neutral.
- stats: arbitrary JSON. The engine recognizes cautious sport-specific fields such as WAR/ERA, plus-minus/minutes, EPA, goals-above-replacement/save percentage, xG/xA/rating, ranking, and striking differential.

Context subjective values should normally use -1 to +1. Direct homeAdjustment and awayAdjustment accept -2 to +2. Supported examples include homeRestDays, awayRestDays, homeTravelKm, awayTravelKm, homeFatigue, awayFatigue, homeMotivation, awayMotivation, homeMatchup, awayMatchup, weatherSeverity, homeWeatherFit, awayWeatherFit, homeAdjustment, and awayAdjustment. Unknown numeric factors remain stored for future extensions but do not silently affect predictions.

## External data and caching

ESPN public endpoints supply schedules, teams, records, statuses, historical finals and box scores, current injury/roster/lineup reports, available weather, and sometimes a free single-book line. The bot makes at most one cached history request per active league, one current summary request per selected upcoming game, and a capped set of immutable historical-summary requests. Concurrent guild refreshes share these caches. Historical boxes are cached for weeks, stale data can be used during provider outages, and final checks never request paid odds or rebuild historical intelligence. Provider caches are written in compact JSON. Summary caches retain bounded modeling fields and compact play records while discarding raw commentary, news, article, and video payloads.

For independent redundancy, supported MLB slates are checked against MLB StatsAPI, NHL slates against the NHL public score feed, and NFL schedules against the public nflverse schedule dataset. These sources require no key and use the same durable cache. MLB probable pitchers are merged into the starter layer. A source match raises API Confidence conservatively; status or start-time conflicts lower it. Other sports continue to use ESPN plus optional multi-book confirmation until a stable, lawful, keyless feed proves reliable enough to add.

The advanced snapshot layer is separate from live provider calls. Once per configured interval it downloads and normalizes small/keyless public datasets, then serves them locally: Baseball Savant batter/pitcher expected statistics, nflverse team EPA, MoneyPuck team xG/GSAx inputs, StatsBomb's available-competition catalog, and compatible ATP/WTA match statistics. Source failure retains the prior snapshot. Source receipts and attribution metadata are stored with the snapshot; verify source terms separately. Tennis sources are non-commercial. MoneyPuck permits free noncommercial use with attribution; obtain provider permission for other uses. Public availability does not grant a commercial entitlement. See [NHL request-period evidence and access limits](../docs/SPORTS_NHL_REQUEST_SEASON_BINDING.md). NBA.com advanced team ratings can be enabled explicitly, but are off by default because hosted requests are frequently blocked.

Automatic history never includes prediction-day games, preventing same-day/final-score leakage into pregame features. Current-game box-score performance and provider win-probability feeds are intentionally ignored. History, summaries, and provenance are stored in the private provider cache; no secret is needed for these public feeds.

Automatic-enrichment defaults:

- `AUTO_ENRICH_ENABLED=true`
- `AUTO_HISTORY_MAX_LEAGUES=10` and `AUTO_HISTORY_MAX_DAYS=365` (sport-specific windows are usually shorter)
- `AUTO_HISTORY_CACHE_HOURS=12`
- `AUTO_SUMMARY_MAX_GAMES=24`
- `AUTO_SUMMARY_CACHE_MINUTES=180`
- `AUTO_BOXSCORE_MAX_EVENTS=36` and `AUTO_BOXSCORE_CACHE_DAYS=30`
- `AUTO_OFFICIAL_SOURCES=true`
- `AUTO_LEARNING_ENABLED=true` and `AUTO_LEARNING_MIN_SAMPLES=30`
- `DRIFT_RECENT_SAMPLES=30`
- `PREGAME_REFRESH_ENABLED=true` and `PREGAME_REFRESH_WINDOWS=90,30,10`
- `FEATURE_WAREHOUSE_ENABLED=true`
- `HISTORICAL_REPLAY_ENABLED=true` and `HISTORICAL_REPLAY_MAX_ROWS=8000`
- `PLAY_BY_PLAY_ENABLED=true`
- `LOCAL_ML_ENABLED=true` and `LOCAL_ML_MIN_SAMPLES=150`
- `HORIZON_EVALUATION_ENABLED=true`
- `SOURCE_REDUNDANCY_ENABLED=true`
- `CHALLENGER_MIN_SAMPLES=75`
- `ADVANCED_DATASETS_ENABLED=true` and `ADVANCED_DATASET_SYNC_DAYS=7`
- `ADVANCED_NBA_STATS_ENABLED=false`

The caps apply per refresh, while cached responses are shared across guilds and concurrent requests. Lower the limits for a very constrained host; raise them only after checking memory, disk, provider behavior, and Discord slate size.

The Odds API is optional. When configured, the bot:

- claims at most one daily paid provider batch per guild/date;
- caches results across repeated refreshes;
- requests only active supported sport feeds;
- de-vigs complete bookmaker outcome sets before consensus;
- reports bookmaker count and disagreement through API Confidence;
- falls back to local/scoreboard modeling on quota, auth, outage, mismatch, or outlier conditions.

Set `AUTO_ENRICH_ENABLED=false` to keep the public daily scoreboard but disable automatic history and event-summary network enrichment. Set `LOCAL_ONLY=true` to disable all sports-provider and dataset network calls; the bot still reuses its local feature warehouse and manual intelligence. In strict local mode, import schedules and final results through `/sportsdata import` or `/sportsdata result-add`.

## Evaluation rules

- Only predictions created before the event start with predictionMode=pregame are eligible for calibration.
- Picks created during an event may be displayed and graded, but are excluded from pregame evaluation.
- Picks first created after an event is final are marked retrospective_ungraded and cannot inflate history.
- Accuracy measures pick hits, but does not measure probability quality.
- Brier score measures squared probability error; lower is better.
- Log loss heavily penalizes confident misses; lower is better.
- Expected calibration error compares displayed confidence bands with observed hit rates; lower is better.
- Calibration adjustments require a minimum local sample and use Bayesian shrinkage so small samples cannot dominate the base model.
- Per-sport feature learning is strictly chronological: a game is scored using the weights available before it, then becomes training evidence afterward.
- Learned feature weights remain disabled unless at least 20 holdout predictions exist and the walk-forward Brier improvement exceeds the acceptance threshold.
- Drift penalties compare a complete recent window with an earlier baseline and automatically shrink evidence/confidence when degradation is material.
- Champion/challenger promotion requires the configured minimum chronological sample, a Brier improvement greater than 0.0025, non-material log-loss regression, and acceptable recent performance. The best validated specialist-hybrid or local-ML challenger may be promoted, and a promoted challenger rolls back when recent Brier score becomes materially worse.
- Withheld recommendations remain calibration evidence because hiding uncertain misses would bias evaluation, but they are excluded from best, value, low-risk, report, and upset-pick boards.

## cPanel deployment

Application root:

    .omnimod_private/omnimod-sports-bot

Recommended settings:

    Application startup file: app.js
    Application mode: production
    Node.js version: 20 or newer

Run NPM Install after upload, then restart. app.js exposes /health while the Discord worker runs. app.cjs remains a CommonJS-compatible Passenger wrapper.

On Linux, durable state defaults to ~/.omnimod-sports-data so duplicate cPanel app roots share provider-usage guards and caches. Set OMNIMOD_SPORTS_DATA_DIR to an explicit persistent private directory if preferred. On Windows, state defaults to the project data directory.

Do not upload local data exports to a public web root. Keep .env, guild settings, provider caches, and intelligence JSON private. The project .gitignore excludes .env, data, and node_modules.

## Verification

    npm run check
    npm test
    npm audit --omit=dev
    npm run preview

The test suite covers projected workload and player uncertainty, compact play-by-play extraction, historical box parsing, player-value and starter-pair learning, opponent adjustment, lineup coverage, travel/time-zone/altitude/congestion automation, officiating/environment/source context, official-source cache reuse, all seven specialist models, local-ML chronological holdouts and promotion, horizon/closing-line evaluation with bootstrap intervals, targeted pregame windows, durable market behavior, uncertainty/abstention, champion scoring, chronological replay/future-score leakage prevention, walk-forward acceptance, drift penalties, season regression, automatic injury effects, request caps, daily provider locking, offline imports, strict-local generation, confidence separation, draws, market outliers, Discord size limits, provider-cache deduplication, and secret redaction.

## Finding a price worth investigating

Use `/sports value` for outcomes that clear payout-aware price checks, and `/sports game` to inspect why a specific outcome qualifies or is withheld. The likely winner and the best quoted value can differ. The value board compares all outcomes and shows the offered bookmaker, American price, provider timestamp, expected net return per unit and return after reducing the modeled probability by the heuristic uncertainty width.

For example, a 60% estimate at -180 has **negative** expected return (about -6.7%), even if the estimate exceeds the de-vigged consensus. Model-versus-consensus disagreement is now labeled separately from payout EV.

An opportunity requires two comparable quotes updated within 15 minutes, a modeled settlement scope, evidence quality of at least 65, sufficient verified pregame outcome history, acceptable calibration error, at least +2% modeled return and positive stressed return. Cached displays recheck time before presenting an opportunity. Freshness means a provider timestamp, not the time a cached page was fetched. The free single-book ESPN fallback remains context and cannot qualify on its own.

Expect the board to withhold opportunities while history accumulates. It requires 40 selected-pick calibration observations and 40 observations for the relevant side/probability bin; legacy records without pregame timestamps do not qualify for the latter. These minimums are screening rules, not proof of profitability. The model already uses market information. Check current book prices, rules, fees and stake availability yourself; the bot does not place bets or confirm an executable stake.

Each frozen warehouse prediction now retains `valueAnalysis`, including every compared outcome, quote assumptions and rejection reasons. Evaluate future outcomes against these original observations before relying on the system with meaningful capital. Actual fills, voids, fees, taxes and limits require a separate execution journal.

### Optional fresh quote refresh

Ordinary `/sports value` uses cached prices and does not request extra paid batches. To make an occasional fresh comparison available, an operator can set `SPORTS_VALUE_REFRESH_DAILY_CAP` to a small positive number in the deployment environment and restart the bot. It defaults to `0` (disabled). `SPORTS_VALUE_REFRESH_COOLDOWN_MINUTES` defaults to `5`. No credential or live setting is enabled by this code change.

An administrator can then run `/sports value refresh:true league:nba`. Re-register commands after deployment to expose the new optional parameters. Each invocation requests only head-to-head prices for one selected league, using known event IDs where available; omit `league` to choose the next upcoming league. It uses the first configured Odds API region and the existing credential. The response reports disabled, cached, daily-cap, cooldown, provider-failure, fresh or provider-stale status. A provider response does not guarantee fresh market timestamps or a qualifying opportunity.

The request cap is shared across guilds/processes using the same data directory and resets by the configured local date. Failed requests consume their reserved slot. These are extra-refresh HTTP request limits, separate from the existing once-daily batch and the provider's billing credits. Immutable claim files and an exclusive lock enforce the limits across restarts. Corrupt claims or an interrupted lock fail closed; an operator should inspect them before restoring service, never erase claims to bypass the cap.

Quote refresh reuses a verified model snapshot no older than six hours and displays `modelAsOf`; it does not make old team/injury inputs newly current. Run the ordinary model refresh first if that snapshot is too old. Each new price decision is archived with its actual issuance time as `quoteRefreshOnly`, while its original model time/probabilities remain unchanged. These snapshots are excluded from forecast calibration/training and remain available for the separate hypothetical priced-opportunity audit.
