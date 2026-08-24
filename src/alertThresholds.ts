import type { AlertThresholdConfig, EcosystemState, EventAlertThreshold } from './types';

const existingFallback: EventAlertThreshold = {
  standard: 100_000,
  critical: 1_000_000,
  highSensitivity: 10_000,
};

export const FALLBACK_ALERT_THRESHOLDS: AlertThresholdConfig = {
  source: 'Bundled fallback',
  recalculatedAt: 0,
  events: {
    stake: { ...existingFallback },
    unstake: { ...existingFallback },
    withdraw: { ...existingFallback },
  },
};

function validEventThreshold(value: EventAlertThreshold | undefined): value is EventAlertThreshold {
  return Boolean(value
    && Number.isFinite(value.standard) && value.standard > 0
    && Number.isFinite(value.critical) && value.critical >= value.standard
    && (value.highSensitivity == null || (Number.isFinite(value.highSensitivity) && value.highSensitivity > 0)));
}

export function resolveAlertThresholds(state: EcosystemState | null): { config: AlertThresholdConfig; fallback: boolean } {
  const candidate = state?.alertThresholds;
  if (candidate
    && typeof candidate.source === 'string' && candidate.source.trim()
    && Number.isFinite(candidate.recalculatedAt) && candidate.recalculatedAt > 0
    && validEventThreshold(candidate.events?.stake)
    && validEventThreshold(candidate.events?.unstake)
    && validEventThreshold(candidate.events?.withdraw)) {
    return { config: candidate, fallback: false };
  }
  return { config: FALLBACK_ALERT_THRESHOLDS, fallback: true };
}
