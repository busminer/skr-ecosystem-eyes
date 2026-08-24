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

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, { headers: { accept: 'application/json' } });
  if (!response.ok) {
    let detail = '';
    try {
      const payload = await response.json() as { error?: unknown };
      if (typeof payload.error === 'string') detail = payload.error;
    } catch {
      // Status remains authoritative when an upstream proxy returns non-JSON.
    }
    throw new ApiError(response.status, detail || `SKR Eyes API returned ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export const fetchEcosystemState = () => getJson<EcosystemState>('/api/state');
export const fetchWalletProfile = (wallet: string) => getJson<WalletProfile>(`/api/wallet/${encodeURIComponent(wallet)}`);
