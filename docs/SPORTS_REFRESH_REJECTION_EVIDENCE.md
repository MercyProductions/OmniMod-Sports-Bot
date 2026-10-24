# Durable pregame rejection reasons

## Confirmed defect and repair

At the preceding review head `50ad5e1aeae0ac2b4b60b38047993957718541f5`, the completion gate in `sports-bot/src/pregameRefresh.js:85` correctly rejected `cache_event_changed_during_refresh` and `summary_source_identity_conflict`. The terminal-attempt serializer in `sports-bot/src/predictionJournal.js:168` omitted both codes from its allowlist. Consequently the permanent journal and `auditSportsOperations()` could count a rejection while losing its actual cache/source cause.

The initial six-case reproduction had five failures: each individual cause, the complete code contract, combined causes and retry/audit counting. The acceptance gate itself rejected correctly, and its protection against provider metadata replacing a revalidated summary passed. This is an observed durable-evidence defect, not evidence that a rejected forecast was actually issued.

The repair introduces a shared fixed-code serializer in `src/refreshReasonCodes.js`. New terminal records declare `reasonPolicy: sports-refresh-rejection-codes-v2`, retain both missing codes and count omitted unrecognized inputs without storing their text. Malformed reason containers fail with a sanitized error. Operational audit v3 now exposes `refreshes.reasonEvidence`: current-policy attempts, legacy/unknown-policy attempts, omitted-code counts, invalid counters and explicit unverified historical completeness.

An identical legacy retry keeps its original bytes and hash chain. New causes or newly observed omitted-code counts cannot silently replace a previously frozen terminal record. Older lost causes cannot be reconstructed or backfilled. Zero recorded causes must not be interpreted as zero underlying conflicts.

No model formulas, thresholds, acceptance/issuance conditions, risk controls or trading settings are edited. Model identity remains v6.0.67. The source artifact nevertheless changes because it binds all `src/` files, including journal/audit code. Existing artifact approvals are not transferred to the revised bundle; an incompatible champion still falls back under the existing selection rules. The archived v67 trial remains pinned to its original source. No before/after probability or performance equivalence is inferred from this audit repair. Passing tests cannot authorize promotion of this bundle.

## Injury and goalie bottleneck

Tracing the actual caller confirms that targeted refresh completion requires a newly obtained or revalidated event summary within the attempt and a valid new pregame forecast. A fresh optional availability snapshot can supply independent model inputs, but **cannot by itself complete that refresh** when the required summary is unavailable. Current provider metadata alone is not a substitute for verified source authority. The gate is preserved; a source-neutral alternative requires a separately designed and validated receipt/completeness contract.

The existing free-source evidence remains incomplete: the saved v67 capture has 12 unverified NHL summary mappings, six failed NBA/MLB summary requests and three NBA cap omissions. Six NHL games provide season candidates, not confirmed event goalies; injury coverage is unknown for all 42 team sides. No actual preferred-provider feed is connected. This phase makes failed-refresh causes observable; it does not recover medical data, retry denied endpoints or manufacture healthy-player evidence. See [the measured availability report](SPORTS_GOVERNED_FORWARD_FAMILY.md) and [provider contract](SPORTS_GOALIE_INJURY_PROVIDERS.md).

## Verification

| Check | Actual result |
| --- | --- |
| Reproduced full baseline | 1,211 passed |
| Initial old-source reproduction | Five failures / six cases; acceptance remained closed |
| Expanded new regressions | 11 cases: cause persistence, audit counts, combined failures, redaction, retry immutability, legacy history, malformed inputs and strict counter types |
| Focused refresh/journal/operational/event checks | 69 passed |
| Full default-parallel `npm test` | 1,222 passed; zero failures/skips |
| `npm run check` | 233 project files |
| Real read-only operations CLI | 12 issued forecasts; zero terminal refresh records; journal bytes unchanged |

Commands run from the repository root were `npm test`, `npm run check`, and the CRLF-aware whitespace check. The focused command runs from `sports-bot/`:

```text
node --import ./test/setup.js --test test/refresh-rejection-evidence.test.js test/prediction-journal.test.js test/operational-audit.test.js test/refresh-event-identity.test.js
node scripts/audit-operations.js --journal=<explicit-private-journal.jsonl>
```

The actual CLI used the existing isolated v52 research journal and an empty environment, with migration disabled. It made no provider requests, orders or Discord posts. Its `unknown_no_attempt_records` result is not proof that every pregame refresh succeeded, nor a way to estimate historical loss of these reason codes. Fixture tests establish the repaired pipeline; actual historical prevalence is unknown.

Read-only inspection also verified the original manifest/capture/ledger bytes for all four current-source diagnostic studies. At the actual check, pending role/game rows were not started (24, 21, 33 and 33 respectively); all studies had zero eligible final queries and zero unindexed captures. Those overlapping rows are not independent samples. No final query, new forecast or provider request was run, and no process was restarted.

The shared forward-family inspector still verifies both registered trials and their existing source/artifacts. The original collector, v67 November collector, current-source final-only reconciliation and Stocks automation files remain ACTIVE and byte-identical. No production host is attested by these checks. Sports remains user-confirmed offline; no main merge, deployment, startup, model promotion, credential change or live trading occurred.

## Remaining requirements

Real injury/confirmed-goalie source coverage, validated alternative refresh authority, adequate independent multi-date proper-score/calibration evidence, executable-price/settlement/cost evidence and actual production-host verification remain unfinished. Preserve the original v52 and November v67 trial identities and their real timestamps. Keep the full Sports requirements ahead of Crypto, then Stocks; no goal scope is replaced by this audit repair.
