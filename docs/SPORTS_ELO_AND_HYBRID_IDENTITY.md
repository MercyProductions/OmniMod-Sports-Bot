# Elo result conflicts and hybrid recipe identity — development v6.0.5

## Confirmed repairs

The previous Elo duplicate key included score values. Two conflicting score versions for the same dated matchup therefore became two updates rather than one unresolved event. `selectEloResults` now consolidates same-event cross-source copies before applying Elo. Conflicting scores, known neutral-site assertions or season-year assertions quarantine the event. Repeated exact source IDs with different start times quarantine the matchup rather than treating a reschedule as a second event. Learning-context diagnostics include selected, duplicate, conflicting, invalid and ambiguous-result counts.

Known distinct start times preserve same-day doubleheaders. Date-only copies cannot be assigned to one of several timed games and are excluded as ambiguous. A dated legacy matchup without times can provide at most one update, with explicitly limited identity evidence. This does not recover unknown doubleheaders or resolve team alias/provider ID mismatches. Such coverage needs authoritative event identity and source reconciliation; the code does not choose whichever score happens to help a model.

The hybrid registry previously checked a review's hash format and matching stored strings but did not bind the approval to the running hybrid implementation or blend weight. `hybridArtifactId` freezes a source manifest at module startup and binds its hash to current model identity, sport and specialist blend weight. The manifest hashes local `src/*.js` bytes, requires the central implementation files, and never hashes environment values, credentials or mutable private state. Missing source support returns no artifact rather than silently accepting approval.

Registry reads and explicit promotion decisions now require a hybrid approval to match that recipe. Source/version/weight changes require new review. Shadow forecasts freeze the current hybrid artifact ID even when the candidate is inactive. Runtime registry refresh still cannot promote a challenger automatically. Source identity is intentionally conservative: even unrelated source/comment changes invalidate the recipe's prior approval.

This recipe identity is not a complete snapshot of learned state, provider observations, runtime dependencies or binary execution. Concurrent in-place source editing during startup is not supported; deployments must use an immutable release directory and restart explicitly after approval. The existing preregistered selection workflow supports local ML artifacts, not yet a complete hybrid trial. This phase prevents mismatched hybrid activation but does not claim hybrid selection governance is finished.

## Verification

197 baseline Sports tests reproduced at `ea3dfa63df6bd4531c2913e4d4e240c8744022d7`. Current suite: 205 passing, zero failures/skips; configured syntax and whitespace checks pass.

Regression tests cover identical cross-source copies; conflicting scores and venue facts; input-order stability; distinct timed doubleheaders and ambiguous untimed copies; rescheduled IDs; sport/weight-specific recipe IDs; stale or arbitrary approved hashes; explicit unsupported promotion; and a fresh child process detecting modified source bytes and missing implementation in an isolated temporary copy. Original source and production state are untouched by the mutation fixture.

The development prediction identity is v6.0.5. Earlier frozen predictions retain their original identity and probabilities. No real provider data, Discord messages, deployments, orders or promotions were initiated in this phase. No improved accuracy or profitability is established.

## Remaining goal work

Finish point-in-time feature/source review, hybrid prospective selection integration, actual deployed-host inspection, isolated prospective baseline/repaired-model collection, and the full requirement-to-evidence map. Actual matched outcomes and after-cost evidence are still needed. Sports remains in progress before the queued Crypto and Stocks work.
