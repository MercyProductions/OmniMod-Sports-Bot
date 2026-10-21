# OmniMod Sports Bot

Collect sports evidence, issue timestamped pregame outcome forecasts, compare available odds and grade final outcomes. `npm start` launches **only Sports**. Automated tests establish code behavior; current provider coverage and forward performance require separate evidence.

## How it works

1. Fetch supported schedules, historical finals, box scores and available player/lineup information using cached, capped requests, supported official corroboration and manual records.
2. Build chronological Elo/team strength, rest/travel/context and sport-specific features. Football, basketball, baseball, hockey, soccer, tennis and combat have distinct model profiles.
3. Compute full outcome probabilities, bounded optional market blending, calibration/uncertainty and shadow specialist/ML candidates. A leading team can remain visible even when a stronger recommendation is withheld.
4. Refresh around T-90/T-30/T-10 and retain frozen forecasts. Feed quality, model probability and uncertainty are different measurements.
5. Observe final scores and evaluate issued pregame forecasts with proper scores/calibration. An observed bookmaker price is not proof of independent value or an available wager.

Highlights are not the full universe and watches are not automatically approved entries. Model probability, heuristic strength and data quality have different meanings. Zero results can mean a closed session, disabled provider, missing evidence, pending model or risk rejection.

## Requirements and layout

Use Git, **Node.js 22.9+** (the export was checked with Node 24), npm and your own Discord app/server. The primary project is [`sports-bot/`](sports-bot/). Sports is self-contained with its own source and tests.

`repository.json` records the original export/source hashes. Later Git commits/tags are authoritative for subsequent changes. Dependencies remain locked in the existing project lockfiles.

## Install from a clean checkout

```sh
git clone https://github.com/MercyProductions/OmniMod-Sports-Bot.git
cd OmniMod-Sports-Bot
npm run bootstrap
npm run info
npm test
npm run check
```

Bootstrap installs locked dependencies with lifecycle scripts disabled. It does not create a provider subscription. Tests use isolated fixture/mocked inputs.

Copy the template on Windows PowerShell:

```powershell
Copy-Item sports-bot/.env.example sports-bot/.env
```

Or on Linux/macOS:

```sh
cp sports-bot/.env.example sports-bot/.env
```

Edit that **local** `.env`; never copy the maintainer’s tokens or publish your file. [Every shipped template setting is listed here](docs/CONFIGURATION.md), with sensitive values replaced by instructions to supply your own.

## Create your own Discord application

1. In the [Developer Portal](https://discord.com/developers/applications), create your own application and bot user. Choose its name/avatar.
2. Reset/copy its bot token into `DISCORD_TOKEN`; set the application ID as `DISCORD_CLIENT_ID`. They are different values. Each independently running bot needs its own application/token.
3. Enable Discord Developer Mode and copy your server ID to `DISCORD_GUILD_ID`. Configure SPORTS_CHANNEL_ID; never reuse the owner’s destination IDs.
4. Install it to your server with `bot` and `applications.commands` scopes. Allow View Channel, Send Messages, Embed Links and Read Message History in its channels. Setup that creates channels/roles needs the corresponding management permission.
5. Register commands and start this application:

```sh
npm run register
npm start
```

Use `/sports setup` in your server to select destinations/roles. Registration/startup connects to your own Discord application and can publish messages. A connected gateway does not establish feed readiness.

The identity skeleton is deliberately empty:

```dotenv
DISCORD_TOKEN=
DISCORD_CLIENT_ID=
DISCORD_GUILD_ID=
```

Add the project’s own destination/provider fields from its template. Do not share tokens in issues, screenshots or pull requests.

## Free data and paid upgrades

| Source | Role | Settings in local .env | Limits / prerequisites |
| --- | --- | --- | --- |
| Public/official evidence | Default keyless path | ODDS_API_KEY may stay empty; AUTO_ENRICH_ENABLED=true | Coverage varies; 403/stale cache is a data failure, not no games. |
| Offline/manual inputs | Free research fallback | LOCAL_ONLY=true plus local/imported records | Cold caches may be empty; current facts must not be backfilled as historical knowledge. |
| The Odds API v4 | Optional account-based odds | ODDS_API_KEY; ODDS_API_REGION=us | Plan credits vary; daily batch claims and explicit refresh budgets limit requests. |
| Advanced public datasets | Optional supported enrichment | See the template | Missing specialist inputs must not be presented as measured evidence. |

Review this mode skeleton; blank credentials intentionally do not authenticate:

```dotenv
# Configure your own odds key privately when needed.
ODDS_API_REGION=us
POST_ON_START=false
REGISTER_COMMANDS=false
PREGAME_REFRESH_ENABLED=true
PREGAME_REFRESH_WINDOWS=90,30,10
FEATURE_WAREHOUSE_ENABLED=true
```

The [configuration reference](docs/CONFIGURATION.md) lists all shipped variables. A key enables only the implemented adapters, not every endpoint sold by the provider. Read the primary project’s [existing technical guide](sports-bot/README.md) for deeper settings and market-specific workflows.

## Configure an account step by step

Start without an odds key for supported public evidence, or set `LOCAL_ONLY=true` for offline caches/imports. Set your own application ID; the repaired version no longer falls back to the maintainer’s ID. After Discord setup use `/sports refresh` for an initial scan if startup posting is disabled. For odds, obtain your own account key from The Odds API, store it in `ODDS_API_KEY` (or the administrator-only per-server API-key command), and select the intended `ODDS_API_REGION`. Existing daily batch claims persist across restarts; normal refresh does not claim unlimited new batches. Extra value refresh is an explicit administrator action and respects `SPORTS_VALUE_REFRESH_DAILY_CAP`. Monitor provider quota headers. A free single-book line may help context but does not clear the multi-book freshness/value checks.

## Operation and diagnostics

/sports help, /sports setup, /sports today, /sports game, /sports status, /sports results and /sportsdata evaluate. API-key/data-import operations are administrator-only.

Additional commands from this repository root:

```sh
npm --prefix sports-bot run preview
```

Probes/scans can contact the configured provider; metered history or explicit odds refresh may consume your credits. Review request/cost caps first. Do not start duplicate workers against one Discord identity/data store.

| Symptom | Check |
| --- | --- |
| No slash commands | Own token/client-ID pair, correct guild installation, registration and permissions. |
| Connected but zero candidates | Selected source, discovery/screen counts, session, current inputs and rejected-gate reasons. |
| HTTP 401/403 | Key validity, account region/permissions and endpoint entitlement; do not report it as no opportunities. |
| HTTP 429 | Quota headers, cooldown/concurrency and duplicate workers sharing the same provider account. |
| Watches without setups | Data age, model readiness, confirmation, catalyst evidence, explicit costs, emergency stop and risk limits. |
| Unexpected result summary | Separate research/shadow observations, issued alerts, delivery and actual paper fills. Consult durable records. |
| Stale records after restart | Actual data path/OS user, timezone, last successful request and old state; preserve the store when investigating. |

Runtime stores can contain private server settings and credentials saved by admin commands. Keep them outside Git/public web roots, persist them across restarts and back them up privately before upgrades. Original hosting documents may describe older deployments; source publication does not configure cPanel or start a production service.

## Sports audit and development status

The source before this audit is preserved by the baseline tag below. The [technical audit](docs/SPORTS_ACCURACY_AUDIT.md), [prediction-record specification](docs/PREDICTION_RECORDS.md) and [implementation checklist](docs/AUDIT_CHECKLIST.md) describe the development branch, `docs/setup-and-prediction-audit-2026-10-20`. The initial v6.0.1 audit has subsequent repairs; current forecast identity is **v6.0.45**. These changes remain under review; this work has not deployed them, and the actual running Sports source is unverified. On the main branch, documentation does not itself enable the new journal or audit command. Switch to the review branch to inspect/test that implementation.

The repaired branch has 134 passing tests and adds immutable pregame probabilities, available odds/timestamps and linked final results, plus evaluation/provenance fixes. It does not prove improved prediction accuracy. Available local history is insufficient for a fair historical before/after comparison. `FINAL_LOOKBACK_DAYS` in the configuration reference is a development addition.

## Baseline and contributing

The pre-change version is preserved as [`baseline/pre-readme-sports-audit-2026-10-20`](https://github.com/MercyProductions/OmniMod-Sports-Bot/tree/baseline/pre-readme-sports-audit-2026-10-20), commit `1185e178f34c26ee0d2f80c2b06d6f293f4d0eed`. Inspect it without erasing later work:

```sh
git switch -c inspect-baseline baseline/pre-readme-sports-audit-2026-10-20
```

Fork, create a development branch and use your own local credentials. Add regression tests for confirmed defects. Freeze model/strategy versions, dates, horizons and costs before evaluating changes. Compare the same chronological out-of-sample game/trade populations, reporting proper scores/calibration, sample sizes, costs and unresolved outcomes. A few good days or more alerts do not establish improvement. Preserve source and private runtime evidence before model changes.

`npm test` runs this primary project’s tests. `npm run check` runs configured syntax checks. `npm run test:all` is the standalone Sports suite. Submit the problem/change/checks/limits in your PR; share sanitized diagnostics rather than private state.

## Source map

Sports research updates add immutable forecast lifecycle records, per-game evidence coverage, matched game-weighted evaluation and [preregistered ML holdout review](docs/SPORTS_SELECTION_PROTOCOL.md). Runtime registry refreshes do not automatically promote challengers. Development validation and synthetic tests do not establish accuracy improvement or profitable wagering; production changes require separate review.

- [Prediction engine](sports-bot/src/predictionEngine.js)
- [Data lifecycle](sports-bot/src/sportsData.js)
- [Outcome warehouse](sports-bot/src/featureWarehouse.js)
- [Model documentation](sports-bot/docs/MODEL.md)
- [Data/imports](sports-bot/docs/DATA.md)

## Provider documentation

- [Discord setup](https://docs.discord.com/developers/quick-start/getting-started)
- [Alpaca coverage](https://docs.alpaca.markets/us/docs/about-market-data-api)
- [CoinGecko Demo authentication](https://docs.coingecko.com/demo/reference/authentication)
- [OANDA API access](https://developer.oanda.com/rest-live-v20/introduction/)
- [Databento access](https://databento.com/docs/getting-started/build-first-app)
- [Tradier sandbox/data differences](https://docs.tradier.com/docs/market-data)
- [The Odds API v4](https://the-odds-api.com/liveapi/guides/v4/)

References checked on 2026-10-20. Confirm current region, licensing, quota and endpoint entitlement in your own account before enabling a paid selector. Each contributor needs their own provider account; this code does not redistribute the maintainer’s data subscriptions.

Original-price research is documented in [frozen-price audits](docs/SPORTS_PRICE_RESEARCH.md). It preserves offered prices and linked quote updates, requires explicit cost assumptions, and separates hypothetical outcomes from actual paper performance. The current Sports suite has 706 passing tests; no improved forecasting or wagering performance has been established.

Journal event-association repair: [scoped identities, conflict quarantine and eligibility](docs/SPORTS_JOURNAL_EVENT_INTEGRITY.md). Development v6.0.32; original forecasts remain immutable. These are source and synthetic-regression improvements, not proof of forecasting or wagering improvement.

Scoped refresh and publication continuation: [event-bound windows, targeted forecast preservation and Discord delivery](docs/SPORTS_REFRESH_EVENT_IDENTITY.md), development v6.0.33. The full scope and remaining upstream identity work are documented there.

Source/final-refresh continuation: [league/start-bound merging, quote isolation and disputed final preservation](docs/SPORTS_SOURCE_EVENT_ASSOCIATION.md), development v6.0.34. Actual-host verification and predictive improvement remain unproven.

Final delivery continuation: [scoped result claims, message recovery and uncertain transport](docs/SPORTS_FINAL_DELIVERY_INTEGRITY.md), development v6.0.35. Synthetic transport verification does not establish host deployment or exactly-once multi-worker delivery.

Claim ownership continuation: [owner-bound generations, atomic decisions and crash recovery](docs/SPORTS_FINAL_CLAIM_OWNERSHIP.md), development v6.0.36. Extensions must pass the returned lease when finishing or releasing a claim. Hosting and filesystem requirements are explicit.

Final correction continuation: [edit existing result messages while preserving original forecasts](docs/SPORTS_FINAL_RESULT_CORRECTIONS.md), development v6.0.37. Optional acknowledged-final rechecks default to hourly within 24 hours of scheduled start; configuration, source gates and legacy limits are documented there.

Manual result integrity: [scoped doubleheaders, local receipts and conflict quarantine](docs/SPORTS_MANUAL_RESULT_INTEGRITY.md), development v6.0.38. Administrator event scope and source-check inputs are documented there; immutable raw edit history and actual host/prospective validation remain unfinished.

Accepted manual edits: [append-only result revisions, replay and backup requirements](docs/SPORTS_MANUAL_RESULT_HISTORY.md), development v6.0.39. Current snapshots are projections; keep the private result ledgers with backups. No deployment or improved prediction performance is claimed.

Quote refresh identity: [event-bound selection, frozen models and delayed response merging](docs/SPORTS_QUOTE_REFRESH_IDENTITY.md), development v6.0.40. Seven baseline regressions reproduced; no provider credits were used by the tests. Actual host and predictive improvement remain unverified.

Provider event identity: [ordered teams, bound event IDs and cohort conflicts](docs/SPORTS_PROVIDER_EVENT_IDENTITY.md), development v6.0.41. Seven old-matcher failures reproduced; injected daily-builder/quote-refresh and durable evidence paths verified. Native source truth and predictive improvement remain unproven.

Bookmaker integrity: [complete books, conflict quarantine and frozen audit evidence](docs/SPORTS_BOOKMAKER_INTEGRITY.md), development v6.0.42. Nine old-parser failures reproduced; malformed provider data no longer crashes the tested daily-builder path. Predictive improvement remains unproven.

Quote time integrity: [explicit timestamps, contributor ages and consistent inference cutoff](docs/SPORTS_QUOTE_TIMESTAMP_INTEGRITY.md), development v6.0.43. Seven old-source timing/normalization failures reproduced. Original quote text and timing evidence are preserved; independent publication truth and predictive improvement remain unproven.

Quote attempt auditing: [durable request intent, terminal evidence and read-only diagnostics](docs/SPORTS_QUOTE_ATTEMPT_AUDIT.md), development v6.0.44. Six old-workflow failures reproduced; interrupted calls remain outcome-unknown, and prepared snapshots do not imply Discord delivery.

Observed line markets: [single-book spread/total pairs, partial context and settlement provenance](docs/SPORTS_LINE_MARKET_INTEGRITY.md), development v6.0.45. Ten old-selector failures reproduced; selected lines and assumptions are frozen. No spread/total execution or verified bookmaker settlement is claimed.

Current prospective evidence: [new isolated v6.0.45 collection and scoped comparison repair](docs/SPORTS_CURRENT_PROSPECTIVE_VALIDATION.md). Two NHL pairs are frozen before their starts; outcomes remain pending and do not establish improvement. The requirement matrix now separates current fixture/process evidence from actual host and performance gaps.

Legacy result protection: [verified predecessor digests and safe lost-ack recovery](docs/SPORTS_LEGACY_FINAL_PROTECTION.md). Four old-publisher overwrite failures reproduced. Unverifiable old messages remain untouched; current cached picks cannot become reconstructed historical baselines.

Next-day real-data coverage: [13 matched NHL/NFL pairs and local runtime inventory](docs/SPORTS_NEXTDAY_OPERATIONAL_EVIDENCE.md). All outcomes were pending at the timestamped report, evidence coverage was incomplete, and no wager was qualified. Three studies contain 17 pair records but only 15 distinct games; differently pinned studies are not pooled as independent performance evidence. Actual Sports deployment remains unverified.

Operational monitoring v2: [canonical model/horizon cohorts, result conflict quarantine and explicit modeled outcomes](docs/SPORTS_OPERATIONAL_DRIFT_INTEGRITY.md). The read-only audit accepts an explicit-zone --as-of cutoff. Legacy outcome-space ambiguity stays visible; frozen research records are not rewritten, and descriptive drift does not authorize promotion.
