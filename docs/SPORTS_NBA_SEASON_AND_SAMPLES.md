# NBA season, team identity and sample evidence

Development model v6.0.27. Baseline 2081ca4: 378 passing tests. No deployment, champion promotion or live trading. NBA.com's optional advanced adapter remains disabled by default.

## Confirmed defects

The adapter's requested season identity was compared only with its own cache request, not the predicted game's season. Wrong-season NBA inputs could therefore provide pace/net-rating differences. Team GP was copied without normalization and never used to establish whether the ratings represented any measured games. Duplicate normalized team names silently overwrote rows, while duplicate native team IDs could supply both opponents. Optional contradictory native season labels were ignored.

Eight initial integration regressions fail against baseline source. The repaired [adapter and attachment](../sports-bot/src/advancedDatasets.js#L332) use the contracts in [nbaDatasetEvidence.js](../sports-bot/src/nbaDatasetEvidence.js#L12). Identity, period and sample diagnostics are retained by [frozen evidence coverage](../sports-bot/src/evidenceCoverage.js#L61).

## Contracts and repair

A previously saved ESPN CDN response, received 2026-10-21T04:25:13.136Z, contains three NBA events dated October 20–21, 2026 with season.year=2027. The existing parser preserves that assertion and provider identity. For recognized ESPN/ESPN CDN NBA records, the new attachment maps this observed ending-year convention to start year 2026. Other providers' known four-digit seasons are explicitly convention-unverified and cannot silently use this mapping. Unknown game seasons retain disclosed compatibility behavior; invalid seasons, known mismatches and unknown source seasons for known games block numeric external factors.

Request-year alignment is labeled request_season_matched_native_unverified unless native season labels are supplied and match. Optional SEASON_YEAR labels use the explicit YYYY-YY contract, with consecutive years required. Contradictory labels reject the payload before replacing the previous valid cohort. Matching native assertions do not establish publication/revision correctness; nativePublicationVerified remains false.

Successful import requires unique normalized team names and unique supplied native team IDs. Conflicting datasets preserve prior rows and receipts. A legacy snapshot cannot supply both opponents from the same native identity. Name matching remains distinct from verified cross-provider native identity mapping.

GP and consumed measurements are normalized through the existing missing-versus-zero parser. Both teams need measured positive integer games before supplying external pace/net-rating comparisons. True zero net ratings remain measurements. Unknown, zero, negative and fractional GP yield no external factors; missing-sample reasons and actual counts are frozen. This is sample presence only: sampleAdequacyValidated remains false even for a one-game positive control. No new minimum-sample threshold, weighting, confidence bonus or source enablement is introduced. Existing positive-control fixtures now supply explicit games counts.

## Actual validation and limits

Nine new synthetic integration regressions cover matched and wrong periods, unknown conventions/source years, invalid/conflicting assertions, sample gaps, zero ratings, duplicate names/IDs, native-label conflicts, numeric strings and shared legacy identities. Complete suite: 387 passed, no failures/skips; syntax and whitespace checks pass.

A separate private read-only check loaded the three original provider events through the current parser and attachment, using explicitly hypothetical team measurements and a 2026-27 request key. All three decoded to start year 2026 and passed scope alignment with nativePeriodVerified=false. The original cache hash was checked unchanged. No provider request, forecast issuance, odds outcome, native NBA measurement validation or accuracy result was produced by that check.

The convention evidence is limited to the stored ESPN records, not every season/provider format. Optional native label support is a local contract, not a verified current NBA CSV/JSON schema attestation. End-year mapping, live endpoint entitlement and advanced measurements still need prospective validation. General league calendars, preseason/postseason stat-scope interpretation, native publication lineage, physical measurement ranges, sample adequacy and franchise/roster changes remain unfinished. Unknown and legacy input limitations are not reconstructed.

The original two NHL prospective pairs remain unchanged and pending; running-host identification is still missing. No improved predictive accuracy, calibration or economic return is established. cPanel remains excluded. Sports stays in progress, then Crypto and Stocks.
