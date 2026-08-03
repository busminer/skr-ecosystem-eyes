import path from 'node:path';
import { statSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const file = path.resolve(process.argv[2] || process.env.EVENT_DB_FILE || 'data/events.sqlite');
const db = new DatabaseSync(file, { readOnly: true });
const integrity = db.prepare('PRAGMA integrity_check').get().integrity_check;
const raw = db.prepare('SELECT COUNT(*) AS count, MIN(unix_ts) AS firstTs, MAX(unix_ts) AS lastTs FROM protocol_snapshots').get();
const hourly = db.prepare('SELECT COUNT(*) AS count FROM protocol_snapshots_hourly').get();
const latest = db.prepare('SELECT slot, unix_ts AS unixTs, share_price AS sharePrice, reward_index AS rewardIndex FROM protocol_snapshots ORDER BY unix_ts DESC, slot DESC LIMIT 1').get() || null;
db.close();
console.log(JSON.stringify({ file, bytes: statSync(file).size, integrity, raw: { count: Number(raw.count), firstTs: raw.firstTs, lastTs: raw.lastTs }, hourly: Number(hourly.count), latest }, null, 2));
