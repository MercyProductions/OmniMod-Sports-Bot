# Final-result delivery identity and uncertain transport

Development model identity: v6.0.35. Prediction formulas, risk gates and production configuration are unchanged.

## Confirmed defects

Final reply caches, claim callers and Discord footers used native game IDs. Another league or start time could therefore inherit an acknowledgement, suppress a final, or recover the wrong message. Removing punctuation in storage filenames also made arbitrary native IDs unsuitable as independent claim keys.

The publisher returned the same absence value for unreadable history and a genuinely empty search. Its reply catch block then attempted a results-channel send even when the original reply might already have been accepted. In addition, the main batch aborted after one event failed, and a posted durable claim could suppress transport without restoring its lost cache acknowledgement.

## Implemented changes and source locations

- `sports-bot/src/finalResultIdentity.js:5` derives a known event scope; `:12` computes a SHA-256 key over guild, date, league, native ID and canonical start. This is an identity key, not source authentication. Different punctuation, leagues, starts and guilds remain separate. One event receives one displayed final; predictive horizon/model separation stays in the prediction journal.
- `sports-bot/src/finalResultIdentity.js:16` accepts only an event-bound reply with message/channel IDs. Raw legacy native-ID reply entries are preserved but are not trusted as scoped acknowledgements. Final refresh and prior-date reconciliation use the same lookup.
- Legacy Discord recovery (`sports-bot/src/finalResultIdentity.js:22`) requires a bot-authored matching dated footer plus title, league, displayed start and, when available, original daily-message reference. The current native-ID/league/displayed-start cohort must identify one canonical event. Distinct leagues with shared IDs remain independently recoverable. Ambiguous legacy evidence blocks a new send rather than authorizing a duplicate.
- `sports-bot/src/discordPublisher.js:410` continues checking another channel after a history failure, allowing a definitive matching result to be found there. Without a match, unavailable channels, history errors, an exhausted five-page bound and unresolved legacy evidence mean unknown, not absent. Guild mismatches do not authorize cross-server delivery.
- `sports-bot/src/discordPublisher.js:454` validates event identity and writes the scoped footer. A reply error never triggers another send. A definitively missing daily message may use the results channel only after a complete result-history check; uncertain daily-message access blocks transport.
- `sports-bot/src/finalDelivery.js:6` contains the actual batch used by the runtime. It passes scoped keys and scope metadata to the existing persistent claim API, writes scoped acknowledgement records, restores a posted claim's acknowledgement without calling transport, and keeps an event-local failure pending while processing other events. Stored failure reasons exclude exception content.
- `sports-bot/src/index.js:330` calls that batch and persists `finalDeliveryFailures` and `recoveredFinalAcknowledgements`. `sports-bot/src/sportsData.js:984` uses the scoped reply lookup before collecting new finals. Native-ID reply aliases are no longer copied onto renamed source events.

## Verification

The complete pre-change suite passed 479 tests. The prior committed publisher and reconciliation implementation was replayed against the first twelve new delivery tests: **seven failed and five passed**. This is a focused transport/reconciliation comparison, not a before/after evaluation of every new batch path.

The final suite passes **494 tests, zero failed or skipped**; syntax and whitespace checks pass. Fifteen new tests cover scoped IDs, cache/reconciliation isolation, persistent claim isolation, independent result footers and recovery, unreadable/exhausted history, ambiguous and recoverable legacy messages, a timeout after accepted reply, uncertain versus definitively missing daily messages, an event-local batch failure, and recovery from a posted claim with lost cache state.

A real child process exits immediately after the local fake service persists a final, and another process recovers that same message without a second send. This exercises the real publisher against a simulated remote service. It does not exercise the whole scheduler with a crashed active claim lease. Existing daily-slate send/edit, transport ambiguity, restart and character-limit tests remain passing.

All transport and filesystem observations in these tests are synthetic and isolated. No real Discord login/message, source collection, model promotion, deployment, live trade or production-data migration occurred. No predictive accuracy, calibration or economic improvement is inferred.

## Remaining limits and deployment considerations

The existing storage API still uses time-based stale-claim takeover without an owner nonce/host fence. Active-owner overlap and crash-before-send lease handling require further repair and verification. This phase does not establish exactly-once delivery, safe multi-host leases, or automatic recovery from every scheduler crash.

A later score correction is journaled separately, but existing final acknowledgement/reporting paths do not yet provide a fully governed correction-edit workflow. Previously finalized research reports are immutable. Legacy messages lacking sufficient scope evidence, or whose titles/references no longer reconcile, require explicit operator recovery; no guessed binding is created. History beyond the bounded search remains unknown.

Quote-only refresh selection, remaining adapter identity callers, compact timestamp/missingness contracts, full raw revision lineage, actual running-host version/configuration/jobs and adequate prospective evidence remain incomplete. Preserve the original two-game prospective captures. Sports remains in progress, then Crypto and Stocks. cPanel is excluded. No merge or production deployment is performed; live trading remains disabled.
