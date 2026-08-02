import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EventStore } from '../src/store.js';

function event(id, type, amount, blockTime, wallet = 'wallet') {
  return {
    id,
    signature: `signature-${id}`,
    instructionIndex: 0,
    slot: blockTime,
    blockTime,
    type,
    wallet,
    guardianPool: null,
    amount,
    rawAmount: amount == null ? null : String(amount * 1_000_000),
  };
}

test('EventStore migrates legacy JSON once and keeps more history than the memory window', async (context) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'skr-eyes-store-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const database = path.join(directory, 'events.sqlite');
  const legacy = path.join(directory, 'events.json');
  const now = 1_800_000_000;
  await writeFile(legacy, JSON.stringify({ events: [
    event('old', 'stake', 10, now - 90_000, 'a'),
    event('recent', 'unstake', 4, now - 60, 'b'),
  ] }));

  const store = new EventStore(database, 1, 35);
  const recent = await store.load();
  assert.equal(recent.length, 1);
  assert.equal(recent[0].id, 'recent');
  assert.equal(store.count(), 2);
  assert.equal(store.getCursor(), 'signature-recent');

  store.append([event('new', 'stake', 20, now - 30, 'c')]);
  store.setCursor('signature-new');
  const analytics = store.summarize(now);
  assert.equal(store.count(), 3);
  assert.equal(store.getCursor(), 'signature-new');
  assert.equal(analytics.windows['24h'].staked, 20);
  assert.equal(analytics.windows['24h'].unstaked, 4);
  assert.equal(analytics.windows['7d'].staked, 30);
  assert.equal(analytics.windows['30d'].events, 3);
  assert.equal(analytics.coverageFrom, now - 90_000);
  const filtered = store.queryEvents({ type: 'stake', wallet: 'c', limit: 10, offset: 0 });
  assert.equal(filtered.total, 1);
  assert.equal(filtered.items[0].id, 'new');
  store.close();
});
