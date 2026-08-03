import test from 'node:test';
import assert from 'node:assert/strict';
import { StakingIndexer } from '../src/indexer.js';

function createFlakyRpc(failuresBeforeSuccess = 2) {
  let calls = 0;
  return {
    url: 'https://api.mainnet-beta.solana.com/secret',
    async getCoreInputs() {
      calls += 1;
      if (calls <= failuresBeforeSuccess) throw new Error(`transient ${calls}`);
      return {
        configData: Buffer.alloc(200),
        vaultRaw: 0n,
        supplyRaw: 1n,
        sourceSlots: { stakeConfig: 1, stakeVault: 1, mint: 1 },
      };
    },
    async getUserStakeAccounts() {
      return { accounts: [], slot: 2 };
    },
    async getRecentSignatures() {
      return [];
    },
    async getTransaction() {
      return null;
    },
    getCalls() { return calls; },
  };
}

test('indexer.start retries transient failures then goes live', async () => {
  const rpc = createFlakyRpc(2);
  const store = {
    limit: 100,
    async load() { return []; },
    async save() {},
  };
  // summarizeOnChainState needs real config decode - stub refreshMetrics path by mocking methods after construct
  const indexer = new StakingIndexer({
    rpc,
    store,
    startRetries: 4,
    startRetryMs: 10,
    pollMs: 60_000,
    queueRefreshMs: 60_000,
  });
  let refreshCount = 0;
  indexer.refreshMetrics = async () => {
    refreshCount += 1;
    if (refreshCount < 3) throw new Error(`metrics fail ${refreshCount}`);
    indexer.metrics = { updatedAt: 1, queue: [] };
    indexer.status.lastMetricsAt = 1;
  };
  indexer.syncEvents = async () => {
    indexer.status.lastSyncAt = 2;
  };

  await indexer.start();
  assert.equal(indexer.status.phase, 'live');
  assert.equal(indexer.status.startAttempts >= 3, true);
  assert.equal(indexer.publicStatus().rpc, 'api.mainnet-beta.solana.com');
  assert.equal(String(indexer.getState().status.rpc).includes('secret'), false);
  indexer.stop();
});

test('indexer.start arms timers even when degraded after exhausting retries', async () => {
  const store = {
    limit: 100,
    async load() { return []; },
    async save() {},
  };
  const indexer = new StakingIndexer({
    rpc: { url: 'https://rpc.example/path-token' },
    store,
    startRetries: 2,
    startRetryMs: 5,
    pollMs: 60_000,
    queueRefreshMs: 60_000,
  });
  indexer.refreshMetrics = async () => {
    throw new Error('still down');
  };
  await assert.rejects(() => indexer.start(), /still down/);
  assert.equal(indexer.status.phase, 'degraded');
  assert.ok(indexer.pollTimer);
  assert.ok(indexer.metricsTimer);
  assert.ok(indexer.queueTimer);
  assert.equal(indexer.publicStatus().rpc, 'rpc.example');
  indexer.stop();
});

test('indexer does not advance its cursor or report a fresh sync after a transaction lookup failure', async () => {
  let savedCursor = 'known-cursor';
  const store = {
    limit: 100,
    async load() { return []; },
    append() { throw new Error('append should not run'); },
    getCursor() { return savedCursor; },
    setCursor(value) { savedCursor = value; },
    summarize() { return null; },
  };
  const rpc = {
    url: 'https://rpc.example',
    scanUrl: 'https://rpc.example',
    async getSignaturesSince() { return [{ signature: 'new-signature', err: null }]; },
    async getTransaction() { throw new Error('transaction lookup failed'); },
  };
  const indexer = new StakingIndexer({ rpc, store });
  indexer.metrics = { sharePrice: 1 };
  indexer.started = true;
  indexer.status.phase = 'live';

  const error = await indexer.syncEvents().then(() => null, (caught) => caught);
  indexer.recordError(error);
  assert.match(indexer.status.lastError, /transaction lookup failed/);
  assert.equal(indexer.status.phase, 'degraded');
  assert.equal(indexer.status.lastSyncAt, undefined);
  assert.equal(savedCursor, 'known-cursor');
});

test('indexer checkpoints each completed signature before a later rate-limit failure', async () => {
  let savedCursor = 'known-cursor';
  const store = {
    limit: 100,
    append() {},
    getCursor() { return savedCursor; },
    setCursor(value) { savedCursor = value; },
    summarize() { return null; },
  };
  const rpc = {
    url: 'https://rpc.example',
    scanUrl: 'https://rpc.example',
    async getSignaturesSince() {
      return [{ signature: 'newer', err: null }, { signature: 'older', err: null }];
    },
    async getTransaction(signature) {
      if (signature === 'newer') throw new Error('RPC HTTP 429');
      return {
        slot: 1,
        blockTime: 1,
        meta: { err: null, innerInstructions: [] },
        transaction: { signatures: [signature], message: { accountKeys: [], instructions: [] } },
      };
    },
  };
  const indexer = new StakingIndexer({ rpc, store });
  indexer.metrics = { sharePrice: 1 };
  await assert.rejects(() => indexer.syncEvents(), /429/);
  assert.equal(savedCursor, 'older');
  assert.equal(indexer.status.lastSyncAt, undefined);
});

test('indexer consumes batched transactions without individual transaction lookups', async () => {
  let savedCursor = 'known-cursor';
  let transactionLookups = 0;
  const store = {
    limit: 100,
    append() {},
    count() { return 0; },
    getCursor() { return savedCursor; },
    setCursor(value) { savedCursor = value; },
    summarize() { return null; },
  };
  const transaction = {
    slot: 1,
    blockTime: 1,
    meta: { err: null, innerInstructions: [] },
    transaction: { signatures: ['new-signature'], message: { accountKeys: [], instructions: [] } },
  };
  const rpc = {
    url: 'https://rpc.example',
    scanUrl: 'https://rpc.example',
    async getTransactionsSince() {
      return [{ signature: 'new-signature', err: null, transaction }];
    },
    async getTransaction() {
      transactionLookups += 1;
      return transaction;
    },
  };
  const indexer = new StakingIndexer({ rpc, store });
  indexer.metrics = { sharePrice: 1 };

  await indexer.syncEvents();

  assert.equal(savedCursor, 'new-signature');
  assert.equal(transactionLookups, 0);
  assert.equal(indexer.status.lastSignatureBatchSize, 1);
});

test('a successful event sync does not hide an outstanding metrics failure', async () => {
  const store = {
    limit: 100,
    getCursor() { return null; },
    summarize() { return null; },
  };
  const rpc = {
    url: 'https://rpc.example',
    scanUrl: 'https://rpc.example',
    async getRecentSignatures() { return []; },
  };
  const indexer = new StakingIndexer({ rpc, store });
  indexer.metrics = { sharePrice: 1 };
  indexer.started = true;
  indexer.status.phase = 'live';
  indexer.recordError(new Error('metrics unavailable'), false, 'metrics');

  await indexer.syncEvents();
  assert.equal(indexer.status.metricsError, 'metrics unavailable');
  assert.equal(indexer.status.lastError, 'metrics unavailable');
  assert.equal(indexer.status.phase, 'degraded');
});
