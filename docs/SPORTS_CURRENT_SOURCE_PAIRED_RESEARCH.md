# Current-source paired observation and request evidence

## Scope and preserved experiment

The original NHL Daily selection trial remains frozen at v6.0.52. Its declared evaluation window cannot be turned into another independent holdout by opening a new directory. This phase instead records a separately labelled **cold-start operational paired observation**, with no selection registration, promotion or independence claim. The original trial, source archive, plan, forecasts and Stocks schedule were preserved.

Before collection, a private plan declared exact sources, current Chicago date/dayOffset0, the first returned eligible NBA/NHL/NFL/MLB observations, a 120-second paired receipt limit, maximum 32 public requests per worker and 120-second worker timeouts. Unmatched, withheld and failed cases remain visible. Both roles use separate empty state and the same explicit research configuration; this is not a reproduction of a deployed learner.

## Confirmed runner gaps and infrastructure changes

The paired runner previously omitted explicit live-trading/emergency-stop flags and left `AUTO_LEARNING_ENABLED` at its default. It imported no order client, but its stated isolation policy was not fully enforced in child configuration. Both new child environments now require live trading false, emergency stop true and automatic learning false. Account tokens are not inherited, and the worker refuses unsafe flags. This changes the research profile; older studies are not relabelled as if they used it.

[`prospective-network.mjs`](../sports-bot/scripts/prospective-network.mjs) is copied and hash-pinned beside each newly prepared worker. It permits anonymous HTTPS GET requests on the three existing public ESPN/NHL hosts, rejects credentialed/nonpublic/nonstandard-port requests, forces redirect rejection and credential omission, caps each worker at 32 requests, and blocks all transport in offline mode. It does not add a provider, subscription or access-denial workaround.

Each allowed attempt writes its intent before transport. Local response/failure receipts record status, time and latency; blocked requests have sanitized reasons. Error text and rejected credential values are not saved. A summary refuses unfinished requests and closes the request gate before asynchronous sealing, preventing a new request from racing its final hash. Response bodies are **not** archived by this network layer; provider caches and frozen slate inputs remain separate. These are local receipts, not server publication authentication or power-loss durability guarantees.

Worker captures bind exact request-ledger bytes by hash/length. The paired loader checks that evidence before accepting new-policy captures. Support-file tampering and changed request ledgers reject. Existing older manifests/captures remain readable under their original weaker evidence scope; no network proof is manufactured for them.

## Actual current-source collection

| Item | Baseline | Challenger |
| --- | --- | --- |
| Source | `1185e178f34c26ee0d2f80c2b06d6f293f4d0eed` | `fd7d86ef8f7385bbaecd8de82384bd80a80f7f2f` |
| Model | v6.0.0 | v6.0.59 |
| Collection start UTC |2026-10-24 08:28:08.230 |2026-10-24 08:28:09.533 |
| Collection completion UTC |08:28:09.428 |08:28:11.251 |
| Games / pregame forecasts |12 /12 |12 /12 |
| Network requests / failures / policy blocks |16 /12 /0 |23 /6 /0 |
| HTTP responses |4×200,11×403,1×404 |17×200,5×403,1×404 |
| Sum of request-header latencies |3279 ms |2443 ms |
| Per-game evidence reports |0; legacy coverage unknown |12; all incomplete |
| Retained side records |0 |24 |
| Calibration samples per forecast |0 for all12 |0 for all12 |
| Recommendation statuses |12 withheld |6 directional leans,6 withheld |

Concurrent request latency sums are not elapsed scan duration. The paired issuance gap was **1,875 ms** for all twelve pairs, within the declared bound. All eligible games were NHL. Current injury coverage and confirmed critical starters remained unavailable; missing legacy reports are unknown rather than verified zero coverage.

Neither role emitted a normal actionable prediction. The current source recovered record inputs, but its zero calibration samples cannot support calibrated-probability or predictive-improvement claims. Directional leans remain uncertain forecasts rather than qualified wagers.

There were 39 ordinary free-provider requests in total, zero paid requests, zero orders, zero Discord messages, zero model promotions and no production changes. Raw captures, manifests, support hashes, source files, source caches, receipt chains, request audits and the pre-collection plan remain private. The original v52 trial journal hash was identical before and after this collection.

All twelve games overlap the original v52 study. They must **not** be pooled as 24 independent games or promoted as a fresh selection holdout. At collection no final had been observed. Proper-score/accuracy and economic performance remain unestablished; the report permits no promotion. Changed probabilities or fewer failed HTTP calls do not establish predictive improvement.

## Data-window finding

A read-only audit of the saved CDN cache found HTTP200 and 12 NBA events, one MLB event and 14 NFL events. Their starts do not establish eligible games for the requested current Chicago day: NBA/MLB observations are from the preceding local day, and NFL spans its weekly slate. The daily filter correctly kept them out. The request used the existing `dates=20261024` parameter. The response's date-selection semantics and whether additional current-day coverage is available still need investigation. No undocumented parameter was guessed, extra request made or no-games conclusion substituted for this coverage gap. NHL native fallback supplied the twelve eligible games.

## Verification and remaining work

Pre-edit baseline: **1,049 tests passed**. Eight request-policy/receipt tests were added. A closing-race test failed before its fix; expanded archived-worker tests verify explicit flags, offline transport suppression, request-ledger tampering and pinned-helper changes. Full `npm test`: **1,057 passed**, zero failed/skipped. Syntax: **213 project files**. Post-commit source/receipt/archived-worker checks: **42 passed**. Whitespace and configured-secret/Gitleaks checks passed.

Forecast model identity remains v6.0.59: these are collection, configuration and evidence changes. Exact source-bound artifact hashes change with source bytes; old approval cannot silently certify a new source. No current-version accuracy, calibration improvement, profitable price edge or deployment is established.

The [phase checklist](SPORTS_CURRENT_PAIRED_CHECKLIST.json) preserves pending work: obtain valid subsequent finals, retain unsuccessful cases, resolve the observed provider-window/mapping and medical/starter gaps, and establish sufficient independent league/horizon/calibration evidence under the selection protocol. Live trading remains disabled and Stocks tests stay scheduled. The complete Sports specification remains ahead of Crypto then Stocks.
