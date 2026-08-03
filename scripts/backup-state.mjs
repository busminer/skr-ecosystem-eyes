import { createHash } from 'node:crypto';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const [sourceDirectory, destinationDirectory] = process.argv.slice(2);
if (!sourceDirectory || !destinationDirectory) {
  console.error('Usage: node scripts/backup-state.mjs <data-directory> <snapshot-directory>');
  process.exit(2);
}

const source = path.resolve(sourceDirectory);
const destination = path.resolve(destinationDirectory);
if (source === destination || destination.startsWith(`${source}${path.sep}`)) {
  throw new Error('Snapshot directory must be outside the live data directory');
}

await mkdir(destination, { recursive: true, mode: 0o700 });
const databases = ['events.sqlite', 'analytics.sqlite'];
const manifest = { createdAt: new Date().toISOString(), source, files: [] };

for (const name of databases) {
  const input = path.join(source, name);
  try { await access(input); } catch (error) {
    if (process.argv.includes('--allow-missing') && error.code === 'ENOENT') continue;
    throw error;
  }
  const output = path.join(destination, name);
  const database = new DatabaseSync(input, { readOnly: true });
  try {
    const sourceIntegrity = database.prepare('PRAGMA integrity_check').get().integrity_check;
    if (sourceIntegrity !== 'ok') throw new Error(`${name} source integrity check failed: ${sourceIntegrity}`);
    database.exec(`VACUUM INTO '${output.replaceAll("'", "''")}'`);
  } finally {
    database.close();
  }
  const snapshot = new DatabaseSync(output, { readOnly: true });
  const snapshotIntegrity = snapshot.prepare('PRAGMA integrity_check').get().integrity_check;
  snapshot.close();
  if (snapshotIntegrity !== 'ok') throw new Error(`${name} snapshot integrity check failed: ${snapshotIntegrity}`);
  const bytes = await readFile(output);
  manifest.files.push({ name, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), integrity: snapshotIntegrity });
}

await writeFile(path.join(destination, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify({ ok: true, destination, files: manifest.files.map(({ name, bytes, integrity }) => ({ name, bytes, integrity })) }));
