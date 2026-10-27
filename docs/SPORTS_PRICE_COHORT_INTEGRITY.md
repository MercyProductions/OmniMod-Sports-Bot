# Original-price cohort integrity — report v2

## Confirmed defects and repair

The price-research reporter had not received the same identity, chronology and conflict protections as the forecast evaluators. Twelve new regression scenarios failed against its prior implementation. The repairs affect read-only research eligibility, not the forecasting model, value-policy thresholds or execution.

| Failure | Current implementation |
| --- | --- |
| Last-write forecast Map could retime an original issue, substitute different probabilities or lend a provisional copy's quote to an issued forecast. | `priceResearch.js:28` uses the shared forecast identity audit across all visible copies, retains the earliest identical issue and quarantines contradictory IDs. Only canonical ISSUED/observed-pregame records contribute decisions. |
| A quote observation with the same event/guild could borrow another model/generation despite claiming the original forecast ID. | `priceResearch.js:60` requires exact frozen-model linkage, model version and generated instant as well as event/league/guild identity. The journal already emits those fields; older incomplete snapshots remain unverified. |
| Host-local/date parsing and conflicting timestamp aliases could certify a different decision/quote time. Quotes received later could be used in an earlier evaluation. | Strict explicit-zone receipt/generation/evaluation clocks; explicit minute precision remains supported for event starts. Original/normalized quote aliases must identify the same instant, and quotes cannot postdate the frozen evaluation. Existing15-minute freshness/six-hour model-age bounds remain. |
| Missing class metadata, numeric strings or loosely conserved mass could enter cost calculations; same-book conflicting duplicates were chosen by array order. | `priceResearch.js:79` reuses frozen outcome-vector validation, requires declared classes, respects two/three-way settlement and rejects incompatible same-book prices at the selected instant. A verified provider bookmaker key is required. Equivalent timestamp aliases and declared binary structural zero remain supported. |
| Equal-time first decisions from guild copies could be selected arbitrarily; a later resolved/advantageous record could replace the original issue. | `priceResearch.js:99` quarantines conflicting earliest decisions and freezes the first unambiguous valid decision per canonical league/event/start/model **before** looking at outcomes. No later resolved fallback. |
| Contradictory event labels or a malformed later result could leave a favorable assumed return. | Result chronology/identity is checked, invalid later labels shadow older labels, open conflicts require linked reconciliation, and event-wide contradictions across model/guild copies suppress returns while retaining original quote evidence. `resultExclusionReason` is explicit. |

Report schema is **sports-frozen-price-research-v2**. Model identity remains **v6.0.55**, unchanged by this reporting phase. No original prediction, probability, price, journal or model artifact was rewritten. This is a stricter interpretation of retained evidence, not retroactive repair of missing evidence or source authentication.

## Scoped, historical read-only audit

The CLI accepts `--as-of=<explicit-zone-ISO>`, `--league=<native-league-key>`, `--horizon=<recorded-horizon>` and `--model-version=<exact-version>`. Omit a scope to include all available values. Example from the repository root:

```sh
npm --prefix sports-bot run audit:prices -- --journal=/private/path/prediction-journal.jsonl --as-of=2026-10-24T06:22:23.108Z --league=nhl --horizon=Daily --fee-per-stake=0 --commission-on-profit=0 --profit-haircut=0
```

Zero costs here are explicit illustrative assumptions for an absence audit, **not verified free execution**. Actual cost sensitivity still requires appropriate bounded per-stake/per-profit assumptions. The command verifies the journal hash chain and never calls a provider, bookmaker, Discord or order endpoint. Invalid arguments yield a sanitized error. Keep private reports out of the public repository.

Scopes apply before first-decision selection; the result still exposes event-wide label contradictions from the visible journal. `byCohort` separates selected records by model/league/horizon. Default selection remains the first valid event/model decision across horizons/guilds, so the subgroups describe that selected subset rather than all possible horizon opportunities. Separate scoped reports can overlap and must not be pooled as independent games or a combined portfolio.

## Actual evidence

A real read-only audit at **2026-10-24T06:22:23.108Z** inspected the preserved13-forecast v6.0.45 next-day challenger journal and the12-forecast frozen v6.0.52 trial journal. Both produced **zero supported price scenarios**, with13 and12 `no_frozen_qualified_price_decision` exclusions respectively. Both original SHA256 values remained unchanged. No provider request or credential access was needed.

The current trial's frozen capture independently confirms12 unavailable price snapshots and zero calibration samples for all12 forecasts. Its value-analysis record lists missing price/settlement/calibration/quality support and has no qualified opportunity. Later price-validation gates are not claimed to have passed or failed when the report stopped at the absent-decision gate. These counts are not zero observed P&L and do not establish positive or negative strategy expectancy. The synthetic win/loss cases in tests are method checks, not market performance.

## Verification and limits

Pre-edit default-parallel baseline: **966 tests passed**. Twelve prior-source failure scenarios reproduced. Twenty tests added overall:18 integrity/selection/chronology controls and two actual CLI checks. Focused source/price/journal suite: **77 passed**. Full default-parallel suite: **986 passed**, zero failures/skips. Root syntax parses204 project JavaScript files; whitespace checks pass. Existing positive price fixtures now explicitly declare the same class and exact-model linkage metadata emitted by the journal; their expected quote/return behavior is preserved.

Still unverified: offered-price acceptance, stake limits, actual fills/fees, bookmaker-specific void/overtime terms, source publication truth and statistically adequate independent after-cost performance. The report always leaves actual paper performance/realized profit unset and promotion disallowed. Existing source denials, unknown injuries/confirmed goalies and limited calibration data remain unresolved.

The hourly v6.0.52 trial, source archive, original plan/artifact and retained first evidence receipt remain unchanged. Sports stays in progress before the full queued Crypto then Stocks work. No merge, deployment, production startup, model promotion, credential change, orders or Discord posts occurred. Live trading remains disabled; the Stocks automation remains active and unchanged. cPanel remains excluded.
