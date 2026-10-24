# Forward-trial evidence receipts and first actual collection

## Confirmed collection

The first actual pinned trial invocation completed at **2026-10-24T05:46:11.398Z**, after the preregistered start. It recorded **12 NHL Daily forecasts / 12 distinct games**, one date, **zero resolved outcomes**, 17 public-provider requests and three HTTP failures. It made zero Discord posts/orders and promoted no model. No collection was backdated. The hourly Sports heartbeat remains active; the independent Stocks schedule is unchanged.

The three request failures were the ESPN primary schedule (403), CDN schedule (404) and calendar/history (403). The official NHL schedule supplied 12 games. All 12 native events lacked a verified ESPN summary mapping, so summary requests were deliberately skipped. The bounded native-history fallback supplied 47 recent finals and 32 thin profiles. Six permitted goalie-context requests succeeded; six later games were omitted by the existing cap. These six responses provide season candidates, **zero confirmed starters** and unknown injuries. All 12 evidence reports remain incomplete; **zero actionable opportunities** were approved. The separate earlier injury-endpoint probe also returned 403. Access denials were not bypassed.

Missingness is preserved rather than filled with neutral or healthy assumptions. The provider-neutral optional availability-snapshot adapter remains available, but no external user feed is configured. The existing Odds API configuration is unchanged and is not presumed to supply medical or goalie confirmation. The isolated collector intentionally inherits no paid-feed credentials.

## New evidence protections

The previous collector retained captures and a mutable provider cache. The new recorder `forwardEvidence.js` adds a linked receipt ledger containing each exact capture hash, original source/artifact identity, receipt time, forecast-journal byte-prefix hash and provider-cache file manifest. Each observed cache-file version is preserved in a content-addressed blob; a later refresh cannot erase its prior version. Duplicate blobs are reused.

A separate durable ledger head detects a valid JSONL tail rollback or interrupted append. A capture without a receipt, incomplete ledger, altered capture/blob/journal prefix, wrong identity or existing evidence owner stops collection for review. Prior captures are never certified retrospectively. Normal journal appends remain allowed. The actual first capture has one receipt and 16 preserved cache blobs. The static collector manifest now pins 104 files; the archived source ZIP, selection plan and model artifact remain unchanged.

These are **local consistency checks**, not signatures, provider publication-time authentication, a complete HTTP response archive or atomic cross-store/power-loss durability. A privileged actor could rewrite local evidence and all hashes. Interrupted writes are preserved and fail closed; no automatic forensic repair or lock theft is implemented. Provider caches may be transformed or omit uncached failures; raw slate diagnostics and real request counters remain separate. Growing evidence storage still needs operational monitoring.

The forecasting source remains `03c6714ff0ca47ce98b491807ad3742877ca0102`, **v6.0.52**, under the original plan ending November 7 at 05:46 UTC, followed by seven days of final-only reconciliation. The evidence recorder does not change forecasting or strategy behavior. Development v6.0.54 is not silently substituted. This trial compares the registered hybrid and evidence candidates; it does not validate every later source repair or the archived v6.0.0 baseline.

## Verification and pending work

Reproduced baseline: **939 passing tests**. Six new evidence tests plus ten existing collector tests pass together (**16**). The expanded full default-parallel suite passes **945 tests**, zero failures/skips. Root syntax and whitespace checks pass. Tests exercise immutable original provider versions, blob reuse, append-only journal growth, tampering, ledger rollback, orphan/interrupted captures, owner fencing and original identities. Actual private installation/worker checks and the first real provider-backed run also succeeded.

The minimum remains **75 independent games, eight dates and 14 days**. One date and no final scores cannot establish predictive improvement, calibration or economic value. Confirmed goalie/injury source coverage, broader league evidence, source publication truth, executable odds and intermittent zero-successor cause remain unfinished. Sports remains in progress before the full queued Crypto and Stocks work. No merge, production startup, deployment, model promotion or live trading occurred.
