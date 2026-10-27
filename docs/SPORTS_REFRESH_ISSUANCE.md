# Refresh completion must agree with durable issuance

This source repair continues the Sports lifecycle audit. Forecast calculations remain v6.0.9; publication/eligibility code changes are preserved in their own source commit. No deployed configuration, Discord destination, model promotion or frozen research capture is changed.

## Confirmed gaps

1. `completePregameRefreshAttempt` built its durable predictions from the rebuilt slate, replacing only explicitly rejected games with prior values. New unsolicited predictions and rejected games without a prior forecast could therefore remain in the returned slate. The actual targeted builder can discover new games while refreshing another game; a successful companion refresh could publish the complete returned slate. The completion boundary did not enforce an accepted-only replacement policy.
2. Completion checked fresh receipt/generation times but did not verify normalized probabilities, a model version or consistency between the prediction's declared start/league and its game. A malformed forecast could count as a completed refresh while the journal refused eligible issuance.
3. Even after passing a structural gate, reusing a rejected forecast identity or changing probabilities under an existing identity could cause the journal to refuse issuance while the refresh still marked its windows complete. The new regression reproduced a completed count of one when the durable journal did not accept the candidate.
4. Delivery acknowledgement matched identity without comparing the displayed vector to the immutable issued probabilities. A mutated candidate sharing that identity could acknowledge the original record despite showing different probabilities.

These are integrity/reconciliation defects. Synthetic regressions establish the mechanisms; no claim is made that they caused a specific historical loss or occurred in a particular production game.

## Source repairs

- `predictionJournal.js:55` exposes `forecastIssuanceEvidence`. The journal and refresh gate now use the same pregame chronology, probability and version eligibility logic. Explicitly contradictory game/prediction start times or league identifiers cannot establish issuance. Unknown metadata remains unknown rather than being reconstructed.
- `pregameRefresh.js:80` replaces cached predictions only for accepted game IDs. Existing untouched/rejected forecasts survive; newly discovered schedule rows can remain available for a later eligible refresh without publishing their provisional predictions. Prior rows absent from a partial rebuilt slate are preserved.
- `predictionJournal.js:259` returns `verifiedIssuedGameIds` after journal synchronization. These include only candidate snapshots matching a real issued record, including its immutable vector, side and start. Merely requesting issuance is insufficient.
- `pregameRefresh.js:134` requires that durable confirmation before marking completion or preparing the publishable slate. Refusals retain pending refresh windows and record `journal_issuance_not_verified`. Malformed/inconsistent candidates record `forecast_issuance_not_verified`; the operational journal preserves those structured reasons.
- `predictionJournal.js:206` acknowledges delivery only when the snapshot matches the original issued forecast. A genuine late delivery of the unchanged forecast remains recordable at its actual acknowledgement time; it is not backdated or reclassified as a pregame delivery.

No score, EV, evidence, timing or risk threshold was lowered. The underlying native input publication/lineage limitations remain.

## Verification

Two initial completion regressions failed before repair: a non-target candidate overwrote a 55% cached vector with 99%, and a malformed forecast counted as completed. A separate regression reproduced journal refusal still producing a completed refresh. New controls cover mismatched start/league, missing versions, rejected new forecasts, preserved untouched rows, reused rejected/provisional/issued identities and immutable delivery matching.

An integration fixture combines the real provisional journal, completion helper and publisher with the existing simulated Discord boundary. Of three synthetic observations, one passes, one is rejected for stale evidence and one was not targeted. It verifies one issued/displayed/delivered forecast while all three original provisional observations remain auditable. The existing actual offline-builder regression now also verifies that rejection returns no publishable prediction while retaining the discovered schedule row.

Initial baseline run: 252 of 253 tests passed. A second wall-clock quote-budget fixture crossed the local daily reset during a six-minute retry offset. All quote scenarios now use their already-injected fixed daytime clock; the explicit midnight rollover test remains. Production budget/cooldown behavior is unchanged.

Final full suite: **259 passed, zero failures/skips**. Configured syntax and whitespace checks pass. Logs are retained privately outside Git. These checks verify code behavior, not better predictive accuracy.

## Remaining limits

The scheduler's production callers were inspected and use these helpers, but this fixture does not boot the full Discord client/timer loop. Live API delivery, competing processes, mid-write interruption/lock recovery, nested feature revision provenance and adequate forward outcomes remain unverified. Existing journal writes are separately synchronized; this repair is not a multi-file transaction over cache, warehouse and journal. A refusal cannot rewrite an existing terminal attempt with conflicting evidence: existing integrity checks still fail closed.

Preserved v6.0.7 research captures remain their original experiment and cannot demonstrate this revision's accuracy. cPanel remains excluded by user instruction. Sports is unfinished; Crypto and Stocks remain queued afterward.
