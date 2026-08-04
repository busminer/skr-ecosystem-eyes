const ROUTES = {
  stake: {
    lane: 0,
    direction: 1,
    action: 'STAKE',
    destination: 'TO STAKING VAULT',
    presentation: 'route',
    sign: '+',
    color: '#5ce9b5',
    approximate: false,
  },
  unstake: {
    lane: 1,
    direction: -1,
    action: 'UNSTAKE',
    destination: 'TO 48H COOLDOWN',
    presentation: 'route',
    sign: '−',
    color: '#ffb45d',
    approximate: true,
  },
  cancel_unstake: {
    lane: 1,
    direction: 1,
    action: 'CANCEL',
    destination: 'BACK TO ACTIVE',
    presentation: 'route',
    sign: '',
    color: '#a291ff',
    approximate: false,
  },
  withdraw: {
    lane: 2,
    direction: 1,
    action: 'WITHDRAW',
    destination: 'EXIT CONFIRMED',
    presentation: 'receipt',
    sign: '−',
    color: '#ff6577',
    approximate: false,
  },
};

const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));

function abbreviated(value) {
  const absolute = Math.abs(Number(value));
  const units = [
    [1_000_000_000, 'B'],
    [1_000_000, 'M'],
    [1_000, 'K'],
  ];
  for (const [threshold, suffix] of units) {
    if (absolute >= threshold) {
      const scaled = absolute / threshold;
      const digits = scaled >= 100 ? 0 : scaled >= 10 ? 2 : 2;
      return `${Number(scaled.toFixed(digits))}${suffix}`;
    }
  }
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(absolute);
}

export function formatCapitalAmount(value, sign = '') {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return 'AMOUNT UNAVAILABLE';
  return `${sign}${abbreviated(value)} SKR`;
}

export function shortCapitalWallet(wallet) {
  if (!wallet) return 'WALLET UNKNOWN';
  return wallet.length > 10 ? `${wallet.slice(0, 4)}…${wallet.slice(-4)}` : wallet;
}

export function normalizeCapitalEvent(event) {
  const route = ROUTES[event?.type];
  if (!route) return null;
  const amount = event?.amount === null || event?.amount === undefined ? null : Number(event.amount);
  const amountLabel = formatCapitalAmount(amount, route.sign);
  const magnitude = amount === null ? .28 : clamp(Math.log10(Math.max(1, amount) + 1) / 8, .28, 1);
  return {
    id: event?.id || `${event?.signature || 'event'}:${event?.instructionIndex || 0}`,
    signature: event?.signature || null,
    blockTime: event?.blockTime || null,
    type: event?.type || 'stake',
    lane: route.lane,
    direction: route.direction,
    action: route.action,
    destination: route.destination,
    presentation: route.presentation,
    color: route.color,
    approximate: route.approximate,
    amount,
    amountLabel: route.approximate && amount !== null ? `≈${amountLabel}` : amountLabel,
    wallet: event?.wallet || null,
    walletLabel: shortCapitalWallet(event?.wallet),
    magnitude,
    duration: 4.7 - magnitude * 1.25,
  };
}

export function progressForDirection(progress, direction) {
  const bounded = clamp(progress, 0, 1);
  return direction < 0 ? 1 - bounded : bounded;
}

export function capitalConcurrency(width) {
  return Number(width) < 520 ? 1 : 2;
}

export function shouldAnimateCapitalEvent(event, nowSeconds = Math.floor(Date.now() / 1000), maxAgeSeconds = 120) {
  const blockTime = Number(event?.blockTime);
  if (!Number.isFinite(blockTime) || blockTime <= 0) return true;
  return nowSeconds - blockTime <= maxAgeSeconds;
}

export function collectUnseenEvents(events, currentSeen = new Set(), initialize = false, maxSeen = 2_000) {
  const seen = new Set(currentSeen);
  const unseen = [];
  const ordered = [...(events || [])]
    .sort((a, b) => Number(a?.blockTime || 0) - Number(b?.blockTime || 0));
  for (const event of ordered) {
    if (!event?.id) continue;
    if (!initialize && !seen.has(event.id)) unseen.push(event);
    seen.add(event.id);
  }
  while (seen.size > maxSeen) seen.delete(seen.values().next().value);
  return { events: unseen, seen };
}

export const CAPITAL_EVENT_ROUTES = Object.freeze(ROUTES);
