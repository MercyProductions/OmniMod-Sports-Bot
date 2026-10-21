# Next-day prospective coverage and local runtime inventory

Observed October 21, 2026, approximately 14:00–14:06 UTC. This is new real-data evidence, not a model promotion or completion certificate. Model identity remains v6.0.45; source algorithms, credentials, risk controls and production state were not changed.

## Frozen next-day collection

A private collection plan and hashes of both existing studies were saved before creating a new study. The existing bounded collector was used without changing its source or profile limits. Target sampling date was October 22 in America/Chicago, with NBA/NHL/NFL/MLB enabled, six summary slots, four history leagues, 90 history days and no box-score downloads. Paid odds, optional advanced datasets/corroboration, local ML, warehouse, Discord and orders were disabled. Built-in official schedule fallbacks are separate from optional corroboration.

| Role | Archived source | Worker started UTC | Worker completed UTC | Pregame forecasts |
| --- | --- | --- | --- | --- |
| Baseline | `1185e178f34c26ee0d2f80c2b06d6f293f4d0eed` / v6.0.0 | 14:04:54.802 | 14:04:56.050 | 13 |
| Challenger | `39b26b20c30f0526d5b372fee1f4d0d9d6be349a` / v6.0.45 | 14:04:56.199 | 14:04:57.052 | 13 |

The receipt-verified report at 14:05:15 UTC contains **13 matched pairs: 12 NHL and one NFL**, with no association rejections and a 997 ms gap between the role capture receipts. This is sequential public-data collection, not identical-input inference. The manifest, archived files, worker and dependency binding were inspected by the existing verifier.

Earliest start in this sample is October 22 at 23:00 UTC; latest is October 23 at 02:00 UTC. All 26 role/game observations were not started at report time. No final query was eligible or performed. There are no scored outcomes, performance comparisons, new fitted models or promotion evidence.

## What the actual data supplied

| Observation in this bounded run | Result |
| --- | --- |
| Primary scoreboard requests | HTTP 403; no access-control bypass attempted |
| NHL CDN route | HTTP 404; built-in official schedule fallback returned 12 eligible events |
| NFL CDN route | Network response returned weekly events; one survived the requested-date filter |
| NBA/MLB CDN responses | Returned events, but no forecasts survived this sample's date/eligibility filter; this does not prove those markets have no games or complete coverage |
| NHL/NFL history | HTTP 403; zero learned team/player profiles or eligible calibration outcomes in the isolated state |
| Challenger NHL summaries | Twelve skipped because the ESPN event mapping was unverified; no incorrect cross-provider ID substitution |
| Challenger NFL summary | Attempted, HTTP 403 |
| Both roles' recommendations | All 13 withheld; no qualifying wager |
| Challenger complete evidence reports | 0 of 13 |

For **all 13 challenger games**, frozen coverage explicitly reports missing summary, unverified summary freshness, unknown history timestamps, thin/unknown team history and incomplete advanced measurements. Both sides of every game have unknown injury coverage and an unconfirmed critical starter: **26 of 26 sides**. These are unknowns, not verified healthy rosters. No calibration history or active local ML model exists in this deliberately isolated cold-start profile; this does not establish the state of the deployed learner.

This confirms that free schedule discovery works for more than the original two NHL events, including an NFL event. It also confirms a substantial input-quality bottleneck in this environment. It does not show that generic priors are accurate enough for wagering, nor that every supported league is covered. Soccer and other leagues outside the four-league profile were not tested.

## Existing studies and independence

The original v6.0.7 and earlier v6.0.45 study manifests, workers, ledgers and receipted captures have identical before/after hashes. Their frozen predictions were not recollected, relabeled or overwritten.

Across the three studies there are 17 pair records but only **15 distinct league/native-ID/start-time game identities**. The two original studies cover the same two October 21 NHL games. The new study adds 13 October 22 games. Do not count 17 independent games or pool differently pinned studies as one performance cohort. All captures in this inventory were made on October 21; two game dates are not two independent collection days. Team/day dependence remains.

The current-day read-only report at 14:01:13 UTC still shows two unresolved NHL pairs, four role/game observations not started and zero eligible final requests. No outcome or confidence interval was fabricated.

## Local runtime verification

A read-only Windows process, scheduled-task and service inventory did not identify a Sports process or a Sports task/service entry. Four other OmniMod bot tasks were reported Running. No raw command lines, arguments, tokens or environment values were saved or published.

**This does not prove Sports is stopped.** Relative launch arguments, unknown working directories, another machine or another process host can prevent identification. The actual Sports host, loaded source, effective configuration, data directory, registry and jobs remain unverified. A local Git SHA or an online Discord identity would not establish those facts. The host/folder/service location has been requested without asking for credentials. cPanel remains excluded.

## Verification and next steps

The unchanged source suite was reproduced: **672 passed, zero failures/skips**. The prospective CLI exited successfully for preparation, live collection and read-only reports. Both prior study hashes were preserved; new receipts and coverage summaries are retained privately. No continuous collector, new scheduled task, production login or deployment was started.

Next: reconcile eligible results using each study's pinned worker, retain unresolved/conflicting observations, collect adequate independent dates/leagues and verify the actual host when its location is supplied. Missing source entitlement/publication truth, full settlement evidence, universal provider auditing and reviewed legacy result adoption remain unresolved. No better accuracy, calibration or after-cost performance is claimed.

Sports stays in progress; full Crypto then Stocks requirements remain queued. No merge, deployment, model promotion or live trading.
