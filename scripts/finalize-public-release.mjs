import { spawnSync } from 'node:child_process';

for (const script of ['scripts/purge-cloudflare-cache.mjs', 'scripts/verify-public-release.mjs']) {
  const result = spawnSync(process.execPath, [script], { stdio: 'inherit', env: process.env });
  if (result.status !== 0) process.exit(result.status || 1);
}
