import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { EventStore } from '../src/store.js';

const sample = (slot, unixTs, rewardIndex = '11.6') => ({ slot, unixTs, sharePrice: '1.116', totalShares: '10', activeStaked: '11.16', vaultBalance: '12', rewardIndex });

test('protocol snapshots use finalized slot dedupe, cadence and reward-change writes', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'skr-snapshot-'));
  try {
    const file = path.join(directory, 'events.sqlite');
    const store = new EventStore(file);
    await store.load();
    assert.equal(store.recordProtocolSnapshot(sample(100, 1_000)), true);
    assert.equal(store.recordProtocolSnapshot(sample(101, 1_100)), false);
    assert.equal(store.recordProtocolSnapshot(sample(102, 1_101, '11.7')), true);
    assert.equal(store.recordProtocolSnapshot(sample(103, 1_402, '11.7')), true);
    assert.deepEqual(store.queryProtocolSnapshots({ from: 1_050, to: 1_200 }).map((row) => row.slot), [102]);
    store.close();
    const db = new DatabaseSync(file, { readOnly: true });
    assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM protocol_snapshots').get().count, 3);
    db.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('protocol snapshots compact expired raw rows into hourly facts', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'skr-snapshot-'));
  try {
    const file = path.join(directory, 'events.sqlite');
    const store = new EventStore(file);
    await store.load();
    store.recordProtocolSnapshot(sample(200, 3_600, '10'));
    store.recordProtocolSnapshot({ ...sample(201, 3_900, '11'), sharePrice: '1.2' });
    const now = 100 * 86_400;
    assert.equal(store.pruneProtocolSnapshots(true, now), 2);
    store.close();
    const db = new DatabaseSync(file, { readOnly: true });
    const hourly = db.prepare('SELECT * FROM protocol_snapshots_hourly').get();
    assert.equal(hourly.sample_count, 2);
    assert.equal(hourly.open_share_price, '1.116');
    assert.equal(hourly.close_share_price, '1.2');
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM protocol_snapshots').get().count, 0);
    db.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
