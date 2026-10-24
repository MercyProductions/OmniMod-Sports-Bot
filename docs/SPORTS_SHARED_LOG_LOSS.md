# Shared log-loss contract

## Confirmed report inconsistency

Registry candidate scoring, historical replay and horizon evaluation still clipped actual-outcome probabilities into [0.001, 0.999]. This disagreed with the repaired local ML scorer, matched journal evaluator and operational monitor. It capped surprising-outcome loss and imposed a positive loss on correctly certain forecasts. The same frozen unlikely outcome could therefore have different reported log loss solely because of the report path.

## Implementation references

- `sports-bot/src/probabilityLogLoss.js:4`: shared finite [0,1] validation and numerical floor 1e-12, with no upper clipping. Invalid inputs fail without echoing their contents.
- `sports-bot/src/modelRegistry.js:40`: candidate scoring uses the shared calculation; report exposes `logLossProtocol`.
- `sports-bot/src/historicalReplay.js:54`: replay scores use the same calculation; report exposes protocol metadata.
- `sports-bot/src/horizonEvaluation.js:157`: horizon loss uses the shared calculation; obsolete local clamp removed.
- `sports-bot/src/localMl.js:160`: baseline and fitted challenger scoring share the helper.
- `sports-bot/src/matchedJournalEvaluation.js:37` and `sports-bot/src/operationalDrift.js:68`: equivalent existing 1e-12 arithmetic delegates to the helper.

Registry/replay/horizon outputs label the protocol `multinomial-log-floor-1e-12-v1`. Existing local ML and journal score descriptions remain applicable. Prior stored reports and original forecasts are not rewritten. Brier score units and cohort policies have not been unified by this change; different score populations cannot be compared simply because arithmetic now agrees.

## Verification

- Unchanged baseline: 706 passed.
- Six added tests; four report integration tests fail against prior report sources. Two utility tests exercise the new helper's boundary and invalid-input contract.
- Focused scoring, historical replay, ML, journal and operational tests: 66 passed.
- Full suite: 712 passed, zero failures/skips. Syntax and whitespace checks pass.
- Golden fixture: registry, horizon, matched and operational reports agree on -ln(0.0001), approximately 9.21034. Earlier registry/horizon reporting capped this at -ln(0.001), approximately 6.90776.
- Actual replay function integration uses three synthetic NFL results, with the final tied game following two warm-up games. Its binary forecast's zero-probability draw now receives -ln(1e-12), approximately 27.63102. This is a synthetic fixture, not a real game or actual performance result.
- Probability one scores zero loss; malformed values throw a redacted validation message. Caller fixtures remain unchanged.

## Remaining requirements and authorization

No forecast values, model weights, risk thresholds, production registry, source datasets, Discord runtime or jobs changed. Corrected evaluation can affect future research rankings; old/new metrics must retain their protocol context, and consumed holdouts must not be reused for selection. Nothing is promoted automatically.

Candidate outcome-class declarations, malformed-vector normalization in legacy descriptive paths, historical feature availability and temporal/result identity still require separate audit. Universal source/settlement provenance and adequate independent prospective outcomes remain unfinished. The shared arithmetic is not evidence of improved prediction quality or economic performance. Sports remains offline; installed state/startup unverified. No merge, deployment, promotion or live trading. Sports in progress; Crypto then Stocks queued.
