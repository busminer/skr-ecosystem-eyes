import { mkdtemp, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { EventStore } from '../src/store.js';

const directory = await mkdtemp(path.join(os.tmpdir(), 'skr-snapshot-size-'));
const file = path.join(directory, 'events.sqlite');
try {
  let store = new EventStore(file);
  await store.load();
  store.close();
  let db = new DatabaseSync(file);
  db.exec('VACUUM');
  db.close();
  const baseline = (await stat(file)).size;

  store = new EventStore(file);
  await store.load();
  const start = 1_800_000_000;
  for (let index = 0; index < 288; index += 1) {
    store.recordProtocolSnapshot({
      slot: 500_000_000 + index,
      unixTs: start + index * 300,
      sharePrice: `1.${String(116_000_000 + index).padStart(9, '0')}`,
      totalShares: '4512345678.123456',
      activeStaked: '5039999999.123456',
      vaultBalance: '5057999999.123456',
      rewardIndex: `11.${String(600_000 + index).padStart(7, '0')}`,
    });
  }
  store.close();
  db = new DatabaseSync(file);
  db.exec('PRAGMA wal_checkpoint(TRUNCATE); VACUUM');
  const integrity = db.prepare('PRAGMA integrity_check').get().integrity_check;
  db.close();
  const populated = (await stat(file)).size;
  console.log(JSON.stringify({ rowsPerDay: 288, baselineBytes: baseline, populatedBytes: populated, incrementalBytesPerDay: populated - baseline, bytesPerRow: (populated - baseline) / 288, integrity }, null, 2));
} finally {
  await rm(directory, { recursive: true, force: true });
}
