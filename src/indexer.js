import { EventEmitter } from 'node:events';
import { summarizeEvents } from './analytics.js';
import { buildEventEvidence } from './event-evidence.js';
import { evaluateFreshness } from './freshness.js';
import { maskRpcUrl } from './http-utils.js';
import { summarizeOnChainState } from './metrics.js';
import { buildProvenance, USER_STAKE_SCAN_CAVEAT } from './provenance.js';
import { parseStakingTransaction } from './transaction.js';

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export class StakingIndexer extends EventEmitter {
  constructor({
    rpc,
    store,
    pollMs = Number(process.env.POLL_INTERVAL_MS || process.env.POLL_MS || 8_000),
    metricsRefreshMs = Number(process.env.METRICS_INTERVAL_MS || 60_000),
    queueRefreshMs = Number(process.env.QUEUE_INTERVAL_MS || process.env.QUEUE_REFRESH_MS || 900_000),
    initialBackfillLimit = Number(process.env.INITIAL_BACKFILL_LIMIT || 25),
    startRetries = Number(process.env.INDEXER_START_RETRIES || 5),
    startRetryMs = Number(process.env.INDEXER_START_RETRY_MS || 2_000),
  } = {}) {
    super();
    this.rpc = rpc;
    this.store = store;
    this.pollMs = pollMs;
    this.metricsRefreshMs = metricsRefreshMs;
    this.queueRefreshMs = queueRefreshMs;
    this.initialBackfillLimit = Math.max(1, initialBackfillLimit);
    this.startRetries = Math.max(1, startRetries);
    this.startRetryMs = Math.max(250, startRetryMs);
    this.events = [];
    this.metrics = null;
    this.userStakeAccounts = [];
    this.sourceSlots = {};
    this.userStakeSlot = null;
    this.known = new Set();
    this.syncing = false;
    this.started = false;
    this.status = {
      phase: 'starting',
      rpc: maskRpcUrl(rpc?.url),
      scanRpc: maskRpcUrl(rpc?.scanUrl),
      lastError: null,
      lastErrorAt: null,
      lastEventAt: null,
      lastQueueScanAt: null,
      startedAt: Math.floor(Date.now() / 1000),
      startAttempts: 0,
      userStakeAccountCount: 0,
      userStakeScanMode: 'single-response-filtered',
      userStakePageCount: 0,
    };
  }

  publicStatus() {
    const freshness = evaluateFreshness({
      lastMetricsAt: this.status.lastMetricsAt || null,
      lastSyncAt: this.status.lastSyncAt || null,
      lastQueueScanAt: this.status.lastQueueScanAt || null,
    });
    return {
      phase: this.status.phase,
      rpc: this.status.rpc,
      scanRpc: this.status.scanRpc,
      lastError: this.status.lastError,
      lastErrorAt: this.status.lastErrorAt,
      lastEventAt: this.status.lastEventAt,
      startedAt: this.status.startedAt,
      lastMetricsAt: this.status.lastMetricsAt || null,
      lastSyncAt: this.status.lastSyncAt || null,
      lastQueueScanAt: this.status.lastQueueScanAt || null,
      startAttempts: this.status.startAttempts || 0,
      userStakeAccountCount: this.status.userStakeAccountCount || 0,
      userStakeScanMode: this.status.userStakeScanMode || 'single-response-filtered',
      userStakePageCount: this.status.userStakePageCount || 0,
      freshness: freshness.overall,
      freshnessDetail: freshness,
    };
  }

  async start() {
    this.events = await this.store.load();
    this.events.forEach((event) => this.known.add(event.id));
    this.emitState();

    let attempt = 0;
    let lastError = null;
    while (attempt < this.startRetries) {
      attempt += 1;
      this.status.startAttempts = attempt;
      this.status.phase = attempt === 1 ? 'starting' : 'retrying';
      this.emitState();
      try {
        await this.refreshMetrics(true);
        await this.syncEvents(true);
        this.status.phase = 'live';
        this.status.lastError = null;
        this.started = true;
        this.emitState();
        this.#armTimers();
        return;
      } catch (error) {
        lastError = error;
        this.recordError(error);
        if (attempt >= this.startRetries) break;
        await delay(this.startRetryMs * attempt);
      }
    }

    this.status.phase = 'degraded';
    this.started = true;
    this.#armTimers();
    this.emitState();
    throw lastError || new Error('Indexer startup failed');
  }

  #armTimers() {
    if (this.pollTimer || this.metricsTimer || this.queueTimer) return;
    this.pollTimer = setInterval(() => this.syncEvents().catch((error) => this.recordError(error)), this.pollMs);
    this.metricsTimer = setInterval(() => this.refreshMetrics(false).catch((error) => this.recordError(error)), this.metricsRefreshMs);
    this.queueTimer = setInterval(() => this.refreshMetrics(true).catch((error) => this.recordError(error)), this.queueRefreshMs);
    for (const timer of [this.pollTimer, this.metricsTimer, this.queueTimer]) {
      if (typeof timer?.unref === 'function') timer.unref();
    }
  }

  stop() {
    clearInterval(this.pollTimer);
    clearInterval(this.metricsTimer);
    clearInterval(this.queueTimer);
    this.pollTimer = null;
    this.metricsTimer = null;
    this.queueTimer = null;
  }

  async refreshMetrics(scanQueue) {
    this.status.phase = scanQueue ? 'scanning-positions' : this.status.phase;
    const core = await this.rpc.getCoreInputs();
    this.sourceSlots = { ...this.sourceSlots, ...(core.sourceSlots || {}) };
    if (scanQueue || this.userStakeAccounts.length === 0) {
      const snapshot = await this.rpc.getUserStakeAccounts();
      this.userStakeAccounts = Array.isArray(snapshot) ? snapshot : snapshot.accounts;
      this.userStakeSlot = Array.isArray(snapshot) ? null : snapshot.slot;
      this.sourceSlots.userStake = this.userStakeSlot;
      this.status.lastQueueScanAt = Math.floor(Date.now() / 1000);
      this.status.userStakeAccountCount = this.userStakeAccounts.length;
      this.status.userStakeScanMode = snapshot?.paginated
        ? 'paginated-filtered'
        : 'single-response-filtered';
      this.status.userStakePageCount = snapshot?.pageCount || 1;
    }
    this.metrics = summarizeOnChainState({ ...core, userStakeAccounts: this.userStakeAccounts });
    this.status.lastMetricsAt = this.metrics.updatedAt;
    if (this.status.phase === 'scanning-positions' || this.status.phase === 'retrying' || this.status.phase === 'starting') {
      this.status.phase = this.started ? 'live' : 'syncing-events';
    }
    this.emitState();
  }

  async syncEvents(initial = false) {
    if (this.syncing) return;
    this.syncing = true;
    try {
      const signatures = await this.rpc.getRecentSignatures(initial ? this.initialBackfillLimit : 25);
      const fresh = signatures.filter((item) => !item.err && !this.events.some((event) => event.signature === item.signature));
      const added = [];
      for (const item of fresh.reverse()) {
        try {
          const transaction = await this.rpc.getTransaction(item.signature);
          if (transaction) added.push(...parseStakingTransaction(transaction, BigInt(Math.round((this.metrics?.sharePrice || 1) * 1e9))));
        } catch (error) {
          this.recordError(error, false);
        }
        await delay(50);
      }

      if (added.length) {
        const unique = added.filter((event) => !this.known.has(event.id));
        unique.forEach((event) => this.known.add(event.id));
        this.events = [...unique.reverse(), ...this.events]
          .sort((a, b) => (b.blockTime || 0) - (a.blockTime || 0))
          .slice(0, this.store.limit);
        this.status.lastEventAt = this.events[0]?.blockTime || null;
        await this.store.save(this.events);
        this.emit('events', unique);
      }
      this.status.lastSyncAt = Math.floor(Date.now() / 1000);
      this.status.lastError = null;
      if (this.started && this.status.phase !== 'scanning-positions') this.status.phase = 'live';
      this.emitState();
    } finally {
      this.syncing = false;
    }
  }

  recordError(error, emit = true) {
    this.status.lastError = String(error?.message || error);
    this.status.lastErrorAt = Math.floor(Date.now() / 1000);
    if (this.started && this.status.phase === 'live') this.status.phase = 'degraded';
    if (emit) this.emitState();
  }

  emitState() {
    this.emit('state', this.getState());
  }

  getState() {
    const analytics = summarizeEvents(this.events);
    const scan = {
      userStakeMode: this.status.userStakeScanMode || 'single-response-filtered',
      userStakeCaveat: this.status.userStakeScanMode === 'paginated-filtered'
        ? null
        : USER_STAKE_SCAN_CAVEAT,
      userStakeAccountCount: this.status.userStakeAccountCount || this.userStakeAccounts.length || 0,
      userStakePageCount: this.status.userStakePageCount || null,
    };
    return {
      status: this.publicStatus(),
      metrics: this.metrics,
      analytics,
      provenance: buildProvenance({ metrics: this.metrics, analytics, sourceSlots: this.sourceSlots, scan }),
      recentEvents: this.events.slice(0, 100).map((event) => ({ ...event, evidence: buildEventEvidence(event) })),
    };
  }
}
