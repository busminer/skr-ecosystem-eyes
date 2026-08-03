export function parseIntegerParam(value, { fallback, min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (value == null || value === '') return fallback;
  if (!/^-?\d+$/.test(String(value))) return null;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) return null;
  if (parsed < min || parsed > max) return null;
  return parsed;
}

export function isSafeWalletQuery(value) {
  return value === '' || /^[1-9A-HJ-NP-Za-km-z]{1,64}$/.test(value);
}

export function isExactPublicKey(value) {
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(String(value || ''))) return false;
  try {
    return decodeBase58(value).length === 32;
  } catch {
    return false;
  }
}

export function writeSse(streams, event, payload) {
  if (!streams.size) return 0;
  const message = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  let written = 0;
  for (const response of [...streams]) {
    if (response.writableEnded || response.destroyed) {
      streams.delete(response);
      continue;
    }
    if (response.skrBackpressured) continue;
    try {
      const accepted = response.write(message);
      if (!accepted) {
        response.skrBackpressured = true;
        const release = () => {
          response.skrBackpressured = false;
          if (response.skrBackpressureTimer) clearTimeout(response.skrBackpressureTimer);
          response.skrBackpressureTimer = null;
        };
        response.once?.('drain', release);
        response.skrBackpressureTimer = setTimeout(() => {
          if (!response.skrBackpressured) return;
          streams.delete(response);
          try { response.destroy(); } catch { /* ignore */ }
        }, 10_000);
        response.skrBackpressureTimer.unref?.();
        continue;
      }
      written += 1;
    } catch {
      streams.delete(response);
      try { response.destroy(); } catch { /* ignore */ }
    }
  }
  return written;
}

export function closeSseStreams(streams) {
  for (const response of [...streams]) {
    streams.delete(response);
    if (response.skrBackpressureTimer) clearTimeout(response.skrBackpressureTimer);
    try {
      response.write(': shutdown\n\n');
      response.end();
    } catch {
      try { response.destroy(); } catch { /* ignore */ }
    }
  }
}

export function maskRpcUrl(url) {
  if (!url) return 'solana-rpc';
  try {
    const parsed = new URL(url);
    return parsed.host || 'solana-rpc';
  } catch {
    return String(url).replace(/^https?:\/\//i, '').split('/')[0] || 'solana-rpc';
  }
}
import { decodeBase58 } from './base58.js';
