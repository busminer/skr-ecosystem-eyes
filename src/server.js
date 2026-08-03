import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SolanaRpc } from './rpc.js';
import { EventStore } from './store.js';
import { AudienceStore, isValidAudienceSessionId } from './audience-store.js';
import { StakingIndexer } from './indexer.js';
import { PROGRAM_ID, MINT, STAKE_CONFIG, STAKE_VAULT } from './constants.js';
import {
  closeSseStreams,
  isSafeWalletQuery,
  parseIntegerParam,
  writeSse,
} from './http-utils.js';
import { resolveWalletProfile } from './wallet-api.js';
import { buildEventEvidence } from './event-evidence.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public');
const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT || 4173);
const rpc = new SolanaRpc();
const store = new EventStore();
const audience = new AudienceStore(path.resolve(process.env.ANALYTICS_DB_FILE || path.join(path.dirname(store.file), 'analytics.sqlite')));
const indexer = new StakingIndexer({ rpc, store });
const streams = new Set();
const EVENT_TYPES = new Set(['stake', 'unstake', 'cancel_unstake', 'withdraw']);
const SSE_MAX_CLIENTS = Number.isSafeInteger(Number(process.env.SSE_MAX_CLIENTS))
  ? Math.max(1, Number(process.env.SSE_MAX_CLIENTS))
  : 100;
const SECURITY_HEADERS = Object.freeze({
  'content-security-policy': "default-src 'self'; base-uri 'none'; connect-src 'self'; font-src 'self' data:; form-action 'none'; frame-ancestors 'none'; img-src 'self' data:; object-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'",
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-resource-policy': 'same-origin',
  'permissions-policy': 'camera=(), geolocation=(), microphone=(), payment=(), usb=()',
  'referrer-policy': 'no-referrer',
  'strict-transport-security': 'max-age=31536000',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
});
let shuttingDown = false;

function sendJson(response, payload, status = 200) {
  response.writeHead(status, { ...SECURITY_HEADERS, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(JSON.stringify(payload));
}

function broadcast(event, payload) {
  writeSse(streams, event, payload);
}

const audienceSummary = () => audience.summary();

async function readJsonBody(request, maximumBytes = 256) {
  let body = '';
  for await (const chunk of request) {
    body += chunk;
    if (Buffer.byteLength(body) > maximumBytes) throw Object.assign(new Error('Request body too large'), { status: 413 });
  }
  try { return JSON.parse(body || '{}'); } catch { throw Object.assign(new Error('Invalid JSON'), { status: 400 }); }
}

indexer.on('state', (state) => broadcast('state', state));
indexer.on('events', (events) => broadcast('events', events));

async function serveStatic(requestUrl, response, extraHeaders = {}) {
  const requestPath = requestUrl.pathname;
  const relative = requestPath === '/' ? 'index.html' : requestPath.slice(1);
  const file = path.resolve(PUBLIC, relative);
  if (!file.startsWith(`${PUBLIC}${path.sep}`) && file !== path.join(PUBLIC, 'index.html')) return false;
  try {
    if (!(await stat(file)).isFile()) return false;
    const extension = path.extname(file);
    const types = {
      '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
      '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml',
      '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json; charset=utf-8',
      '.webmanifest': 'application/manifest+json; charset=utf-8',
    };
    const versioned = requestUrl.searchParams.has('v');
    const cacheControl = extension === '.html'
      ? 'no-cache, must-revalidate'
      : versioned
        ? 'public, max-age=31536000, immutable'
        : 'public, max-age=300';
    response.writeHead(200, { ...SECURITY_HEADERS, ...extraHeaders, 'content-type': types[extension] || 'application/octet-stream', 'cache-control': cacheControl });
    response.end(await readFile(file));
    return true;
  } catch {
    return false;
  }
}

async function handleRequest(request, response) {
  const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
  if (request.method === 'POST' && (url.pathname === '/api/audience/visit' || url.pathname === '/api/audience/heartbeat')) {
    if (!String(request.headers['content-type'] || '').toLowerCase().startsWith('application/json')) return sendJson(response, { error: 'JSON content type required' }, 415);
    const payload = await readJsonBody(request);
    if (!isValidAudienceSessionId(payload.sessionId)) return sendJson(response, { error: 'Invalid session identifier' }, 400);
    const result = url.pathname.endsWith('/visit') ? audience.record(payload.sessionId) : { counted: false, heartbeat: audience.heartbeat(payload.sessionId) };
    const summary = audienceSummary();
    if (result.counted) broadcast('audience', summary);
    return sendJson(response, { ...summary, counted: result.counted });
  }
  if (request.method !== 'GET') return sendJson(response, { error: 'Read-only service' }, 405);

  if (url.pathname === '/api/health') {
    return sendJson(response, { ok: true, status: indexer.publicStatus() });
  }
  if (url.pathname === '/api/state') return sendJson(response, indexer.getState());
  if (url.pathname === '/api/stats') return sendJson(response, indexer.getState().analytics);
  if (url.pathname === '/api/queue') return sendJson(response, { items: indexer.metrics?.queue || [], updatedAt: indexer.metrics?.updatedAt || null });
  if (url.pathname === '/api/guardians') return sendJson(response, indexer.metrics?.guardians || { count: 0, top: [] });
  if (url.pathname === '/api/config') return sendJson(response, { programId: PROGRAM_ID, mint: MINT, stakeConfig: STAKE_CONFIG, stakeVault: STAKE_VAULT, readOnly: true });
  if (url.pathname.startsWith('/api/wallet/')) {
    const wallet = url.pathname.slice('/api/wallet/'.length);
    const result = resolveWalletProfile(indexer, wallet);
    return sendJson(response, result.payload, result.status);
  }
  if (url.pathname === '/api/audience') return sendJson(response, audienceSummary());
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
    if (typeof store.queryEvents === 'function') {
      const result = store.queryEvents({ limit, offset, minimum, type, wallet });
      return sendJson(response, { ...result, items: result.items.map((event) => ({ ...event, evidence: buildEventEvidence(event) })) });
    }
    const walletNeedle = wallet.toLowerCase();
    const filtered = indexer.events.filter((event) =>
      (!type || event.type === type) &&
      (!minimum || Number(event.amount) >= minimum) &&
      (!walletNeedle || event.wallet?.toLowerCase().includes(walletNeedle)));
    return sendJson(response, { items: filtered.slice(offset, offset + limit), total: filtered.length, offset, limit, hasMore: offset + limit < filtered.length });
  }
  if (url.pathname === '/w' || url.pathname.startsWith('/w/')) {
    const walletPageUrl = new URL('/wallet.html', url);
    if (await serveStatic(walletPageUrl, response, { 'x-robots-tag': 'noindex, nofollow' })) return;
  }
  if (url.pathname === '/api/stream') {
    if (shuttingDown) return sendJson(response, { error: 'Shutting down' }, 503);
    if (streams.size >= SSE_MAX_CLIENTS) return sendJson(response, { error: 'Live stream capacity reached' }, 503);
    response.writeHead(200, {
      ...SECURITY_HEADERS,
      'content-type': 'text/event-stream', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    response.write(`: connected\n\nevent: state\ndata: ${JSON.stringify(indexer.getState())}\n\n`);
    streams.add(response);
    const heartbeat = setInterval(() => {
      if (response.writableEnded || response.destroyed) return;
      try { response.write(`: ping ${Date.now()}\n\n`); } catch { cleanup(); }
    }, 15_000);
    heartbeat.unref();
    const cleanup = () => {
      clearInterval(heartbeat);
      if (!streams.delete(response)) return;
    };
    response.on('close', cleanup);
    response.on('error', cleanup);
    return;
  }

  if (await serveStatic(url, response)) return;
  sendJson(response, { error: 'Not found' }, 404);
}

const server = http.createServer((request, response) => {
  handleRequest(request, response).catch((error) => {
    console.error('Request failed:', error.message);
    if (!response.headersSent) sendJson(response, { error: error.status && error.status < 500 ? error.message : 'Internal service error' }, error.status || 500);
    else response.destroy();
  });
});

server.requestTimeout = 30_000;
server.headersTimeout = 15_000;
server.keepAliveTimeout = 5_000;
server.maxHeadersCount = 100;

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Shutting down on ${signal}...`);
  indexer.stop();
  audience.close();
  closeSseStreams(streams);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3_000).unref();
}

async function start() {
  await audience.load();
  server.listen(PORT, HOST, () => {
    console.log(`SKR Ecosystem Eyes running at http://${HOST}:${PORT}`);
    indexer.start().catch((error) => {
      indexer.recordError(error);
      console.error('Indexer startup failed after retries:', error.message);
    });
  });
}

start().catch((error) => { console.error('Server startup failed:', error.message); process.exitCode = 1; });

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => shutdown(signal));
}
