import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEventEvidence } from '../src/event-evidence.js';

const base = { signature: 'sig', slot: 123, blockTime: 1_800_000_000, instructionIndex: 2, wallet: 'wallet' };

test('buildEventEvidence distinguishes exact, estimated and unavailable amount methods', () => {
  const stake = buildEventEvidence({ ...base, type: 'stake', amount: 12, rawAmount: '12000000' });
  assert.equal(stake.amount.status, 'exact');
  assert.match(stake.amount.method, /instruction data/i);

  const unstake = buildEventEvidence({ ...base, type: 'unstake', amount: 9, rawAmount: '9000000' });
  assert.equal(unstake.amount.status, 'estimated');
  assert.match(unstake.amount.caveat, /current share price/i);

  const withdraw = buildEventEvidence({ ...base, type: 'withdraw', amount: 7, rawAmount: '7000000' });
  assert.equal(withdraw.amount.status, 'exact');
  assert.match(withdraw.amount.method, /vault token-balance delta/i);

  const cancel = buildEventEvidence({ ...base, type: 'cancel_unstake', amount: null, rawAmount: null });
  assert.equal(cancel.amount.status, 'unavailable');
  assert.equal(cancel.amount.value, null);
});

test('buildEventEvidence preserves finalized transaction proof fields', () => {
  const evidence = buildEventEvidence({ ...base, type: 'stake', amount: 12, rawAmount: '12000000', guardianPool: 'guardian' });
  assert.deepEqual(evidence.transaction, {
    commitment: 'finalized', signature: 'sig', slot: 123, blockTime: 1_800_000_000, instructionIndex: 2,
  });
  assert.deepEqual(evidence.accounts, { wallet: 'wallet', guardianPool: 'guardian' });
});

test('buildEventEvidence distinguishes exact transaction totals from mixed net withdraws', () => {
  const total = buildEventEvidence({ ...base, type: 'withdraw', amount: 12, rawAmount: '12000000', aggregation: 'transaction-total' });
  assert.equal(total.amount.status, 'exact');
  assert.match(total.amount.method, /aggregate/i);

  const mixed = buildEventEvidence({ ...base, type: 'withdraw', amount: 10, rawAmount: '10000000', aggregation: 'transaction-net' });
  assert.equal(mixed.amount.status, 'estimated');
  assert.match(mixed.amount.caveat, /other Stake Vault movements/i);
});
