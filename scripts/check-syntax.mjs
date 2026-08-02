import { readdirSync } from 'node:fs';
import { extname, join } from 'node:path';
import { spawnSync } from 'node:child_process';

const roots = ['src', 'public', 'scripts'];
const files = roots.flatMap((root) => readdirSync(root, { withFileTypes: true })
  .filter((entry) => entry.isFile() && ['.js', '.mjs'].includes(extname(entry.name)))
  .map((entry) => join(root, entry.name)));

for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

console.log(`Syntax checked ${files.length} JavaScript files.`);
