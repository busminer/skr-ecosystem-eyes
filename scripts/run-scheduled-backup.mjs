import { readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const dataDirectory = path.resolve(process.env.SKR_DATA_DIRECTORY || '/var/lib/skr-ecosystem-eyes/data');
const backupRoot = path.resolve(process.env.SKR_BACKUP_DIRECTORY || '/var/backups/skr-eyes/state');
const retentionDays = Math.max(7, Number(process.env.SKR_BACKUP_RETENTION_DAYS || 14));
const stamp = new Date().toISOString().replaceAll(':', '').replace(/\.\d{3}Z$/, 'Z');
const destination = path.join(backupRoot, stamp);
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));

const backup = spawnSync(process.execPath, [path.join(scriptDirectory, 'backup-state.mjs'), dataDirectory, destination], { stdio: 'inherit' });
if (backup.status !== 0) process.exit(backup.status || 1);
const verify = spawnSync(process.execPath, [path.join(scriptDirectory, 'verify-backup.mjs'), destination], { stdio: 'inherit' });
if (verify.status !== 0) process.exit(verify.status || 1);

const cutoff = Date.now() - retentionDays * 86_400_000;
for (const entry of await readdir(backupRoot, { withFileTypes: true })) {
  if (!entry.isDirectory() || !/^\d{4}-\d{2}-\d{2}T\d{6}Z$/.test(entry.name)) continue;
  const createdAt = Date.parse(entry.name.replace(/T(\d{2})(\d{2})(\d{2})Z$/, 'T$1:$2:$3Z'));
  if (Number.isFinite(createdAt) && createdAt < cutoff) await rm(path.join(backupRoot, entry.name), { recursive: true, force: true });
}
