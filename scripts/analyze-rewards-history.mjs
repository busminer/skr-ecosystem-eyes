import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { calculateConstantShareReturn } from '../src/rewards-history.js';

const file = process.argv[2];
if (!file) throw new Error('Usage: node scripts/analyze-rewards-history.mjs <events.sqlite>');
const db = new DatabaseSync(path.resolve(file), { readOnly: true });
const first = db.prepare('SELECT unix_ts AS unixTs, share_price AS sharePrice FROM protocol_snapshots ORDER BY unix_ts, slot LIMIT 1').get();
const last = db.prepare('SELECT unix_ts AS unixTs, share_price AS sharePrice FROM protocol_snapshots ORDER BY unix_ts DESC, slot DESC LIMIT 1').get();
if (!first || !last) throw new Error('Protocol snapshot history is empty');
console.log(JSON.stringify({ first, last, ...calculateConstantShareReturn(first, last), caveat: 'Protocol share-price return for a constant number of shares; not a wallet PnL when shares changed inside the interval.' }, null, 2));
db.close();
