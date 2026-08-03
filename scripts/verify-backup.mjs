import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const directory = path.resolve(process.argv[2] || '');
if (!process.argv[2]) {
  console.error('Usage: node scripts/verify-backup.mjs <snapshot-directory>');
  process.exit(2);
}

const manifest = JSON.parse(await readFile(path.join(directory, 'manifest.json'), 'utf8'));
for (const expected of manifest.files || []) {
  const file = path.join(directory, expected.name);
  const bytes = await readFile(file);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (sha256 !== expected.sha256) throw new Error(`${expected.name} checksum mismatch`);
  const database = new DatabaseSync(file, { readOnly: true });
  const integrity = database.prepare('PRAGMA integrity_check').get().integrity_check;
  database.close();
  if (integrity !== 'ok') throw new Error(`${expected.name} integrity check failed: ${integrity}`);
}
console.log(JSON.stringify({ ok: true, directory, files: manifest.files.length, createdAt: manifest.createdAt }));
