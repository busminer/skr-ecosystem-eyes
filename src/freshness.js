export function ageSeconds(timestamp, now = Math.floor(Date.now() / 1000)) {
  if (timestamp == null || !Number.isFinite(Number(timestamp))) return null;
  return Math.max(0, now - Number(timestamp));
}

export function freshnessLevel(ageSec, staleAfterSec) {
  if (ageSec == null) return 'unknown';
  if (ageSec <= staleAfterSec * 0.5) return 'fresh';
  if (ageSec <= staleAfterSec) return 'aging';
  return 'stale';
}

export function evaluateFreshness({
  now = Math.floor(Date.now() / 1000),
  lastMetricsAt = null,
  lastSyncAt = null,
  lastQueueScanAt = null,
  metricsStaleSec = Number(process.env.METRICS_STALE_SEC || 120),
  eventsStaleSec = Number(process.env.EVENTS_STALE_SEC || 120),
  queueStaleSec = Number(process.env.QUEUE_STALE_SEC || 960),
} = {}) {
  const metricsAgeSec = ageSeconds(lastMetricsAt, now);
  const eventsAgeSec = ageSeconds(lastSyncAt, now);
  const queueAgeSec = ageSeconds(lastQueueScanAt ?? lastMetricsAt, now);

  const metrics = freshnessLevel(metricsAgeSec, metricsStaleSec);
  const events = freshnessLevel(eventsAgeSec, eventsStaleSec);
  const queue = freshnessLevel(queueAgeSec, queueStaleSec);

  const rank = { unknown: 0, fresh: 1, aging: 2, stale: 3 };
  const overall = [metrics, events, queue].sort((left, right) => rank[right] - rank[left])[0] || 'unknown';

  return {
    overall,
    metrics,
    events,
    queue,
    metricsAgeSec,
    eventsAgeSec,
    queueAgeSec,
    metricsStaleSec,
    eventsStaleSec,
    queueStaleSec,
    isStale: overall === 'stale',
  };
}
