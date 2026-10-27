# Advanced dataset freshness, retries and contributing-row receipts

Development prediction identity becomes **OmniMod Evidence Ensemble v6.0.11** because corrected provenance can change which advanced inputs satisfy an information cutoff. The original baseline and v6.0.7 prospective study are unchanged. This work used synthetic provider responses only; no live provider request, paid service, deployment, promotion or Discord post occurred.

## Confirmed defects

The preceding adapter reused the whole snapshot whenever its container `updatedAt` was within the configured interval. Negative age from a future timestamp also passed. A failed refresh retained old source data but stamped the container with the new attempt time, potentially suppressing another source attempt for the full seven-day default interval. A partial success and multiple failures were not scheduled independently.

Attached tennis/independent schedule evidence used that container time; other advanced feature bags often lacked source receipt metadata altogether. Old rows could appear newly observed, or known-new rows could remain indistinguishable from untimestamped legacy data. The external request counter incremented on successful parsing, omitting failed calls and some fallback requests.

All six initial regressions failed before repair. They cover future container cache hits, failure retry suppression, repeated healthy-source requests versus failed-source retries, contributing receipts, unknown legacy receipts and provider retry restrictions. These are confirmed code defects, not measured explanations for a particular historical forecast loss.

## Source changes

- `advancedDatasets.js:113` records each source's latest check separately from `lastSuccessAt`. Failure never advances its success time. Consecutive failures back off for 1, 2, 4, 8, 16 and then 24 hours, with explicit longer provider delays preserved.
- At line 136, scheduling uses per-source success/attempt metadata. Successful sources retain the existing `ADVANCED_DATASET_SYNC_DAYS` cache interval; failed sources retry independently. Unknown/invalid/future success evidence cannot establish freshness. Container `updatedAt` remains a batch-attempt marker and no longer establishes data age.
- `Retry-After` seconds and HTTP-date forms are honored, including explicit forced sync and a backwards-clock test. Force may bypass the ordinary local cache/backoff but does not override a provider delay. Tennis fallback does not continue after 401/403/429 or an explicit retry delay. No identity disguise or access-control bypass was added.
- The request counter now counts actual calls through the configured fetch boundary, including errors and fallbacks.
- At line 162, newly downloaded/processed rows receive their own `sourceFetchedAt` and source ID. Retained rows keep their original metadata. No timestamp is invented for legacy rows. Tennis, baseball, football teams/schedules, hockey, optional NBA and the soccer catalog are covered.
- `receiptProvenance` at line 341 and attachment logic at line 351 carry contributing row receipts and source refresh statuses into feature bags. These are local availability receipts, not native publication or revision times. A failed latest attempt remains visible even when prior rows are retained.
- `sourceIntelligence.js:157` uses each independent schedule row's receipt. It no longer substitutes the advanced container time. Dependent environment/context records retain that receipt or explicit unknown.
- `sportsData.js:807` preserves both historical-derived and external receipt dependencies while merging feature bags. Missing history receipts stay unknown beside known external receipts rather than disappearing under the external provider label.
- `evidenceCoverage.js:91` freezes receipts, source check/success/retry states and missing/failure diagnostics per game. Later refresh checks cannot become known outcomes of an earlier information cutoff. `nativePublicationVerified` remains false.

The data-directory path and snapshot version-2 reader remain compatible; receipt/status fields are additive. Existing row timestamps are preserved, and old containers are not retroactively certified. Review changed retry cadence before any later deployment; a frequently invoked scheduler now retries failed sources according to their own bounded schedule instead of waiting for the whole-container interval.

## Verification

Baseline: **264 passing tests**. Added eight provider-boundary tests; all configured source families, including optional NBA in the fixture, receive synthetic payloads. The mixed-failure fixture verifies the successful NFL source is requested once across two batches while failed sources retry. The all-success fixture observes nine configured source calls and zero on the immediate cached pass. These are fixture measurements, not live-provider latency or entitlement evidence.

Tests also verify retained older rows are not restamped, all attached market families retain actual contributing receipts, legacy rows remain unknown, schedule/environment/context use the row timestamp, future receipts fail the inference cutoff, and per-game reports preserve source failures without leaking future check statuses. The offline slate-builder integration verifies historical receipts survive into its frozen evidence report.

Final complete suite: **272 passed, zero failures/skips**. `npm run check` and whitespace checks pass. Logs/private evidence remain outside Git. No accuracy, calibration, return or profitability improvement is established.

## Remaining work and deployment limits

Receipt preservation does not validate provider licensing, entitlements, native publication times, complete revision history or every returned schema. No new source was added or enabled in production. Existing live ESPN access restrictions remain unresolved.

The next data-quality work must audit missing-value/default coercions in historical feature differences and advanced adapters, empty/malformed-success payload handling, historical year/season cache identity, and stricter field-level source lineage. Retained advanced data can still be old; the report now exposes receipts/failure state but does not assert an independently validated age-to-predictive-quality policy. Do not promote models or weaken final risk controls on the strength of these infrastructure tests.

Full live runtime/timers, distributed publication races, adequate matched forward outcomes and costed odds evidence remain unverified. cPanel stays excluded by user request. Sports is unfinished; Crypto and Stocks remain queued afterward.
