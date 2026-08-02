import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeBase58 } from '../src/base58.js';
import { summarizeOnChainState } from '../src/metrics.js';
import { DEFAULT_GUARDIAN_POOL as GUARDIAN_POOL } from '../src/constants.js';

function writeU128(buffer, offset, value) {
  buffer.writeBigUInt64LE(value & ((1n << 64n) - 1n), offset);
  buffer.writeBigUInt64LE(value >> 64n, offset + 8);
}

function configData() {
  const data = Buffer.alloc(153);
  data.writeBigUInt64LE(1_000_000n, 105);
  data.writeBigUInt64LE(172_800n, 113);
  writeU128(data, 121, 4_500_000_000_000_000n);
  writeU128(data, 137, 1_100_000_000n);
  return data;
}

function position({ wallet, shares, pending, timestamp }) {
  const data = Buffer.alloc(128);
  decodeBase58(wallet).copy(data, 0);
  decodeBase58(GUARDIAN_POOL).copy(data, 32);
  writeU128(data, 64, shares);
  data.writeBigUInt64LE(pending, 112);
  data.writeBigInt64LE(BigInt(timestamp), 120);
  return { pubkey: `stake-${wallet.slice(0, 4)}`, account: { data: [data.toString('base64'), 'base64'] } };
}

const WALLET_A = '3xMZwaVNe4kH3722hEnT21MP4fg8EcWAV2QSFfQDW6Ma';
const WALLET_B = 'HHR4LJCFSBpw2D8trzE7ki5AWJA2eejwyJ3tY5ESu44B';

test('summarizeOnChainState computes staking, queue and ecosystem metrics', () => {
  const now = 1_800_000_000;
  const summary = summarizeOnChainState({
    configData: configData(),
    vaultRaw: 5_000_000_000_000_000n,
    supplyRaw: 10_000_000_000_000_000n,
    userStakeAccounts: [
      position({ wallet: WALLET_A, shares: 100_000_000n, pending: 500_000_000n, timestamp: now - 100 }),
      position({ wallet: WALLET_B, shares: 0n, pending: 2_000_000_000n, timestamp: now - 200_000 }),
    ],
    now,
  });

  assert.equal(summary.activeStaked, 4_950_000_000);
  assert.equal(summary.vaultBalance, 5_000_000_000);
  assert.equal(summary.stakedPercent, 49.5);
  assert.equal(summary.sharePrice, 1.1);
  assert.equal(summary.pendingUnstake, 2_500);
  assert.equal(summary.withdrawable, 2_000);
  assert.equal(summary.totalPositions, 2);
  assert.equal(summary.activePositions, 1);
  assert.equal(summary.pendingPositions, 2);
  assert.equal(summary.queue[0].wallet, WALLET_B);
  assert.equal(summary.queue[0].status, 'withdrawable');
  assert.equal(summary.guardians.count, 1);
  assert.equal(summary.guardians.top[0].guardianPool, GUARDIAN_POOL);
  assert.equal(summary.guardians.top[0].activeStaked, 110);
  assert.equal(summary.guardians.top[0].positions, 1);
});

test('summarizeOnChainState aggregates the complete 48 hour unlock horizon', () => {
  const now = 1_800_000_000;
  const cooldown = 172_800;
  const summary = summarizeOnChainState({
    configData: configData(),
    vaultRaw: 5_000_000_000_000_000n,
    supplyRaw: 10_000_000_000_000_000n,
    userStakeAccounts: [
      position({ wallet: WALLET_A, shares: 0n, pending: 1_000_000n, timestamp: now - cooldown - 1 }),
      position({ wallet: WALLET_A, shares: 0n, pending: 2_000_000n, timestamp: now - cooldown + 3_600 }),
      position({ wallet: WALLET_A, shares: 0n, pending: 3_000_000n, timestamp: now - cooldown + 28_800 }),
      position({ wallet: WALLET_B, shares: 0n, pending: 4_000_000n, timestamp: now - cooldown + 64_800 }),
      position({ wallet: WALLET_B, shares: 0n, pending: 5_000_000n, timestamp: now - cooldown + 129_600 }),
    ],
    now,
  });

  assert.deepEqual(summary.unlockHorizon, {
    ready: 1,
    next6h: 2,
    next12h: 3,
    next24h: 4,
    next48h: 5,
  });
});
