import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const file = process.argv[2];
if (!file) {
  console.error('Usage: node scripts/analyze-event-distribution.mjs <events.sqlite>');
  process.exit(2);
}

const db = new DatabaseSync(path.resolve(file), { readOnly: true });
const integrity = db.prepare('PRAGMA integrity_check').get().integrity_check;
if (integrity !== 'ok') throw new Error(`Database integrity check failed: ${integrity}`);
const newest = Number(db.prepare('SELECT MAX(block_time) AS value FROM events').get().value || 0);
const coverageFrom = Number(db.prepare('SELECT MIN(block_time) AS value FROM events').get().value || 0);
const types = ['stake', 'unstake', 'withdraw'];
const windows = { '24h': 86_400, '7d': 604_800, '30d': 2_592_000 };
const thresholds = [10_000, 50_000, 100_000, 500_000, 1_000_000];
const percentilePoints = [0.5, 0.9, 0.99, 0.999, 0.995, 0.9995];

function percentile(sorted, point) {
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(point * sorted.length) - 1))];
}

const distributions = {};
for (const [window, seconds] of Object.entries(windows)) {
  distributions[window] = {};
  for (const type of types) {
    const values = db.prepare(`
      SELECT amount FROM events
      WHERE type = ? AND block_time >= ? AND block_time <= ? AND amount IS NOT NULL AND amount >= 0
      ORDER BY amount
    `).all(type, newest - seconds, newest).map((row) => Number(row.amount));
    distributions[window][type] = {
      count: values.length,
      p50: percentile(values, 0.5),
      p90: percentile(values, 0.9),
      p99: percentile(values, 0.99),
      p99_5: percentile(values, 0.995),
      p99_9: percentile(values, 0.999),
      p99_95: percentile(values, 0.9995),
      max: values.length ? values.at(-1) : null,
    };
  }
}

const simulations = {};
const observedSeconds = Math.max(1, Math.min(windows['30d'], newest - coverageFrom));
for (const threshold of thresholds) {
  const rows = db.prepare(`
    SELECT type, COUNT(*) AS count FROM events
    WHERE block_time >= ? AND block_time <= ? AND amount >= ?
    GROUP BY type
  `).all(newest - windows['30d'], newest, threshold);
  const byType = Object.fromEntries(types.map((type) => [type, 0]));
  for (const row of rows) byType[row.type] = Number(row.count);
  const total = Object.values(byType).reduce((sum, count) => sum + count, 0);
  simulations[threshold] = { ...byType, total, observedDays: observedSeconds / 86_400, projectedPerWeek: total / (observedSeconds / 604_800) };
}

console.log(JSON.stringify({ file: path.resolve(file), integrity, newest, coverageFrom, coverageDays: (newest - coverageFrom) / 86_400, totalEvents: Number(db.prepare('SELECT COUNT(*) AS value FROM events').get().value || 0), percentilePoints, distributions, simulations }, null, 2));
db.close();
