# Current-candidate registration with preserved prior trials

The latest fixed NHL Daily candidate is now preregistered for the existing November 8–22 research window. This addresses the earlier absence of a selection plan for the latest source. It does not establish accuracy, calibration, profitable prices or model approval. The original v52 collection continues, and no production model or Discord bot was activated.

## Guarded pre-start transition

The older November v67 trial had no runtime directory, capture receipts, provider blobs, journal bytes or recorded actual runs. Its source-integrity repairs were selected before this trial's observations existed. The replacement was not chosen from November outcomes.

`sports-bot/src/selectionProtocol.js:120` adds an explicit `supersedeUnstartedSelectionPlan` operation. It uses the existing selection transaction and the same collector owner lock used by collection. Both original plan objects, artifact files and source archives remain unchanged. A hash-bound transition record links the retained old plan to the replacement.

`selectionSupersession.js:30` validates retained plan hashes, clocks, scope, weight, decision rule, unchanged period and non-reduced minimums. Active league periods remain disjoint. The operation refuses an already-started trial, captured or orphaned observations, data-bearing runtime files, checkpoint evidence of activity, owner claims, redirected paths, changed source/artifacts or a prior report. It snapshots existing consumed-game identities at transition time; later legitimate replacement outcomes can be consumed without reviving the retired plan.

`forwardTrialCollector.js:49` and the family wrapper return `superseded_before_trial_start` without invoking a retired worker. Retired plans cannot finalize or acquire approval evidence. Family verification flags unexpected later evidence in a retired collector. Original-source publication and human identity remain outside these local consistency checks; hashes do not authenticate provider truth.

CLI setup for a user's own isolated research store uses the new explicit `--action=supersede-unstarted`, `--prior-plan`, `--prior-collector`, `--directory` and `--spec` options on `selection-research.js`. The directory must be the canonical physical shared selection directory. The replacement spec uses the existing hybrid registration schema and the same period, sport, league, horizon, fixed weight and decision rule. This command mutates the research ledger; inspect existing evidence first and never use it to discard a started or unsuccessful trial. Preserve a failed/unknown invocation and inspect its actual state before retrying.

## Actual registered candidate

| Field | Preserved or registered value |
| --- | --- |
| Original active trial | v52, source `03c6714...`, original plan/artifact/forecasts retained |
| Retained superseded trial | `nhl-hybrid-daily-v6067-20261108`; source/archive/plan/artifact/checkpoint unchanged |
| New active plan | `nhl-hybrid-daily-v6069-20261108` |
| Frozen source | `4b2736be0cb96b2dc3239b33f2f02fdd727d53b0`, predictive identity v6.0.69 |
| Artifact | `535fa522928f8ae5dc0eb953b229a332539f8471124459be9a11b3acbb6e0629` |
| Registration/transition time | 2026-10-24T17:19:25.589Z |
| New-forecast period | 2026-11-08T12:00Z through 2026-11-22T12:00Z |
| Bounded final grace | Through 2026-11-29T12:00Z |
| Requirements | At least 75 independent games, eight dates, 14 days; existing paired proper-score criteria and explicit approval gate |
| Installed evidence | 121 verified files; three retained plans, one superseded and two active; zero finalized reports/consumed games at installation |

Registration ran once. The first private installer preflight failed because a filename-prefix replacement also changed a family schema label. That failure prevented worker execution. Failed metadata was retained; only the unsealed binding/manifest/checkpoint metadata was repaired and rehashed. Candidate source, registered artifact, plan hash and original evidence were unchanged, and registration was not repeated. The repaired family inspection, pre-start invocation and actual frozen-worker preflight all passed with **zero provider requests, orders and Discord posts**.

The existing November heartbeat now points to this exact v69 archive and plan. Only its name, prompt and update timestamp changed. Its cadence, status, destination and creation time stayed fixed. The original v52 collector, current-source final-only reconciliation and Stocks test automation files remained byte-identical. Saved configuration and preflight do not attest future uninterrupted execution; actual completed runs remain the evidence.

The original v52 collector also completed its next due invocation at **2026-10-24T17:37:24.405Z** after the transition: 12 distinct games/one date/zero finals, 13 evidence receipts/115 provider blobs, 12 checked runs and 127 cumulative requests. This run made 10 free-provider requests with three failures and reconciled one date without inventing a final. Its source archive remained unchanged. Repeat observations are not independent games, and the missed-interval counter does not prove every scheduled wake.

## Verification and unfinished requirements

Pre-edit baseline: **1,272 tests passed**. Twenty new tests cover immutable retention, real child-process contention, partial state/artifact failures, redirected/used/started stores, unchanged policy, consumed-outcome snapshots, retired dispatch/approval rejection and later successor finalization. Focused and postcommit checks: **79 passed**. Full `npm test`: **1,292 passed**, zero failures/skips. `npm run check`: **243 files**; whitespace and public-source secret scans pass.

The new candidate has **zero trial forecasts/outcomes** at installation; its future window has not begun. No strategy improvement or promotion is established by registering it. This is a cold-start NHL Daily hybrid-versus-evidence trial, not validation of all leagues, horizons or the installed learner. Earlier overlapping engineering diagnostics and small retrospective score comparisons do not become independent selection data.

Actual injury/confirmed-goalie coverage remains missing. The prior 21-game audit still shows native-event mapping, request-failure and cap omissions, with all 42 team sides medically unknown. No provider entitlement, exporter connection or clinical evidence was invented. Full Sports completion still needs genuine permitted inputs, adequate independent forecasts/results, calibrated model/uncertainty comparisons, original offered-price/settlement/cost evidence and operational verification. Crypto then Stocks remain queued in that order. Live trading stays disabled with emergency stop enabled; no main merge, production startup, deployment, promotion, credential change or paid data request occurred.
