# Reviewed journal-to-warehouse result recovery

Development model v6.0.31. Baseline 6d10b57: 425 passing tests. This adds an explicit operator recovery workflow; ordinary scans never invoke it. No production record was reviewed or changed, and no scoring weight, champion, deployment or live-trading setting changed.

## Implemented workflow

[Proposal validation](../sports-bot/src/warehouseResultReview.js#L43) links one disputed warehouse record to one genuinely issued pregame forecast and the latest result in the hash-verified journal. Matching includes guild, league, native event ID, start, model, horizon, issue time, selected side and original outcome distribution. The warehouse must also have been captured pregame. The proposal exposes the matchup, original distribution, disputed observations, source hashes and exact data directory.

The result requires comparable nonnegative integer scores consistent with its outcome, unchanged schedule, and an explicit provider fetch receipt after start and no later than result observation/recording. Future, unknown, inconsistent or late evidence fails closed. This intentionally does not infer a source provider's identity or authenticate a score from its timestamp.

The [manual review](../sports-bot/scripts/review-warehouse-results.js) must explicitly accept that proposal, identify a reviewer and reason, reference the checked source, and record a review time after preparation. The decision and source-check assertion are operator claims, not authenticated identities or machine-verified independent truth. Those limits remain explicit in saved receipts and exported learning rows.

Apply revalidates the proposal digest, exact warehouse fingerprint, latest selected journal result and directory. Unrelated journal appends do not invalidate a review; selected result corrections do. Arguments are cloned before asynchronous writes. Repeated identical application adds no duplicate receipt and does not rewrite the warehouse. Old approvals cannot override a new dispute.

An accepted review restores only the matching outcome and preserves original forecast inputs/probabilities, conflict observations, prior grade and review history. Label availability is the application time, not the older provider result time. The real learner's cutoff test excludes a restored label before application. Three-way draws remain draws and do not turn a missed team selection into a win.

Later contradictory observations re-quarantine an adjudicated result. Learning reads also recheck the current journal proof, outcome, original vector and label-availability timestamp; a later canonical correction or detached proof makes that row ineligible without rewriting its audit history. Inventory exposes disputed, adjudicated and stale-adjudicated prediction-record counts. These are record counts, not independent games.

## CLI usage

Choose the intended private data directory first. Its JSONL journal and warehouse must already contain the matching observed forecast/result. A review journal must reside directly in that directory; arbitrary external journal paths are rejected.

```powershell
$env:OMNIMOD_SPORTS_DATA_DIR = 'C:\OmniModResearch\Sports'
npm --prefix sports-bot run audit:warehouse-results -- --action=prepare --forecast-id=FORECAST_ID "--output=C:\OmniModResearch\Sports\proposal.json"
```

Without output, prepare prints the proposal. Output files use exclusive creation and cannot overwrite an existing artifact. Preparation reads do not create/migrate a data directory. Review writes suppress automatic legacy-data migration; ordinary bot migration behavior is preserved.

After independently checking the disputed result, create a private review file containing:

```json
{
  "proposalId": "ID_FROM_THE_PREPARED_PROPOSAL",
  "decision": "accept",
  "sourceChecked": true,
  "reviewer": "REVIEWER_IDENTIFIER",
  "reason": "EXPLANATION_OF_THE_RESULT_CHECK",
  "sourceReference": "PUBLIC_RESULT_REFERENCE_OR_LOCAL_EVIDENCE_REFERENCE",
  "reviewedAt": "ACTUAL_UTC_REVIEW_TIME_AFTER_PREPARATION"
}
```

Those uppercase values are placeholders. No token, API key or account credential belongs in a proposal or review.

```powershell
npm --prefix sports-bot run audit:warehouse-results -- --action=apply "--proposal=C:\OmniModResearch\Sports\proposal.json" "--review=C:\OmniModResearch\Sports\review.json" "--data-directory=C:\OmniModResearch\Sports"
```

Custom same-directory journals use the explicit journal argument on both commands. Apply requires the matching directory argument and is never called automatically. API equivalents are prepareWarehouseResultReview and applyWarehouseResultReview.

## Locking and persistence

All warehouse writes now use the [shared exclusive owner lock](../sports-bot/src/auditFileLock.js). Apply holds the journal's compatible lock while verifying and updating the warehouse, preventing a concurrent journal correction during the decision. Warehouse serialization and atomic JSON replacement keep the restored label and its receipt together.

Coordinate manual application with bot operation: a competing writer receives a busy error. Locks are not stolen or automatically deleted after a crash; inspect ownership before any operator recovery. Active-owner preservation is verified with a real child process. This is a filesystem coordination protocol, not authentication or a distributed transaction service.

## Actual verification

Twenty-two new integration tests exercise read-only proposals, accepted/denied review, stale hashes and identity mismatches, future/missing receipts, changed schedules, corrupt files, idempotence, original-input preservation, repeated disputes, chronological label availability, argument mutation, three-way draws, current-proof invalidation, a complete CLI round trip, and content-safe parse errors. A production-mode child using the actual storage module and isolated configuration verifies that review operations do not copy legacy data, while normal migration still works.

Complete suite: 447 passed, zero failures/skips. Syntax and whitespace checks pass. All reviewed records and reviewer assertions in these tests are synthetic; the copied storage/configuration fixture does not touch production data. No market-data request or forecast was issued, and no actual accuracy/calibration or economic improvement is established.

## Remaining limits

Source truth and reviewer identity remain unauthenticated. Comparable-score recovery does not cover winner declarations without comparable scores, changed schedules or missing receipts; those require separate source-specific reconciliation. Legacy missingness is not reconstructed. Full raw revision lineage, journal event association, other compact timestamp contracts, source/sample adequacy, live-host verification and adequate prospective outcomes remain incomplete. Original prospective captures are unchanged. cPanel is excluded. Sports remains in progress, followed by Crypto then Stocks.
