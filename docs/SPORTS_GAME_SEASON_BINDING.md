# NFL game-to-source season binding

Development model: OmniMod Evidence Ensemble v6.0.21. Baseline 331 tests at 2afa2d0. Source only; no deployment, model promotion or live trading.

## Reproduced gap

Source request identity already prevented a requested 2025 refresh from reusing a fresh 2024 request cache. It did not compare the cached source period with the actual game's declared season. A fresh, request-matching 2026 NFL dataset still contributed a numeric EPA difference to a game declaring season 2025. Changing the game season after initial attachment could also leave or recompute those values. A conflicting native season in a cached row was not checked during attachment.

Four initial regressions exposed missing per-game alignment evidence or retained numeric features. This is a reproduced input-integrity defect, not proof that a production accuracy decline came from this mechanism.

## Implementation

- `sports-bot/src/advancedDatasetContracts.js:60`: nflGameSeasonEvidence compares a valid four-digit NFL game season with both source rows. It distinguishes matched, unknown/invalid game season, unknown source season, mismatch and contradictory native/request season evidence. Source declarations and previously validated request-contract evidence remain separately labeled.
- `sports-bot/src/advancedDatasets.js:247`: newly processed NFL rows retain their validated native season/type declarations. Older rows with the previously validated regular-season-summary request contract can retain period evidence without inventing a native row declaration. Unidentified legacy rows cannot certify alignment to a known game season.
- `sports-bot/src/advancedDatasets.js:442`: attachment nulls the four NFL external comparison features on a blocked period, including values in an already attached bag. These rejected contexts are not counted as matches; periodRejections exposes structured per-game reasons. The original source cache and receipts are preserved. Restoring a matching game season can legitimately reattach the retained source data.
- `sports-bot/src/evidenceCoverage.js:51` and `:111`: freeze the period evidence and add the actual unverified/rejection state to missing-evidence reasons. Existing root receipt chronology still excludes known-future data and its metadata from earlier inference cutoffs.

The helper applies only to the established NFL season-year convention. It does not guess NBA end-year versus start-year labels or interpret NHL composite season IDs. Matching season years establish declared period alignment, not event-type equivalence, native publication time, current roster validity or independently authenticated provider data.

## Compatibility and limitations

A game without a valid declared season cannot receive a matched attestation. Unknown game seasons retain the existing permissive legacy behavior, explicitly labeled game_season_unknown; this is not complete period integrity. Malformed declared seasons are blocked. A known game season with an unknown source period is blocked. No new prior-season carry-forward model was introduced.

The existing UTC month-based seasonStart default and explicit override remain unchanged. The repair prevents known mismatches from silently entering a game's external NFL features; it does not fix the entire multi-league season calendar. Unknown game metadata and provider source semantics still need work. Validation-contract evidence is an assertion from the local ingestion contract, not cryptographic provider authenticity.

## Verification

Six added tests cover mismatched game/source periods, matching seasons and mutation/restoration of cached attachment, unknown legacy periods, contradictory native row/request declarations, prior validated-contract migration, and structured rejection/frozen coverage with invalid game years and strict information cutoffs. All provider responses are synthetic and no external data or Discord request is made by these tests.

Complete suite: **337 passed, no failures/skips**. Syntax and whitespace checks pass. Original prospective captures remain unchanged. Adequate matched forward accuracy/calibration/costed outcomes, native publication lineage and actual running-host verification remain unfinished. The host-location question is pending; cPanel excluded. Sports remains in progress, followed by Crypto then Stocks. Keep live trading disabled.
