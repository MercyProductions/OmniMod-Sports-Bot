# OmniMod Sports Bot

Standalone Discord application for sports schedules, pregame forecasts, final-result grading, source diagnostics and model evaluation. The application is in `sports-bot/`; `npm start` launches only Sports. This repository is separate from the older C++ Aegis Sports Betting AI project.

## Setup

Use Node.js 22.9 or newer and npm.

```sh
npm run bootstrap
npm run info
npm test
npm run check
```

Copy `sports-bot/.env.example` to `sports-bot/.env` locally and configure the bot's own Discord identity, channels and data settings. Never commit that file. Bootstrap uses the existing dependency lockfile with lifecycle scripts disabled.

After configuration:

```sh
npm run register
npm start
```

Registration updates this Discord application's commands; startup can publish configured messages. Neither action is performed by uploading this repository.

## Source and verification

- [Sports documentation](sports-bot/README.md)
- [Data documentation](sports-bot/docs/DATA.md)
- [Model documentation](sports-bot/docs/MODEL.md)
- [Export verification](EXPORT_VERIFICATION.md)

The existing source is preserved, including prediction timing, uncertainty, result formatting, duplicate-post protection and optional odds-data handling. `repository.json` records SHA-256 hashes for the copied source files. Historical hosting instructions in the original documentation require review for your deployment; this export does not copy private cPanel configuration or change the production host.

Credentials, runtime data, cached schedules, Discord state, dependencies and logs are excluded. Tests verify code behavior, not current sports-feed access, predictive accuracy or profitable betting. This upload does not connect a wagering account or place a bet.
