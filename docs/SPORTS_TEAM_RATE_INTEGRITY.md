# Team rate denominators and consumed NHL totals

Development model v6.0.29. Baseline 7d61841: 397 passing tests. No deployment, promotion, source enablement or live trading.

## Confirmed defects

The advanced-source perGame helper accepted every positive finite denominator, including fractional games. NFL legacy records could also supply already-derived EPA/CPOE factors without any games-count evidence. NHL partial/fractional samples supplied rates without frozen sample diagnostics. Negative expected-goal totals or negative/fractional actual goals-against could enter derived NHL comparisons. The all-situations importer silently selected the last duplicate team row and treated whitespace around the all situation marker as no matching observations.

Eight initial integration regressions fail against unchanged baseline source. [Shared count/rate contracts](../sports-bot/src/dataValidation.js#L15), [NHL measurement and cohort validation](../sports-bot/src/hockeyDatasetEvidence.js#L6), [source attachment](../sports-bot/src/advancedDatasets.js#L464) and [frozen invalid-measurement reasons](../sports-bot/src/evidenceCoverage.js#L63) implement the repairs.

## Input contracts

All three external team adapters now use measured safe positive integer game counts for sample presence. NFL and NHL require this evidence for both sides before supplying their external factors. Cached derived numbers cannot bypass missing denominators. The shared per-game calculation refuses invalid denominators at import as well as attachment. Invalid finite counts remain visible rather than being rounded, clamped or invented. NBA retains its prior identity and sample rules and now shares the safe-integer count contract.

This is sample presence, not sample sufficiency: sampleAdequacyValidated remains false. No league-specific minimum, confidence bonus, statistical reliability claim or maximum-season rule is invented. One valid observation may pass the presence check but is not asserted adequate for forecasting. NFL CPOE additionally needs its actual passing-attempt sample interpretation reviewed; games alone does not establish that adequacy.

Consumed NHL xGoalsFor/xGoalsAgainst must be finite nonnegative measurements; actual goalsAgainst must additionally be a safe integer. Invalid values disable only their dependent factors. For example, invalid goalsAgainst suppresses GSAx comparison while valid expected-goal comparisons can remain. Negative NFL EPA is a legitimate signed metric and remains supported. Real zeros remain measurements in every branch. Invalid/missing consumed NHL field names and team game counts are frozen in teamSampleEvidence; source contribution receipts and strict cutoff behavior remain unchanged.

Only all-situations NHL records form the team cohort, with trimmed case-insensitive markers and trimmed uppercase team IDs. Duplicate team identities reject the refresh before replacement, preserving the last usable cohort and its original receipts. Other situations cannot overwrite that cohort; their exclusion count is recorded. This is not a native identity mapping or live MoneyPuck schema attestation.

## Actual tests and measurements

Eight new synthetic integration tests cover missing, blank, boolean, zero, negative, fractional and unsafe counts; import division; negative EPA and genuine zeros; NHL consumed-value domains; duplicate identity preservation; situation whitespace/exclusions; frozen samples and future cutoffs. The NBA sample loop additionally rejects an unsafe integer count. Existing valid legacy NFL fixtures now provide explicit games evidence instead of claiming complete factors from unmeasured samples.

Complete suite: 405 passed, zero failures/skips. Syntax and whitespace checks pass. Previously a 2.5-game NFL record could divide 20 total EPA into 8 per game; it now retains games=2.5 but supplies no per-game rate or qualified external factor. With two measured games, negative four passing EPA still yields negative two per game and zero rushing EPA stays zero.

A private offline integration check reused the previously authorized actual 2024 nflverse REG file. All 32 records have measured positive integer games, all 32 EPA-per-game outputs match independent arithmetic, and the selected synthetic matchup's sides each preserve games=17. No network request or forecast was issued; the original data hash was unchanged. Historical publication/revision availability is not established by this calculation.

## Limits and remaining work

Valid denominators do not prove sufficient samples or correct upstream values. NFL CPOE/efficiency units, other physical domains, identity aliases, offseason changes, native publication/revision lineage, mixed-period storage and source entitlements remain to be audited. Non-numeric imported values normalize to unknown; prior lost raw anomalies cannot be reconstructed. The new NHL tests are synthetic only. MoneyPuck's existing 403 and commercial-use entitlement remain unresolved and were not retried or bypassed.

The original two prospective NHL pairs remain unchanged and pending, and actual running-host verification is still missing. No improved accuracy, calibration or economic return is established. cPanel is excluded; Sports remains in progress, followed by Crypto then Stocks.
