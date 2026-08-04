export const MINIMUM_REWARDS_HISTORY_SECONDS = 7 * 86_400;

export function calculateConstantShareReturn(start, end) {
  const startPrice = Number(start?.sharePrice);
  const endPrice = Number(end?.sharePrice);
  if (!Number.isFinite(startPrice) || !Number.isFinite(endPrice) || startPrice <= 0 || endPrice <= 0) {
    throw new Error('Valid positive share prices are required');
  }
  const seconds = Number(end.unixTs) - Number(start.unixTs);
  return {
    available: seconds >= MINIMUM_REWARDS_HISTORY_SECONDS,
    coverageSeconds: seconds,
    availableAt: Number(start.unixTs) + MINIMUM_REWARDS_HISTORY_SECONDS,
    returnRatio: endPrice / startPrice - 1,
  };
}
