# Prospective receipt selection and real final reconciliation

## Confirmed defects and repair

Equal-time first forecasts and final observations depended on capture array order. A later array element could hide conflicting frozen forecasts, winners, exact scores or a source association conflict. A clean duplicate could erase earlier ambiguity.

- `sports-bot/src/captureObservationSelection.js:2` selects by parsed receipt time. Conflicting equal-time signatures stay ambiguous; equivalent ties use receipt-hash ordering without mutating inputs. Only a strictly preferred receipt time replaces prior ambiguity.
- `sports-bot/src/prospectivePairs.js:148` retains the earliest validated forecast per role/event/horizon; line 155 excludes ambiguous first captures without substituting a later forecast. Invalid vector/pick observations are rejected before this selection; this is not an all-attempt cohort.
- `prospectivePairs.js:127` and line 132 apply latest-receipt selection to final-source conflicts and exact winner/score signatures. Both roles must still agree. A strictly newer agreeing final can resolve an older ambiguous observation in this isolated research report; it does not adjudicate production records.
- `prospectivePairs.js:205`, line 208 and line 219 use the same policy in the final-query planner. Ambiguous first inputs are excluded explicitly at line 229.

Report schema is now `sports-isolated-paired-report-v4`, with an explicit receipt selection policy. Raw capture/receipt schemas and the raw emitted-outcome adapter remain unchanged. Model identity remains v6.0.45; strategy, production risk controls and archived source pins are unchanged. Direct array APIs require the authenticated receipt/manifest loader at the boundary.

## Verification

Reproduced unchanged baseline: 799 tests passed. Ten added tests cover both input orders, sticky tie conflicts, exact-score disagreements despite the same winner, within-source conflicts, no later fallback, as-of cutoffs, independent scheduled starts, stable equivalent ties and input immutability. Eight targeted regressions fail against the preceding implementation.

Focused command from `sports-bot`: `node --import ./test/setup.js --test test/capture-receipt-selection.test.js test/prospective-pairs.test.js test/capture-vector-adapter.test.js` — 39 passed. Full `npm test` — 809 passed, zero failures/skips. `npm run check` and whitespace checks passed. Tests establish the exercised integrity behavior, not improved predictions.

## Real final collection

At 2026-10-22T04:48:28–29Z, isolated final-only workers reconciled the earlier v6.0.45 study, pinned to baseline `1185e178f34c26ee0d2f80c2b06d6f293f4d0eed` and challenger `1ffc59452dc387d65f7c5cd1355015376684a6f0`. Each role fetched two eligible NHL finals from the official fallback. Primary HTTP 403 and CDN HTTP 404 remain observed source-access failures. No Odds API request occurred.

Final scores were 3–1 for event `nhl-2026020152` and 1–5 for `nhl-2026020153` (away–home). The report at 2026-10-22T04:48:44.556Z scores two matched games: baseline and challenger each have accuracy 0.5, Brier 0.250961 and log loss 0.695072884138028. All three differences are zero; confidence intervals remain unavailable for this tiny sample. There are no remaining final-query tasks for this study. These are actual final observations, not fixture scores.

Original manifest and two pregame captures retained their SHA-256 hashes. The receipt ledger retains its exact original byte prefix and appends two new final-only captures; the original ledger is also backed up privately. No forecasts were regenerated. Raw captures and local paths remain private.

The separate next-day study remains 13 unresolved pairs (12 NHL, one NFL) as of 2026-10-22T04:47:08.874Z, with 26 not-started role observations and zero final-query requests. Its manifest, original captures and ledger hashes remain unchanged. Studies overlap: 17 pair records represent 15 distinct games, not 17 independent observations. Do not pool them naively.

## Remaining limits

Two resolved games on one event date cannot establish calibration, superiority, deterioration or profitability. Both versions produced identical probabilities here. Missing lineup/injury evidence, provider access, independent feature timestamps, broader league coverage, correlated game-day/team effects, valid model-selection evidence and actual offered-price settlement research remain incomplete. No offered-price, cost-adjusted wagering performance was measured.

Sports is user-confirmed offline. No startup, deployment, merge, model promotion, Discord delivery or real-money execution occurred. Sports remains in progress; Crypto then Stocks remain queued.
