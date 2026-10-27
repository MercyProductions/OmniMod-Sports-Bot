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

The existing Sports heartbeat remains ACTIVE, scheduled hourly through November 15, and unchanged after the v6.0.62 source repairs. Five checked current-time invocations completed on October 24, the latest at **10:09:06.437 UTC**. They retain **12 distinct games, one date and zero finals**, with **five evidence receipts and 52 retained provider blobs**. Cumulative requests across these checked runs are 57. These checks do not establish every automated hourly invocation. Original source/plan/artifact are preserved; current data repairs are not silently installed into the trial. The Stocks automation configuration remains ACTIVE with unchanged file hash; this check does not certify a future scheduler wake. See [current data limitations](SPORTS_NATIVE_RECORD_AVAILABILITY.md) and [current-day discovery repair](SPORTS_CDN_DATE_SELECTION.md).

A subsequent read-only check verified the 104-file collector manifest, source archive, registered plan/artifact, all five capture receipts, provider blobs and original journal prefix. Targeted collector, availability-provider, reconciliation, goalie-context and health-diagnostic checks passed **57 tests**, zero failures/skips. This was an integrity/test check with no provider requests, not an additional trial sample. Current-source full verification is 1,100 tests; the frozen trial deliberately keeps its original implementation.

The previously saved native NHL landing and boxscore responses for the first trial event contain no explicit injury, starter, probable, lineup or roster fields. The landing response's `matchup.goalieComparison` is season context only; its leaders do not confirm an event starter. The captured ESPN injury request returned HTTP 403. These observations explain actual missing inputs in this checkpoint; they do not establish that every future native response will lack such information. No denied request was retried or bypassed during this read-only check, no preferred provider was silently configured and no unknown health/starter state was converted into confirmation.

## Additional checked current-time run

At 2026-10-24T08:03:07.820Z a due invocation completed after checking the prior terminal run, no live worker and no owner lock. It retained 12 games/one date/zero finals, appended receipt 3 and preserved 34 provider blobs; 10 ordinary free-provider requests/three failures were recorded. Cumulative requests across the three checked runs are 37. Original archived v52 source/plan/artifact and first forecasts remain unchanged; current v59 code was not substituted. This is no proof that every automatic hourly wake ran, and the worker interval counter is not continuity proof. [Current repair and limits](SPORTS_UNCERTAINTY_CUTOFF_LINEUPS.md).

## Sixth checked capture

At2026-10-24T11:11:31.870Z the original frozen v52 worker completed another due bounded run:10 public requests/three failures, six receipts/61 provider blobs,67 cumulative checked requests,12 distinct games/one date/zero finals. The104-file manifest, archive, plan/artifact and original forecasts verified unchanged. Repeat captures do not add independent games. This does not validate current v65 or prove every scheduled wake. No orders, Discord, paid requests or promotion; all three automation files including Stocks remain unchanged. [Independent input repair](SPORTS_INDEPENDENT_AVAILABILITY_INPUTS.md) stays outside this frozen trial.

## Seventh checked capture and separate current-source diagnostic

The unchanged frozenv52 worker completed at2026-10-24T12:14:26.257Z:10public requests/three failures, seven verified receipts/70blobs,77cumulative checked requests,12distinctgames/onedate/zerofinals. Original source/plan/artifact/first predictions remain pinned; repeat captures are not extra independent games.

[Separately pinnedv67 research](SPORTS_SPECIALIST_SCORE_CONSISTENCY.md) captured12sharedNHLpairs plus9unmatchedNBA/MLBforecasts at12:33UTC. It is a cold-start engineering diagnostic, not this registered selection trial or an untouched final holdout. The existing current-source final-only heartbeat now also handles that exact fourth study; its schedule/status/name/target remain, and no new forecasts or promotion are allowed. The original frozen collector and Stocks automation files stay unchanged. No model-performance improvement is established.
