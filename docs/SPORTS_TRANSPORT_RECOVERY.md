# Isolated Discord transport and process recovery

This continuation exercises the actual publisher, embed builders, cache writer and prediction journal against a file-backed fake Discord boundary. It never logs into Discord, uses an owner's token or posts to a real channel. Prediction semantics remain v6.0.9; the source revision and any source-bound artifact identity change independently. Existing live research captures are not rewritten.

## Confirmed defects and repairs

### Verification failures could cause duplicate sends

Previously `postDailySlate` caught cached-message fetch **and edit** failures together. A denied edit became a missing message. If channel history was also inaccessible, `findDailySlateMessage` returned null and the publisher sent a replacement. Likewise, a first history lookup failure was indistinguishable from a complete search finding no existing post. Two new regressions failed before repair because publication succeeded when it should have stopped.

`discordPublisher.js:312` now supports a strict history lookup. Publication uses it; informational callers retain the existing optional lookup behavior. Missing history permissions, provider errors and exhausting the five-page bound without establishing absence defer publication. They do not authorize a replacement send. An explicitly missing cached resource can still fall through to history discovery, preserving legitimate recovery.

At `discordPublisher.js:352`, cached message retrieval is separate from editing. Edit failures propagate without trying to send another message. Retrieval permits missing-resource recovery only for the installed Discord API's `RESTJSONErrorCodes.UnknownMessage` or `UnknownChannel`; permission/network failures remain unknown. The constants were verified against the installed dependency exports/types. No provider limits or prediction/risk gates changed.

Operational implication: the operator must restore Read Message History/access or provide a verifiable cached message before automatic publication resumes. Forecast computation and durable issuance remain independent of a failed transport. Explicit existing duplicate/force options retain their established contracts; this repair does not turn discovery into a distributed publication lock.

### Delivery acknowledgement exceeded actual visible content

The formatter trims prediction fields to the Discord aggregate character budget. The journal previously acknowledged the first 25 predictions after successful publication even when fewer appeared. A reproduced fixture displayed **12** fields but appended **25** delivery acknowledgements.

`formatSlatePresentation` at line 196 now returns both embeds and the exact retained prediction prefix after trimming. The existing exported `formatSlateEmbeds` API still returns embeds. `postDailySlate` uses that shared presentation and at line 399 acknowledges only its displayed predictions after a successful write. Finding an old post without editing it still does not acknowledge unseen new forecasts. This repair affects delivery evidence, not immutable probabilities or winner selection.

## Actual process interruption test

`test-support/discord-transport.mjs` implements a synthetic remote store and a child-process entry point. The parent test creates an isolated directory and a fixed forecast, then:

1. Starts a child with an allowlisted environment, empty dotenv file, private data directory and no inherited Discord/API credentials.
2. The child issues and synchronizes the real prediction journal, then persists simulated server acceptance of the formatted message.
3. The child immediately exits with status 73, before the publisher can persist its cache or delivery acknowledgement.
4. Two fresh child processes retry. History discovery finds the accepted post, edits it and acknowledges the issued forecast once.

The test verifies one persisted remote message, one issued forecast, one delivery acknowledgement and byte-equivalent original forecast records across the restart. This is an actual process exit/restart against a synthetic boundary, not a module reimport or a claim of live Discord verification.

Other tests cover send failures, denied edits, denied cached reads, unreadable history, bounded search exhaustion, known missing cached IDs, unchanged existing content and length-trimmed delivery records. No scheduler or Discord client login is started.

## Midnight fixture correction

The initial 243-test baseline run had one failing quote-budget test. It used the current wall clock, then advanced by 12 minutes while assuming all claims remained on the same local date. Running near midnight crossed the daily reset and legitimately allowed a new claim. The same-date fixture now pins a daytime timestamp. A separate rollover test verifies both the next-date cap reset and the cross-midnight cooldown. Production quota/cooldown code is unchanged.

## Verification and limits

- Two initial duplicate-prevention regressions failed before the publisher repair; the display-count regression separately reproduced 25 acknowledgements versus 12 displayed fields.
- Focused transport/quote suite: 20 passed. Full repository suite: **253 passed**, zero failures/skips. Configured syntax and whitespace checks pass; syntax coverage includes the new test and worker.
- Existing capture-chronology intermittent failures did not occur in this final run; their cause is still unproven. No timing tolerance was introduced.
- Live Discord permissions/rate limits, simultaneous publishers in different processes, filesystem interruption during an append, torn journal writes, orphan-lock recovery and every scheduler branch are not proven by this harness. Existing integrity/locking fixtures cover some mechanisms separately; they do not establish universal exactly-once transport.
- A new post accepted by Discord but lacking an acknowledgement remains delivery-unknown until verified/retried. The bot must not invent an acceptance timestamp or silently backdate it.
- No deployment, promotion, real-money execution or production learner change occurred. cPanel remains excluded. Prospective accuracy, data-source/lineup coverage and nested feature provenance remain unfinished.
