# NHL availability snapshot refresh path

## Confirmed integration gap

At review head `4f5bdbc54efe9f4f190984129fd240fdc1e30830`, a legitimate fresh preferred-provider observation could reach the real predictor but could never complete a targeted refresh without a newly obtained ESPN summary. The original reproduction applied a scoped goalie projection through `applyAvailabilitySnapshot`, verified that `predictGame` actually selected that source, and then observed zero completed refreshes. It expected one and failed at the completion gate. No speculative source schema or real third-party feed was used for that reproduction.

Development **v6.0.68** adds a specific second freshness authority for the existing **NHL availability snapshot contract**. The ordinary fresh-summary route remains supported. This is a change to which source evidence can validate a research forecast; it is not a change to model formulas, score/confidence thresholds, risk limits or value/price requirements. It requires its own forward verification and does not authorize model promotion or deployment.

## Acceptance contract

`sports-bot/src/availabilityRefresh.js:13` checks original provider assertions and the predictor's selected inputs. A snapshot-based refresh requires all of the following:

- The existing adapter's valid event, team, native player, provider, source reference, snapshot hash, observation, receipt and expiry binding, rechecked at completion.
- The same previous event/start/team identities and a valid earlier cached forecast timestamp.
- A provider observation strictly newer than that forecast and no older than 15 minutes at completion. The adapter's general maximum is still 30 minutes; the new refresh authority is stricter.
- Ingestion during this refresh attempt, before the predictor's information cutoff; expiry after completion. A reread of an observation predating the previous forecast cannot manufacture new evidence.
- Matching prediction and input-chronology cutoffs, receipt before cutoff, generation after cutoff and completion before the event starts.
- The expected refresh horizon under the existing horizon normalization rules.
- At least one actual selected player input with the same source snapshot, event identity and original clocks. Raw provider metadata or a season goalie comparison is insufficient. Up to 64 distinct witnesses are retained; this is not a claim of complete team medical coverage.

The original cache, source-conflict, event, schedule, probability and journal-issuance vetoes still apply. A valid source update can produce an issued research forecast whose pick remains withheld or uncertain. It cannot approve a wager or place an order. Projections remain unconfirmed and health remains unknown unless an explicit supported status is supplied. An injury assertion about one player is not clearance for the rest of the team.

`pregameRefresh.js` takes one local input snapshot across asynchronous issuance. `predictionJournal.js:255` rechecks the acceptance proof against the **frozen provisional/issued inputs inside the journal write transaction before issuance**. Equal probabilities cannot conceal mismatched source evidence. Failed proof checks do not create a new eligible forecast. Matching existing issued records stay immutable; a failed retry is not permission to rewrite them.

Successful terminal attempts carry a sanitized `sourceAcceptanceEvidence` linked to the actual acknowledged forecast ID. Its fixed fields include source hashes, event-binding hashes, horizon and original clocks, without source URLs, provider keys or raw error text. Terminal serialization verifies that the cited issued forecast contains those selected inputs. `operationalAudit.js` reports linked snapshot completions, invalid terminal proofs and rejected frozen-input proofs separately. Missing legacy proof metadata is not interpreted as a successful summary refresh.

## Setup with an authorized provider

Use the existing [provider snapshot setup](SPORTS_GOALIE_INJURY_PROVIDERS.md) and local `AVAILABILITY_PROVIDER_SNAPSHOT_FILE` setting. No new token or subscription is required by this code. The user's authorized client/exporter must supply real observations and refresh the private file atomically; never advance timestamps merely to pass freshness checks. Leave the setting empty to disable the adapter. The shipped examples are deliberately inert placeholders.

The current contract is NHL-specific. It does not create adapters or entitlements for other leagues. Free NHL season leaders, stale snapshots, unverified namespaces and arbitrary metadata do not gain refresh authority. A provider label or local receipt is a supplied assertion, not independent authentication of publication or medical truth. Existing source-quality/missingness reporting remains necessary.

## Verification and actual data

Reproduced baseline: **1,222 passing tests**. The original one-case integration test failed against the old completion path after the real adapter and predictor had accepted/used the input. The final **25 new cases** cover the adapter/file/predictor/provisional/issued/terminal/audit flow, injuries versus team clearance, freshness, expiry, chronology, horizons, event/team/player identity, actual selection, original provisional inputs, prior rejection, caller mutation, retries, JSON restart, proof forgery and text redaction.

- Focused refresh/journal/provider/operational/event suite: **107 passed**.
- Full default-parallel `npm test`: **1,247 passed**, zero failures/skips.
- `npm run check`: **235 files**; CRLF-aware whitespace check passed.

These commands ran on Windows with fixture state. No alternate provider is actually connected. A byte-verified read-only inventory of the existing v67 capture found 21 games, including 12 NHL games, and **zero games with preferred-provider player rows**. It was not re-forecast or backdated. This repair recovers a previously blocked integration path, **not actual missing injury or confirmed-goalie observations**. No improvement in accuracy, calibration or profitability has been established.

The original v52 collector completed its ninth checked real invocation at **2026-10-24T14:29:09.979Z**: 12 distinct NHL games, one date, zero finals, nine receipts and 88 retained provider blobs. It made ten ordinary free-provider requests with three failures; cumulative checked requests are 97. Repeat captures are not independent games. The shared-family inspector verified both immutable trials afterward: two plans, zero finalized reports or consumed games. The registered November v67 trial remains pinned to its exact old source/artifact. **v68 is not silently substituted into either trial and is not forward-validated by them.**

The original collector, November collector, final-only reconciliation and Stocks automation files remain unchanged. No main merge, startup, deployment, credentials change, model promotion, orders, Discord posts or paid requests occurred. Live trading remains disabled and emergency stop enabled. The Sports bot is user-confirmed offline.

## Next validation

Validate a genuine authorized provider's exports and late-pregame observations before trusting this path operationally. Keep all clinical absence, publication uncertainty and source conflicts explicit. Preserve every registered trial and original forecast; adequate independent multi-date proper-score/calibration and realistic original-price/cost evidence remain pending. This phase does not complete the full Sports assignment or move Crypto/Stocks ahead of it.
