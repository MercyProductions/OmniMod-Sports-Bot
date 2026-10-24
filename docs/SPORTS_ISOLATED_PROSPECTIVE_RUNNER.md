# Isolated executable Sports comparison runner

## Implemented

`research:prospective` archives tracked `sports-bot/src/*.js`, package metadata and lockfile from explicit Git commits. The baseline and challenger have separate archived source directories and separate initially empty state. Reused directories, repository-local targets, differing dependency lockfiles, redirected state/dependency directories, changed manifests, altered source and changed worker/environment files are rejected. An exclusive run lock prevents concurrent collectors.

Workers receive a small environment allowlist and explicit research configuration; inherited Discord/provider credentials and Node options are not passed. Dotenv reads a pinned empty file. The worker verifies its configured data directory and disabled credentials, warehouse, replay and local ML before importing the collection pipeline. It calls `buildDailySlate`, never `index.js`, Discord startup or order code. Captures are new exclusive private files with source commits, timestamps and content hashes; they do not claim Discord delivery.

The runner uses installed dependencies through a shared directory junction/symlink. Matching lockfiles and the dependency path are checked; this is not a fully vendored dependency snapshot or an OS security sandbox. Source directories must not be edited during a run. Do not use this runner for untrusted code. Preserve its manifest, archived source, worker and dependency information together.

## Commands

From the repository root, use a new private research path outside the repository. Its parent must already exist:

```powershell
npm --prefix sports-bot run research:prospective -- --action=prepare --directory=C:/private/sports-study --repository=C:/repos/OmniMod-Sports-Bot --baseline=baseline/pre-readme-sports-audit-2026-10-20 --challenger=REVIEWED_COMMIT
npm --prefix sports-bot run research:prospective -- --action=inspect --directory=C:/private/sports-study
npm --prefix sports-bot run research:prospective -- --action=collect --directory=C:/private/sports-study
npm --prefix sports-bot run research:prospective -- --action=collect --directory=C:/private/sports-study --data=live
```

Collection defaults to offline. `--data=live` explicitly requests the existing free-provider pipeline, without a paid odds key. The fixed initial profile covers NBA/NHL/NFL/MLB, up to six summaries and four history leagues over 90 days, no box-score downloads, official-source corroboration, advanced dataset sync, local ML, historical replay, warehouse or Discord. Each worker has a 120-second timeout. This is a bounded cold-start comparison, not full production feature/data coverage or the deployed learned state. The versions collect sequentially; observations are timestamped but not asserted identical across requests.

## Actual verification

Baseline before this development phase: `5eef034ca44173760929fd74a16e46fff8842c85`; 210 tests reproduced. Current Sports suite: 212 passing, zero failures/skips, configured syntax and whitespace checks pass.

An actual integration fixture archives and runs both source versions in child processes against one clearly synthetic offline game, proving separate state and no inherited sentinel credential. It also tests existing owner-lock preservation, refusing reused/repository-local targets and modified-source rejection. This fixture is not market performance evidence.

A separate permitted live capture ran at **2026-10-21 03:50 UTC** (October 20 evening in Chicago):

| Item | Baseline | Challenger |
| --- | --- | --- |
| Source commit | `1185e178f34c26ee0d2f80c2b06d6f293f4d0eed` | `5eef034ca44173760929fd74a16e46fff8842c85` |
| Collection time | 03:50:38.916–03:50:40.104 UTC | 03:50:40.268–03:50:41.237 UTC |
| Selected games | 14 | 14 |
| Game state | 9 final, 5 live | 9 final, 5 live |
| Eligible pregame forecasts | 0 | 0 |
| Selected leagues | 3 NBA, 11 NHL | 3 NBA, 11 NHL |

Existing CDN/official schedule fallbacks returned usable schedules while primary ESPN requests returned 403. NHL primary/CDN reported 403/404 before its official schedule fallback succeeded. NHL/NBA history requests and attempted NBA/NHL summary requests returned 403. Both versions had zero automatic history/team/player samples and no confirmed lineup sides. The missing coverage is real; no successful history/lineup access or accuracy improvement is inferred from schedule success. NFL/MLB returned provider events but none survived the selected local-date slate.

There were no scheduled games left in this captured slate, so the zero pregame count is consistent with timing. Completed/live games were labeled retrospective-ungraded/in-play rather than manufactured as pregame predictions. Original captures and hashes remain private outside Git. No production source/configuration, Discord message, paid quota, order, promotion or learner was changed.

## Not complete

The archived versions were actually executed against current data, but no eligible pregame forecast was captured in this run. Future pregame collection, append-only cross-version pairing, final-result reconciliation, matched statistical evaluation and realistic costed outcomes remain required. Captures alone do not complete the preregistered trial protocol or prove predictive improvement. No continuous collector or scheduled Sports automation was started. Actual deployed-host source/configuration/jobs remain unverified. Source-access 403 failures need further permitted investigation; this implementation does not bypass them.

Sports remains in progress before Crypto and Stocks.
