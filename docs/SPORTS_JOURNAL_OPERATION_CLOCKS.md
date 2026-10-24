# Journal and operational timestamp integrity

Development identity: **v6.0.54**. Operational report schema: **sports-operational-audit-v3**. The independent hourly trial remains frozen at v6.0.52 / `03c6714...`; no archived source, original journal, plan, artifact or production setting was rewritten.

## Reproduced defects

The permanent journal normalized timestamps with permissive Date.parse before deciding whether a forecast was observed pregame. A missing timezone, date-only input or impossible calendar date could become a canonical ISO timestamp and appear to prove chronology. That contradicted the strict timestamp checks in newer evaluators. Refresh attempt inputs used the same conversion.

The operational report had a related, separate defect: it accepted result/delivery states without verifying their relationship to the forecast. An outcome observed before kickoff or after its claimed receipt could clear pending status; an acknowledgement predating issuance could count as delivered. It also counted duplicate/conflicting forecast identities as separate operational issues and coerced malformed duration assertions into latency statistics.

Thirteen new tests include two valid controls. **Eleven fail against the previous journal/report sources**, including the later-invalid-result regression; originals were restored after reproduction. This is evidence of eligibility/reporting defects, not proof that a particular real forecast exploited them.

## Journal repair

`predictionJournal.js:16` now uses the shared strict calendar/explicit-zone parser for generated, receipt, refresh and evaluation instants. Event-start fields separately use `capturedEventTime`, which supports a source's explicit minute precision as :00 seconds but still never guesses a zone or repairs an impossible date. Event identity, correction start comparisons, price-event metadata and rejected-association metadata use the same event rule.

Invalid generated/start observations remain auditable as unqualified journal observations, without an eligible issued forecast. Invalid refresh instants reject before a terminal attempt is appended. New snapshots include `timestampPolicy:explicit-zone-receipts-and-event-start-v2`. Existing valid instants preserve their canonical values; old journal records are never rewritten or upgraded from inferred chronology. Correct explicit timezone offsets and minute-precision event starts retain their positive paths.

Model identity is v6.0.54 because the eligible forecast population changes. This does not establish better probabilities or source publication truth. A valid timestamp format and locally recorded receipt are not independently authenticated native publication times.

## Operational repair

`operationalAudit.js` uses strict receipt clocks, with separate event-start parsing. Schema v3:

- Retains raw asserted issue counts but deduplicates identical forecast IDs and excludes conflicting IDs from canonical operational counts. Existing independent drift identity auditing still sees the raw inputs and reports its own exclusions.
- Checks result observation >= event start and <= result receipt, and rejects schedule-changed results. Invalid visible latest labels cannot silently revive an older resolved label; a later valid observation can restore a usable result. Invalid dispute resolutions do not erase the unresolved dispute.
- Accepts delivery state only at or after the corresponding issued receipt. It remains an asserted local acknowledgement, not independent proof of remote transport.
- Keeps unknown event starts unknown instead of declaring them overdue or resolved.
- Computes mean latency only from finite numeric, nonnegative durations consistent with strict attempted/completed/recorded clocks. It reports timed attempts and unverified durations separately.
- Reports invalid record timestamps, records after cutoff, unbound/invalid result observations, invalid delivery chronology, duplicates and conflicting forecast records.

Operational issuance counts are asserted canonical journal states, not predictive approval or independent runtime health. Repeated games across horizons/guilds are not independent samples. Invalid receipt times have unknown placement relative to a historical cutoff and remain excluded with explicit diagnostics. No original records are repaired, synthetic conflicts created or old clocks backfilled.

Consumers reading the explicit report schema should accept v3. The read-only CLI remains unchanged in usage; its integration regression now asserts v3 and unchanged input bytes.

## Verification and actual read-only evidence

Reproduced full baseline: **926 passed**. Focused: **80 passed** with `node --import ./test/setup.js --test test/journal-operation-clock.test.js test/operational-audit.test.js test/prediction-journal.test.js test/journal-event-integrity.test.js test/refresh-event-identity.test.js` from `sports-bot`. Full default-parallel suite: **939 passed**, zero failures/skips. Root syntax and whitespace checks passed.

The new read-only CLI also inspected the actual preserved next-day v6.0.45 challenger journal. It reported 13 raw/canonical issues, 13 resolved outcomes, zero delivery acknowledgements (expected in isolated research), no invalid clocks/associations/identity conflicts and no overdue outcomes. The journal SHA256 stayed identical. Drift still excludes all 13 records for unverified legacy outcome-space metadata; those classes were not invented from the result or backfilled. Raw capture comparisons remain a separate frozen evaluation, not current-version performance evidence.

## Remaining work and authorization

The v6.0.52 collector remains active but pre-start at the verification checkpoint, with zero trial requests. Current main-source fixes are not substituted into its frozen model. Actual current-version forward validation, complete source/input publication lineage, confirmed injury/goalie coverage, the intermittent zero-successor cause and operational evidence remain unfinished. The latest actual injury endpoint is still HTTP 403; native NHL supplies season context, not confirmed starters or health clearance.

No model promotion, live trading, orders, Discord posting, production startup, merge, deployment or credential changes occurred. Stocks automation remains active and byte-identical. Sports remains first, followed by Crypto and Stocks under the complete queued specifications; cPanel remains excluded.
