# Observed spread/total markets and settlement evidence

Development identity: v6.0.45. This phase repairs provider line context and evidence labeling. It does not introduce spread/total strategies, wager execution, new prediction weights or relaxed value/risk gates.

## Confirmed defects

The former `src/sportsData.js` selector independently chose median-nearest quotes for each side. Partial books could skew those medians differently, producing an away/home spread pair or over/under pair that no bookmaker offered. Duplicate observations could change selection by array order. Unknown outcome names, shared/empty aliases and malformed lines could enter the context. Any minimum point, including a positive or zero point, could be labeled the favorite.

## Repairs

- `src/bookmakerIntegrity.js` exposes its existing provider grouping/conflict checks as `collectProviderMarkets`; h2h parsing still uses the same validation and mathematics. `src/lineMarketIntegrity.js` reuses those checks for spread and total markets.
- Outcomes must map unambiguously to ordered team aliases or the exact Over/Under labels, with valid American prices and measured points. Unknown, malformed or conflicting duplicate outcomes reject that market/book. Complete spreads must have opposite points; complete totals must have equal nonnegative points. These are the supported context shapes, not assertions of every possible market's settlement rules.
- Complete books take precedence over partial ones. Selection chooses **one actual book** nearest the complete-book median, with provider-key tie breaking. Both displayed sides retain that book's original price/point/time combination. Duplicate identical observations coalesce; conflicts cannot increase weighting.
- If only partial books exist, one observed partial book remains available as `partial_context`. Missing sides are not assembled from another book. Only a negative spread side is labeled the favorite. Pick-em zero and partial quotes are explicitly labeled in prediction line text.
- Daily odds enrichment retains `lineMarketIntegrity`. Journals and warehouse prediction/market snapshots freeze the selected `lineMarkets`, integrity evidence and settlement metadata. Original winner forecasts remain unchanged by evidence persistence.

The h2h `rules` field remains a modeled scope classification. New `settlementEvidence` identifies its source as `sport_profile_and_outcome_set`, with `bookSpecificTermsVerified: false` and `executionVerified: false`. Value analysis preserves that distinction; legacy labels are explicitly legacy/unverified. This does not claim that book-specific overtime, void, push or other terms have been independently checked.

## Verification

Reproduced baseline: **606 tests pass**. Restoring the previous line selector reproduced **ten targeted failures**, including actual daily enrichment producing a mixed spread pair. Repaired full suite: **618 passed, zero failed/skipped**; syntax and whitespace checks pass.

Twelve new tests cover single-book paired selection, duplication/conflicts, inconsistent lines, alias/name/point validation, deterministic ties, partial context, pick-em, settlement provenance, actual daily enrichment and durable journal/warehouse evidence. Existing h2h and bookmaker-integrity tests also pass after extracting shared validation.

```sh
npm test
npm run check
# From sports-bot/:
node --import ./test/setup.js --test test/line-market-integrity.test.js test/bookmaker-integrity.test.js
```

Responses are injected fixtures, not paid provider calls. No Discord login, wager or real-money order was made. Tests demonstrate data handling; they do not establish improved forecasting or profitability.

## Limits and deployment requirements

This selects representative observed context, not the best executable wager, arbitrage pair or line-shopping strategy. It does not model spread/total win distributions, pushes, half wins/losses, quarter-line settlement, book limits or fees. Partial books remain incomplete; the retained timestamp is not proof of current availability. Existing free-feed line adapters are not reconstructed or independently verified by this provider-parser repair.

Book-specific settlement terms, source publication truth and actual host/configuration/jobs remain unverified. Cache transactions, controlled legacy result-baseline adoption, complete provider-attempt coverage and sufficient independent prospective accuracy evidence remain unfinished. Deployment requires separate approval, private-data backup and isolated host validation.

Sports remains in progress, followed by the full Crypto and Stocks specifications. No merge, deployment, model promotion or live trading; cPanel excluded.
