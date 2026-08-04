import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateConstantShareReturn, MINIMUM_REWARDS_HISTORY_SECONDS } from '../src/rewards-history.js';

test('rewards history remains unavailable before seven full days', () => {
  const result = calculateConstantShareReturn({ unixTs: 100, sharePrice: '1.1' }, { unixTs: 100 + MINIMUM_REWARDS_HISTORY_SECONDS - 1, sharePrice: '1.2' });
  assert.equal(result.available, false);
  assert.equal(result.availableAt, 100 + MINIMUM_REWARDS_HISTORY_SECONDS);
});

test('rewards history calculates constant-share return after seven full days', () => {
  const result = calculateConstantShareReturn({ unixTs: 100, sharePrice: '1' }, { unixTs: 100 + MINIMUM_REWARDS_HISTORY_SECONDS, sharePrice: '1.12' });
  assert.equal(result.available, true);
  assert.ok(Math.abs(result.returnRatio - 0.12) < 1e-12);
});
