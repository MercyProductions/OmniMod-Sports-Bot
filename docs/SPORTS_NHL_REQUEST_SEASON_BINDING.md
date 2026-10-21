# NHL composite game seasons and request-period evidence

Development model: OmniMod Evidence Ensemble v6.0.22. Baseline 337 tests at 5900a4a. Source only; no deployment, promotion or live trading.

## Observed evidence and access limit

Two original prospective captures contain official NHL game seasonYear 20262027, with NHL API source provenance. Their original files and model pins were left unchanged. The official normalizer preserves the composite value; treating it as a four-digit start year would be incorrect.

An isolated schema request to the configured MoneyPuck 2025 regular-team CSV returned **HTTP 403**. No retry, disguised identity, proxy or alternate dataset host was used. Its native season column and actual returned-period semantics therefore remain unverified. [MoneyPuck's download terms](https://moneypuck.com/data.htm), reviewed October 21, 2026, permit free noncommercial use with attribution and require inquiry for other uses. Commercial deployment permission is not established. An accessible public download page does not establish access to a CSV endpoint or a commercial entitlement.

Three initial regressions showed that source-request data could still attach to a different composite game season, four-digit conventions were silently accepted without a mapping, and native-period uncertainty was not recorded.

## Implemented controls

- `sports-bot/src/advancedDatasetContracts.js:84`: nhlGameSeasonEvidence recognizes an eight-digit consecutive-year composite. 20262027 maps to start year 2026. Malformed/nonconsecutive composites are rejected. Four-digit values are explicitly unmapped, not guessed as start or end years.
- Source periods are extracted only from the MoneyPuck request identity. A match is labeled request_season_matched_native_unverified, with request_scope_only evidence and nativePeriodVerified=false. It is not a claim that the returned dataset actually contains that season.
- Known request/game mismatch, unknown source scope with a known game season, and unsupported game conventions block the external features. A missing game season retains the existing permissive legacy behavior but remains game_season_unknown. Complete season integrity is therefore not claimed.
- `sports-bot/src/advancedDatasets.js:459`: four MoneyPuck comparison inputs become null when blocked, including values previously attached to the same game. Rejections use the existing structured periodRejections result. A restored request/game match can reattach the retained snapshot. The provider snapshot and actual receipt times are preserved.
- Existing frozen coverage records the explicit native-period uncertainty and missing-evidence reason. No provider access flag, entitlement or current runtime setting was enabled by this repair.

## Verification

Five new synthetic tests cover mismatch rejection, valid composite decoding with truthful native uncertainty, unsupported/malformed identifiers, cached mutation/restoration, and frozen coverage plus unknown legacy source periods.

Complete suite: **342 passed, no failures/skips**. Syntax and whitespace checks pass. A read-only check also decoded both real captured game metadata records against hypothetical 2026 request identities. That check used no MoneyPuck observations, generated no new forecasts and established no predictive accuracy improvement. Its private record distinguishes real game metadata from hypothetical request evidence.

## Remaining limits

Native CSV period validation, source-specific licensing/access, per-source season selection and NBA end-year conventions remain unfinished. The original month-based request selector is unchanged. Request identity is not native publication/revision provenance. Repeated context-provenance accumulation and other ingestion lineage paths should be reviewed separately. Adequate matched forward outcomes and actual running-host verification remain missing; the host-location question is pending. cPanel is excluded, live trading disabled, and Sports remains in progress before Crypto then Stocks.
