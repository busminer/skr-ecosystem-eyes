export type Freshness = 'fresh' | 'aging' | 'stale' | 'unavailable';

// The server measures each source on its own clock: the vault metrics, the
// event stream and the queue scan run at different rhythms. One overall word
// for all three is misleading — the slowest source colours everything.
export type FreshnessDetail = {
  overall: Freshness;
  metrics: Freshness;
  events: Freshness;
  queue: Freshness;
  metricsAgeSec?: number;
  eventsAgeSec?: number;
  queueAgeSec?: number;
};

export type EventAlertThreshold = {
  standard: number;
  critical: number;
  highSensitivity?: number;
};

export type AlertThresholdConfig = {
  source: string;
  recalculatedAt: number;
  events: {
    stake: EventAlertThreshold;
    unstake: EventAlertThreshold;
    withdraw: EventAlertThreshold;
  };
};

export type EcosystemState = {
  alertThresholds?: AlertThresholdConfig;
  status: {
    phase: string;
    freshness: Freshness;
    freshnessDetail?: FreshnessDetail;
    lastMetricsAt: number | null;
    lastQueueScanAt: number | null;
    lastEventAt?: number | null;
  };
  metrics: {
    activeStaked: number;
    supply: number;
    stakedPercent: number;
    pendingUnstake: number;
    withdrawable: number;
    totalPositions: number;
    pendingPositions: number;
    unlockHorizon: {
      ready: number;
      next6h: number;
      next12h: number;
      next24h: number;
      next48h: number;
    };
    guardians: { count: number; topConcentrationPercent: number };
    queue: Array<{
      stakeAccount: string;
      wallet: string;
      name?: string | null;
      amount: number;
      unstakeTimestamp: number;
      unlockAt: number;
      status: 'cooldown' | 'withdrawable';
    }>;
    updatedAt: number;
  } | null;
  analytics: {
    coverageFrom: number | null;
    generatedAt: number;
    windows: Record<string, { staked: number; unstaked: number; withdrawn: number; netFlow: number; events: number; wallets: number }>;
    hourly: Array<{ from: number; staked: number; unstaked: number; withdrawn: number; events: number }>;
  };
};

export type WalletProfile = {
  wallet: string;
  found: boolean;
  // The .skr name from the server's mirror of the namespace; null when the wallet has none.
  name?: string | null;
  totals: {
    activeStaked: number;
    pendingUnstake: number;
    withdrawable: number;
    positions: number;
    activePositions: number;
    pendingPositions: number;
  };
  guardians: string[];
  nextUnlockAt: number | null;
  positions: Array<{
    stakeAccount: string;
    guardianPool: string;
    activeStaked: number;
    pendingUnstake: number;
    unlockAt: number | null;
    status: 'cooldown' | 'withdrawable' | null;
  }>;
  updatedAt: number;
  provenance: {
    commitment: 'finalized';
    sourceSlot: number | null;
    observedAt: number;
    scanMode: string;
    accuracy: string;
    caveat: string | null;
  };
};
