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
