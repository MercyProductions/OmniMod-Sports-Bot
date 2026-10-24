# Native NHL naming and real offered-price collection — v6.0.56

## Confirmed integration defect

The free native scoreboard uses common names such as Ducks/Flyers. The Odds API names the same sides Anaheim Ducks/Philadelphia Flyers. Event matching, h2h bookmaker parsing and spread parsing previously recognized only the local name/abbreviation. Even after the event was identified elsewhere, the book's full outcome names were rejected. Four existing-path failures reproduced this through event matching, h2h prices, spreads and the actual explicit-refresh flow.

`nhlTeamIdentity.js:6` now parses the existing first-party NHL event landing response into a scoped naming record. It requires the exact native event/start, season where declared, both native team IDs, abbreviations and matching common names. The additional name composes that response's place-name and common-name fields. It is not a fuzzy search or a hand-maintained nickname table.

`oddsTeamNames` revalidates the retained minimal source event at consumption. A receipt from the future, one older than15 minutes, a changed game/team binding, missing names or a started event cannot supply the extra name. Arbitrary local alias lists cannot supply this evidence. Existing primary names remain supported, ordered sides remain mandatory, source conflicts/duplicate event reuse stay rejected, and display names are preserved.

Event, h2h and spread consumers use the same naming evidence and information cutoff. The explicit quote-refresh path passes its controlled cutoff consistently. The existing goalie-context fetch also extracts naming evidence from its already requested response, so the main pipeline adds no extra HTTP call for that extraction. The per-game evidence report records the identity receipt separately. It grants **no confirmed goalie, injury coverage or confidence bonus**.

The existing `NHL_GOALIE_CONTEXT_MAX_GAMES=6` request budget and maximum12 remain unchanged; zero now disables both extra naming and season-goalie context through that fetch. Thus normal default coverage remains bounded to six selected native landing responses per scan. The separate one-shot research profile explicitly requested twelve. Broader cheap team metadata, non-ASCII naming coverage and full-market/league completeness remain unverified; this repair is not a declaration that every game receives complete data.

## Actual authorized research collection

The existing key was read privately from its original local file without copying it into the repository or changing credentials. The [provider's v4 documentation](https://the-odds-api.com/liveapi/guides/v4/#get-sports) describes catalogue/event endpoints as quota-free and h2h odds for one region/market as one usage credit. The initial catalogue returned HTTP200, active NHL coverage,500 credits remaining,0 used/last cost. The actual entitlement/plan type and historical-data rights were not inferred from that quota.

A separate private one-shot reservation was created before collection, with a one-request cap, one US h2h market and a24-hour research cooldown. It inherited no Discord/broker credentials, disabled live trading and learning, recorded exact processor-file hashes, and reserved budget through the existing quote-refresh audit. It was **not** installed as a recurring paid collector. Production/admin refresh defaults and the hourly free trial were not changed.

At **2026-10-24T06:43:08.307Z**, the run had:

| Measurement | Actual observation |
| --- | --- |
| Candidate associations to the provider event list |0/12 before naming evidence;12/12 afterward under the existing60-minute context tolerance |
| Native landing responses |12; no injury/starter field paths found in this inspected set |
| Priced games / structurally accepted books |12 /5–9 books per game |
| Fresh best side quotes |24 |
| Quote request / reported usage |1 /1 credit; remaining500 to499 |
| New price observations |12 in a separate research journal |
| Qualified opportunities / orders / Discord posts |0 /0 /0 |
| Independent new forecasts |0; original forecasts were copied unchanged with an explicit source binding |

There were three quota-free Odds API catalogue/event requests across preflight and collection,12 public NHL requests and one credited quote request. Raw responses, receipts, usage headers, processor hashes, source hashes and failure/reservation state are private outside Git. The research journal starts with an exact copy of the original12 frozen forecast records and separately appends price observations; its source-binding receipt labels those copies as neither independent forecasts nor production-learning data. Original capture/journal bytes and credentials remained unchanged. No predictive trial, model activation or production instance was started.

**Schedule agreement is incomplete:** only3/12 provider times exactly equal the NHL starts. Nine are within the existing context tolerance, including ten-minute differences and one50-minute difference. The causes were not verified or silently normalized. A candidate context association is not exact schedule agreement or an execution-qualified identity. The stricter original-price economic evaluator still requires exact frozen start agreement if a decision otherwise qualifies. These discrepancies need further source investigation; no timing or value gate was relaxed.

The initial one-shot harness explicitly pinned `options.now` before the HTTP response, causing24 receipt-after-cutoff reasons. This was a harness clock choice, not a defect in the normal live path: without that override, `refreshValueQuotes` uses its post-response clock. The captured observations were retained unchanged. A separately labelled retrospective computation at the recorded receipt plus one millisecond removed those24 clock reasons but still qualified **zero opportunities**, without another API call or any backdated journal append. Two added default-live-clock controls verify post-receipt evaluation and the six-hour model-age boundary. A corrected future harness was prepared, but this one-shot reservation was not restarted.

The shadow value audit contains **zero qualified price scenarios** and24 missing-qualified-decision exclusions across copied forecasts/new price observations, with unchanged journal hashes. Zero-cost inputs were explicit absence-audit assumptions, not verified free fees. Actual paper performance remains null. Existing zero calibration/weak evidence gates still withhold all opportunities despite observed prices.

## Verification and remaining scope

Pre-edit baseline: **986 tests passed**. Four prior-source integration failures reproduced. Twelve tests added: four recovered integrations plus controls for native IDs/season/roles, arbitrary names, receipt/expiry/start limits, cutoff protection and absence of a health/probability bonus and default live receipt clocks. Focused source/price tests passed **50 tests**; full default-parallel suite passed **998**, zero failed/skipped. Root syntax checks206 project files, and whitespace checks pass. No risk/quality/calibration threshold was lowered.

Development model identity is **v6.0.56**, because repaired joins can change available market inputs. Improved predictive accuracy or after-cost performance is not established. Existing v6.0.52 trial source, source archive and plan/artifact are unchanged; original evidence was not rewritten; this separate price capture does not validate v6.0.56. Missing injuries/confirmed goalies, start discrepancies, broader coverage, adequate independent forward/calibration evidence, native scoreboard record omissions and operational host proof remain unfinished.

Sports remains in progress before full queued Crypto then Stocks. No merge, deployment, production startup, model promotion, credentials change, order or Discord post occurred. Live trading remains disabled. The Stocks schedule remains active and unchanged; cPanel remains excluded.

A checked additional frozen-collector invocation completed at2026-10-24T06:58:56.840Z after confirming the prior run was terminal and no worker/owner was present. It appended a second capture receipt, retaining25 provider blobs,12 distinct games and zero finals;10 free-provider requests/three failures were recorded. This was an actual current-time invocation, not a backdated missed window or proof that every scheduled wake ran. The schedule remains dependent on the PC/Codex host, and no recurring paid collector was added.
