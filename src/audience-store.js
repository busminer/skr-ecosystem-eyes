import { createHash } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const utcDay = (timestamp) => new Date(timestamp * 1000).toISOString().slice(0, 10);

export const isValidAudienceSessionId = (value) => typeof value === 'string' && SESSION_ID.test(value);
export const hashAudienceSession = (value) => createHash('sha256').update(value).digest('hex');

export class AudienceStore {
  constructor(file = path.resolve(process.env.ANALYTICS_DB_FILE || 'data/analytics.sqlite')) {
    this.file = file;
    this.db = null;
    this.lastPrunedAt = 0;
  }

  async load(now = Math.floor(Date.now() / 1000)) {
    await mkdir(path.dirname(this.file), { recursive: true });
    this.db = new DatabaseSync(this.file);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = FULL;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS daily_visits (day TEXT PRIMARY KEY, visits INTEGER NOT NULL CHECK(visits >= 0));
      CREATE TABLE IF NOT EXISTS recent_sessions (session_hash TEXT PRIMARY KEY, first_seen INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS recent_sessions_seen_idx ON recent_sessions(first_seen);
      CREATE TABLE IF NOT EXISTS active_sessions (session_hash TEXT PRIMARY KEY, last_seen INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS active_sessions_seen_idx ON active_sessions(last_seen);
      CREATE TABLE IF NOT EXISTS audience_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    `);
    this.db.prepare('INSERT OR IGNORE INTO audience_metadata(key, value) VALUES(?, ?)')
      .run('tracking_since', new Date(now * 1000).toISOString());
    this.prune(now, true);
    return this.summary(now);
  }

  record(sessionId, now = Math.floor(Date.now() / 1000)) {
    if (!this.db) throw new Error('AudienceStore.load() must be called before record()');
    if (!isValidAudienceSessionId(sessionId)) return { counted: false, reason: 'invalid' };
    let inserted = false;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = this.db.prepare('INSERT OR IGNORE INTO recent_sessions(session_hash, first_seen) VALUES(?, ?)')
        .run(hashAudienceSession(sessionId), now);
      inserted = Number(result.changes || 0) === 1;
      if (inserted) this.db.prepare(`INSERT INTO daily_visits(day, visits) VALUES(?, 1)
        ON CONFLICT(day) DO UPDATE SET visits = visits + 1`).run(utcDay(now));
      this.db.prepare(`INSERT INTO active_sessions(session_hash, last_seen) VALUES(?, ?)
        ON CONFLICT(session_hash) DO UPDATE SET last_seen = excluded.last_seen`).run(hashAudienceSession(sessionId), now);
      this.db.exec('COMMIT');
    } catch (error) {
      try { this.db.exec('ROLLBACK'); } catch { /* preserve original error */ }
      throw error;
    }
    this.prune(now);
    return { counted: inserted, reason: inserted ? 'new' : 'duplicate' };
  }

  heartbeat(sessionId, now = Math.floor(Date.now() / 1000)) {
    if (!this.db || !isValidAudienceSessionId(sessionId)) return false;
    const result = this.db.prepare(`INSERT INTO active_sessions(session_hash, last_seen) VALUES(?, ?)
      ON CONFLICT(session_hash) DO UPDATE SET last_seen = excluded.last_seen`).run(hashAudienceSession(sessionId), now);
    return Number(result.changes || 0) > 0;
  }

  summary(now = Math.floor(Date.now() / 1000)) {
    if (!this.db) return { visitsTotal: 0, visits24h: 0, liveSessions, trackingSince: null };
    const total = this.db.prepare('SELECT COALESCE(SUM(visits), 0) AS count FROM daily_visits').get();
    const recent = this.db.prepare('SELECT COUNT(*) AS count FROM recent_sessions WHERE first_seen >= ?').get(now - 86_400);
    const trackingSince = this.db.prepare('SELECT value FROM audience_metadata WHERE key = ?').get('tracking_since')?.value || null;
    const active = this.db.prepare('SELECT COUNT(*) AS count FROM active_sessions WHERE last_seen >= ?').get(now - 90);
    return { visitsTotal: Number(total.count || 0), visits24h: Number(recent.count || 0), liveSessions: Number(active.count || 0), trackingSince };
  }

  prune(now = Math.floor(Date.now() / 1000), force = false) {
    if (!this.db || (!force && now - this.lastPrunedAt < 3_600)) return 0;
    this.lastPrunedAt = now;
    const removed = Number(this.db.prepare('DELETE FROM recent_sessions WHERE first_seen < ?').run(now - 7 * 86_400).changes || 0);
    this.db.prepare('DELETE FROM active_sessions WHERE last_seen < ?').run(now - 300);
    return removed;
  }

  integrityCheck() { return this.db ? this.db.prepare('PRAGMA integrity_check').get().integrity_check : 'closed'; }
  close() { if (this.db) this.db.close(); this.db = null; }
}
