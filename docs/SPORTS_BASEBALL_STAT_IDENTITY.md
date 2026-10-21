# Baseball Savant role and name identity

Development model v6.0.25; baseline 3fcc09e, 363 passing tests. No deployment, champion promotion or live trading.

## Reproduced defects

`advancedDatasets.js` imported batter then pitcher records into one normalized-name dictionary. A two-way player's pitcher record replaced the batting measurement. Distinct player IDs with the same normalized name silently selected the last CSV row. Successful refreshes appended records, leaving absent old names eligible indefinitely. Six new adapter/attachment regressions fail against the unchanged baseline implementation.

## Repair

`baseballStatIdentity.js` maintains separate authoritative batter/pitcher name indexes containing every imported record. The selected role is replaced only after payload validation succeeds. Other roles and failed-refresh observations retain their actual receipt and request key. Ambiguous names, including repeated rows, are excluded rather than resolved by row order. Source status counts ambiguous names; per-game lineup evidence records missing, ambiguous and wrong-role lookup counts. Existing complete-lineup, source-period and chronology checks remain required.

The legacy dictionary becomes a compatibility projection: unique batters take priority over pitchers, while ambiguous batters cannot be replaced by a pitcher. Once a role index exists, missing names never fall back to stale compatibility entries. Old unambiguous role records migrate, including records whose names exist only as dictionary keys. No native provider ID is equated with an ESPN athlete ID.

## Verification

Six synthetic integration tests exercise the real importer and attachment path: two-way role separation, reversed same-name IDs and duplicate rows, successful cohort replacement, failed-role receipt preservation, authoritative missing-name behavior, and legacy migration/request-period isolation. The prior all-adapter provenance test now expects an absent old batter to be removed after a successful replacement. Original receipts on failed refreshes remain covered.

Complete suite: 369 passed, no failures/skips; syntax and whitespace checks pass. Synthetic two-way batting xwOBA .4 now survives a subsequent .2 pitcher import; ambiguous names supply no batting value. These are integrity measurements, not evidence of better predictive accuracy or economic returns.

## Limits and next work

Legacy snapshots already overwritten by the old importer cannot reconstruct lost records or detect previously discarded collisions; a successful authorized refresh is needed. Matching remains normalized-name-only, with native cross-provider identity mapping unverified. Successful imports replace the currently returned role cohort; absence may reflect eligibility/sample filters and does not establish retirement or delisting. Source publication/revision lineage, sample sufficiency and native MLB season alignment remain unverified. Pitcher metrics are retained separately but are not newly connected to model scoring by this change.

No actual Baseball Savant network request or deployed-host validation was performed. The isolated original NHL captures remain unchanged and pending outcomes; no model improvement is established. cPanel is excluded. Sports remains in progress, then Crypto and Stocks.
