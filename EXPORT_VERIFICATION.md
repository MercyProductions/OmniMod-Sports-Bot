# Sports export verification — 2026-10-20

- Clean `npm run bootstrap` succeeded using the existing package lock, with lifecycle scripts disabled.
- `npm test`: **109 passed**, zero failures.
- `npm run check` and the root wrapper syntax check passed.
- `npm run info` selected `sports-bot` and `node app.js` as the primary entry point.
- All 65 copied source files match their recorded SHA-256 hashes.
- Export checks compared files with configured credentials and common secret patterns; no credentials were found in the selected files. Git staging uses an explicit allowlist.
- Real `.env` files, data, caches, logs, dependencies and private cPanel configuration are excluded.

The source tests ran with isolated test storage and cleared Discord configuration. No Discord registration, production restart, deployment or wager was performed. These checks do not verify present provider availability or predictive/betting performance.
