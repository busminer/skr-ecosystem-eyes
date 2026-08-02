import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeEvents } from '../src/analytics.js';

const now = 1_800_000_000;
const event = (type, amount, age, wallet = 'wallet') => ({ type, amount, blockTime: now - age, wallet, signature: `${type}-${age}` });

test('summarizeEvents computes flows, whales and 24 hour chart buckets', () => {
  const stats = summarizeEvents([
    event('stake', 1_000_000, 60),
    event('stake', 500, 600),
    event('unstake', 250_000, 120),
    event('withdraw', 50_000, 180),
    event('stake', 100, 90_000),
  ], now);

  assert.equal(stats.windows['1h'].staked, 1_000_500);
  assert.equal(stats.windows['1h'].unstaked, 250_000);
  assert.equal(stats.windows['1h'].withdrawn, 50_000);
  assert.equal(stats.windows['1h'].netFlow, 750_500);
  assert.equal(stats.windows['24h'].events, 4);
  assert.equal(stats.whales[0].amount, 1_000_000);
  assert.equal(stats.hourly.length, 24);
  assert.equal(stats.hourly.at(-1).staked, 1_000_500);
});
