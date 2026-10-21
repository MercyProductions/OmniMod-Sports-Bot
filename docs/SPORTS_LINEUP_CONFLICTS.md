# Distinct-player lineup evidence and capture timestamp integrity

Development prediction identity is **OmniMod Evidence Ensemble v6.0.9**. Existing archived baseline/v6.0.7 captures are unchanged. No deployment, model promotion, production journal migration or live Discord publication occurred.

## Reproduced lineup defects

The new regressions failed against the preceding implementation:

| Input | Earlier behavior | Repaired behavior |
| --- | --- | --- |
| Five NBA roster starters, one separately reported Out | Five confirmed starters; full-lineup quality bonus remained possible | Four distinct available confirmed starter records; incomplete lineup |
| Five duplicate rows for the same NBA athlete | Five starters could satisfy the expected starting count | One distinct starter; no complete-lineup claim |
| Confirmed pitcher roster record and separate same-team injury record saying Out | Critical starter coverage remained confirmed | Projected/unavailable coverage with a conflict reason |

`src/playerEvidence.js:24` derives reconciled evidence without editing the original observations. Provider athlete IDs and normalized team identity scope deduplication. Name-only records remain a weaker fallback. An unidentified same-name assertion cannot count as an extra person alongside known-ID records, nor bridge two conflicting known IDs into one person. Rows lacking team and any usable identity cannot establish distinct coverage.

An unavailable assertion for the matching team/player suppresses confirmed coverage. Contradictory explicit starter flags also prevent confirmation. This is conservative conflict handling, not a claim that either source is independently authoritative or that an older injury report always describes current reality. Future work must establish native update/revision provenance before resolving those conflicts chronologically.

Callers now share that derivation:

- `advancedMetrics.js:663`: distinct available roster starters determine lineup completeness, coverage and starter-pair evidence. Critical-player form excludes conflicting unavailable observations.
- `participationProjection.js:90`: reconciled lineup and participant rows prevent last-row order from restoring an unavailable starter or multiplying participation records.
- `evidenceCoverage.js:42`: frozen coverage uses the same distinct-player policy, records `lineupEvidenceConflicts` and adds `lineup_evidence_conflict` to missing-evidence reasons.

Existing exported confirmation/identity helpers remain available through their previous modules. Implementations now live together in `playerEvidence.js` to avoid incompatible rules and circular imports. Raw event roster/injury observations remain inspectable; a confirmed role is still not medical clearance.

One older advanced-model test explicitly supplied a zero-availability home starter but expected two complete lineups. Its corrected assertions expect one complete side and no starter-pair contribution from the unavailable player. Restoring availability in the same fixture demonstrates the positive control: two complete sides and the supported pair contribution return.

## Capture chronology repair and diagnostics

`src/prospectivePairs.js:40` now requires both start and completion times to parse, before testing ordering. Previously a malformed completion yielded `NaN`; comparisons against start and receipt times were false and could fail to reject it. Receipt loading at line 64 also rejects unknown/reversed timestamps even when a legacy ledger's file hashes and chain are internally consistent.

New errors distinguish summary mismatch, invalid timestamp, completion before start and completion after receipt. They include numeric start/completion/receipt timestamps only; raw payloads, credentials and provider exceptions are not printed. No time tolerance was introduced, no future capture became eligible, and original evidence was not rewritten.

Two isolated-worker chronology failures recurred during a full-suite run before these diagnostics were added. They did not recur in the following full run or final full run. Their original cause remains unproven. Better failure diagnostics are not evidence that the intermittent issue is resolved; preserve that open reliability item.

## Verification

Baseline: 237 tests passed, zero failures/skips. Three new lineup regression tests failed before source repair. Added order/identity controls verify conflict handling in either row order, isolation across teams/conflicting IDs, exclusion of anonymous duplicate assertions, and preservation of original rosters. Two additional capture tests reject malformed/future/reversed completion times and a hash-valid legacy capture with invalid timing.

Final full suite: **243 passed, zero failures/skips**. `npm run check` includes the new module and passes; whitespace checks pass. Logs and any private captures remain outside Git. Tests verify code behavior; they do not demonstrate better forecast accuracy or profitability.

The existing live-study report still contains two matched pregame NHL pairs. Four role/game observations are not started, the final-query plan is empty, and no new provider request was made. Both results remain unresolved. The full Sports requirement matrix, broader data coverage, isolated transport/process recovery and statistically adequate forward comparisons remain unfinished. cPanel remains excluded at the user's request; deployed state remains unverified.
