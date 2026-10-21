# Prediction reliability continuation — October 20, 2026

## Confirmed defect and correction

The existing 134-test suite passed before edits. However, `sportsData.js:940` journaled targeted refresh forecasts before `index.js` called the completion gate. An old/failed summary could therefore create an apparently eligible forecast even though `completePregameRefreshAttempt` later rejected the refresh. Optional feature-warehouse snapshots had the same ordering problem.

Targeted builds now append only provisional observations. `pregameRefresh.js:109` adds a completion-and-journal boundary using the existing freshness/status/generation checks. Rejected observations receive an immutable rejection reason; only completed game IDs are issued and subsequently eligible for the feature warehouse. Issuance remains independent of Discord transport.

`predictionJournal.js:88` persists a hash-chained lifecycle: a full `PROVISIONAL` snapshot, validation event, immutable `ISSUED` forecast, optional `DELIVERED` acknowledgement, and `GRADED` event with independently revisioned results. Rejected identities cannot later qualify through an ordinary retry. A probability change requires a new forecast identity. Result-only refreshes cannot issue reconstructed forecasts.

`discordPublisher.js:342` distinguishes an actual send/edit from recovery of an existing message. Only successful payload writes acknowledge delivery, and only for the 25 predictions actually included in the embeds. Unshown predictions remain issued but undelivered. Recovered old messages do not prove that newly calculated forecasts appeared in Discord.

`journalEvaluation.js:9` excludes older forecast records without explicit issuance lifecycle evidence from the new performance cohort. Those records remain in the journal and are counted separately as legacy/unverified. This is a conservative cohort change, not evidence that the old forecasts were wrong or that the repaired model is more accurate.

## Actual validation

- Baseline: `npm --prefix sports-bot test` — 134 passed.
- After correction: the same full suite — 139 passed.
- `npm --prefix sports-bot run check` — passed.
- The actual offline targeted slate builder is exercised by `offline-slate.test.js:193`: its output cannot become an eligible forecast when fresh summary evidence is absent.
- Journal regressions exercise stale/rejected retries; successful validation followed by transport failure/no acknowledgement; fresh-module restart and duplicate delivery; cancellations, postponements and expired windows; immutable probabilities; final grading; and legacy cohort exclusion. Existing hash-chain corruption, torn-write, lock, score-correction and horizon tests still pass.

These fixtures verify lifecycle correctness, not real provider coverage, live Discord behavior, or accuracy improvement. The previous accuracy decline still cannot be attributed from the available historical evidence.

## Remaining requirements

| Phase | Status | Remaining authoritative evidence |
| --- | --- | --- |
| Verify previous repairs | In progress | Baseline reproduced; remaining source-to-test mappings for every earlier repair need a complete review. |
| Journal sequencing and lifecycle | In progress | Critical ordering defect corrected; live provider failures, missed windows and actual Discord restart behavior still need isolated operational evidence. |
| Per-game evidence coverage | In progress | Frozen per-game reports and v6.0.2 input/workload corrections implemented and tested; actual provider and sport-specific coverage still needs prospective validation. See SPORTS_EVIDENCE_COVERAGE.md. |
| Matched accuracy evaluation | In progress | Same-issue paired evaluation, first-issue selection, game-cluster uncertainty and coverage strata implemented/tested; real matched baseline/challenger outcomes still missing. See SPORTS_MATCHED_EVALUATION.md. |
| Model selection/calibration | In progress | Exact evaluated ML artifacts, chronology/provenance guards and pinned single-use preregistered reviews implemented/tested (167 tests). Hybrid governance, feature-learning chronology, league calibration and real trials remain open. See SPORTS_SELECTION_PROTOCOL.md. |
| Realistic odds/value research | Pending | Timestamped offered prices, settlement conventions, market dependence and realistic costs; winner accuracy is not economic value. |
| Operational/prospective validation | Pending | Actual Sports source/runtime/model/config/jobs inspection and isolated forward research. No deployment authorized by this goal. |

## Deployment and recovery

Keep development on `docs/setup-and-prediction-audit-2026-10-20` and preserve its pre-continuation commit `d86c96733d905978ea19cdf7eba8de84300b0673`. Do not delete or rewrite existing journals. New lifecycle records use the existing hash-chain schema and append event types; older consumers must be reviewed before deployment. Back up durable journals, caches and model registry, confirm the active data directory and worker owner, and test an isolated prospective run before requesting production approval.

The code does not manufacture missing starters, odds or historical timestamps. This phase changes evidence eligibility, not model probabilities or wagering thresholds. No live bot was altered, no wager was placed, and no improvement or profitability claim is supported yet.
