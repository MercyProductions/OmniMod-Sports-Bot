# Quote timestamps and inference cutoff

Development identity: v6.0.43. This phase repairs timestamp eligibility and preserves its evidence. Existing six-hour market reuse and fifteen-minute value limits, prediction weights, risk limits and provider budgets are unchanged. Correcting which inputs satisfy those rules can change forecasts and requires forward validation.

## Confirmed defects and repairs

- `src/predictionEngine.js:320` previously accepted an untimestamped market and checked contributor timestamps for future/invalid values without checking every contributor's age. A newer summary could therefore conceal a quote older than the six-hour limit. `src/quoteChronology.js:4` now checks the aggregate, supplied contributors and known receipts together. Missing detailed quote times remain unknown; a future/invalid receipt or a quote update after that receipt rejects the market input.
- `src/sportsData.js` previously selected the oldest aggregate time by string sorting. Different timezone offsets can reverse lexical versus chronological order. It now compares validated instants and leaves an invalid aggregate unknown.
- `src/oddsPricing.js:24` adds explicit-timezone, real-calendar quote parsing. Numeric/boolean/object values, date-only or timezone-less strings, impossible dates and invalid clock fields cannot certify quote time. Supported explicit ISO offsets and leap dates remain valid. Provider-update verification now requires both its source label and a valid quote timestamp.
- `src/oddsValue.js` uses the same parser and rejects known invalid/future receipts or updates after the receipt. The existing freshness, evidence, uncertainty, settlement and bookmaker gates remain in force.
- `src/predictionJournal.js:49` previously normalized a permissively parsed quote time into UTC, potentially hiding that the original was timezone-ambiguous. Invalid times now produce `quotedAt: null`; original string text is separately preserved as `originalQuotedAt`. Valid timestamps still normalize to UTC.
- `src/predictionEngine.js:454` previously classified pregame/late mode using the wall clock while other evidence used the caller's injected cutoff. It now uses the same cutoff. The default real-time path still uses the current clock; this is not authorization to pass a historical cutoff to issue actual forecasts.

`marketTimestampEvidence` freezes reason codes, validated aggregate/receipt instants, receipt availability, contributor count, granularity and the existing age policy in predictions, journals and warehouse rows. `publicationTimeIndependentlyVerified` remains false: checking declared timestamps does not authenticate a provider's publication time.

## Verification

Reproduced baseline: **583 tests pass**. Restoring the previous inference/parser sources reproduced **six timing failures**. Separately restoring the old journal normalizer reproduced **one timestamp-normalization failure**. Original sources were restored after each controlled comparison.

Repaired complete suite: **594 passed, zero failed/skipped**. Syntax and whitespace checks pass. Eleven new tests cover strict dates/offsets, consistent inference mode, missing aggregate/contributor times, stale nested quotes, chronological oldest-time selection, invalid/future/inconsistent receipts, positive valid-time behavior, journal preservation and frozen warehouse evidence.

```sh
npm test
npm run check
# From sports-bot/:
node --import ./test/setup.js --test test/quote-time-integrity.test.js
```

Tests use explicit synthetic clocks and isolated files. They do not collect new real predictions, call paid providers, start Discord or place orders. Better accuracy, calibration and economic performance have not been established.

## Limits and deployment requirements

Legacy aggregate-only markets can remain timing-eligible when their declared aggregate time is valid, but are labeled `aggregate_only_legacy`. Missing receipts remain explicitly unknown; historical receipt/publication truth cannot be reconstructed. Free feeds labeled `fetch_time` remain non-actionable under provider-update verification; bounded legacy model context does not become independently verified publication evidence.

This phase does not reconstruct ambiguous timestamps already normalized by older journals, attest clock synchronization or provider timestamp semantics, or prove executable prices. Strict receipt ordering can quarantine clock-skewed provider data; there is no hidden tolerance. Runtime timestamps have JavaScript millisecond precision.

Full settlement/void rules, spread/total conflict semantics, durable failed quote-attempt auditing, cache transactions, legacy result-baseline adoption and actual host/configuration/jobs remain unfinished. Sufficient independent prospective outcomes are still needed before claiming improved forecasts or promoting a model.

Any deployment requires separate approval, private-data backup and isolated host validation. Sports remains in progress, then the complete Crypto and Stocks specifications. No merge, deployment, model promotion or live trading; cPanel excluded.
