# Bookmaker and h2h outcome integrity

Development identity: v6.0.42. This phase repairs bookmaker input handling. The complete-book de-vig formula, median consensus, probability normalization, prediction weights, existing two-book value gate, risk limits and request budgets remain unchanged.

## Confirmed defects

The former `sportsData.js` parser kept the first duplicate bookmaker/market and the last duplicate outcome. Conflicting inputs therefore changed the chosen price or consensus according to array order. Unknown or malformed extra outcomes were skipped, allowing a corrupt book to appear complete. Shared or empty aliases could map an outcome to the away side. Label-only bookmaker identities could count as independent providers. Malformed nested collections could throw during daily slate construction.

## Implemented handling

- `src/bookmakerIntegrity.js:7` maps each outcome to exactly one nonempty team alias or the explicit Draw/Tie outcome. It requires a valid price and the complete sport-appropriate outcome set. Unknown/ambiguous/invalid outcomes reject that bookmaker instead of being discarded.
- Identical duplicate outcomes, markets and bookmaker observations coalesce. Conflicting prices or source-time observations reject the affected bookmaker regardless of input order. Partial records cannot be combined to construct a book that was never offered.
- `src/bookmakerIntegrity.js:26` groups by a nonempty provider bookmaker key, normalized for casing/whitespace. Display titles remain labels rather than identities. Title-only rows are rejected. Unrelated complete books remain usable.
- `src/sportsData.js:400` consumes validated books using its existing margin/consensus arithmetic. Malformed collections yield unavailable markets with audit evidence. Spread/total iteration now guards malformed nested collections so the same provider payload cannot crash that ancillary path; spread/total strategy semantics are otherwise unchanged.
- Explicit quote-refresh audit rows contain `bookmakerIntegrity`. Daily games retain attempted-provider evidence separately from whichever market was actually retained. Journal odds, warehouse predictions and market snapshots preserve offered-book integrity; attempted-provider evidence remains separately labeled. Original pregame probabilities are unchanged.

Audit evidence includes accepted/rejected counts, canonical provider keys, reason codes, observation/coalescing counts and a bounded list of up to 100 observations. Rejected counts include identified bookmaker groups plus unidentified malformed rows; they are not a count of independently verified companies. Examples of reasons include conflicting duplicate outcome, conflicting bookmaker observations, unknown outcome, ambiguous alias, missing provider key, malformed collections and incomplete/wrong outcome set.

## Verification

Reproduced baseline: **570 tests pass**. Temporarily restoring the old parser reproduced **nine targeted failures**, including a conflicted bookmaker incorrectly satisfying the real quote-refresh two-book gate and malformed payloads crashing the actual daily builder.

Repaired full suite: **583 passing tests, zero failed/skipped**; syntax and whitespace checks pass. Thirteen new tests cover outcome/book/market duplication, unknown/malformed data, alias ambiguity, provider identity, partial fragments, preserved two-/three-way arithmetic, actual quote refresh, actual daily builder and durable journal/warehouse evidence.

```sh
npm test
npm run check
# From sports-bot/:
node --import ./test/setup.js --test test/bookmaker-integrity.test.js
```

Provider responses are injected fixtures. No paid request, production Discord login, wager or real-money order was made. These results prove parser and integration behavior, not improved forecast accuracy or profitability.

## Remaining limits and deployment requirements

Keys do not prove that different bookmaker brands are economically independent. Native team-ID crosswalks, ambiguous real aliases and market settlement still need independent evidence. Conflicting observations with different timestamps are quarantined rather than automatically choosing a supposedly newer snapshot. This phase preserves existing timestamp provenance; complete publication/fetch chronology and full settlement rules remain unfinished.

Spread/total duplicate/conflict selection is not redesigned; only malformed collection isolation was added there. Failed quote-attempt evidence is returned to its caller, but complete durable auditing through all command/process failures remains unfinished. Existing cache persistence is not a transaction across independent writers.

Deployment requires separate approval, private-data backup and isolated validation on the actual host. The running source/configuration/jobs, legacy correction baseline adoption and sufficient independent prospective performance remain unverified. Sports remains in progress, followed by the full Crypto and Stocks requirements. No merge, deployment, model promotion or live trading; cPanel excluded.
