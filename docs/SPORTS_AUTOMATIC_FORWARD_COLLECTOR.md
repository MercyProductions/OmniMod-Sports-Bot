# Automatic frozen forward-trial collection and availability diagnostics

## Installed collector

The user authorized automatic collection for the existing NHL Daily hybrid trial. A thread heartbeat named **Sports frozen forward-trial collector** is active, scheduled hourly. It invokes a private pinned collector copy rather than whichever source later occupies the repository branch. The machine and Codex scheduler must be available; this is not an always-on external service. Missed intervals are counted from actual receipts and are never backdated.

The trial still uses source commit `03c6714ff0ca47ce98b491807ad3742877ca0102`, model v6.0.52 and the original registered artifact/plan. No frozen source, artifact, forecast or plan was rewritten. A separate collector file manifest pins 104 extracted-source/support files and the private empty environment. Original source archive SHA256 and selection state/plan/artifact digests are checked before work. Dependencies share the verified existing Node dependency directory by junction; this is controlled isolation, not an OS security sandbox or authentication of every dependency byte.

The declared period is **2026-10-24 05:46 UTC through 2026-11-07 05:46 UTC**. Before it starts, the runner returns awaiting-trial-start with zero provider requests. The actual frozen worker also has a no-network preflight, which verified the registered source/artifact. At this initial installation checkpoint no real trial collection had occurred; later checked runs are recorded below.

The collector stops starting new forecasts four minutes before the end to respect its bounded four-minute child timeout. Trial eligibility still uses original journal receipt times strictly inside the declared period. Final-only reconciliation may continue for seven additional days, after which the heartbeat must report actual status/unresolved outcomes and remove itself. A review-ready research result never promotes a model automatically.

## Working flow and safeguards

- `src/forwardTrialCollector.js` verifies the private source/plan/runner manifest and acquires an exclusive owner lock. It never removes somebody else's lock. A crashed or unknown owner remains fail-closed for investigation.
- `scripts/forward-trial-worker.mjs` loads the archived source, checks exact hybrid identity, and has no inherited Discord, odds, broker or other account credentials. Live trading is false, emergency stop true, model training/learning, replay, warehouse ingestion and paid odds requests are disabled.
- The worker permits only HTTPS GET requests to the existing public ESPN/NHL data hosts; redirects and other methods/domains are rejected. It does not import/start a Discord client or any broker/order client.
- Each current-day scan retains existing cached first-issue predictions while admitting newly discovered games. Original generated times and journal records remain frozen; captures preserve subsequent observations separately.
- Private captures, provider caches, a hash-chain forecast/result journal and run summaries are retained outside the repository. The collector does not copy outcomes into production learning caches.
- Final reconciliation handles at most three pending dates per run, rotates by the oldest attempt, and records attempts before provider work. A stuck older game therefore cannot monopolize all later result queries. Deferred dates remain visible.
- Status reports actual eligible forecasts, distinct games, resolved forecasts, requests/failures, missed intervals, reconciled/deferred dates and research-review status. Registration or scheduling is not evidence of completed validation.

The private installation contains `collector-manifest.json`, `CHECKPOINT.json`, `source-03c6714.zip`, `frozen/`, `collector/`, `selection/`, `runtime/`, `captures/` and an empty `.env` substitute. The generic one-shot entry is `node sports-bot/scripts/collect-forward-trial.js --directory=<private-verified-trial-directory>`. It deliberately refuses an unprepared or modified directory. Never point it at production state, remove owner locks to force a run, overwrite its journal or substitute a newer source for the pinned model. Preserve failed partial evidence for review.

## Injury and goalie investigation

A fresh, credential-free probe at approximately 2026-10-24 05:03 UTC returned NHL landing HTTP200 for native game 2026020168 and ESPN injuries HTTP403. The native FUT payload contains two season goalie leaders per side, no explicit starter fields and no injury fields. It therefore still supplies **four context candidates, zero confirmed starters and unknown injuries**. No access controls were bypassed, alternate identities used or paid subscription purchased.

One actual reporting defect was repaired: `advancedMetrics.js` counted null availability as a learned injury because JavaScript compares null as numeric zero. The counter now requires an observed finite availability value. A targeted regression fails against the previous source and passes after repair; explicit zero availability still counts as a negative availability assertion.

Additional per-side `criticalRoleEvidence` separates confirmed role, projected role and unknown health. A roster-only confirmed goalie can be represented as role evidence without manufacturing a healthy-player input; explicitly unavailable/projected players cannot become confirmed usable evidence. Existing critical-player quality gates, ratings and availability thresholds are unchanged. This is diagnostic correctness, not recovery of an unavailable provider report. Optional preferred-provider snapshots and existing Odds API configuration remain unchanged.

These repository fixes do not modify the archived trial implementation. Any later strategy/source change needs its own frozen evidence rather than silently entering this trial.

## Verification and remaining limits

The preceding source had 903 passing tests. Thirteen new tests cover collector ownership/windows/integrity/environment, actual worker preflight, first-issue persistence, blocked network actions, final-date fairness and health diagnostics. Focused collector/source/model command: **51 passed**. Full default-parallel suite: **916 passed**, zero failures/skips. Root `npm run check` and whitespace checks passed. One targeted old-source health-counter failure was reproduced with current files restored afterward.

The installed real runner returned awaiting-trial-start, zero requests/orders/Discord posts. The real archived worker's preflight passed exact source/artifact checks with zero requests. The first actual provider-backed trial run remains pending; fixture tests and preflight do not verify future provider availability, uninterrupted scheduling, prediction quality or profitability.

The minimum remains 75 independent games and eight dates over the predeclared 14-day period. Confirmed injury/goalie coverage, source publication truth, the earlier intermittent zero-successor cause and adequate current-version forward performance remain unfinished. Sports stays in progress before Crypto, then Stocks. No merge, production startup, deployment, model promotion or live trading occurred. The separate Stocks automation remains active and byte-identical. cPanel remains excluded.

## Subsequent actual-run checkpoint

The first actual invocation at 2026-10-24 05:46:11 UTC captured 12 NHL forecasts and zero finals. Earlier pending statements above describe the installation checkpoint. [Evidence-receipt report](SPORTS_FORWARD_EVIDENCE_RECEIPTS.md) documents the new local capture/provider/journal protections, three request failures and remaining unknown injuries/goalies. The source and registered experiment are unchanged. Full 945 tests pass; model validation remains in progress.

## Latest checked installation state

The existing Sports heartbeat remains ACTIVE and unchanged after the v6.0.57 source repairs. Two actual current-time invocations completed at 2026-10-24T05:46:11.398Z and 06:58:56.840Z, retaining 12 distinct games, one date and zero finals, with two evidence receipts and 25 retained provider blobs. These checks do not establish every automated hourly invocation. Original source/plan/artifact are preserved; current data repairs are not silently installed into the trial. The Stocks automation remains ACTIVE with unchanged file hash. See [current data limitations](SPORTS_NATIVE_RECORD_AVAILABILITY.md).
