# Goalie context, injury missingness and optional provider input

## Source facts and what is working

The existing free official NHL pregame landing feed provides goalie season leaders and samples, not an event starting-goalie confirmation. A live sample for native event `2026020168`, fetched at **2026-10-24T03:55:12.465Z**, contained two goalie candidates per side. The pregame boxscore had no player-by-game goalie entries. The existing ESPN NHL injury endpoint returned **HTTP 403** through the normal bot client.

The bot now collects a bounded amount of native goalie season context and records it separately. It never turns a season leader into a projected/confirmed starter, inserts these candidates as model player inputs, assigns them health clearance, or awards a confidence bonus. Actual confirmed starters from this free sample: **0**. Injury coverage: **unknown**.

`NHL_GOALIE_CONTEXT_MAX_GAMES=6` limits sequential landing requests; 0 disables and 12 is the maximum. Existing native event ID, exact start, both team abbreviations, pregame status, season, numeric sample/stat and receipt checks apply. Invalid or conflicting player identities are excluded. Cache TTL is 15 minutes, stale fallback is disabled, and 401/403/429 stops/defer remaining work. Reports show cap omissions. Failed/missing fields remain unknown.

## Confirmed injury-data defect repaired

Manual player import previously converted an omitted availability value into **100% available**. New imports preserve `availability:null`, `status:unknown` and explicit unknown evidence instead. Numeric zero remains an actual zero. Missing/role-prior availability now increases participation uncertainty and carries `availabilityObserved:false` and a role-prior basis.

The numeric workload prior is still a heuristic internal value, not an observed or calibrated medical probability. Existing legacy rows are not rewritten: an old 100% value may have been explicit or defaulted and needs independent provenance review. Known Out/IR observations still veto participation. Native goalie season candidates do not fill confirmed-starter or team injury coverage.

Relevant sources: `nhlGoalieResearch.js`, `dataValidation.js:hasAvailabilityObservation`, `intelligenceStore.js:normalizePlayer`, `participationProjection.js`, `inputChronology.js`, and `evidenceCoverage.js`.

## Existing feeds and optional preferred providers

The user confirmed the intended configuration: retain existing free feeds and the existing Odds API integration; support another provider when a user has one. No subscription, credential, odds configuration or live-trading setting was changed. The odds integration is not presumed to provide injuries or starter confirmations.

A working provider-neutral **local JSON snapshot adapter** is available. It is not a built-in client for every commercial vendor. A user's authorized provider client/exporter must map its data into the documented contract and keep its credentials in its own local environment. No key belongs in the snapshot, repository or Discord.

1. Copy [the placeholder example](../examples/availability-provider.snapshot.example.json) outside the repository into private runtime storage.
2. Have the provider's client/exporter replace every placeholder and refresh the file atomically. Set real explicit-zone `observedAt` and `expiresAt`; the maximum window is 30 minutes. The example's future timestamps/identities deliberately cannot be used unchanged.
3. Set `AVAILABILITY_PROVIDER_SNAPSHOT_FILE` in the local `.env` to that file's absolute path. Leave it blank to disable. The adapter also works in local-only enrichment without network calls.
4. Convert provider identifiers to verified native NHL game/player identities. `playerIdNamespace` must be `nhl`; raw ESPN or vendor IDs are not guessed into another namespace. The current adapter targets NHL availability.
5. Use `kind:goalie_starter` only for an explicit event starter assertion from the provider. Use `kind:goalie_projection` for an explicit event projection ([projection template](../examples/availability-provider.projection.example.json)); it keeps confirmation false and health unknown. Do not convert season leaders or depth charts into event starter records.
6. Use `kind:injury` with one of `out`, `injured_reserve`, `doubtful`, `questionable`, `day_to_day`, `probable`, `available`. An explicit provider status is an assertion, not independent medical verification. These statuses use the existing heuristic availability scale; they are not calibrated clinical probabilities.

The source reference must be public HTTPS without embedded credentials, query parameters or fragments. The root schema is `sports-player-availability-v1`; payloads are bounded to 5,000 records and files to 2 MiB. Event start, team side, namespace, pregame eligibility and observation/expiration clocks are checked. Malformed files yield a sanitized unavailable result without echoing private contents.

Different known player namespaces cannot borrow confirmation through a matching name. Multiple starter assertions for one team are quarantined. A same-time changed snapshot removes that provider's effective assertions until a newer observation; older snapshots cannot replace newer ones. A newer full snapshot replaces only that provider's prior effective records and preserves raw observations for audit. Omitted players become unknown, not healthy. Injury records can veto a starter through conservative reconciliation. Expired provider players, lineups and dependent aggregates are excluded at inference. Unrelated manual records are preserved.

Individual injury reports do not establish complete team injury coverage. No current preferred-provider credentials/export were supplied, so real third-party starter/injury observations have **not** been verified. Fixture acceptance is not provider certification or predictive validation.

## Verification and remaining work

Baseline: 850 tests passed. Twelve goalie/missing-health tests and thirteen provider snapshot tests were added. Two targeted health regressions fail against the previous import/projection implementations. Focused source/import/provider tests pass (**61 tests**). Syntax and whitespace checks pass.

Two default parallel full-suite runs exposed operational test failures: dead-owner claim recovery yielded zero successors instead of one, and a concurrent manual-result writer received Windows `EPERM` opening its lock. The isolated 13-test claim suite passed. A full serialized run before the provider adapter passed 862 tests, and the final expanded serialized suite passed **875 tests**, zero failed/skipped. Serialization still executes each concurrency test's competing child processes. The cause of the parallel-run failures is not established; neither failure was silently discarded or repaired by changing unrelated assertions.

Model identity is **v6.0.50** because missing availability changes uncertainty. Full selection report/plan binding, those concurrency failures, adequate preregistered forward model comparisons, and independent starter/injury source access remain unfinished. Existing frozen v6.0.45 results do not validate this version. No predictive improvement or profitability is established.

Sports is user-confirmed offline. No startup, merge, deployment, champion promotion, orders or Discord posts occurred. Live trading stays disabled. The Stocks automation file remains unchanged. Sports remains in progress before Crypto, then Stocks.

## Later reconciliation repair

[Development v6.0.55](SPORTS_AVAILABILITY_RECONCILIATION.md) preserves original same-player inputs across provider replacement, expiry and JSON restart; checks per-source clocks; retains separate provider conflict/empty-snapshot state; and quarantines incompatible event starter identities. Primary health scoring now keeps missing health unknown. Full966 tests pass. The schema/configuration remains compatible; no actual external injury/confirmed-goalie coverage was recovered, and the frozen v52 trial remains separate.

## Native naming reuse

[Development v6.0.56](SPORTS_NHL_ODDS_IDENTITY.md) extracts scoped native place/common-name evidence from the same bounded landing request for odds event/outcome matching. It does not turn season goalie leaders into confirmed starters or add health confidence. The shared6-game default/12 maximum remain unchanged. Separate twelve-game real research found no explicit injury/starter fields; actual confirmed coverage remains unavailable.

## Receipt and identity revalidation

[Development v6.0.57](SPORTS_NATIVE_RECORD_AVAILABILITY.md) now rejects stale/unbound goalie context at parsing, inference and evidence reporting, and stops describing stale team injury reports as current coverage. Explicit unavailable-player restrictions remain. A receipt-correct retrospective review retained 47 season-candidate rows from 12 saved native responses but recovered zero confirmed goalies or injury assertions. Full 1,016 tests pass; this is neither a new forecast nor evidence of predictive improvement. The frozen v52 trial and optional provider adapter remain separate.

## Specialist consumption

[Development v6.0.58](SPORTS_SPECIALIST_HEALTH_EVIDENCE.md) repairs the direct sport-model health path as well as primary scoring: selected current restrictions cap stored workload, unknown role priors do not provide medical evidence, and per-role missingness is frozen in the journal. This does not add an unavailable injury feed or convert goalie season candidates into event starters. Full1,031 tests pass; current-version predictive improvement remains unverified.

## Explicit provider projections

[Development v6.0.64](SPORTS_PROVIDER_GOALIE_PROJECTIONS.md) adds a separate projection assertion, conflict diagnostics and accepted-observation counts, and preserves same-player goalie role metadata during injury reconciliation. Existing identity/chronology/expiry/uncertainty policies remain. Twelve new cases/full1,126 pass; actual preferred-provider data remains unconnected and missing injury/confirmation coverage is not solved by an adapter.
