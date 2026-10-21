# Preregistered hybrid selection continuation

The existing isolated selection ledger now supports `candidate: hybrid` in addition to local ML. This extends the source-bound recipe protection; it does not activate a hybrid or demonstrate that it improves forecasting.

## Registration

A hybrid plan pins the exact current `sports-hybrid-recipe-v1` descriptor: current model version, sport, blend weight and source-file hashes. Full canonical descriptor bytes and their hash are archived beside the plan. Altered manifests, stale identities and fabricated fitted-training timestamps are rejected. `recipeFrozenAt` is the actual registration time; a fixed source recipe is not a trained statistical model and receives no invented training dates.

Create a private plan JSON containing `id`, `candidate: hybrid`, `sport`, `league`, `horizon`, optional `specialistWeight` (default 0.38), and future ISO `start` / `end`. Existing minima remain: 14 days, 75 matched games and eight distinct event UTC dates. The CLI supplies the current verified artifact identity and version. There is no backdating or activation switch.

```powershell
npm --prefix sports-bot run research:selection -- --action=register --directory=./sports-bot/data/research/isolated/selection --spec=./sports-bot/data/research/isolated/hybrid-plan.json
npm --prefix sports-bot run research:selection -- --action=finalize --directory=./sports-bot/data/research/isolated/selection --id=hybrid-trial-001 --journal=./sports-bot/data/research/isolated/prediction-journal.jsonl
```

Hybrid registration needs no ML model file. ML registration retains its existing artifact and fitted-training-time checks. Unsupported candidate names fail closed. All commands operate on private research files without provider, Discord or order calls.

## Evaluation

Finalization filters by the plan's exact candidate artifact ID, model version, sport, league, horizon and prospective issuance period. The hybrid's frozen probability vector is evaluated, rather than accidentally reading the ML column. Existing matched chronology, game-cluster scoring, pending-outcome handling, minimum evidence and paired confidence-bound rules remain unchanged.

League periods cannot overlap across hybrid/ML experiments or horizons. Consumed games cannot support another review. Final reports are single-use and immutable, including insufficient or unsupported results; additional observations do not silently reopen a consumed holdout. Changed source recipes/weights need a new disjoint future trial. Descriptors returned to callers are copies so mutation cannot alter the process's frozen recipe identity.

`review_ready` is research evidence for human review, not production permission. Reports still set `promotionAllowed: false` and `approvalRequired: true`; runtime registry refresh cannot promote candidates. A pinned descriptor establishes recipe identity but does not preserve executable source archives, runtime dependencies or independent learned state. The isolated baseline/repaired-model collector must preserve these separately.

## Verification

Baseline `2a98f25510b83fd7ec0ceffb41a8b45855302173`: 205 tests reproduced. Current Sports suite: 210 passing, zero failures/skips, with configured syntax and whitespace checks passing.

New tests verify exact recipe pinning without fabricated training dates, manifest-tamper rejection, hybrid-specific scoring despite deliberately different ML vectors, one-time report finalization, cross-candidate league-period exclusion, wrong-recipe exclusion, descriptor mutation isolation, and actual CLI hybrid registration in a temporary research directory.

All trial forecasts/results are synthetic test fixtures. No actual prospective trial was registered, no real holdout was consumed, no model was promoted and production was not deployed or changed. Accuracy and profitability remain unproven.

Remaining Sports work includes the isolated executable baseline/challenger collector and its actual prospective run, deployed-host inspection, broader point-in-time feature provenance, league calibration analysis and the complete requirement-to-evidence report. Crypto and Stocks remain queued afterward.
