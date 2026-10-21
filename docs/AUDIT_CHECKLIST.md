# Audit implementation checkpoint — 2026-10-20

| Phase | Status | Evidence / next step |
| --- | --- | --- |
| Preserve seven source baselines | Verified complete | Remote baseline tags plus private local Git bundles. |
| Archive Sports runtime evidence | Verified complete | Private archive outside Git; no .env copied. |
| Explain seven projects and independent provider setup | Verified complete | Seven root READMEs and configuration inventories published on main; public README bytes and baseline tags verified via GitHub API. |
| Audit confirmed correctness/provenance defects | Verified complete within documented scope | Technical report and reproduced regression fixtures. |
| Implement immutable prediction/result evidence | Verified complete in development | Journal and evaluation fixtures; production runtime validation pending. |
| Test repaired Sports code | Verified complete locally | 134 passing tests; configured syntax checks pass. |
| Attribute historical accuracy decline | Blocked | Only one dated local slate; no adequate versioned before/after archive. |
| Establish improved accuracy / costed performance | Pending | Matched prospective out-of-sample paper evidence required. |
| Production provider/Discord migration | Pending | Development review and operational validation required; no deployment performed. |

See [the audit](SPORTS_ACCURACY_AUDIT.md) for changed modules, known limitations and validation priorities, and [prediction records](PREDICTION_RECORDS.md) for evidence/recovery procedures. Verified implementation does not mean verified profitability.

Continuation: [prediction lifecycle reliability](SPORTS_RELIABILITY_CONTINUATION.md) records the confirmed targeted-refresh ordering defect, its issuance barrier, append-only lifecycle, and 139-test verification. The broader coverage, matched-accuracy, selection/value and prospective operational phases remain unfinished; no deployment or model promotion occurred.

Per-game evidence continuation: [frozen coverage and v6.0.2 corrections](SPORTS_EVIDENCE_COVERAGE.md), 147 passing Sports tests and syntax checks. Probable/confirmed roles, injury coverage bonuses and availability arithmetic repaired in development; real forecasting improvement remains unproven.

Matched evaluation continuation: [paired game-weighted comparisons](SPORTS_MATCHED_EVALUATION.md), 157 passing Sports tests and syntax checks. Reference-population and repeated-horizon counting defects corrected; real matched accuracy improvement remains unverified.

Model-selection continuation: [exact ML artifacts and preregistered holdout review](SPORTS_SELECTION_PROTOCOL.md), 167 passing tests and syntax checks. Stored-fit mismatch and retrospective-production provenance defects repaired; runtime automatic promotion disabled. No real trial or improved accuracy claim; hybrid governance and feature-learning chronology remain open.

Original-price research continuation: [frozen offers and cost sensitivity](SPORTS_PRICE_RESEARCH.md), 178 passing Sports tests and syntax checks. Missing timestamp provenance and malformed probability vectors now fail closed; price refreshes have separate journal records. Zero eligible local price scenarios; actual settlement, execution and prospective costed performance remain unverified.

Operational continuation: [durable refresh attempts and read-only diagnostics](SPORTS_OPERATIONAL_VALIDATION.md), 185 passing Sports tests and syntax checks. Local development journal has no issued forecasts or attempts; deployed runtime and isolated prospective baseline/challenger execution remain unverified.

Feature-learning continuation: [exact frozen weights and outcome chronology](SPORTS_FEATURE_FIT_VALIDATION.md), 191 passing Sports tests and syntax checks. Development v6.0.3 removes automatic activation of unsupported learned weights. Feature artifacts remain research-only; full ensemble chronology, hybrid governance, actual runtime inspection and prospective comparisons remain unfinished.

Learning-context continuation: [availability-constrained calibration and Elo](SPORTS_LEARNING_CONTEXT_CHRONOLOGY.md), 197 passing Sports tests and syntax checks. Development v6.0.4 excludes late/unknown labels and future team seeds, deduplicates calibration games, and freezes exclusion diagnostics. Mutable historical revisions, other feature provenance, hybrid governance, runtime and prospective evidence remain unresolved.

Elo/hybrid continuation: [conflict quarantine and source-bound recipe review](SPORTS_ELO_AND_HYBRID_IDENTITY.md), 205 passing tests and syntax checks. Development v6.0.5 prevents conflicting score copies from double-updating Elo and binds hybrid review to source/sport/weight. Hybrid prospective protocol, other feature provenance, actual runtime and comparative performance remain unverified.

Hybrid trial continuation: [preregistered recipe-specific selection](SPORTS_HYBRID_SELECTION_PROTOCOL.md), 210 passing Sports tests and syntax checks. Hybrid and ML trials share disjoint-period and single-use holdout protections. No real trial registered or promotion performed; executable isolated collection, actual host inspection and prospective evidence remain pending.

Isolated runner continuation: [archived executable versions and actual live capture](SPORTS_ISOLATED_PROSPECTIVE_RUNNER.md), 212 passing tests and syntax checks. Both versions returned 14 games but no pregame forecasts at the late-hour capture; history/summary HTTP 403 persisted. Prospective pregame collection, cross-version pairing/outcome evaluation and deployed-host verification remain unfinished.

Capture pairing continuation: [receipt-backed cross-version scores and observed finals](SPORTS_ISOLATED_CAPTURE_PAIRING.md), 218 passing Sports tests and syntax checks. Actual report verified two new receipts, zero pregame pairs, and exclusion of two unreceipted legacy captures. Cross-date final fetching, provider coverage, pregame evidence and deployed-host inspection remain unfinished.

Provider/final-query continuation: [native ID routing and bounded cross-date planning](SPORTS_PROVIDER_IDENTITY_AND_FINAL_QUERIES.md), 223 passing Sports tests and syntax checks. Development v6.0.6 skips unmapped native IDs before ESPN summary selection. Existing bot identity still receives access denial; no bypass introduced. Cross-date fetching, actual pregame outcomes and deployed-host inspection remain unfinished.

Isolated final execution: [bounded archived-worker reconciliation](SPORTS_ISOLATED_FINAL_EXECUTION.md), 225 passing Sports tests and syntax checks. Both archived versions preserve fixture probabilities/timestamps while grading prior-date finals; altered jobs fail closed. Actual study has no pending pregame records, so live final retrieval and forward performance remain unverified.

Inference chronology continuation: [single cutoff and known-future input exclusion](SPORTS_INFERENCE_INPUT_CHRONOLOGY.md), 231 passing Sports tests and syntax checks. Development v6.0.7 fixes wall-clock mixing, automatic-profile bypasses and upcoming-date cutoff selection. Untimestamped lineage, real forward comparisons, provider access and deployed-host verification remain unfinished.

Upcoming-day continuation: [pinned sampling and first real pregame pairs](SPORTS_UPCOMING_PREGAME_CAPTURE.md), 232 passing Sports tests and syntax checks. Actual October 21 collection preserved two NHL pregame pairs with 838 ms receipt gaps, both unresolved/withheld. Adequate forward outcomes, provider coverage and deployed-host validation remain unfinished.

Current requirement checkpoint: [source/test evidence and outstanding requirements](SPORTS_REQUIREMENT_EVIDENCE.md). Reproduced unavailable confirmed-starter coverage contradiction and aligned coverage with participation status; 233 tests and syntax checks pass. Real paired study remains two unresolved pregame games. cPanel is excluded at user request; deployed state is unverified.

Player identity continuation: [team-scoped lineups and ID-first history joins](SPORTS_PLAYER_IDENTITY.md). Development v6.0.8; 237 passing tests and syntax checks. Three newly reproduced identity regressions and a production-caller regression covered. Intermittent isolated capture chronology failures remain unexplained; no timing gates relaxed. Frozen v6.0.7 prospective captures unchanged, cPanel excluded, no deployment or promotion.

Lineup conflict continuation: [distinct-player coverage and capture chronology](SPORTS_LINEUP_CONFLICTS.md). Development v6.0.9; 243 passing tests, syntax checks pass. Separate unavailable reports and duplicated starter rows no longer produce full-lineup coverage. Malformed capture completion times rejected on write/reload; intermittent chronology failure cause still unproven. Two actual pregame pairs remain unresolved; no deployment/promotion.

Transport recovery continuation: [real publisher with isolated simulated Discord and child-process restarts](SPORTS_TRANSPORT_RECOVERY.md). 253 passing tests and syntax checks. Fixed replacement sends after unverifiable history/edit failure and false delivered acknowledgements for character-trimmed forecasts. Actual child exit after simulated remote acceptance recovers without duplicate forecast/message; live Discord and cross-process concurrency remain unverified. Production quotas unchanged; midnight fixture corrected.

Refresh issuance continuation: [accepted-only durable slate and journal-confirmed completion](SPORTS_REFRESH_ISSUANCE.md). 259 passing tests and syntax checks. Shared issuance eligibility, preserved untouched forecasts, durable journal confirmation, refusal diagnostics and immutable delivery matching verified. Mixed refresh publishes only the accepted candidate while preserving provisional observations. Remaining quote fixtures now use an injected daytime clock; production quotas unchanged. No deployment/promotion.

Derived chronology continuation: [dependent participation, roster and nested receipts](SPORTS_DERIVED_INPUT_CHRONOLOGY.md). Development v6.0.10; 264 passing tests and syntax checks. Known-future parents no longer leave dependent participation/lineup/advanced features active; current injury status survives removal of a future nested projection. Advanced snapshot per-source freshness/retry defects identified for the next repair. Complete point-in-time provenance and comparative accuracy remain unproven.

Advanced source continuation: [per-source freshness/retry and contributing-row receipt preservation](SPORTS_ADVANCED_SOURCE_FRESHNESS.md). Development v6.0.11; 272 passing tests and syntax checks. Failed sources retry independently with bounded backoff and provider Retry-After, healthy sources retain their cache, unknown legacy receipts remain unknown. Per-game evidence freezes receipts and refresh failures. Native publication/revision provenance, payload/missing-value/year identity and actual predictive improvement remain unverified. No deployment/promotion.

Measured-feature continuation: [unknown-versus-zero arithmetic across sport families and external adapters](SPORTS_MEASURED_FEATURES.md). Development v6.0.12; 278 passing tests and syntax checks. Missing two-sided inputs no longer manufacture differences; per-game rates require positive observed counts; genuine zeros preserved. Missing measurements frozen in per-game evidence. Payload/year identity, remaining upstream defaults, forward accuracy and native provenance remain pending. No deployment/promotion.

Collector clock follow-up: [actual clock observation before receipt recording](SPORTS_COLLECTOR_CLOCK.md). Post-commit diagnostics measured 1-2 ms child/collector clock offsets; collector now waits at most 50 ms for a real matching observation before the unchanged strict receipt check. 279 passing tests and syntax checks; excessive/persistent skew remains rejected. No claim of universal clock synchronization or live performance.

Advanced payload/period continuation: [adapter contracts, request-bound cache and concurrent-period isolation](SPORTS_ADVANCED_PAYLOAD_CONTRACTS.md). Development v6.0.13; 290 passing tests and syntax checks. Malformed collections preserve prior data; explicit historical attachment excludes wrong/unknown periods; Retry-After retained. Native record period/units, running host and predictive improvement remain unverified. No deployment/promotion.

NFL summary continuation: [native period/grain and unique-team validation](SPORTS_NFL_SUMMARY_CONTRACT.md). Development v6.0.14; 291 passing tests and syntax checks. Real 2024 REG file: 32 accepted/0 rejected. Synthetic wrong-season/weekly/duplicate inputs reject without replacement. Existing per-game arithmetic preserved; publication chronology, league season selection, forward performance and deployed state remain unverified.

Venue/rating continuation: [measured score inputs, neutral-site correction and verified solver convergence](SPORTS_VENUE_AND_RATING_INTEGRITY.md). Development v6.0.15; 297 tests and syntax checks pass. Reproduced null-score sample inflation, neutral-site home-edge contamination and two-team oscillation. Fixed without changing blend weights/risk thresholds. Shared season calendar and forward predictive improvement remain unverified.

Player-workload continuation: [observed workload, explicit priors and separate reliability counts](SPORTS_PLAYER_WORKLOAD_EVIDENCE.md). Development v6.0.16; 304 tests and syntax checks pass. True zero preserved through parsing/profiles/projection; missing and legacy-only estimates do not certify measured history. Evidence frozen per game. Performance formulas, league workload denominators, season calendars and forward improvement remain unverified.

Player-performance continuation: [complete-input scores, statistic identity and group conflict provenance](SPORTS_PLAYER_PERFORMANCE_INTEGRITY.md). Development v6.0.17; 310 tests, expanded 25-test missing-value checks and syntax pass. Plusminus/save-rate collisions and malformed numeric parsing repaired; incomplete scores remain unknown with separate sample counts. Group conflicts no longer overwrite by input order. Forward performance, historical reconstruction and complete semantic/unit validation remain unproven.

Historical-starter continuation: [observed flags, conflict-preserving joins and independent sample counts](SPORTS_HISTORICAL_STARTER_EVIDENCE.md). Development v6.0.18; 316 tests and syntax checks pass. Missing/nonboolean flags no longer become bench history, conflicting flags cannot teach starter pairs, and current confirmed starts remain intact. Legacy reconstruction, source semantics, league denominators/calendars and forward performance remain unverified.

Basketball units continuation: [shared league regulation scale and frozen unit contracts](SPORTS_BASKETBALL_WORKLOAD_UNITS.md). Development v6.0.19; 322 tests and syntax pass. NBA normalization/projection use 48; WNBA/NCAA retain 40; unknown fallback, legacy contracts and overtime limits disclosed. Public round trip and mismatched-unit controls verified. Other sport proxies, season calendars and forward performance remain unverified.

Team-feature continuation: [complete-input rates/proxies and separate observation counts](SPORTS_TEAM_FEATURE_MEASUREMENTS.md). Development v6.0.20; 331 tests and syntax pass. Missing defaults, actual-score xG/run substitution and unsupported bullpen/GSAx attribution removed. Partial advanced ratings do not fabricate the missing side; per-feature counts frozen. Native units/model validity, seasonal selection and forward improvement remain unverified.

Game-season continuation: [NFL per-game source-period binding and frozen rejection evidence](SPORTS_GAME_SEASON_BINDING.md). Development v6.0.21; 337 tests and syntax pass. Known wrong/invalid/unknown source periods cannot contribute to a known-season game; cached comparisons are cleared. Unknown game seasons stay explicitly unverified. Multi-league calendars, publication provenance and forward improvement remain incomplete.

NHL season continuation: [verified composite-game encoding and request-only alignment evidence](SPORTS_NHL_REQUEST_SEASON_BINDING.md). Development v6.0.22; 342 tests and syntax pass. Known mismatched/unmapped periods block external features; matched request scopes remain explicitly native-unverified. Original game captures unchanged. MoneyPuck schema access returned 403; no bypass, commercial entitlement unverified.

Contributor-replacement continuation: [field-scoped receipts, stale-field invalidation and nested chronology](SPORTS_ADVANCED_CONTRIBUTOR_REPLACEMENT.md). Development v6.0.23; 352 tests and syntax pass. Repeated attachment is bounded; successful statuses replace failures; disappearing contributors clear owned comparisons; independent/unknown/future inherited evidence remains intact. Journals/captures unchanged. Native lineage, lineup membership and forward improvement remain unfinished.

MLB membership continuation: [confirmed batters, complete-factor qualification and parent receipts](SPORTS_MLB_LINEUP_MEMBERSHIP.md). Development v6.0.24; 363 tests and syntax pass. Injury lists cannot substitute for batting lineups; partial averages are research-only. Unavailable/ambiguous/shared identities block complete comparisons; lineup and tennis-surface receipts enter cutoff lineage. Native identity mapping, live source validation and forward improvement remain unproven.
