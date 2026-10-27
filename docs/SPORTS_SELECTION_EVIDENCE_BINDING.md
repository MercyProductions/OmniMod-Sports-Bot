# Selection evidence binding and scoped model eligibility

Development identity: **v6.0.52**. Sports remains user-confirmed offline and in progress. No production model, credentials, orders, Discord transport or deployment was changed.

## Confirmed approval defects

The previous registry accepted a selection review when its report hash looked like 64 hexadecimal characters and candidate/sport/artifact/timestamp fields matched. It did not establish that the report matched a preregistered plan, pinned model bytes, journal inputs, reproduced measurements or independent game consumption. A modified in-memory report could also retain approval. A sport-level champion could apply outside the league and horizon actually tested.

Four targeted tests fail against the previous registry implementation: hash-shaped approval, serialized-but-unverified report, changed reviewed measurements, and league/horizon overreach. These are verified eligibility defects, not evidence that a specific installed model was promoted incorrectly. No installed model was inspected or modified as part of this phase.

## Implementation

`selectionProtocol.js` now produces `sports-selection-review-v2` reports with immutable consumed-game identities. A read-only verifier checks:

- Complete local selection state digest, plan contract/digest and strict preregistration/training chronology.
- Exact report bytes/digest against that state, plan ID, candidate, sport, league, horizon, model version and artifact identity.
- Pinned artifact file bytes and native ML artifact identity/training clocks or exact current hybrid source recipe.
- Exact journal envelopes available at finalization against the original input digest, complete results and game consumption.
- No later visible forecast/result/conflict revision silently reusing an earlier review.
- Full deterministic matched-journal evaluation recomputation, game-cluster confidence intervals and the original decision rule: at least 75 games, eight dates, a 14-day period, positive Brier lower bound, mean improvement over .0025 and log-loss lower bound at least -.003.
- Consumed-game ledger completeness and no repeated game evidence across reports.

A verified report receives a process-local, nonserializable proof tied to its bytes and verification cutoff. JSON flags and hashes cannot manufacture that proof. Changing the report invalidates it; a historical inference cannot use a verification obtained after its cutoff. A serialized registry requires fresh verification after reload. This deliberately fails closed for legacy v1 reviews instead of inventing missing evidence or upgrading old reports in place.

`modelRegistry.js` uses that proof for proposed and existing champions. Its read path optionally verifies an explicitly configured local evidence directory and hash-chain journal. Missing, malformed, changed or unverified evidence leaves the champion ineligible; a sanitized status explains the failure. Verification writes neither registry nor research inputs. Scheduled registry refresh still uses `allowPromotion:false`; evidence verification alone cannot authorize promotion.

`predictionEngine.js` supplies the game league and requested forecast horizon. `sportsData.js` derives that horizon from the same per-event market stage used for the new forecast. A reviewed NBA Daily model therefore cannot silently activate for WNBA, T-90 or T-10. Missing scope fails closed. The current registry remains one entry per sport, so multiple simultaneous league/horizon champions require a future explicitly scoped registry design; unsupported scopes use the evidence baseline.

## Local setup and trust boundary

New optional `.env.example` keys (blank by default):

```
MODEL_SELECTION_EVIDENCE_DIR=
MODEL_SELECTION_JOURNAL_FILE=
```

The first is a private isolated directory containing `selection-state.json` and its pinned `<plan-id>-model.json`; the second is the corresponding complete, hash-chain prediction journal. Both paths must be explicitly configured before a serialized nonbaseline champion can verify. Do not place credentials in any research file or commit these private inputs. Existing bot `.env` files were not changed.

Register a new exact recipe or trained artifact before its trial period with the existing `research:selection` CLI. Preserve the entire journal, plan, artifact and state. Finalize only after the predeclared period and outcomes are complete. The returned v2 report remains research evidence, not an activation instruction. No new promotion or deployment command was added. Blank verification settings retain the baseline until evidence and separately authorized approval are available.

These checks establish local consistency and reproducible mathematics. They do **not** authenticate a feed, reviewer identity, original source publication time, or a malicious administrator able to rewrite all local files and hashes. The verifier reads caller-specified local evidence; it does not create evidence. Running source and version must still be preserved. Later corrections require review rather than silently revising the frozen trial. An unverified/legacy report elsewhere in the same selection ledger also fails closed; preserve it and use a separately reviewed evidence directory rather than deleting records to regain approval.

## Verification

- Unchanged default-parallel baseline: **888 passed**.
- Four targeted regressions fail against the prior registry, with current source restored afterward.
- Fifteen new evidence tests cover valid synthetic trials, forged/serialized proofs, modified measurements, exact artifact/plan/input binding, later conflicts, consumed games, promotion authorization, actual hash-chain file reload, no writes, path/JSON failures, inference scope and legacy review refusal.
- Existing positive-path approval, rollback, chronology and ML inference fixtures now use synthetic trials generated through the real registration/finalization workflow. They are explicitly synthetic and are not reported as market evidence.
- Focused command from `sports-bot`: `node --import ./test/setup.js --test test/selection-proof.test.js test/registry-availability.test.js test/elo-conflicts-hybrid-binding.test.js test/v5-prediction-system.test.js test/v6-prediction-system.test.js test/selection-protocol.test.js test/refresh-event-identity.test.js`: **91 passed**.
- Final default-parallel full suite: **903 passed**, zero failed/skipped. Root `npm run check` and `git -c core.whitespace=cr-at-eol diff --check` passed.

## What remains unverified

The frozen v6.0.45 next-day study remains 13 resolved games with identical baseline/challenger results: 10/13 correct, Brier .2334843076923077 and log loss .6600681637547575. It neither establishes improvement nor validates v6.0.52. No current-version preregistered 75-game/eight-date/14-day trial has completed. A better model cannot be declared from fixtures, the old small sample or a newly registered plan.

The last actual free-source observations remain four season-context goalie candidates, zero confirmed starters and injury HTTP403. Optional user-provider snapshots remain supported but no actual external exporter is connected. This phase made no provider requests, changed no Odds API configuration and did not convert missing health into healthy status. Source publication truth and complete league-specific availability remain unfinished.

The earlier Windows zero-successor failure did not reproduce in the preceding eight child-process repetitions. Its underlying cause remains unresolved; owner fencing and diagnostics are preserved. Full operational verification remains pending while Sports is offline. Existing frozen research stays separate from production learning.

Sports remains ahead of Crypto, then Stocks. Live trading stays disabled; no merge, deployment, model promotion or orders occurred. The Stocks market-session schedule is unchanged; cPanel remains excluded.
