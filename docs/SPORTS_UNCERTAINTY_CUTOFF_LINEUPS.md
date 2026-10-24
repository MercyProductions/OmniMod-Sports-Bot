# Forecast-cutoff uncertainty and critical-role evidence — v6.0.59

## Confirmed defects

[`uncertainty.js`](../sports-bot/src/uncertainty.js#L21) accepted a forecast input but calculated minutes to start with the process's `Date.now()`. Re-evaluating the same frozen inputs later could change the late-lineup decision. Primary inference already had an explicit information cutoff, but did not pass it to this consumer.

The late-lineup test also required `criticalStarters > 0`. Completely missing critical starters therefore skipped the check. The aggregate count came from a broader starter calculation and did not prove a goalie/QB/pitcher identity. Conversely, actual role assertions without aggregate counters could not express why the gap was resolved. Evidence reporting accepted any number of distinct confirmed critical-role players as one confirmed role.

Finally, primary mode classification admitted a forecast at exactly its start time as pregame and treated malformed/unzoned event times as pregame. The immutable journal already required strict observed-before-start timestamps; the mode/calibration flag was inconsistent with that requirement. This is not proof that any such record was actually trained or wagered.

## Repairs

- Uncertainty uses one explicit numeric `now` cutoff, with wall-clock time used only when the caller omits it. Invalid explicit cutoffs fail. [`predictionEngine.js:719`](../sports-bot/src/predictionEngine.js#L719) supplies the same cutoff and selected automatic/manual player rows used by primary inference.
- Starts use the existing explicit-zone event-time parser, including its supported minute-precision format. Unverified scheduled starts cannot yield actionable pregame status. At the captured start, calibration eligibility ends; malformed/unzoned starts have `unverifiable_time` mode. See [`modelMode`](../sports-bot/src/predictionEngine.js#L438).
- The existing late window remains **0 < minutes to start ≤ 30**, for scheduled games only. Live/final/alert and already-started games are not called late-pregame gaps.
- Required roles remain the existing NHL goalie, football quarterback and baseball starting pitcher. NBA/soccer do not inherit an invented single-position requirement. Role status is recomputed from cutoff-filtered inputs and conservative player reconciliation; aggregate counters and caller-supplied cached coverage reports cannot substitute for those inputs.
- Missing/projected/unavailable or multiple distinct confirmed identities remain gaps. [`evidenceCoverage.js:119`](../sports-bot/src/evidenceCoverage.js#L119) distinguishes one confirmed role from `conflicting_confirmed_records`, preserves assertion counts and reports identity conflicts. Repeated assertions of the same player do not become multiple identities.
- A role confirmation remains separate from unknown health, injury completeness and independently attested starter truth. Existing heuristic uncertainty formulas, coefficients, interval labels and the evidence-quality threshold 58 were preserved. A late gap still combines with that existing threshold; this is not a blanket rejection of every forecast with missing data.
- `sports-uncertainty-context-v1` records evaluation/start times, minutes remaining, window state, per-side critical roles, missing sides and the late-gap decision. Primary output and its evidence report retain the context; the existing journal freezes it with original probabilities. No previous record was rewritten.

The direct estimator recomputes evidence coverage to avoid trusting stale cached reports. Primary inference also builds its richer selected-team report, so this change adds a small in-memory coverage pass per forecast; it adds no provider request or indicator/history download.

## Controlled before/after measurement

A credential-free script ran the exact old uncertainty source from commit `27ec10a` and the repaired implementation. All cases below used synthetic NHL teams, the same explicit cutoff, 70% home probability, evidence quality 55 and an unchanged heuristic half-width **0.0982781353**. These are implementation checks, not actual game predictions, confidence validation or performance evidence.

| Synthetic condition | Prior status / late-gap reason | Repaired status / late-gap reason |
| --- | --- | --- |
| Cutoff 20 minutes before start; process wall clock 80 minutes before | prediction / absent | withheld / present |
| Same inputs and cutoff; process wall clock one day later | withheld / present | withheld / present |
| No critical starter assertions | prediction / absent | withheld / present |
| Aggregate counters say complete; role records absent | prediction / absent | withheld / present |
| One actual confirmed role per side; aggregate counters absent | prediction / absent | prediction / absent |
| No role assertions, but cutoff 60 minutes before start | prediction / absent | prediction / absent |

The old first two rows demonstrate a decision changing with the replay clock. The repaired result is invariant. No probability or band was inflated to obtain a passing result. Original old-source bytes, scenario inputs/script/results and repaired processor hashes are private.

## Verification and forward collection

Pre-edit default-parallel baseline: **1,031 tests passed**. The initial 14-test suite reproduced 13 failures, including expectations for new diagnostics; these are scenarios, not 13 observed production incidents. Eighteen tests were added in total. They cover cutoff invariance, zero/multiple/projected/future/unavailable roles, duplicate identity controls, all three role families, exact timing boundaries, unchanged 58 threshold, noncritical sport controls, invalid starts/cutoffs, stale report rejection, medical/role separation and immutable journal context.

Focused uncertainty/health/coverage tests passed **74**. Final full `npm test` passed **1,049**, zero failed/skipped. `npm run check` parsed **211 project files** and whitespace checks passed. Development identity is **v6.0.59** and requires independent forward validation. No source-bound approval was promoted or migrated.

After checking that the prior collector was terminal, no worker was live and no owner lock was present, a due current-time invocation of the unchanged frozen collector completed at **2026-10-24T08:03:07.820Z**. It retained 12 distinct games, one date and zero finals, appended a third capture receipt, preserved 34 provider-cache blobs and made 10 ordinary free-provider requests with three failures. Total requests across the three checked runs are 37. There were zero orders, Discord posts or promotions. This does not prove every automatic hourly wake ran; the worker's interval counter alone is not continuity evidence.

The collector still uses source `03c6714ff0ca47ce98b491807ad3742877ca0102`, model v6.0.52, and the original plan/artifact/source archive. Current repairs were not installed into that trial. It requires 75 independent games/eight dates/fourteen days plus bounded final reconciliation, and depends on this PC/Codex. Original forecasts and receipts remain preserved; no missed window was backdated.

See the [structured phase checklist](SPORTS_UNCERTAINTY_CUTOFF_CHECKLIST.json). Actual medical/confirmed-goalie source completeness, broader league coverage, sufficient current-version forward/calibration/economic evidence, executable book terms and operational host proof remain unfinished. Sports is user-confirmed offline. No merge, deployment, startup, paid-provider request, credentials change, order or Discord post occurred. Live trading remains disabled, emergency stop remains enabled for isolated research, Stocks tests remain scheduled and unchanged, and Crypto then Stocks remain queued after the complete Sports specification.
