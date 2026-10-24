# Corrected final scores and immutable prediction displays

Development model identity: v6.0.37. Prediction weights, probability formulas, risk gates and production configuration are unchanged. New optional settings govern public-data correction rechecks.

## Confirmed defects

A final acknowledgement suppressed further refresh and delivery work. The batch restored an already-posted claim, and the publisher returned the existing message without updating it. Consequently, an originally correct forecast could remain green after a later score correction made it wrong. A same-winner score change could remain stale too.

The previous committed delivery/publisher/reconciliation code fails both targeted baseline regressions: correction editing with original-forecast preservation, and bounded correction rechecks after acknowledgement. These are synthetic workflow defects, not measurements of forecasting accuracy.

## Implemented workflow

- `sports-bot/src/finalResultRevision.js:12` binds the final to the known league, canonical start and native ID or explicit upstream mapping. It freezes the pregame prediction separately from outcome fields and computes an outcome digest covering scores, outcome, original selection/model/issue time and probability vector. Observation time remains separate, so repeated observations of unchanged scores do not manufacture revisions.
- `sports-bot/src/finalDelivery.js:7` snapshots the entire incoming slate before asynchronous work. The durable claim's original forecast is authoritative when a later cache contains changed picks or probabilities. The batch inspects the latest posted record, prepares a revision, and requests the same event's owner-fenced chain. Initial delivery and every correction remain separately recorded.
- `sports-bot/src/finalClaimStore.js:50` traverses through posted history instead of returning an older matching digest. A different outcome needs explicit revision permission and a strictly later verified observation time. A newer reversion to an earlier score is allowed; a replay of an older correction is not. The claim links its predecessor and retains the original frozen forecast. Completion cannot substitute another outcome digest or observation time.
- `sports-bot/src/discordPublisher.js:464` writes a result digest beside the scoped event footer. At `:498`, a correction edits the original bot-authored message. The original message ID/channel, event footer and guild are checked. Missing, denied or mismatched targets remain pending; they cannot cause a replacement send. Green/red grading uses the original selection and corrected outcome.
- A matching remote digest proves the same revision was already rendered by this workflow, so a retry after accepted edit does not edit again. This handles a timeout or process exit after remote persistence but before local acknowledgement. It is not independent authentication of source truth.
- `sports-bot/src/sportsData.js:986` compares the refreshed outcome with the acknowledged digest and can collect a corrected final after prior delivery. The immutable prediction journal retains its original forecast and appends result revisions.
- Cached acknowledgement merging prefers a known higher claim generation. An unchanged, already-current acknowledgement does not inflate the recovery counter. `correctedCount` counts acknowledged correction operations, including transport reconciliation; it is not an audited count of HTTP edits.

## Source evidence and legacy records

Automatic corrections require an existing frozen baseline, a later outcome observation, and a non-stale provider fetch receipt newer than the prior outcome observation and no later than the new one. `sports-bot/src/finalResultRevision.js:32` checks these conditions. Missing/future/pre-baseline evidence is rejected. Fetch receipts still do not prove underlying provider publication time.

Manual score overrides retain precedence in grading, but are now explicitly marked by `sports-bot/src/sportsData.js:716`. Their current date/team matching does not establish a unique event or independent provider provenance. Such overrides cannot borrow an unrelated scoreboard fetch receipt to qualify an automatic correction. Manual-result identity and review require further work.

Legacy posted claims without a frozen forecast and outcome digest cannot safely infer which historical pick was displayed. They are marked `correction_baseline_unverified`, with automatic rapid retries disabled. They require explicit baseline reconciliation. No missing original probability, provider receipt or historical result is fabricated. Other structured failure reasons distinguish source-evidence rejection, revision ordering, missing targets and access denial without storing exception contents.

## Bounded rechecks

The scheduler now includes acknowledged finals in a correction window. Defaults:

```dotenv
FINAL_CORRECTION_CHECK_HOURS=24
FINAL_CORRECTION_CHECK_MINUTES=60
```

The window is measured from scheduled start, not final completion. Hours may be 0 to disable extra acknowledged-final checks, or up to 168; interval bounds are 10–1440 minutes. Existing unresolved-event checks and `FINAL_LOOKBACK_DAYS` still bound eligible dates. Date batches share normal public scoreboard caching/rate/error behavior and make no Odds API call. A pending retryable delivery failure continues through the normal final-check path. Last correction checks are persisted in the cache.

## Verification

Complete baseline suite: **507 passed**. Both targeted baseline regressions fail against the former committed workflow. Repaired suite: **521 passed, zero failed/skipped**, plus syntax and whitespace checks.

Fourteen new tests cover green-to-red edits, unchanged original picks despite cache mutation, same-winner score changes, newer score reversions and stale rollback rejection, stale/manual/future evidence, deleted/denied targets, accepted-edit timeouts, concurrent corrections, bounded rechecks, acknowledgement generation merging, asynchronous input mutation, and explicit upstream mapping.

One test executes the actual source parser, final refresh, journal and delivery batch with injected ESPN responses and local fake Discord. It verifies a correction after acknowledgement and an unchanged original journal forecast. A real child exits after the fake service persists an edit; a new process recovers the revision without another edit or send. No production Discord login, real source collection, deployment or live trading occurred.

## Limits and next steps

Exactly-once delivery under delayed remote visibility, power loss, multiple hosts or adversarial storage is not established. The claim protocol retains its single-host/local-filesystem contract. Cache generation merging protects a merge against a known older acknowledgement; it is not a transaction covering independent concurrent cache writers. A single scheduler/cache writer remains the verified operating model, with durable claim history used for reconciliation.

Legacy baseline adoption, manual-result identity/provenance, broader correction coverage beyond configured windows, quote-only refresh selection, remaining adapter identity, compact timestamp/missingness and full source revision lineage remain unfinished. Source truth, actual host/configuration/jobs and sufficient prospective accuracy/calibration evidence remain unverified. Original prospective captures are preserved. Sports remains in progress, then Crypto and Stocks. cPanel is excluded; no merge, deployment, model promotion or live trading occurred.
