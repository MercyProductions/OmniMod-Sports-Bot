# Operational evidence — development continuation

## Implemented and verified locally

`npm --prefix sports-bot run audit:operations` reads the integrity-checked journal; optional `--journal=/private/path/journal.jsonl` selects a private evidence file. It does not log in to Discord, fetch market/provider data, train a model or write learner state. Keep detailed reports private until identifiers have been reviewed.

Pregame refresh observability previously relied on the latest mutable cache attempt and forecast lifecycle transitions. A missing prediction could leave no permanent rejected-game record; a provider/build exception could leave only transient logs. `completeAndJournalPregameRefresh` now appends a hash-chained terminal attempt with per-game status, due windows, bounded reason codes and elapsed build/validation time. `buildJournaledPregameRefresh` records build failures even when no forecast exists. Exception text is not persisted. The actual scheduler calls both helpers.

Terminal attempt identity uses guild, attempt start and sorted game identifiers. Identical retries deduplicate after journal reload; contradictory terminal evidence fails closed. Attempts are not forecasts, training observations, delivered messages or graded outcomes. Process crashes, a failure to write the journal, or interruption between issuance and terminal recording can still leave a missing attempt; historical records cannot reconstruct that absence. Duration excludes Discord transport and is not total end-to-end latency.

The read-only report includes:

- Recorded successful, rejected and failed-build game counts, rejection reasons, terminal attempt counts and mean recorded duration.
- Issued forecasts, delivery acknowledgements and records without acknowledgements. Missing acknowledgement is not proof of failed delivery.
- Missing results, unknown scheduled start and overdue missing results. Default overdue threshold is 24 hours after scheduled start; it does not assert that postponed or long games have finished.
- Frozen evidence missingness reasons, unknown lineup/injury/source coverage, and underlying freshness uncertainty. A fresh fetch receipt does not verify source publication time.
- Per-league operational counts and per-league/model calibration monitoring.

Calibration monitoring uses the first issued forecast per event/start/version across guilds and horizons. Two adjacent seven-day windows are grouped by scheduled event time and use only results observed as of the audit cutoff. It reports multiclass Brier, log loss, and signed top-outcome confidence minus accuracy. Delta reporting requires at least 30 unique resolved games in each window. This minimum is a reporting guard, not statistical significance. Cohort composition, first-forecast horizon, pending results and coverage changes can bias descriptive deltas. Complete calibration curves and confidence intervals remain in matched forecast evaluation. No automated promotion or rollback follows this report.

## Verification

Baseline suite: 178 tests reproduced before this phase. Current full Sports suite: 185 passing, zero failures/skips; configured syntax and whitespace checks pass. New tests exercise absent-prediction rejections, provider build failure with sanitized evidence, retry deduplication, contradictory attempt evidence, chronology bounds, overdue/delivery/coverage accounting, game deduplication, sample guards and malformed probabilities. Existing lifecycle expectations explicitly include the new attempt event while eligible forecast counts remain unchanged.

Actual local CLI report: zero terminal attempts and zero issued forecasts in the development journal; refresh coverage is unknown, not a 100% success claim. A read-only Windows process inspection found no Node command line containing `sports-bot` or `OmniMod-Sports-Bot`. Relative-path launches cannot be ruled out by that inspection. It does not verify a remote process. No unrelated processes were changed.

## Still unverified / required before deployment

1. Inspect the actual host's running source revision, application root, configured data directory, selected model/artifact registry, provider entitlement and scheduler state. GitHub HEAD is not deployment proof.
2. Archive private host evidence, without publishing credentials or raw guild records. Do not mutate live configuration or restart the bot without deployment authorization.
3. Run an isolated prospective repaired model and separately pinned baseline using the same point-in-time inputs and schedules. Keep journal, warehouse, learned state and model registry separate from production and from each other.
4. Collect actual issued/delivered forecasts and final outcomes. Demonstrate matched proper-score/calibration results and realistic original-price costed research before claiming improvement.
5. Complete hybrid/feature-learning chronology and the full requirement-to-test mapping. None of these remaining requirements is satisfied by synthetic tests or empty local reports.

No production deployment, Discord messages, real wagers, live orders or model promotion occurred during this phase. Sports remains in progress; Crypto and then Stocks remain queued.
