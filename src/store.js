import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const WINDOWS = Object.freeze({ '1h': 3_600, '24h': 86_400, '7d': 604_800, '30d': 2_592_000 });

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function eventFromRow(row) {
  if (!row) return null;
  let instructionIndex = null;
  if (row.instructionIndex != null) {
    try { instructionIndex = JSON.parse(row.instructionIndex); } catch { instructionIndex = row.instructionIndex; }
  }
  return {
    id: row.id,
    signature: row.signature,
    instructionIndex,
    slot: row.slot,
    blockTime: row.blockTime,
    type: row.type,
    wallet: row.wallet,
    guardianPool: row.guardianPool,
    amount: row.amount,
    rawAmount: row.rawAmount,
    ...(row.aggregation ? { aggregation: row.aggregation } : {}),
  };
}

export class EventStore {
  constructor(
    file = path.resolve(process.env.EVENT_DB_FILE || 'data/events.sqlite'),
    limit = Number(process.env.EVENT_MEMORY_LIMIT || process.env.EVENT_LIMIT || 20_000),
    retentionDays = Number(process.env.EVENT_RETENTION_DAYS || 35),
  ) {
    this.file = file;
    this.limit = positiveInteger(limit, 20_000);
    this.retentionDays = Math.max(31, positiveInteger(retentionDays, 35));
    this.legacyFile = process.env.EVENT_LEGACY_FILE || path.join(path.dirname(file), 'events.json');
    this.db = null;
    this.lastPrunedAt = 0;
    this.persistedEventCount = 0;
    this.snapshotRetentionDays = Math.max(90, positiveInteger(process.env.SNAPSHOT_RETENTION_DAYS, 90));
  }

  async load() {
    await mkdir(path.dirname(this.file), { recursive: true });
    this.#open();
    await this.#migrateLegacyJson();
    this.prune(true);
    return this.recent(this.limit);
  }

  #open() {
    if (this.db) return;
    this.db = new DatabaseSync(this.file);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        signature TEXT NOT NULL,
        instruction_index TEXT,
        slot INTEGER,
        block_time INTEGER,
        type TEXT NOT NULL,
        wallet TEXT,
        guardian_pool TEXT,
        amount REAL,
        raw_amount TEXT,
        aggregation TEXT,
        inserted_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS events_block_time_idx ON events(block_time DESC);
      CREATE INDEX IF NOT EXISTS events_signature_idx ON events(signature);
      CREATE INDEX IF NOT EXISTS events_type_time_idx ON events(type, block_time DESC);
      CREATE INDEX IF NOT EXISTS events_wallet_time_idx ON events(wallet, block_time DESC);
      CREATE TABLE IF NOT EXISTS metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS protocol_snapshots (
        slot INTEGER PRIMARY KEY CHECK(slot > 0),
        unix_ts INTEGER NOT NULL CHECK(unix_ts > 0),
        share_price TEXT NOT NULL,
        total_shares TEXT NOT NULL,
        active_staked TEXT NOT NULL,
        vault_balance TEXT NOT NULL,
        reward_index TEXT NOT NULL,
        inserted_at INTEGER NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS protocol_snapshots_unix_ts_slot_idx
        ON protocol_snapshots(unix_ts, slot);
      CREATE TABLE IF NOT EXISTS protocol_snapshots_hourly (
        hour_ts INTEGER PRIMARY KEY,
        first_slot INTEGER NOT NULL,
        last_slot INTEGER NOT NULL,
        open_share_price TEXT NOT NULL,
        high_share_price TEXT NOT NULL,
        low_share_price TEXT NOT NULL,
        close_share_price TEXT NOT NULL,
        close_total_shares TEXT NOT NULL,
        close_active_staked TEXT NOT NULL,
        close_vault_balance TEXT NOT NULL,
        close_reward_index TEXT NOT NULL,
        sample_count INTEGER NOT NULL CHECK(sample_count > 0)
      );
    `);
    this.persistedEventCount = Number(this.db.prepare('SELECT COUNT(*) AS count FROM events').get().count || 0);
  }

  async #migrateLegacyJson() {
    if (this.persistedEventCount > 0) return;
    try {
      const payload = JSON.parse(await readFile(this.legacyFile, 'utf8'));
      const events = Array.isArray(payload.events) ? payload.events : [];
      if (!events.length) return;
      this.append(events);
      const newest = [...events]
        .filter((event) => event?.signature)
        .sort((left, right) => Number(right.blockTime || 0) - Number(left.blockTime || 0))[0];
      if (newest?.signature) this.setCursor(newest.signature);
      this.setMetadata('legacy_json_migrated_at', String(Math.floor(Date.now() / 1000)));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }

  append(events = []) {
    if (!this.db) throw new Error('EventStore.load() must be called before append()');
    const insert = this.db.prepare(`
      INSERT OR IGNORE INTO events (
        id, signature, instruction_index, slot, block_time, type, wallet,
        guardian_pool, amount, raw_amount, aggregation, inserted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    let inserted = 0;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const insertedAt = Math.floor(Date.now() / 1000);
      for (const event of events) {
        if (!event?.id || !event?.signature || !event?.type) continue;
        const result = insert.run(
          event.id,
          event.signature,
          event.instructionIndex == null ? null : JSON.stringify(event.instructionIndex),
          Number.isFinite(Number(event.slot)) ? Number(event.slot) : null,
          Number.isFinite(Number(event.blockTime)) ? Number(event.blockTime) : null,
          event.type,
          event.wallet || null,
          event.guardianPool || null,
          event.amount == null || !Number.isFinite(Number(event.amount)) ? null : Number(event.amount),
          event.rawAmount == null ? null : String(event.rawAmount),
          event.aggregation || null,
          insertedAt,
        );
        inserted += Number(result.changes || 0);
      }
      this.db.exec('COMMIT');
      this.persistedEventCount += inserted;
    } catch (error) {
      try { this.db.exec('ROLLBACK'); } catch { /* preserve original error */ }
      throw error;
    }
    this.prune(false);
    return inserted;
  }

  recent(limit = this.limit) {
    if (!this.db) return [];
    const rows = this.db.prepare(`
      SELECT id, signature, instruction_index AS instructionIndex, slot,
             block_time AS blockTime, type, wallet, guardian_pool AS guardianPool,
             amount, raw_amount AS rawAmount, aggregation
      FROM events
      ORDER BY block_time DESC, rowid DESC
      LIMIT ?
    `).all(positiveInteger(limit, this.limit));
    return rows.map(eventFromRow);
  }

  queryEvents({ limit = 100, offset = 0, minimum = 0, type = '', wallet = '', walletExact = false } = {}) {
    if (!this.db) return { items: [], total: 0, offset, limit, hasMore: false };
    const clauses = [];
    const parameters = [];
    if (type) {
      clauses.push('type = ?');
      parameters.push(type);
    }
    if (minimum) {
      clauses.push('amount >= ?');
      parameters.push(minimum);
    }
    if (wallet) {
      if (walletExact) {
        clauses.push('wallet = ?');
        parameters.push(wallet);
      } else {
        clauses.push('LOWER(wallet) LIKE ?');
        parameters.push(`%${wallet.toLowerCase()}%`);
      }
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const total = Number(this.db.prepare(`SELECT COUNT(*) AS count FROM events ${where}`).get(...parameters).count || 0);
    const rows = this.db.prepare(`
      SELECT id, signature, instruction_index AS instructionIndex, slot,
             block_time AS blockTime, type, wallet, guardian_pool AS guardianPool,
             amount, raw_amount AS rawAmount, aggregation
      FROM events
      ${where}
      ORDER BY block_time DESC, rowid DESC
      LIMIT ? OFFSET ?
    `).all(...parameters, limit, offset);
    return {
      items: rows.map(eventFromRow),
      total,
      offset,
      limit,
      hasMore: offset + limit < total,
    };
  }

  summarize(now = Math.floor(Date.now() / 1000)) {
    if (!this.db) return null;
    const flowQuery = this.db.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN type = 'stake' THEN amount ELSE 0 END), 0) AS staked,
        COALESCE(SUM(CASE WHEN type = 'unstake' THEN amount ELSE 0 END), 0) AS unstaked,
        COALESCE(SUM(CASE WHEN type = 'withdraw' THEN amount ELSE 0 END), 0) AS withdrawn,
        COALESCE(SUM(CASE WHEN type = 'cancel_unstake' THEN 1 ELSE 0 END), 0) AS cancelled,
        COUNT(*) AS events,
        COUNT(DISTINCT CASE WHEN wallet IS NOT NULL AND wallet != '' THEN wallet END) AS wallets
      FROM events
      WHERE block_time >= ? AND block_time <= ?
    `);
    const windows = {};
    for (const [label, seconds] of Object.entries(WINDOWS)) {
      const row = flowQuery.get(now - seconds, now + 60);
      const flow = {
        staked: Number(row.staked || 0),
        unstaked: Number(row.unstaked || 0),
        withdrawn: Number(row.withdrawn || 0),
        cancelled: Number(row.cancelled || 0),
        events: Number(row.events || 0),
        wallets: Number(row.wallets || 0),
      };
      flow.netFlow = flow.staked - flow.unstaked;
      windows[label] = flow;
    }

    const hourly = Array.from({ length: 24 }, (_, index) => ({
      from: now - (23 - index) * 3_600,
      staked: 0,
      unstaked: 0,
      withdrawn: 0,
      events: 0,
    }));
    const hourlyRows = this.db.prepare(`
      SELECT CAST((? - block_time) / 3600 AS INTEGER) AS ageBucket,
             type, COALESCE(SUM(amount), 0) AS amount, COUNT(*) AS events
      FROM events
      WHERE block_time >= ? AND block_time <= ?
      GROUP BY ageBucket, type
    `).all(now, now - 86_400 + 1, now);
    for (const row of hourlyRows) {
      const ageBucket = Number(row.ageBucket);
      if (!Number.isInteger(ageBucket) || ageBucket < 0 || ageBucket > 23) continue;
      const bucket = hourly[23 - ageBucket];
      const amount = Number(row.amount || 0);
      if (row.type === 'stake') bucket.staked += amount;
      if (row.type === 'unstake') bucket.unstaked += amount;
      if (row.type === 'withdraw') bucket.withdrawn += amount;
      bucket.events += Number(row.events || 0);
    }

    const whaleRows = this.db.prepare(`
      SELECT id, signature, instruction_index AS instructionIndex, slot,
             block_time AS blockTime, type, wallet, guardian_pool AS guardianPool,
             amount, raw_amount AS rawAmount, aggregation
      FROM events
      WHERE block_time >= ? AND amount >= 100000
      ORDER BY amount DESC
      LIMIT 20
    `).all(now - WINDOWS['30d']);
    const coverage = this.db.prepare('SELECT MIN(block_time) AS coverageFrom FROM events').get();
    return {
      windows,
      hourly,
      whales: whaleRows.map(eventFromRow),
      coverageFrom: coverage?.coverageFrom == null ? null : Number(coverage.coverageFrom),
      generatedAt: now,
    };
  }

  getCursor() {
    return this.getMetadata('signature_cursor');
  }

  setCursor(signature) {
    if (!signature) return;
    this.setMetadata('signature_cursor', signature);
  }

  getMetadata(key) {
    if (!this.db) return null;
    return this.db.prepare('SELECT value FROM metadata WHERE key = ?').get(key)?.value || null;
  }

  setMetadata(key, value) {
    if (!this.db) throw new Error('EventStore.load() must be called before metadata writes');
    this.db.prepare(`
      INSERT INTO metadata(key, value) VALUES(?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(key, String(value));
  }

  prune(force = false, now = Math.floor(Date.now() / 1000)) {
    if (!this.db) return 0;
    if (!force && now - this.lastPrunedAt < 3_600) return 0;
    this.lastPrunedAt = now;
    const cutoff = now - this.retentionDays * 86_400;
    const result = this.db.prepare('DELETE FROM events WHERE block_time IS NOT NULL AND block_time < ?').run(cutoff);
    const removed = Number(result.changes || 0);
    this.persistedEventCount = Math.max(0, this.persistedEventCount - removed);
    return removed;
  }

  count() {
    return this.db ? this.persistedEventCount : 0;
  }

  recordProtocolSnapshot(snapshot, { minimumIntervalSeconds = 300 } = {}) {
    if (!this.db) throw new Error('EventStore.load() must be called before snapshot writes');
    if (!Number.isSafeInteger(snapshot?.slot) || snapshot.slot <= 0 || !Number.isSafeInteger(snapshot?.unixTs) || snapshot.unixTs <= 0) {
      throw new Error('Protocol snapshot requires a finalized positive slot and unix timestamp');
    }
    const latest = this.db.prepare('SELECT unix_ts AS unixTs, reward_index AS rewardIndex FROM protocol_snapshots ORDER BY unix_ts DESC, slot DESC LIMIT 1').get();
    const rewardChanged = latest && String(latest.rewardIndex) !== String(snapshot.rewardIndex);
    if (latest && !rewardChanged && snapshot.unixTs - Number(latest.unixTs) < minimumIntervalSeconds) return false;
    const result = this.db.prepare(`
      INSERT OR IGNORE INTO protocol_snapshots (
        slot, unix_ts, share_price, total_shares, active_staked,
        vault_balance, reward_index, inserted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(snapshot.slot, snapshot.unixTs, String(snapshot.sharePrice), String(snapshot.totalShares), String(snapshot.activeStaked), String(snapshot.vaultBalance), String(snapshot.rewardIndex), Math.floor(Date.now() / 1000));
    if (Number(result.changes || 0)) this.pruneProtocolSnapshots(false, snapshot.unixTs);
    return Number(result.changes || 0) > 0;
  }

  queryProtocolSnapshots({ from = 0, to = Number.MAX_SAFE_INTEGER, limit = 10_000 } = {}) {
    if (!this.db) return [];
    return this.db.prepare(`
      SELECT slot, unix_ts AS unixTs, share_price AS sharePrice,
             total_shares AS totalShares, active_staked AS activeStaked,
             vault_balance AS vaultBalance, reward_index AS rewardIndex
      FROM protocol_snapshots
      WHERE unix_ts >= ? AND unix_ts <= ?
      ORDER BY unix_ts, slot
      LIMIT ?
    `).all(from, to, Math.max(1, Math.min(100_000, positiveInteger(limit, 10_000))));
  }

  pruneProtocolSnapshots(force = false, now = Math.floor(Date.now() / 1000)) {
    if (!this.db) return 0;
    const lastRun = Number(this.getMetadata('protocol_snapshot_pruned_at') || 0);
    if (!force && now - lastRun < 86_400) return 0;
    const cutoff = now - this.snapshotRetentionDays * 86_400;
    const rows = this.db.prepare('SELECT * FROM protocol_snapshots WHERE unix_ts < ? ORDER BY unix_ts, slot').all(cutoff);
    if (!rows.length) {
      this.setMetadata('protocol_snapshot_pruned_at', String(now));
      return 0;
    }
    const groups = new Map();
    for (const row of rows) {
      const hour = Math.floor(Number(row.unix_ts) / 3_600) * 3_600;
      const group = groups.get(hour) || [];
      group.push(row);
      groups.set(hour, group);
    }
    const insert = this.db.prepare(`
      INSERT OR REPLACE INTO protocol_snapshots_hourly (
        hour_ts, first_slot, last_slot, open_share_price, high_share_price,
        low_share_price, close_share_price, close_total_shares,
        close_active_staked, close_vault_balance, close_reward_index, sample_count
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      for (const [hour, samples] of groups) {
        const first = samples[0];
        const last = samples.at(-1);
        const prices = samples.map((row) => Number(row.share_price));
        insert.run(hour, first.slot, last.slot, first.share_price, String(Math.max(...prices)), String(Math.min(...prices)), last.share_price, last.total_shares, last.active_staked, last.vault_balance, last.reward_index, samples.length);
      }
      this.db.prepare('DELETE FROM protocol_snapshots WHERE unix_ts < ?').run(cutoff);
      this.db.prepare(`INSERT INTO metadata(key, value) VALUES('protocol_snapshot_pruned_at', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(String(now));
      this.db.exec('COMMIT');
    } catch (error) {
      try { this.db.exec('ROLLBACK'); } catch { /* preserve original error */ }
      throw error;
    }
    return rows.length;
  }

  close() {
    if (!this.db) return;
    this.db.close();
    this.db = null;
  }
}
