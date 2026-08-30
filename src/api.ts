import { t } from './i18n';
import type { EcosystemState, WalletProfile } from './types';

// Store builds are intentionally pinned to the reviewed HTTPS backend.
// This prevents build-time environment overrides from redirecting wallet lookups.
export const API_BASE_URL = 'https://skr.alexkosa.dev';

export class ApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

// A request that never answers is worse than one that fails: the caller waits
// for it forever while the next poll starts another beside it. The position age
// service has always had a deadline; every other read now has one too.
const TIMEOUT_MS = 20_000;

async function getJson<T>(path: string): Promise<T> {
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, { headers: { accept: 'application/json' }, signal: controller.signal });
  } finally {
    clearTimeout(deadline);
  }
  if (!response.ok) {
    let detail = '';
    try {
      const payload = await response.json() as { error?: unknown };
      if (typeof payload.error === 'string') detail = payload.error;
    } catch {
      // Status remains authoritative when an upstream proxy returns non-JSON.
    }
    throw new ApiError(response.status, detail || t('SKR Eyes API returned {status}', { status: response.status }));
  }
  return response.json() as Promise<T>;
}

export const fetchEcosystemState = () => getJson<EcosystemState>('/api/state');
export const fetchWalletProfile = (wallet: string) => getJson<WalletProfile>(`/api/wallet/${encodeURIComponent(wallet)}`);
