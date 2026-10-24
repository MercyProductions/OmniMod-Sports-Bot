# Durable explicit quote-refresh attempts

Development identity: v6.0.44. This phase adds audit persistence around the existing administrator-only quote refresh. Prediction weights, value/risk gates, cooldown and daily request limits are unchanged. Live provider access remains opt-in under existing configuration.

## Confirmed gap

The previous `src/valueQuoteRefresh.js` preserved a request-budget reservation but not the selected forecasts or terminal provider/identity/processing result. Failures and unmatched observations were returned only to the caller. A process exit could therefore leave no explanation for a consumed request slot. Successful price observations were journaled later by the command handler, leaving a similar gap before that consumer ran.

## Implemented lifecycle

`src/quoteAttemptAudit.js` creates immutable, hash-checked start and completion JSON records in the private `value-refresh-audits/` directory. They are bound to the existing `value-refresh-claims/<date>-<slot>.json` reservation. Claim files are now file-synced before proceeding.

1. Reserve the existing request slot. Failure still consumes a slot; no retry loophole is introduced.
2. Persist a start record **before** invoking the provider. It freezes selected local event scope, model version, original forecast/as-of time, selection, probabilities and forecast hash. It records request intent, not proof of network dispatch or provider charging.
3. Run the existing request and validation. Provider failures, processing failures, unmatched results, stale quotes and fresh results have bounded terminal evidence. Identity/bookmaker rejection reasons and observation hashes survive independently of the command caller.
4. Persist completion **before** returning prepared price snapshots. If audit start fails, no provider call occurs. If completion cannot be verified, no price snapshot is returned for issuance; the reservation remains consumed and existing audit files are preserved.

Publication uses a synced temporary file and no-replace hard link. Existing differing terminal evidence cannot be overwritten. Read-only validation checks content hashes, claim/start/completion binding, record types and local time order. Missing or detached claim evidence fails closed. A backwards completion clock cannot certify an outcome.

The audit deliberately excludes raw errors, request URLs, API keys, headers and full provider payloads. Selected event/model metadata is private research data. No production credentials or configuration were modified.

## Operational interpretation and diagnostics

From `sports-bot/`:

```sh
npm run audit:quote-attempts
node scripts/audit-quote-attempts.js --directory=/path/to/private/data
```

The command is read-only, prints aggregate state/status counts and prepared snapshot counts, and does not contact Discord or a provider. `readQuoteAttemptAudits(directory)` is also available for private developer inspection.

| State | Meaning |
| --- | --- |
| `reserved_without_audit` | Legacy reservation or interruption before a start record; dispatch is unknown |
| `started_unfinished` | Start persisted; terminal result is unknown, even if a provider may have been contacted |
| `completed` | A terminal computation result was durably recorded; this does not prove later journaling, delivery, execution or provider charging |

`preparedPriceSnapshots` counts snapshots prepared by the refresh function. It is **not** a count of delivered Discord alerts or persisted prediction-journal observations. The consumer continues to handle those separately. Interrupted requests are not automatically retried or reclassified as failed/successful.

## Verification

The existing full suite was reproduced: **594 passed**. Restoring the old refresh workflow produced **six targeted failures**, demonstrating missing failure/success/rejection/dispatch evidence and the absence of a pre-request audit gate.

Repaired full suite: **606 passed, zero failed/skipped**, with syntax and whitespace checks passing. Twelve new tests cover redacted failures, HTTP metadata, identity rejections, success and diagnostics, start/completion write failures, processing errors, immutable/detached records, legacy states and clock rollback. Two real child-process exits verify unfinished dispatch and completion surviving before any consumer journal/Discord work. Requests use injected fixtures; no paid provider calls or Discord logins occurred.

```sh
npm test
npm run check
# From sports-bot/:
node --import ./test/setup.js --test test/quote-attempt-audit.test.js
```

These tests establish audit behavior, not improved forecast accuracy or profitability.

## Limits and deployment requirements

This is a cooperative local-filesystem protocol. Hashes are not authentication or external immutability; deleting all related records cannot be detected without an independent backup. Hard-link support and filesystem behavior must be verified on the actual host. Process-crash tests and file sync do not establish power-loss guarantees.

Back up claim and audit directories together with the rest of the private bot data. Never infer actual provider credits, executable prices or charges from request intent. Raw failed payloads are not reconstructed from bounded hashes/reasons. Older reservations cannot recover missing forecasts or outcomes. Read cost grows with retained claim files; no retention deletion or compaction is introduced.

This covers the explicit quote-refresh path, not a universal ledger for every provider fetch or daily enrichment call. Full settlement rules, spread/total conflict semantics, cache transactions, legacy result-baseline adoption and actual running host/configuration/jobs remain unfinished. Independent prospective evidence is still required before claiming improved accuracy or promoting a model.

Deployment requires separate approval and isolated validation with backed-up private data. Sports remains in progress, followed by the complete Crypto and Stocks requirements. No merge, deployment, model promotion or live trading; cPanel excluded.
