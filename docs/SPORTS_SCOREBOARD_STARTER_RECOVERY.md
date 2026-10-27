# Scoreboard starter recovery — v6.0.61

## Confirmed missing-data path

The already saved, successful MLB CDN response included two `probableStartingPitcher` records in the game's competitors. [`parseEspnEvent`](../sports-bot/src/sportsData.js#L153) kept team/schedule information but discarded these records. Player enrichment depended on a separate summary request. A summary failure therefore lost projections already available in the successful schedule response.

An old-source regression reproduced this path: the failed summary left no automatic player inputs. This is a data-plumbing defect, not evidence that the projected pitchers were confirmed, healthy or predictive. No new endpoint, subscription or access workaround was needed.

## Implemented contract

[`scoreboardStarters.js`](../sports-bot/src/scoreboardStarters.js) retains the observed MLB probable-pitcher contract only. It requires explicit source role, native player/team IDs, one ordered competitor per side, matching event/competition/start and compatible season context. Conflicting players, sides, names or team IDs remain rejected evidence. Duplicate identical records do not become additional players. NHL season goalie leaders are deliberately outside this contract: this repair does not invent a confirmed-goalie feed.

Each snapshot preserves the receipt, cache state, event/team/season binding, candidate rows and rejection reasons. A receipt is not a provider publication-time attestation. Projection inputs require a current successful receipt, expire after 15 minutes or at game start, and are rechecked against the current event during inference, including after JSON restart. Invalidated player inputs also invalidate their dependent participation aggregates. Old snapshots and original evidence are not rewritten.

[`autoEnrichment.js`](../sports-bot/src/autoEnrichment.js#L778) applies projections after the summary attempt and before existing historical player/profile processing. Existing same-player injury records, selected pitcher records and confirmed event-roster starters take precedence. Source replacement removes only its own projection; a separately retained injury assertion survives. No projected row enters the confirmed lineup collection.

Retained rows have `confirmedStarter:false`, `confirmationStatus:'projected'`, `availability:null` and explicit unknown health. The existing role prior is not a medical probability. Flat scoreboard statistics such as postseason ERA lack the sample/period evidence required for this new path, so they are not silently promoted into model statistics. Existing independently supported historical-profile enrichment can still apply through the normal architecture.

[`inputChronology.js`](../sports-bot/src/inputChronology.js#L40) revalidates source/event/receipt/expiry binding. [`evidenceCoverage.js`](../sports-bot/src/evidenceCoverage.js#L163) separates current source candidates from selected model inputs, projects no confirmation or injury coverage, and freezes that distinction through the existing prediction journal. Two usable source candidates do not mean two approved picks. No threshold, uncertainty coefficient, risk/value rule or calibration requirement was relaxed.

Development identity advances to **v6.0.61** because new input availability can change model behavior and uncertainty. Implementation commit: **`861f78ce63f08ed2a4e1257aaf34113bbae01252`**. This identity is not a promoted champion or a deployment. The original v52 trial, v59 paired study and v60 observation retain their own source/state.

## Verification and actual source evidence

| Check | Actual result |
| --- | --- |
| Reproduced pre-edit full suite |1,066 passed |
| Old-source failed-summary regression |1 failed as expected: both available projections were lost |
| New regression scenarios |13 |
| Focused source/enrichment/chronology/availability checks |77 passed |
| Full `npm test` |1,079 passed; zero failures/skips |
| `npm run check` |217 project files parsed |
| Postcommit source/archived-worker/network/uncertainty checks |59 passed |
| Whitespace and changed-code credential/Gitleaks checks |Passed; zero configured-secret matches/findings |

A retrospective parser-only review used the original saved MLB body and its **2026-10-24T08:45:35.671Z** receipt. At that original receipt it recovered two projected rows, zero confirmations and unknown injuries. At the actual later clock both rows correctly expired. The original body hash was unchanged. This made zero provider requests and issued zero forecasts; it is not backdated forward evidence.

A separate pre-collection plan then pinned source `861f78c` and the original tagged baseline in isolated empty state. At **2026-10-24T09:33:51.494–09:33:54.937Z**, the real workers produced:

| Role | Games | Requests / failures | Scoreboard projections |
| --- | --- | --- | --- |
| Original v6.0.0 baseline |12 NHL |16 /12 |0 |
| Current v6.0.61 |12 NHL,8 NBA,1 MLB |31 /14 |2 MLB |

The fresh MLB source receipt was **09:33:53.468Z**. Each side had one projected pitcher in the actual inference evidence report; both remained `projected_or_unavailable`, with unknown injury coverage and zero confirmed starters. Every forecast had zero calibration samples. Current outputs were nine directional leans and twelve withheld, with no actionable prediction. There were 47 ordinary free-provider requests, zero paid requests, zero orders, zero Discord posts and zero promotions. Exact role/source/capture/request evidence remains private.

Only the contemporaneously shared NHL games can form matched pairs. Missing baseline NBA/MLB forecasts are not baseline losses. All NHL games overlap earlier studies; versions are correlated observations, not independent games or a new selection holdout. The newly recovered MLB projections are not evidence of better accuracy, calibrated probability or economic value. All 33 role/game observations were still before their starts, so the final-query planner returned no eligible task and made no final requests. The original trial and prior study hashes remained unchanged.

## Automatic finals and unfinished requirements

A separate thread heartbeat, **Sports current-source final reconciliation**, is ACTIVE hourly for the already frozen v59, v60 and v61 observations. It uses the existing manifest-verified, bounded final-only runner, waits until actual starts, preserves original probabilities and refuses incomplete/unknown owners. It never collects new forecasts, changes model selection or shares outcomes with production learning. Routine checks stay quiet; completion/failure or required action produces a notification. It must save unresolved exclusions and remove itself when all outcomes resolve or their existing seven-day result lookback expires.

The original **Sports frozen forward-trial collector** and Stocks automation files remain byte-identical. Scheduling depends on the PC/Codex being available; this is not proof of every future wake. No scheduler-created future final is being claimed at this checkpoint.

Confirmed NHL goalie and medical data remain missing. Saved native landing/boxscore responses contain season context without explicit starter/injury assertions; the earlier injury request returned HTTP403. The user-preferred NHL snapshot adapter remains available but no alternate provider is connected. Projected MLB identities do not solve late scratches, bullpen availability, true publication timestamps, broader league coverage or independent current-model validation.

Actual finals, proper scores/calibration, adequate independent samples and realistic executable-odds evidence remain pending. Sports is still in progress before the full Crypto, then Stocks specifications. No production startup, merge, deployment or credentials change occurred. Live trading stays disabled and research emergency stop stays enabled. See the [phase checklist](SPORTS_SCOREBOARD_STARTER_CHECKLIST.json) and [full requirement matrix](SPORTS_REQUIREMENT_EVIDENCE.md).
