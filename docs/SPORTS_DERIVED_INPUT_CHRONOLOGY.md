# Cutoff integrity for derived participation and nested receipts

Development prediction identity becomes **OmniMod Evidence Ensemble v6.0.10**. Existing baseline/v6.0.7 prospective captures retain their exact source, timestamps and probabilities. No production deployment, learner mutation, model promotion or live trading is included.

## Reproduced defects

The cutoff filter excluded known-future summary/history/player inputs but could retain dependent objects: raw roster records, participation summaries/projections, nested player workload projections, environment/context and advanced aggregates. `predictionEngine.js` reads those participation summaries for visible feature/ML inputs and uncertainty. Removing the parent alone did not establish that the model stopped using its derived evidence.

Separately, `observedInputState` checked parent timestamp fields but missed receipt timestamps inside corroboration `matches`. A record containing a known-future receipt could therefore be classified as unknown and retained. An untimestamped advanced aggregate could also survive after its explicitly future-dated team profile was removed, despite `sportsData.js` deriving those fields from that profile.

Three initial new regression tests failed before source repair: future summary-derived roster/participation data remained, nested future corroboration survived, and an advanced aggregate remained after excluding its team-profile dependency. This proves the software mechanisms, not that a specific production forecast used those conditions or that they explain a historical accuracy decline.

## Repairs and source entry points

- `inputChronology.js:4` examines the existing parent fields plus declared `sourceReceiptTimes`, corroboration match receipts and selected nested environment timestamps. Invalid or after-cutoff times remain excluded. Missing receipt dependencies return unknown only after checking known timestamps, so an unknown sibling cannot hide a known-future receipt.
- At line 40, nested player participation metadata is checked independently of the player's receipt. A current injury/status row can survive while its future projection is removed. Exclusion also invalidates the dependent lineup/participation aggregates.
- At line 45, dependent participation summaries, projection lists and per-player projections are cleared consistently when an applicable parent is excluded. Per-player objects are copied before deleting nested projection fields; original observations are preserved.
- At line 57, an excluded automatic team profile invalidates the inseparable advanced feature bag. This is conservative aggregate exclusion, not a claim of field-level provenance.
- Summary/history rejection also clears the relevant derived lineup/environment/advanced/participation inputs. Known-future corroboration invalidates its inseparable environment/context (line 71).

No native publication time is inferred from a receipt, recalculation time or missing value. Untimestamped legacy inputs retain the existing explicitly unknown policy. `pointInTimeComplete` remains false. Partial known/unknown receipt lists now remain visible in `unknownAvailability` rather than being described as fully observed.

## Verification

Baseline suite: 259 passed. Five new tests cover the three reproduced leaks, nested projection timestamps, and positive controls for contemporaneous data/true zero/unknown receipts. They verify source objects remain unchanged, current medical status is retained when only the projection is invalid, and excluded summary participation no longer remains a visible feature or changes uncertainty relative to the corresponding no-summary fixture.

Final suite: **264 passed, zero failures/skips**. Configured syntax and whitespace checks pass. The cutoff model version changed because corrected feature eligibility can affect candidate inputs, uncertainty and probability outputs; no performance improvement is inferred from unit tests.

## Confirmed remaining audit work

Inspection found separate advanced-adapter provenance issues requiring the next repair:

1. `syncAdvancedDatasets` carries prior data forward but updates the container's `updatedAt` even when a particular source refresh fails. The container's age can then suppress a retry without establishing that the retained source rows are fresh.
2. Several attached advanced feature bags lack per-source row receipt metadata; tennis and independent schedule corroboration can use the container timestamp. That cannot prove when retained rows became available.
3. The advanced snapshot cache age check does not explicitly reject a future-dated container. Reproduce these with synthetic provider responses before changing the adapter; do not perform unauthorized scraping or manufacture historical timestamps.
4. Historical derived differences still require a broader missing-value and lineage audit. This phase does not attest every nested field or revision, or reconstruct absent as-of history.

Those items remain unfinished. Actual provider access, adequate prospective outcomes, full scheduler/live Discord behavior and deployed state remain unverified. cPanel remains excluded. Sports is still in progress, with Crypto and Stocks queued afterward.
