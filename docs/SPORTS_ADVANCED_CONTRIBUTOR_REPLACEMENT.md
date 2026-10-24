# Advanced feature contributor replacement

Development model: OmniMod Evidence Ensemble v6.0.23. Baseline 342 tests at 243bbb4. Source only; no deployment, promotion or live trading.

## Reproduced defects

Repeated attachment appended receipts and source statuses to the existing bag even when the same fields were replaced. Five calls accumulated ancestor receipts instead of retaining the two current NFL contributors. A successful refresh retained its earlier failed status. Fully replaced legacy values could retain an obsolete future timestamp and incorrectly exclude current replacement data.

Separate regressions showed stale numeric values surviving when NFL source rows disappeared, one NBA side disappeared, or MLB lineup membership changed. Tennis replacement discarded independent fields and did not invalidate a missing contributor's prior comparison. These are current-context defects; permanent prediction journals are separate and must remain append-only.

## Repairs and source map

- `sports-bot/src/advancedProvenance.js:10`: composeAdvancedProvenance records field-scoped sourceContributions. Overwritten fields lose their old contributor entries; independent fields retain their original receipts. Flat receipt/request-key compatibility views are derived from current contributors. Repeated replacement is bounded by actual fields/contributors, not refresh count.
- A source has one latest refresh status in the flat diagnostic view. That status never re-dates retained rows. Unknown receipt values remain null. Observation timestamps attached only to fully replaced legacy values are cleared; if independent legacy fields remain, their direct/nested timestamps remain inherited and conservative.
- `sports-bot/src/advancedDatasets.js:380`: explicit source field ownership defines replacement scope. `:391` recognizes previously attached source ownership from the new schema, request identities or known legacy provider labels. It does not indiscriminately delete unidentifiable manual/history fields.
- All existing external branches replace their own numeric fields and provenance together. Missing source rows or necessary sides clear known source-owned comparisons. MLB missing lineup membership records coverage none; tennis preserves independent fields while invalidating unavailable comparisons. Match counts require currently usable contributors.
- `sports-bot/src/inputChronology.js:8` checks nested contributor receipts as well as flat receipts. A known future nested observation cannot hide behind an older flat list. Missing nested receipts remain unknown. The strict cutoff is unchanged.
- `sports-bot/src/evidenceCoverage.js` freezes contributor field/receipt identities without copying raw future refresh statuses into nested audit metadata. Malformed/legacy contributor metadata remains unknown instead of causing a coverage-report exception. The flat source-status view retains its existing cutoff masking.

Existing immutable issued forecasts, historical capture files and the production learner are untouched. This changes how new inputs are assembled and needs prospective validation under the new model identity.

## Verification

Ten new tests cover bounded repeated attachment; replacing receipts/failure status on success; independent historical provenance; fully replaced obsolete timestamps; disappearing NFL inputs; lost NBA side; changed MLB membership; missing tennis contributors; nested future/unknown receipts and malformed coverage metadata; and conservative legacy migration with a surviving independent field.

Complete suite: **352 passed, zero failures/skips**. Syntax and whitespace checks pass. Initial four provenance regressions failed before the first repair; three disappearance regressions then reproduced stale-value retention before branch invalidation was added. All added observations are synthetic. Existing known-future cutoffs, unknown-legacy receipts and period/retry behavior remain covered.

## Limits and next work

Field-scoped attribution is not native source publication/revision attestation. Unknown inherited fields remain explicitly unattributed. An explicit historical-period request can still reject unverified legacy context under the existing conservative period rules. Unknown ownership cannot safely be reconstructed from numeric values alone. Snapshot files remain latest-state caches; permanent forecast/revision auditing belongs to the journal.

MLB selection currently warrants a separate audit of actual batting-lineup membership and unavailable players; matching a player's historical stat row does not itself prove inclusion in today's lineup. NBA/calendar conventions, provider entitlement/access, native lineage, running-host identification and adequate matched forward outcomes remain unfinished. The MoneyPuck 403 is not retried or bypassed. cPanel is excluded; live trading disabled. Sports remains in progress before Crypto then Stocks.
