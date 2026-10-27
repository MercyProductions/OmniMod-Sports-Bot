# Sports ML chronology and holdout review

## Confirmed defects

The pre-change source is commit `d39f2dca45ac9909cd34385a7b679c77d132fd6c`; its full suite passed 157 tests.

| Baseline location | Confirmed problem | Repair |
| --- | --- | --- |
| `sports-bot/src/localMl.js:193` and `:201` | Validation scored a 22-round training-only fit, but the stored artifact was a different 28-round refit including validation labels. Validation therefore did not describe the installed weights. | Store the exact evaluated fit, with a content-based artifact ID and training provenance. A future full-data refit is a new challenger requiring new evidence. |
| `sports-bot/src/localMl.js:223` | Reconstructed validation predictions inherited `source: frozen-production` and original issue timestamps. A causally constructed retrospective prediction could be mistaken for one actually issued. | Mark these rows `retrospective-ml-validation`, retain their origin and reconstruction time, and use a distinct snapshot policy. They cannot pass the production-provenance cohort check. |
| `sports-bot/src/modelRegistry.js:121` and `:207` | Repeated registry refreshes reused cumulative/recent results without a durable untouched-trial record. A good mean difference could automatically promote a challenger. | Runtime refreshes explicitly prohibit promotion. Review is separate, preregistered, artifact-specific and single-use, with explicit approval still required. |
| Training and inference cutoffs | Outcomes unavailable at training time could enter a fit; unknown/future-trained or modified artifacts lacked inference rejection. | Filter by actual label availability, purge training labels not available before the first validation forecast, verify artifact contents and trained-at time at inference, and require the registry's approved artifact to match the loaded artifact. |

## Exact research artifacts

`localMl.js` now writes store schema version **2** and `sports-local-ml-artifact-v2` models. Training records, cohort, features, fit rounds, stumps and league adjustments determine the artifact ID. Held-out labels do not enter its weights or identity. The artifact records the last training-label availability time, excluded/purged counts, training/validation sizes and the descriptive development evaluation.

The existing `accepted` field means the development validation criterion passed; it is **not** production authorization. Repeated inspection of that development block is not a fresh final test. Old store versions are inactive in the new reader; read-only inspection does not overwrite them. Back up the old store and registry before any separately approved deployment.

Candidate artifact IDs are frozen in forecasts and warehouse records. A changed daily research fit cannot silently replace a different approved ML artifact: inference falls back unless the loaded artifact matches approval. Runtime retraining remains research; deployment of an approved pinned artifact needs its own reviewed operational procedure.

## Preregistered review workflow

`selectionProtocol.js` manages a separate private research ledger. Before observations begin, declare one exact ML artifact, sport, league, parent model version, forecast horizon and future evaluation period. The protocol verifies the model and training timestamps and pins its full JSON bytes. Periods must span at least 14 days, with at least 75 matched games across at least eight distinct scheduled-event UTC dates. These are minimum review requirements, not proof of sufficient power or independence.

Plans cannot be redeclared. Evaluation periods for a league cannot overlap across trials. A completed game's identity cannot be reused for another trial, including at another horizon or from another guild. Hashes, exclusive owner locks, synchronous writes and atomic state replacement protect the ledger; corrupt state, changed pinned bytes and existing locks fail closed.

After the declared period ends, unresolved forecasts remain pending rather than becoming losses. Finalization evaluates only lifecycle-issued forecasts carrying the exact registered ML artifact, using the matched evaluator and its timestamp/outcome checks. All final reports are immutable, including insufficient-sample and unsupported-challenger results. Reruns return the stored report and explicitly ignore new evidence. Later score corrections require separate review; they must not silently reselect a model from the consumed trial.

Candidate improvement is oriented **candidate versus issued champion**, reversing the matched report's primary-minus-reference convention where appropriate. Review readiness requires a positive game-bootstrap lower bound for candidate Brier improvement, mean improvement above 0.0025, and log-loss lower bound no worse than -0.003. A ready report is advisory: `promotionAllowed` remains false and approval is required. Game-cluster intervals do not remove date/team dependence, and repeated independent trials still require attention to multiple testing.

This initial protocol covered pinned **ML** trials. The [hybrid continuation](SPORTS_HYBRID_SELECTION_PROTOCOL.md) extends preregistered artifact-specific research review to hybrid source recipes. Executable baseline/challenger collection and league-specific calibration remain unfinished. No activation CLI or automatic deployment is provided.

## Commands

Use a real, adequately sourced artifact and an **isolated prospective research journal**. Never create placeholder model weights to satisfy registration. Paths below are examples inside ignored research storage; the isolated collector still needs operational validation.

Create a private plan JSON with `id`, `sport`, `league`, `horizon`, future ISO `start` and `end`, and optional `minimumGames`/`minimumDates` at or above the protocol minima. The CLI reads the verified artifact and supplies its identity, trained-at time and last training-label time; it uses the actual current time and has no backdating switch.

```powershell
npm --prefix sports-bot run research:selection -- --action=register --directory=./sports-bot/data/research/isolated/selection --model-file=./sports-bot/data/research/isolated/local-ml-models.json --spec=./sports-bot/data/research/isolated/selection-plan.json
npm --prefix sports-bot run research:selection -- --action=finalize --directory=./sports-bot/data/research/isolated/selection --id=trial-001 --journal=./sports-bot/data/research/isolated/prediction-journal.jsonl
```

Finalization checks the journal hash chain before evaluation. The scripts contact no providers, post no Discord messages, place no orders and modify no production learner or registry. Keep their ledger, pinned artifact and resulting reports private and archived together.

## Verification and remaining evidence

The full Sports suite now has **167 passing tests**; syntax checks pass. Ten new tests cover held-out-label invariance, unavailable/purged labels, modified/future artifacts, immutable/disjoint registration, one-time review with correct improvement direction, pending outcomes, wrong artifacts, corrupt state/locks, reused games, pinned-model changes and an actual isolated CLI register/read workflow. Existing promotion tests now distinguish explicit reviewed activation boundaries from default research-only behavior.

All new trial data are clearly synthetic fixtures. No real trial was registered, no real holdout was consumed, and no improved accuracy or wagering expectancy is established. Remaining work includes evidence-ensemble feature-learning chronology, hybrid selection governance, sport/league calibration, real timestamped odds and realistic costed outcomes, isolated prospective collection, and verification of the actual hosting/runtime/model state. No deployment or model promotion occurred.
