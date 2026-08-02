# Contributing

SKR Ecosystem Eyes is an independent, read-only community project. Contributions that improve data accuracy, provenance, reliability, accessibility, or operational clarity are welcome.

## Before opening a pull request

1. Keep the application read-only. Do not add wallet connection, signing, custody, or transaction submission.
2. Never invent missing data. Mark values as exact, estimated, unavailable, or coverage-limited.
3. Keep API keys, RPC credentials, local event data, logs, and machine-specific paths out of commits.
4. Preserve source slots, transaction signatures, derivation notes, and known caveats when changing metrics.
5. Run `npm run check` and describe any data-model or accuracy trade-off in the pull request.

## Development

Requires Node.js 22 or newer. The project has no runtime npm dependencies.

```bash
npm start
npm run check
```

Use `.env.example` as the configuration reference. Do not commit `.env`.

## Issues

Please include reproducible evidence: the affected metric or route, observation time, finalized slot or transaction signature when available, and the expected result. Never post private keys, seed phrases, access tokens, or private RPC URLs.
