# MLB batting membership and derived-input receipts

Development model: OmniMod Evidence Ensemble v6.0.24. Baseline 352 tests at d03c916. Source only; no deployment, promotion or live trading.

## Confirmed defects

The Baseball Savant lineup average selected game.autoPlayers, a collection populated principally by injury/probable-starter reports. Historical stat availability was effectively treated as batting-lineup membership. Confirmed event-roster batters in autoLineups were ignored. A generic injury list could produce a numeric lineup difference, while an actual confirmed roster with no injury entries produced no such feature.

The feature also had no complete-lineup requirement, could reuse a name-matched stat record for ambiguous identities, and recorded old stat receipts without the current lineup assertions used to select those stats. Current roster rows lacked individual timestamps despite an available summary receipt. Separately, tennis surface-specific Elo selection omitted the surface-context receipt.

Seven initial integration regressions failed. Existing field-scoped replacement and strict cutoff machinery are retained and extended to these actual dependencies.

## Selection and comparison contract

[MLB describes nine batters per lineup](https://www.mlb.com/glossary/positions/batter). This implementation's complete comparison requires exactly nine distinct confirmed batting candidates on each side, nine unambiguous historical-stat matches per side, and no conflicting supplied batting slots or shared provider-stat identity across teams.

- `sports-bot/src/mlbLineupEvidence.js:14`: use current autoLineups assertions, scoped to the team's known name/abbreviation/aliases. Reuse player-evidence reconciliation for identity deduplication, conflicting starter assertions and matching unavailable-player reports. Generic autoPlayers entries cannot establish batting membership.
- Batting candidates require confirmation plus a recognized batting role or an explicit positive integer batting-order assertion. A pitcher without a batting-slot assertion is excluded. Supplied duplicate slots, extra candidates and ambiguous same-name/different-ID assertions cannot form a complete factor. Provider batting-order encodings are not independently mapped; no order-based plate-appearance weighting is claimed.
- `sports-bot/src/advancedDatasets.js:432`: match source records to the selected batters only. Preserve finite zero xwOBA and reject negative/missing values. Native provider IDs identify duplicate stat reuse within this provider; they are not compared with ESPN IDs as if the namespaces were interchangeable.
- Partial side averages are retained as explicitly labeled research observations. The lineupXwobaDifference consumed by the MLB specialist is null until both sides satisfy the complete contract. This is a changed forecast-input qualification rule requiring forward validation, not a lowered signal/risk threshold.
- `lineupXwobaEvidence` reports expected/confirmed batters, matched/distinct stat identities, completeness, rejected roles/confirmation, ambiguous names and shared stat identities. Cross-provider matching remains normalized_name_only with nativeIdentityMappingVerified=false.

## Receipt integrity

- Current summary parsing stamps roster rows with the actual summary receipt (`autoEnrichment.js:472`).
- `mlbLineupEvidence.js:5` retains selected known receipt/update/observation timestamps, including environment and side receipts. Relevant lineup/availability assertions and the summary receipt become dependencies of the calculated average. Only recognized automatic legacy rows may inherit their originating summary receipt; unattributed inputs remain unknown rather than borrowing a date.
- `advancedProvenance.js:10` accepts dependency receipts alongside statistical-row receipts. They use the existing field-scoped replacement and strict nested/flat cutoff checks. A known future lineup assertion invalidates its derived average even when the historical-stat rows are older.
- Tennis surface selection now includes the actual context receipt. A future context cannot leave its surface-dependent Elo comparison available after the context is excluded. Untimestamped context remains unknown.
- `evidenceCoverage.js:113` freezes lineup completeness/identity evidence in the issued input report.

## Verification

Eleven new tests cover injury-list exclusion, complete positive lineups, unavailable batters, deduplication and ambiguous identities, partial stat coverage, future lineup receipts, actual summary-parser integration/frozen coverage, pitcher/batting-slot and shared-stat controls, valid zero/invalid xwOBA, tennis surface receipt lineage, and incomplete roles/duplicate slots/extra starters. Existing sparse fixtures now identify actual lineup assertions and test partial research averages; receipt tests account for both statistic and membership observations.

Complete suite: **363 passed, zero failures/skips**. Syntax and whitespace checks pass. Complete synthetic lineups with .3 versus .4 inputs preserve the .1 comparison. Missing/ambiguous/unavailable membership cannot produce the complete factor. All observations in the new tests are synthetic; no actual MLB provider or Discord access was verified and no improved accuracy/calibration or economic return is established.

## Remaining limits

Confirmation and timestamps are still provider/manual assertions. Names do not establish native cross-provider identities. Source role/sample/season quality, pitcher/batter record collisions, batting-order interpretation, native publication/revision lineage and full causal receipt coverage remain to be reviewed. Equal-weight lineup averages and thresholds are not a validated plate-appearance model. Unknown dependencies remain disclosed; the implementation does not reconstruct unavailable source revisions.

Running-host identification and adequate prospective outcomes remain missing. Original captures are unchanged; the MoneyPuck 403 is not retried/bypassed and commercial entitlement remains unverified. cPanel excluded; live trading disabled. Sports remains in progress, followed by Crypto then Stocks.
