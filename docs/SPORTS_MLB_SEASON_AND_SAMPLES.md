# MLB source season and batting-sample evidence

Development model v6.0.26. Baseline fe9e317: 369 passing tests. Source only; no deployment, champion promotion or live trading.

## Confirmed defects and repair locations

- [The old MLB attachment path](../sports-bot/src/advancedDatasets.js#L447) checked each source request against the requested collection year but did not compare it with the game's season. A known 2025 game could consume the current 2026 cohort without a warning. The attachment now compares game season and every selected record's native/request year. Known mismatches, invalid game years, conflicting native assertions and unknown source periods for a known game cannot supply side averages or the complete comparison. Structured period rejections and frozen coverage record the reason; stale comparisons are overwritten with null.
- [Payload validation](../sports-bot/src/advancedDatasetContracts.js#L110) now rejects contradictory declared native year/season fields before replacing a role. Missing/blank native fields remain unknown. Request scope is distinguished from native row assertions, with publication verification always false. A matching request can still supply a factor, explicitly native-unverified. Unknown game seasons retain the established permissive compatibility behavior and are reported, rather than guessed from dates.
- [Sample measurement](../sports-bot/src/baseballStatIdentity.js#L46) keeps PA and BIP separately. The importer previously conflated them, and an empty PA string prevented nullish fallback to a known BIP count. Both counts now survive import, including real zeros; the compatibility sample field identifies its source.
- [Complete lineup qualification](../sports-bot/src/advancedDatasets.js#L441) now requires a positive, integer, nonnegative and internally consistent measured sample for each of the nine distinct batting records on each side. Unknown, zero-only, fractional, negative or contradictory counts cannot establish the complete factor. An untyped legacy sampleSize cannot establish the unit. Partial averages remain research-only; they are not consumed as the complete comparison. [Frozen evidence coverage](../sports-bot/src/evidenceCoverage.js#L60) retains measurements, counts and missing/invalid-sample reasons.

Positive samples establish presence, not statistical adequacy. A one-observation fixture qualifies this presence check while sampleAdequacyValidated remains false. No new minimum-sample threshold, weight or confidence bonus is invented; robust sample sufficiency still requires validation. Nine-lineup positive-control fixtures now explicitly provide measured PA/BIP instead of silently claiming completeness without them.

## Reproductions and actual verification

Eight initial integration regressions failed against baseline source, including actual old-season factor leakage and complete comparisons without measured samples. Nine regressions now cover those cases plus contradictory paired counts. Positive controls preserve a .1 difference from .3 versus .4 lineups with matching periods and samples. A known wrong-season game supplies no numeric comparison; malformed native imports preserve the original usable cohort and receipt. Matching native row assertions and request-only evidence are distinguished. No native publication/revision provenance is inferred from a URL or fetch time.

Complete suite: 378 passed, no failures/skips. Syntax and whitespace checks pass. These fixtures and importer responses are synthetic. No real Baseball Savant request was made. Predictive accuracy, calibration and economic improvement are not established by integrity tests.

## Remaining work and deployment boundary

Optional native year/season field handling is a conservative local contract, not a verified live CSV schema attestation. Native row assertions are not independently authenticated or historically publication-correct. Unknown game seasons, roster changes, sample adequacy, cross-provider native identity mapping, pitcher/bullpen modeling and league calendars remain unfinished. Old untyped samples need a successful authorized refresh to acquire explicit fields; missing evidence is not reconstructed. The factor becomes more conservative and needs prospective validation before promotion.

Original prospective NHL captures remain unchanged; their games start at 2026-10-21T23:30:00Z and had not started at this phase's 07:49 UTC clock check. No new accuracy outcomes are claimed. Running-host identity remains pending; cPanel is excluded. MoneyPuck access/licensing limits remain unchanged and no blocked provider was retried. Sports remains in progress, followed by Crypto then Stocks.
