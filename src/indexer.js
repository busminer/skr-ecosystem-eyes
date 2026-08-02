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
    analyticsRefreshMs = Number(process.env.ANALYTICS_REFRESH_MS || 30_000),
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
    this.analyticsRefreshMs = Math.max(5_000, analyticsRefreshMs);
    this.initialBackfillLimit = Math.max(1, initialBackfillLimit);
    this.startRetries = Math.max(1, startRetries);
    this.startRetryMs = Math.max(250, startRetryMs);
    this.events = [];
    this.analytics = summarizeEvents([]);
    this.metrics = null;
    this.userStakeAccounts = [];
    this.sourceSlots = {};
    this.userStakeSlot = null;
    this.known = new Set();
    this.syncing = false;
    this.refreshingMetrics = false;
    this.queueScanPending = false;
    this.started = false;
    this.signatureCursor = null;
    this.lastAnalyticsAtMs = 0;
    this.status = {
      phase: 'starting',
      rpc: maskRpcUrl(rpc?.url),
      scanRpc: maskRpcUrl(rpc?.scanUrl),
      lastError: null,
      generalError: null,
      metricsError: null,
      eventError: null,
      lastErrorAt: null,
      lastEventAt: null,
      lastQueueScanAt: null,
      startedAt: Math.floor(Date.now() / 1000),
      startAttempts: 0,
      userStakeAccountCount: 0,
      userStakeScanMode: 'single-response-filtered',
      userStakePageCount: 0,
      persistedEventCount: 0,
      lastSignatureBatchSize: 0,
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
      metricsError: this.status.metricsError,
      eventError: this.status.eventError,
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
      persistedEventCount: this.status.persistedEventCount || 0,
      lastSignatureBatchSize: this.status.lastSignatureBatchSize || 0,
      freshness: freshness.overall,
      freshnessDetail: freshness,
    };
  }

  async start() {
    this.events = await this.store.load();
    this.events.forEach((event) => this.known.add(event.id));
    this.signatureCursor = this.store.getCursor?.() || null;
    this.status.persistedEventCount = this.store.count?.() || this.events.length;
    this.status.lastEventAt = this.events[0]?.blockTime || null;
    this.refreshAnalytics(true);
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
        this.status.generalError = null;
        this.status.metricsError = null;
        this.status.eventError = null;
        this.#refreshErrorState();
        this.status.phase = 'live';
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
    this.pollTimer = setInterval(() => this.syncEvents().catch((error) => this.recordError(error, true, 'events')), this.pollMs);
    this.metricsTimer = setInterval(() => this.refreshMetrics(false).catch((error) => this.recordError(error, true, 'metrics')), this.metricsRefreshMs);
    this.queueTimer = setInterval(() => this.refreshMetrics(true).catch((error) => this.recordError(error, true, 'metrics')), this.queueRefreshMs);
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
    this.store.close?.();
  }

  async refreshMetrics(scanQueue) {
    if (this.refreshingMetrics) {
      if (scanQueue) this.queueScanPending = true;
      return;
    }
    this.refreshingMetrics = true;
    this.status.phase = scanQueue ? 'scanning-positions' : this.status.phase;
    try {
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
      this.status.generalError = null;
      this.status.metricsError = null;
      this.#refreshErrorState();
      if (this.status.phase === 'scanning-positions' || this.status.phase === 'retrying' || this.status.phase === 'starting') {
        this.status.phase = this.started ? 'live' : 'syncing-events';
      }
      this.emitState();
    } finally {
      this.refreshingMetrics = false;
      if (this.queueScanPending) {
        this.queueScanPending = false;
        const timer = setTimeout(() => this.refreshMetrics(true).catch((error) => this.recordError(error, true, 'metrics')), 0);
        timer.unref?.();
      }
    }
  }

  async syncEvents(initial = false) {
    if (this.syncing) return;
    this.syncing = true;
    try {
      const cursor = this.store.getCursor?.() || this.signatureCursor;
      const signatures = cursor
        ? await this.rpc.getSignaturesSince(cursor)
        : await this.rpc.getRecentSignatures(initial ? this.initialBackfillLimit : 25);
      this.status.lastSignatureBatchSize = signatures.length;
      const added = [];
      for (const item of [...signatures].reverse()) {
        if (item.err) {
          this.store.setCursor?.(item.signature);
          this.signatureCursor = item.signature;
          continue;
        }
        const transaction = await this.rpc.getTransaction(item.signature);
        if (!transaction) throw new Error(`Finalized transaction was unavailable: ${item.signature}`);
        const parsed = parseStakingTransaction(transaction, BigInt(Math.round((this.metrics?.sharePrice || 1) * 1e9)));
        const unique = parsed.filter((event) => !this.known.has(event.id));
        if (unique.length) {
          this.store.append(unique);
          added.push(...unique);
          this.events = [...[...unique].reverse(), ...this.events]
            .sort((a, b) => (b.blockTime || 0) - (a.blockTime || 0))
            .slice(0, this.store.limit);
          this.known = new Set(this.events.map((event) => event.id));
          this.status.lastEventAt = this.events[0]?.blockTime || null;
          this.status.persistedEventCount = this.store.count?.() || this.events.length;
        }
        this.store.setCursor?.(item.signature);
        this.signatureCursor = item.signature;
        await delay(50);
      }
      if (added.length) this.emit('events', added);
      this.refreshAnalytics(false);
      this.status.lastSyncAt = Math.floor(Date.now() / 1000);
      this.status.generalError = null;
      this.status.eventError = null;
      this.#refreshErrorState();
      if (this.started && !this.status.lastError && this.metrics && this.status.phase !== 'scanning-positions') this.status.phase = 'live';
      this.emitState();
    } finally {
      this.syncing = false;
    }
  }

  recordError(error, emit = true, source = 'general') {
    const message = String(error?.message || error);
    if (source === 'metrics') this.status.metricsError = message;
    else if (source === 'events') this.status.eventError = message;
    else this.status.generalError = message;
    this.#refreshErrorState();
    this.status.lastErrorAt = Math.floor(Date.now() / 1000);
    if (this.started) this.status.phase = 'degraded';
    if (emit) this.emitState();
  }

  emitState() {
    this.emit('state', this.getState());
  }

  getState() {
    const analytics = this.analytics || summarizeEvents(this.events);
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

  refreshAnalytics(force = false) {
    const nowMs = Date.now();
    if (!force && nowMs - this.lastAnalyticsAtMs < this.analyticsRefreshMs) return this.analytics;
    const now = Math.floor(nowMs / 1000);
    this.analytics = this.store.summarize?.(now) || summarizeEvents(this.events, now);
    this.lastAnalyticsAtMs = nowMs;
    return this.analytics;
  }

  #refreshErrorState() {
    this.status.lastError = this.status.generalError || this.status.metricsError || this.status.eventError || null;
  }
}
