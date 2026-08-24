export function compact(value: number): string {
  const absolute = Math.abs(value);
  if (absolute >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}B`;
  if (absolute >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (absolute >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

export function integer(value: number): string {
  return Math.round(value).toLocaleString('en-US', { maximumFractionDigits: 0 });
}

export const shortAddress = (value: string) => value ? `${value.slice(0, 4)}…${value.slice(-4)}` : '';

export function relativeTime(timestamp: number | null): string {
  if (!timestamp) return 'Unavailable';
  const seconds = Math.max(0, Math.floor(Date.now() / 1000) - timestamp);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3_600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3_600)}h ago`;
}
