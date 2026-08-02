import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateFreshness, freshnessLevel } from '../src/freshness.js';

test('freshnessLevel marks fresh, aging and stale windows', () => {
  assert.equal(freshnessLevel(10, 120), 'fresh');
  assert.equal(freshnessLevel(80, 120), 'aging');
  assert.equal(freshnessLevel(200, 120), 'stale');
  assert.equal(freshnessLevel(null, 120), 'unknown');
});

test('evaluateFreshness picks the worst live signal', () => {
  const now = 1_800_000_200;
  const result = evaluateFreshness({
    now,
    lastMetricsAt: now - 20,
    lastSyncAt: now - 20,
    lastQueueScanAt: now - 1000,
    metricsStaleSec: 120,
    eventsStaleSec: 120,
    queueStaleSec: 960,
  });
  assert.equal(result.metrics, 'fresh');
  assert.equal(result.events, 'fresh');
  assert.equal(result.queue, 'stale');
  assert.equal(result.overall, 'stale');
  assert.equal(result.isStale, true);
});

test('evaluateFreshness does not call a partially initialized service fresh', () => {
  const now = 1_800_000_200;
  const result = evaluateFreshness({ now, lastSyncAt: now - 5 });
  assert.equal(result.events, 'fresh');
  assert.equal(result.metrics, 'unknown');
  assert.equal(result.queue, 'unknown');
  assert.equal(result.overall, 'unknown');
});
