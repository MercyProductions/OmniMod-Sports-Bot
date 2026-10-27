# Journal forecast identity integrity

## Confirmed defects

The summary and matched evaluator could attach an ID-keyed result to different visible forecast payloads sharing that ID. Missing IDs could also join an undefined-key result in the summary. Identical duplicate records inflated eligible summary counts. Matched issue selection used array order/raw scope fields and its direct entry point accepted timezone-naive clocks through Date.parse.

Operational drift already quarantined conflicting frozen IDs, but it audited identity after issue chronology qualification. A later visible contradictory payload with invalid issue timing could therefore disappear before its conflict was noticed.

## Shared repair and references

- `sports-bot/src/journalForecastIdentity.js:5`: shared audit of caller-visible forecast records. Nonempty string IDs and explicit-zone recorded clocks are required. Full canonical payload hashes detect conflicting reuse. Every visible copy of a conflicting ID is excluded; identical payload copies collapse to their earliest recorded event. Input records are untouched.
- `journalEvaluation.js:20`: performance eligibility uses canonical identity events. Payload wrappers retain each event's own issue timestamp even when arbitrary caller arrays reuse the same JavaScript object. Raw forecast count remains separate from eligible issues; ID conflicts, duplicates, missing IDs and per-version identity exclusions are explicit. They are not mislabeled invalid chronology.
- `matchedJournalEvaluation.js:124`: audited records are time ordered; earliest eligible selection uses canonical guild/league/string event/start/model/horizon. Missing IDs cannot attach results. Direct receipt/generated/start/result timestamps use the strict explicit-zone parser. Reused native event IDs on different starts stay separate.
- `operationalDrift.js:14`: the same identity audit runs before issue qualification within the caller's supplied issued population, so visible contradictory reuse cannot be hidden by later bad chronology. Existing rejection counters remain compatible.

All identity audits operate on records visible at the requested cutoff. A future collision cannot retroactively change an earlier cutoff. The operational caller supplies issued observations; the summary/matched callers supply visible journal records. Their raw counter populations remain explicitly different.

## Verification

- Unchanged baseline: 770 passed.
- Ten added regressions. All ten fail against preceding report sources after strengthening timezone coverage. The first comparison had one naive-clock check passing accidentally under this host's timezone; a real UTC child exposed Date.parse acceptance. Both observations are retained, not presented as independent defects.
- Focused identity, journal summary, matched and operational suite: 78 passed.
- Full suite: 780 passed, zero failures/skips. Syntax and whitespace checks pass.
- Coverage includes changed probabilities, event identity, candidate/coverage metadata; duplicate raw/eligible counts; earliest receipt and shuffled/shared-object arrays; future-cutoff visibility; missing IDs; strict clocks in the current host and UTC child; canonical league/horizon/time aliases; and distinct scheduled events sharing native IDs.

These tests verify selection and result-association integrity using isolated fixtures. No stored forecast/result, private study capture or production dataset/model was modified. Fewer eligible observations after quarantine are not improved predictive performance.

## Limits and remaining work

Payload hashes detect contradictory reuse; they do not authenticate source truth, validate every ID against the writer's version-specific deterministic identity recipe, or verify an arbitrary input array's journal hash chain. The canonical reader remains responsible for byte-chain integrity. Audit differences in caller populations are not interchangeable health attestations.

Simultaneous *different* IDs within one matched event/horizon, conflicts in later unselected revisions, raw-capture adapters, source-specific feature/result availability and settlement semantics still require review. Whole-game intervals do not resolve cross-game day/team/league dependence. Adequate independent prospective outcomes and actual installed-state/startup validation remain unproven.

Sports remains offline. No merge, deployment, promotion or live trading. Sports in progress; Crypto then Stocks requirements remain queued.
