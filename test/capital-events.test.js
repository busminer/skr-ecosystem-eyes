import assert from 'node:assert/strict';
import test from 'node:test';
import {
  capitalConcurrency,
  collectUnseenEvents,
  formatCapitalAmount,
  normalizeCapitalEvent,
  progressForDirection,
  shouldAnimateCapitalEvent,
} from '../public/capital-events.js';

const event = (overrides = {}) => ({
  id: 'sig:0',
  signature: 'sig',
  blockTime: 1_800_000_000,
  type: 'stake',
  wallet: '7Jk111111111111111111111111111111111pQ2',
  amount: 284_000,
  ...overrides,
});

test('normalizeCapitalEvent routes stake forward with a signed exact amount', () => {
  const result = normalizeCapitalEvent(event());
  assert.equal(result.lane, 0);
  assert.equal(result.direction, 1);
  assert.equal(result.action, 'STAKE');
  assert.equal(result.destination, 'TO STAKING VAULT');
  assert.equal(result.presentation, 'route');
  assert.equal(result.amountLabel, '+284K SKR');
  assert.equal(result.walletLabel, '7Jk1…1pQ2');
  assert.equal(result.approximate, false);
});

test('normalizeCapitalEvent routes unstake backward and marks its current-price estimate', () => {
  const result = normalizeCapitalEvent(event({ type: 'unstake', amount: 91_500 }));
  assert.equal(result.lane, 1);
  assert.equal(result.direction, -1);
  assert.equal(result.action, 'UNSTAKE');
  assert.equal(result.destination, 'TO 48H COOLDOWN');
  assert.equal(result.presentation, 'route');
  assert.equal(result.amountLabel, '≈−91.5K SKR');
  assert.equal(result.approximate, true);
});

test('normalizeCapitalEvent distinguishes withdraw and amountless cancel routes', () => {
  const withdraw = normalizeCapitalEvent(event({ type: 'withdraw', amount: 40_000 }));
  assert.equal(withdraw.lane, 2);
  assert.equal(withdraw.direction, 1);
  assert.equal(withdraw.amountLabel, '−40K SKR');
  assert.equal(withdraw.destination, 'EXIT CONFIRMED');
  assert.equal(withdraw.presentation, 'receipt');

  const cancel = normalizeCapitalEvent(event({ type: 'cancel_unstake', amount: null }));
  assert.equal(cancel.lane, 1);
  assert.equal(cancel.direction, 1);
  assert.equal(cancel.amountLabel, 'AMOUNT UNAVAILABLE');
  assert.equal(cancel.destination, 'BACK TO ACTIVE');
  assert.equal(cancel.presentation, 'route');
});

test('normalizeCapitalEvent refuses unsupported event types instead of faking a stake', () => {
  assert.equal(normalizeCapitalEvent(event({ type: 'future_instruction' })), null);
});

test('formatCapitalAmount preserves useful precision without raw-number noise', () => {
  assert.equal(formatCapitalAmount(999, '+'), '+999 SKR');
  assert.equal(formatCapitalAmount(12_345, '+'), '+12.35K SKR');
  assert.equal(formatCapitalAmount(4_500_000, '−'), '−4.5M SKR');
  assert.equal(formatCapitalAmount(null, '+'), 'AMOUNT UNAVAILABLE');
});

test('progressForDirection makes unstake travel in reverse', () => {
  assert.equal(progressForDirection(0.25, 1), 0.25);
  assert.equal(progressForDirection(0.25, -1), 0.75);
});

test('capitalConcurrency serializes labels on mobile and limits desktop to one flight per route', () => {
  assert.equal(capitalConcurrency(368), 1);
  assert.equal(capitalConcurrency(519), 1);
  assert.equal(capitalConcurrency(520), 2);
  assert.equal(capitalConcurrency(713), 2);
});

test('shouldAnimateCapitalEvent rejects stale backfill but accepts fresh or unknown-time live events', () => {
  const now = 1_800_000_000;
  assert.equal(shouldAnimateCapitalEvent(event({ blockTime: now - 30 }), now), true);
  assert.equal(shouldAnimateCapitalEvent(event({ blockTime: now - 120 }), now), true);
  assert.equal(shouldAnimateCapitalEvent(event({ blockTime: now - 121 }), now), false);
  assert.equal(shouldAnimateCapitalEvent(event({ blockTime: null }), now), true);
});

test('collectUnseenEvents seeds history without replay then emits only new events oldest first', () => {
  const history = [event({ id: 'newer', blockTime: 20 }), event({ id: 'older', blockTime: 10 })];
  const seeded = collectUnseenEvents(history, new Set(), true);
  assert.deepEqual(seeded.events, []);
  assert.deepEqual([...seeded.seen].sort(), ['newer', 'older']);

  const next = collectUnseenEvents([
    event({ id: 'latest', blockTime: 30 }),
    ...history,
  ], seeded.seen, false);
  assert.deepEqual(next.events.map((item) => item.id), ['latest']);

  const ordered = collectUnseenEvents([
    event({ id: 'third', blockTime: 40 }),
    event({ id: 'second', blockTime: 35 }),
    ...history,
  ], seeded.seen, false);
  assert.deepEqual(ordered.events.map((item) => item.id), ['second', 'third']);
});

test('collectUnseenEvents bounds the browser dedupe ledger without losing newest IDs', () => {
  const result = collectUnseenEvents([
    event({ id: 'four', blockTime: 4 }),
    event({ id: 'three', blockTime: 3 }),
    event({ id: 'two', blockTime: 2 }),
  ], new Set(['one']), false, 3);
  assert.deepEqual([...result.seen], ['two', 'three', 'four']);
});
