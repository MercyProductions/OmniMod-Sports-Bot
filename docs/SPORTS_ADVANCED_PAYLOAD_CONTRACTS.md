# Advanced provider payload and period contracts

Development model: OmniMod Evidence Ensemble v6.0.13. Source-only changes on the existing development branch; no deployment, model promotion or live trading.

## Confirmed defects

The baseline suite passed 279 tests. Seven initial synthetic regressions then failed: HTTP-success HTML, unrelated CSV, empty/header-only payloads and malformed JSON could be treated as successful refreshes; some adapters replaced good collections with empty data. A fresh source cache did not distinguish requested years/seasons. Multi-year tennis fallback data could contaminate a single-year cohort. A separate concurrent-request regression reproduced a 2025 caller receiving a 2024 operation result.

## Implemented controls

- `sports-bot/src/advancedDatasetContracts.js:3` validates explicit year/season arguments and creates deterministic source request identities. Calendar-year and season-start sources have separate scopes; the schedules catalog retains its minimum-season scope.
- `sports-bot/src/advancedDatasetContracts.js:37` validates the implemented adapter headers, usable identities and at least one finite consumed measurement where applicable. Partial measurements remain unknown; actual zero remains usable. Empty or invalid collections fail without clearing the prior collection. This is an adapter contract, not full provider schema certification.
- `sports-bot/src/advancedDatasets.js:131` binds freshness to source request identity. Legacy identity-free cache statuses trigger a refresh. Provider Retry-After still takes precedence over force or a changed period. Failed refreshes preserve prior data and its original success identity.
- `sports-bot/src/advancedDatasets.js:194` filters tennis observations to the requested calendar year, including fallback data, and rejects invalid calendar dates. Rejected identities and excluded periods are counted.
- `sports-bot/src/advancedDatasets.js:137` coalesces matching concurrent periods and serializes different-period refreshes, preventing cross-period result sharing and stale-store overwrites inside this process.
- `sports-bot/src/advancedDatasets.js:387` excludes known mismatched source rows and cached derived context during attachment. Explicit historical requests also reject identity-free legacy rows. Default requests retain unknown legacy input as unknown provenance, never as verified period evidence.
- `sports-bot/src/evidenceCoverage.js` freezes contributing request keys and source success/failure identities with the existing receipt evidence. Future refresh metadata does not become available at an earlier cutoff.

The existing UTC month rule for choosing a season start is preserved: before September, previous year; otherwise current year. Callers may specify `seasonStart` independently of calendar `year`. This rule is not a verified season calendar for every league. Source request identity proves which endpoint scope was requested; except for filtered tennis dates, it does not certify the returned records' native publication time or season.

## Verification

Eleven new synthetic tests cover invalid HTTP-success bodies, malformed JSON shapes, partial/zero measurements, changed years, failed year changes, invalid arguments, multi-year tennis fallback, different-period concurrency, explicit seasonal overrides, matching-period coalescing and Retry-After preservation. The existing provenance fixtures now declare the request identity needed to establish a fresh cache.

Complete source suite: **290 passed, zero failures/skips**. `npm run check` and whitespace checks pass. No live provider or Discord request was needed for these regressions. No threshold, risk control or promotion gate was lowered.

## Remaining limits and next work

This does not validate all provider units, ranges, record grain, duplicate-team semantics, native revision/publication chronology, access entitlements or commercial-use rights. In particular, review upstream team-stat aggregation before treating imported per-team values as season aggregates. Cross-process locking is not established by the in-process concurrency tests. Real matched prospective evidence remains too small and unresolved to establish improved accuracy, calibration or after-cost returns.

Sports remains in progress. Crypto follows Sports; Stocks follows Crypto. The actual running source/configuration is unverified and cPanel is excluded by user instruction. Keep live trading disabled and preserve the original prospective captures.
