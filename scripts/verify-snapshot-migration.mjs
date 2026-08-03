import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { EventStore } from '../src/store.js';

const file = process.argv[2];
if (!file) {
  console.error('Usage: node scripts/verify-snapshot-migration.mjs <copied-events.sqlite>');
  process.exit(2);
}

const resolved = path.resolve(file);
const store = new EventStore(resolved);
await store.load();
const events = store.count();
const snapshots = store.queryProtocolSnapshots().length;
store.close();

const db = new DatabaseSync(resolved, { readOnly: true });
const integrity = db.prepare('PRAGMA integrity_check').get().integrity_check;
const tables = Number(db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name LIKE 'protocol_snapshots%'").get().count || 0);
db.close();
if (integrity !== 'ok' || tables !== 2) throw new Error(`Migration verification failed: integrity=${integrity}, tables=${tables}`);
console.log(JSON.stringify({ ok: true, file: resolved, integrity, tables, events, snapshots }));
