export const ANALYTICS_RANGES = Object.freeze({
  '1h': { label: '1H', seconds: 3_600 },
  '24h': { label: '24H', seconds: 86_400 },
  '7d': { label: '7D', seconds: 604_800 },
  '30d': { label: '30D', seconds: 2_592_000 },
});

const EMPTY_FLOW = Object.freeze({
  staked: 0,
  unstaked: 0,
  withdrawn: 0,
  cancelled: 0,
  netFlow: 0,
  events: 0,
  wallets: 0,
});

function compactDuration(seconds) {
  if (seconds < 3_600) return `${Math.floor(seconds / 60)}M`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3_600)}H`;
  return `${Math.floor(seconds / 86_400)}D`;
}

export function buildRangeView(analytics, range = '24h', now = analytics?.generatedAt) {
  const key = ANALYTICS_RANGES[range] ? range : '24h';
  const config = ANALYTICS_RANGES[key];
  const generatedAt = Number.isFinite(Number(now)) ? Number(now) : Math.floor(Date.now() / 1_000);
  const rawCoverageFrom = analytics?.coverageFrom;
  const coverageFrom = Number(rawCoverageFrom);
  const hasCoverage = rawCoverageFrom != null && Number.isFinite(coverageFrom) && coverageFrom > 0;
  const coverageSeconds = hasCoverage
    ? Math.max(0, Math.min(config.seconds, generatedAt - coverageFrom))
    : 0;
  const complete = coverageSeconds >= config.seconds;
  const coveredLabel = compactDuration(coverageSeconds);
  const flow = analytics?.windows?.[key] || EMPTY_FLOW;
  const grossFlow = Number(flow.staked || 0) + Number(flow.unstaked || 0);
  const flowRatio = grossFlow > 0 ? Number(flow.netFlow || 0) / grossFlow : 0;

  let verdict = ['PARTIAL VIEW', '', `${coveredLabel} OF ${config.label} INDEXED`];
  if (complete && flowRatio >= 0.1) verdict = ['ACCUMULATING', 'positive', `NET FLOW IS ${(flowRatio * 100).toFixed(1)}% OF GROSS FLOW`];
  else if (complete && flowRatio <= -0.1) verdict = ['EXIT PRESSURE RISING', 'negative', `NET FLOW IS ${(flowRatio * 100).toFixed(1)}% OF GROSS FLOW`];
  else if (complete) verdict = ['BALANCED', 'balanced', 'NET FLOW WITHIN ±10% OF GROSS FLOW'];

  return {
    key,
    label: config.label,
    flow,
    coverageSeconds,
    complete,
    coverageLabel: complete ? `${config.label} COMPLETE` : `${coveredLabel} / ${config.label}`,
    verdict,
  };
}
