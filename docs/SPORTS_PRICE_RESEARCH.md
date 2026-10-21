# Frozen original-price research — development checkpoint

## Confirmed defects and repairs

- `sports-bot/src/oddsValue.js:24`: malformed probability vectors could previously produce apparent value from individually valid components. Incomplete, out-of-range or non-normalized vectors now withhold value qualification.
- `sports-bot/src/oddsValue.js:48`: missing or unknown timestamp provenance previously passed the quote-freshness test. Only explicit provider-update timestamps now qualify. A fetch receipt is not a verified quote timestamp.
- `sports-bot/src/oddsValue.js:25`: an already-started provider event now withholds value even if the local schedule still says pregame. Existing evidence, calibration, freshness, liquidity and stress thresholds were not lowered. Eligibility changes are value-policy version 2.
- `sports-bot/src/predictionJournal.js:76`: freezes the original price decision, original offered formats, event mapping and provenance. Administrative quote refreshes now append linked price observations through `prices_only` rather than creating winner forecasts (`:141`). Ambiguous links remain unlinked audit evidence. Retries deduplicate independently of their new receipt time, including after journal reload.

## Read-only report

From the repository root:

```sh
npm --prefix sports-bot run audit:prices -- --fee-per-stake=0.01 --commission-on-profit=0.02 --profit-haircut=0.01
```

These numbers are illustrative assumptions, not actual tariffs. All three assumptions are mandatory; explicitly use zero if appropriate. An optional `--journal=/private/path/prediction-journal.jsonl` selects a private integrity-checked journal. The command does not call providers, Discord, a bookmaker or an order endpoint. Do not publish reports containing private guild/event records without review.

The analysis selects the first eligible frozen qualified price decision per game/model version before examining the result. It requires verified pregame chronology, matching event/start identity, original prices and a complete synchronized market from the same bookmaker. It never substitutes closing odds. American and explicitly declared decimal formats are normalized without guessing.

De-vigged same-book probabilities provide a market reference. Offered payout odds already contain the bookmaker margin; the margin is not deducted again as an execution cost. Assumed win return per unit is `(decimal - 1) * (1 - haircut) * (1 - profitCommission) - stakeFee`; loss return is `-1 - stakeFee`. Expected return weights these by the frozen probability. Neither a model-market disagreement nor positive modeled EV proves an executable profitable bet. Market-informed forecasts are identified explicitly.

Recorded `regulation_3way` and `full_game_2way` scopes remain distinct. A three-way draw can resolve a hypothetical outcome; a two-way draw, changed schedule or invalid result chronology is censored rather than forced into a loss. Missing results stay unresolved. Book-specific void, overtime and acceptance terms are not established by the current adapters; `settlementVerified` remains false unless explicitly attested in the source snapshot.

All reported returns are counterfactual cost sensitivity. Actual fills, stake limits, acceptance, taxes and portfolio commission are unverified. `executedTradesVerified` stays zero, actual paper performance/realized profit stay null, and promotion remains disabled. Reports are retrospective research, not preregistered prospective strategy evidence.

## Verification and remaining work

- Baseline before this phase: commit `07944d4696da1d0d5a28f90a414ccda3a5425474`; 167 tests reproduced before edits.
- Current full Sports suite: 178 passed, zero failures/skips; configured syntax checks and whitespace checks passed.
- Regression coverage: explicit formats, same-book margin/cost arithmetic, malformed vectors, unknown provenance, already-started events, stale/wrong-event prices, three-way draws, asynchronous quotes, unresolved/two-way ties, first-decision selection, and actual quote-refresh-to-journal linkage/deduplication.
- Local read-only report: zero eligible scenarios, no measured return or evidence of improvement. Synthetic tests establish implementation behavior only.
- No production deployment, provider requests, Discord messages, wagers or model promotion occurred during this phase.

Sports remains in progress: actual operational inspection, isolated prospective baseline/challenger collection, full repair-to-test mapping, hybrid/feature-learning chronology and real after-cost evidence still need work. Crypto and then Stocks remain queued.

## Provider references

[The Odds API v4](https://the-odds-api.com/liveapi/guides/v4/) documents explicit decimal/American format selection. [Market definitions](https://the-odds-api.com/sports-odds-data/betting-markets.html) distinguish head-to-head and three-way markets. These references do not verify an individual bookmaker's settlement, entitlement or execution terms. The shipped adapters still request American odds; explicit decimal support is a parsing capability, not a changed provider plan.
