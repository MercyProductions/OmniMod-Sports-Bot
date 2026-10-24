# Repository map

This repository contains one Node.js ESM Sports bot in `sports-bot/`. Root scripts delegate through `scripts/repository.mjs`; runtime entry is `sports-bot/app.js`, with scheduling and Discord handling in `sports-bot/src/index.js`. Dependencies are locked; generated runtime data, caches and `node_modules` are not source search targets.

## Verified commands

From the repository root:
- `npm test` — full fixture/integration suite; last checked with Node 24.
- `npm run check` — per-file syntax checker; avoids Windows command-line length limits.
- `git -c core.whitespace=cr-at-eol diff --check` — whitespace check accounting for tracked CRLF files.

From `sports-bot/`, targeted checks use `node --import ./test/setup.js --test test/<actual-file>.test.js`. Resolve test filenames with `rg --files` first. The setup creates isolated temporary state and clears Discord destinations. Green tests do not prove public-provider access or predictive performance.

## Architecture and invariants

- `src/sportsData.js` collects schedules and builds slates. CDN and primary ESPN routes use different date selectors; see `scoreboardWindow.js` and the CDN report before changing them.
- `src/officialSources.js` retains the existing MLB/NHL API and cache wrappers. `officialScheduleEvidence.js` binds exact events and projected pitchers, keeps provider namespaces separate, expires inputs and distinguishes same-source consistency from independent corroboration.
- `src/autoEnrichment.js` gathers summaries/history. `summarySourceIdentity.js` checks declared event/start/team/season identity; `scoreboardStarters.js` preserves explicitly projected MLB starters separately from confirmation and health.
- `src/summaryPlayerEvidence.js` composes player role/stat/health observations through `availabilityReconciliation.js`. `availabilitySourceRows` are original observations of the same player, not extra players; preserve them when rebuilding views or expiring dependencies.
- `src/predictionEngine.js`, `sportModels.js`, `inputChronology.js` and `evidenceCoverage.js` select inputs, enforce information cutoffs and report missing evidence. `availabilityProviderScope.js` rechecks original provider event/snapshot binding; a rejected summary must not erase independently valid provider/scoreboard inputs. Keep unknown values distinct from zero and role projections distinct from medical assertions.
- `src/sportModels.js` exposes raw specialist probabilities plus scoring input/margin evidence. `forecastHorizonScope.js` binds new predictions to the horizon actually passed to registry selection at one information cutoff; the journal validates it. Legacy inferred identities remain unchanged. Source/artifact approval must match the exact bundle. Normal point-model means must match their probability margin; unknown inputs stay distinct from zero. `predictionJournal.js` snapshots new specialist metadata without backfilling old records.
- `src/pregameRefresh.js` accepts refreshes before eligible permanent issuance. `availabilityRefresh.js` permits only fresh, new, event-bound selected NHL snapshot inputs as an alternate authority; the journal rechecks frozen source proof before issuance and links terminal proof to its acknowledged forecast. Do not treat season candidates or provider metadata alone as authority. `refreshReasonCodes.js` owns fixed terminal-rejection codes/policy; journals never store raw error text. Operational reports distinguish legacy missing reasons, and identical legacy retries must preserve original bytes. `predictionJournal.js` preserves first probabilities and separate lifecycle/result revisions. Check callers and journal/evaluation contracts together when changing either path.
- `scripts/family-forward-trial.mjs` guards newer frozen collectors against selection-directory redirection, overlapping league periods and duplicate consumed outcomes; it uses the existing collector lock and worker. `scripts/audit-capture-availability.mjs` only reads hash-bound saved capture evidence, separates mappings/failures/caps and keeps unknown health distinct from zero. These scripts do not change inference source identity.
- `src/prospectiveIsolation.js` / `prospectivePairs.js` and the prospective worker handle separately pinned source studies. `forwardTrialCollector.js` manages the registered frozen trial. Inspect manifests/receipts and ownership; do not rewrite archived source, original forecasts or experiment identities to match newer code.
- `src/oddsPricing.js` snapshots local provider fetch/revalidation receipts for new journal odds. `priceResearch.js` report v3 requires quote update <= receipt <= frozen evaluation; never infer missing legacy receipts from journal time. Linked later price observations keep their original model identity. These are research provenance checks, not source publication or executable-price proof.
- `src/config.js` owns data-directory/environment configuration. Runtime secrets and evidence stay outside tracked source. Use the isolated research entry points rather than starting the Discord app for validation.

Current objective, phase counts and unresolved validation belong in `docs/SPORTS_REQUIREMENT_EVIDENCE.md` and its linked checklists. Historical reports retain their original source/version and are not certificates for the current model. Live trading, model promotion, production startup, merge and deployment are separate actions, not effects of passing tests.
