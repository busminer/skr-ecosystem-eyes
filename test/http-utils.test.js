import test from 'node:test';
import assert from 'node:assert/strict';
import {
  closeSseStreams,
  isSafeWalletQuery,
  maskRpcUrl,
  parseIntegerParam,
  writeSse,
} from '../src/http-utils.js';

test('parseIntegerParam accepts safe integers and rejects junk', () => {
  assert.equal(parseIntegerParam(null, { fallback: 100, min: 1, max: 200 }), 100);
  assert.equal(parseIntegerParam('25', { fallback: 100, min: 1, max: 200 }), 25);
  assert.equal(parseIntegerParam('0', { fallback: 0, min: 0, max: 10 }), 0);
  assert.equal(parseIntegerParam('nope', { fallback: 100, min: 1, max: 200 }), null);
  assert.equal(parseIntegerParam('201', { fallback: 100, min: 1, max: 200 }), null);
  assert.equal(parseIntegerParam('1.5', { fallback: 100, min: 1, max: 200 }), null);
});

test('isSafeWalletQuery allows base58-ish needles and empty string', () => {
  assert.equal(isSafeWalletQuery(''), true);
  assert.equal(isSafeWalletQuery('So11111111111111111111111111111111111111112'), true);
  assert.equal(isSafeWalletQuery('bad wallet!'), false);
  assert.equal(isSafeWalletQuery('../etc/passwd'), false);
});

test('maskRpcUrl never returns full credentialed URL path', () => {
  assert.equal(maskRpcUrl('https://api.mainnet-beta.solana.com'), 'api.mainnet-beta.solana.com');
  assert.equal(maskRpcUrl('https://example.com/secret-token'), 'example.com');
  assert.equal(maskRpcUrl(''), 'solana-rpc');
});

test('writeSse removes closed streams and keeps healthy ones', () => {
  const streams = new Set();
  const healthy = {
    writableEnded: false,
    destroyed: false,
    chunks: [],
    write(chunk) { this.chunks.push(chunk); return true; },
  };
  const closed = {
    writableEnded: true,
    destroyed: false,
    write() { throw new Error('should not write'); },
  };
  const broken = {
    writableEnded: false,
    destroyed: false,
    write() { throw new Error('socket down'); },
    destroy() { this.destroyed = true; },
  };
  streams.add(healthy);
  streams.add(closed);
  streams.add(broken);
  const written = writeSse(streams, 'state', { ok: true });
  assert.equal(written, 1);
  assert.equal(streams.has(healthy), true);
  assert.equal(streams.has(closed), false);
  assert.equal(streams.has(broken), false);
  assert.match(healthy.chunks[0], /event: state/);
});

test('closeSseStreams ends and clears all subscribers', () => {
  const streams = new Set();
  const ends = [];
  const response = {
    writableEnded: false,
    destroyed: false,
    write() { return true; },
    end() { ends.push('end'); this.writableEnded = true; },
  };
  streams.add(response);
  closeSseStreams(streams);
  assert.equal(streams.size, 0);
  assert.deepEqual(ends, ['end']);
});
