# Production release gate

Every public release must follow this order:

1. build fingerprinted browser assets with `npm run build:public`;
2. run `npm run check` and `git diff --check`;
3. create and verify a SQLite backup before changing the release symlink;
4. install the immutable release directory, switch `/opt/skr-ecosystem-eyes-current`, restart and verify `skr-eyes.service`;
5. set `CLOUDFLARE_ZONE_ID`, `CLOUDFLARE_API_TOKEN` and `PUBLIC_BASE_URL`, then run `npm run release:finalize`;
6. if purge or clean-URL verification fails, restore the previous symlink and restart the service.

`release:finalize` deliberately runs Cloudflare purge before public verification and stops on either failure. The token must be a scoped API token that can purge only the `alexkosa.dev` zone; it must never be committed or printed.

HTML responses use `Cache-Control: no-cache, must-revalidate`. Fingerprinted files under `/build/<name>.<sha256-prefix>.(js|css)` use one-year immutable caching. Unfingerprinted files retain a five-minute policy.
