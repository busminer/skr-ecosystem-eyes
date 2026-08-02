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
      CREATE TABLE IF NOT EXISTS metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
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

  queryEvents({ limit = 100, offset = 0, minimum = 0, type = '', wallet = '' } = {}) {
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
      clauses.push('LOWER(wallet) LIKE ?');
      parameters.push(`%${wallet.toLowerCase()}%`);
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

  close() {
    if (!this.db) return;
    this.db.close();
    this.db = null;
  }
}
