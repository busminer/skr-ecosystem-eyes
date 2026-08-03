import assert from 'node:assert/strict';
import test from 'node:test';
import { buildRangeView } from '../public/range-view.js';

const generatedAt = 1_800_000_000;
const analytics = {
  generatedAt,
  coverageFrom: generatedAt - 9 * 3_600,
  windows: {
    '1h': { staked: 120, unstaked: 20, withdrawn: 4, netFlow: 100, events: 7, wallets: 5 },
    '24h': { staked: 500, unstaked: 250, withdrawn: 20, netFlow: 250, events: 30, wallets: 18 },
    '7d': { staked: 700, unstaked: 300, withdrawn: 40, netFlow: 400, events: 44, wallets: 27 },
    '30d': { staked: 900, unstaked: 450, withdrawn: 80, netFlow: 450, events: 60, wallets: 35 },
  },
};

test('buildRangeView selects the requested analytics window', () => {
  const view = buildRangeView(analytics, '7d', generatedAt);
  assert.equal(view.key, '7d');
  assert.equal(view.label, '7D');
  assert.equal(view.flow.events, 44);
  assert.equal(view.coverageLabel, '9H / 7D');
});

test('buildRangeView refuses to infer a verdict from partial coverage', () => {
  const view = buildRangeView(analytics, '24h', generatedAt);
  assert.equal(view.complete, false);
  assert.deepEqual(view.verdict, ['PARTIAL VIEW', '', '9H OF 24H INDEXED']);
});

test('buildRangeView produces a verdict only for a complete window', () => {
  const complete = { ...analytics, coverageFrom: generatedAt - 8 * 86_400 };
  const view = buildRangeView(complete, '7d', generatedAt);
  assert.equal(view.complete, true);
  assert.equal(view.coverageLabel, '7D COMPLETE');
  assert.equal(view.verdict[0], 'ACCUMULATING');
});

test('buildRangeView falls back to 24h for an unsupported range', () => {
  const view = buildRangeView(analytics, '90d', generatedAt);
  assert.equal(view.key, '24h');
  assert.equal(view.flow.events, 30);
});

test('buildRangeView treats missing coverage as partial instead of epoch-wide history', () => {
  const view = buildRangeView({ generatedAt, coverageFrom: null, windows: {} }, '24h', generatedAt);
  assert.equal(view.complete, false);
  assert.equal(view.coverageLabel, '0M / 24H');
  assert.deepEqual(view.verdict, ['PARTIAL VIEW', '', '0M OF 24H INDEXED']);
});
