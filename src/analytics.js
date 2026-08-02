const WINDOWS = { '1h': 3_600, '24h': 86_400, '7d': 604_800 };

function emptyFlow() {
  return { staked: 0, unstaked: 0, withdrawn: 0, cancelled: 0, netFlow: 0, events: 0, wallets: 0 };
}

function addEvent(flow, event) {
  const amount = Number(event.amount) || 0;
  if (event.type === 'stake') flow.staked += amount;
  if (event.type === 'unstake') flow.unstaked += amount;
  if (event.type === 'withdraw') flow.withdrawn += amount;
  if (event.type === 'cancel_unstake') flow.cancelled += 1;
  flow.events += 1;
}

export function summarizeEvents(events = [], now = Math.floor(Date.now() / 1000)) {
  const valid = events.filter((event) => Number.isFinite(event.blockTime));
  const windows = {};
  for (const [label, seconds] of Object.entries(WINDOWS)) {
    const flow = emptyFlow();
    const wallets = new Set();
    for (const event of valid) {
      if (event.blockTime < now - seconds || event.blockTime > now + 60) continue;
      addEvent(flow, event);
      if (event.wallet) wallets.add(event.wallet);
    }
    flow.netFlow = flow.staked - flow.unstaked;
    flow.wallets = wallets.size;
    windows[label] = flow;
  }

  const hourly = Array.from({ length: 24 }, (_, index) => ({
    from: now - (23 - index) * 3_600,
    staked: 0,
    unstaked: 0,
    withdrawn: 0,
    events: 0,
  }));
  for (const event of valid) {
    const age = now - event.blockTime;
    if (age < 0 || age >= 86_400) continue;
    const index = 23 - Math.floor(age / 3_600);
    addEvent(hourly[index], event);
  }

  const whales = valid
    .filter((event) => Number(event.amount) >= 100_000)
    .sort((a, b) => Number(b.amount) - Number(a.amount))
    .slice(0, 20);

  return {
    windows,
    hourly,
    whales,
    coverageFrom: valid.length ? Math.min(...valid.map((event) => event.blockTime)) : null,
    generatedAt: now,
  };
}
