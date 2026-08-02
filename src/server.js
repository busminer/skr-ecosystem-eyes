import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SolanaRpc } from './rpc.js';
import { EventStore } from './store.js';
import { StakingIndexer } from './indexer.js';
import { PROGRAM_ID, MINT, STAKE_CONFIG, STAKE_VAULT } from './constants.js';
import {
  closeSseStreams,
  isSafeWalletQuery,
  parseIntegerParam,
  writeSse,
} from './http-utils.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public');
const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT || 4173);
const rpc = new SolanaRpc();
const store = new EventStore();
const indexer = new StakingIndexer({ rpc, store });
const streams = new Set();
const EVENT_TYPES = new Set(['stake', 'unstake', 'withdraw']);
let shuttingDown = false;

function sendJson(response, payload, status = 200) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(JSON.stringify(payload));
}

function broadcast(event, payload) {
  writeSse(streams, event, payload);
}

indexer.on('state', (state) => broadcast('state', state));
indexer.on('events', (events) => broadcast('events', events));

async function serveStatic(requestPath, response) {
  const relative = requestPath === '/' ? 'index.html' : requestPath.slice(1);
  const file = path.resolve(PUBLIC, relative);
  if (!file.startsWith(`${PUBLIC}${path.sep}`) && file !== path.join(PUBLIC, 'index.html')) return false;
  try {
    if (!(await stat(file)).isFile()) return false;
    const extension = path.extname(file);
    const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };
    response.writeHead(200, { 'content-type': types[extension] || 'application/octet-stream', 'cache-control': extension === '.html' ? 'no-store' : 'public, max-age=300' });
    response.end(await readFile(file));
    return true;
  } catch {
    return false;
  }
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
  if (request.method !== 'GET') return sendJson(response, { error: 'Read-only service' }, 405);

  if (url.pathname === '/api/health') {
    return sendJson(response, { ok: true, status: indexer.publicStatus() });
  }
  if (url.pathname === '/api/state') return sendJson(response, indexer.getState());
  if (url.pathname === '/api/stats') return sendJson(response, indexer.getState().analytics);
  if (url.pathname === '/api/queue') return sendJson(response, { items: indexer.metrics?.queue || [], updatedAt: indexer.metrics?.updatedAt || null });
  if (url.pathname === '/api/guardians') return sendJson(response, indexer.metrics?.guardians || { count: 0, top: [] });
  if (url.pathname === '/api/config') return sendJson(response, { programId: PROGRAM_ID, mint: MINT, stakeConfig: STAKE_CONFIG, stakeVault: STAKE_VAULT, readOnly: true });
  if (url.pathname === '/api/events') {
    const limit = parseIntegerParam(url.searchParams.get('limit'), { fallback: 100, min: 1, max: 200 });
    const offset = parseIntegerParam(url.searchParams.get('offset'), { fallback: 0, min: 0, max: 1_000_000 });
    const minimum = parseIntegerParam(url.searchParams.get('min'), { fallback: 0, min: 0, max: Number.MAX_SAFE_INTEGER });
    const type = url.searchParams.get('type');
    const wallet = url.searchParams.get('wallet') || '';
    if (limit == null || offset == null || minimum == null) {
      return sendJson(response, { error: 'Invalid limit, offset, or min query parameter' }, 400);
    }
    if (type != null && type !== '' && !EVENT_TYPES.has(type)) {
      return sendJson(response, { error: 'Invalid type query parameter' }, 400);
    }
    if (!isSafeWalletQuery(wallet)) {
      return sendJson(response, { error: 'Invalid wallet query parameter' }, 400);
    }
    const walletNeedle = wallet.toLowerCase();
    const filtered = indexer.events.filter((event) =>
      (!type || event.type === type) &&
      (!minimum || Number(event.amount) >= minimum) &&
      (!walletNeedle || event.wallet?.toLowerCase().includes(walletNeedle)));
    return sendJson(response, { items: filtered.slice(offset, offset + limit), total: filtered.length, offset, limit, hasMore: offset + limit < filtered.length });
  }
  if (url.pathname === '/api/stream') {
    if (shuttingDown) return sendJson(response, { error: 'Shutting down' }, 503);
    response.writeHead(200, {
      'content-type': 'text/event-stream', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    response.write(`: connected\n\nevent: state\ndata: ${JSON.stringify(indexer.getState())}\n\n`);
    streams.add(response);
    const cleanup = () => streams.delete(response);
    request.on('close', cleanup);
    response.on('close', cleanup);
    response.on('error', cleanup);
    return;
  }

  if (await serveStatic(url.pathname, response)) return;
  sendJson(response, { error: 'Not found' }, 404);
});

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Shutting down on ${signal}...`);
  indexer.stop();
  closeSseStreams(streams);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3_000).unref();
}

server.listen(PORT, HOST, () => {
  console.log(`SKR Ecosystem Eyes running at http://${HOST}:${PORT}`);
  indexer.start().catch((error) => {
    indexer.recordError(error);
    console.error('Indexer startup failed after retries:', error.message);
  });
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => shutdown(signal));
}
