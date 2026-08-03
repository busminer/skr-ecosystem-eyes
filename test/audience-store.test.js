import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { AudienceStore, hashAudienceSession, isValidAudienceSessionId } from '../src/audience-store.js';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

test('validates and hashes anonymous browser session identifiers', () => {
  assert.equal(isValidAudienceSessionId(A), true);
  assert.equal(isValidAudienceSessionId('not-a-session'), false);
  assert.equal(hashAudienceSession(A).length, 64);
  assert.equal(hashAudienceSession(A).includes(A), false);
});

test('counts once and survives database reopen', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'skr-audience-'));
  const file = path.join(directory, 'analytics.sqlite');
  const now = 1_786_000_000;
  try {
    const first = new AudienceStore(file);
    await first.load(now);
    assert.deepEqual(first.record(A, now), { counted: true, reason: 'new' });
    assert.deepEqual(first.record(A, now + 1), { counted: false, reason: 'duplicate' });
    assert.deepEqual(first.record(B, now + 2), { counted: true, reason: 'new' });
    assert.equal(first.summary(now + 2, 3).visitsTotal, 2);
    assert.equal(first.summary(now + 2).liveSessions, 2);
    assert.equal(first.heartbeat(A, now + 100), true);
    assert.equal(first.summary(now + 100).liveSessions, 1);
    assert.equal(first.integrityCheck(), 'ok');
    first.close();
    const reopened = new AudienceStore(file);
    await reopened.load(now + 3);
    assert.equal(reopened.summary(now + 3).visitsTotal, 2);
    assert.deepEqual(reopened.record(A, now + 4), { counted: false, reason: 'duplicate' });
    reopened.close();
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('prunes identifiers without deleting durable totals', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'skr-audience-'));
  const file = path.join(directory, 'analytics.sqlite');
  const now = 1_786_000_000;
  try {
    const store = new AudienceStore(file);
    await store.load(now);
    store.record(A, now);
    store.prune(now + 8 * 86_400, true);
    assert.equal(store.summary(now + 8 * 86_400).visitsTotal, 1);
    assert.deepEqual(store.record(A, now + 8 * 86_400), { counted: true, reason: 'new' });
    assert.equal(store.summary(now + 8 * 86_400).visitsTotal, 2);
    store.close();
  } finally { await rm(directory, { recursive: true, force: true }); }
});
