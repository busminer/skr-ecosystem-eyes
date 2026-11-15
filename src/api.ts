import { lang, t } from './i18n';
import { installId } from './install';
import type { EcosystemState, TopFind, TopList, TopPage, WalletProfile } from './types';
import type { ReleaseReceipt, StoreGuardians } from './guardians';

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
    // The phone's language rides along as one header, so the server's request
    // counter can say which languages people actually open the app in, and
    // the installation's random name as another (src/install.ts), so it can
    // count installations. Nothing else about the person travels with it.
    const install = installId();
    response = await fetch(`${API_BASE_URL}${path}`, { headers: { accept: 'application/json', 'x-skr-lang': lang(), ...(install ? { 'x-skr-install': install } : {}) }, signal: controller.signal });
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
// The store's guardians (1.6.0): every release request and vote of the last
// day, and this build's own receipt. A 404 on the receipt means the votes are
// not on chain yet, not that something broke.
export const fetchStoreGuardians = () => getJson<StoreGuardians>('/api/store-guardians');
export const fetchReleaseReceipt = (versionCode: number) => getJson<ReleaseReceipt>(`/api/store-guardians/receipt/${versionCode}`);
export const fetchWalletProfile = (wallet: string) => getJson<WalletProfile>(`/api/wallet/${encodeURIComponent(wallet)}`);

// The leaderboard, one page at a time. The wallet rides along so the answer
// carries this person's own place without a second request.
export const fetchTop = ({ list, offset = 0, limit = 100, wallet }: { list: TopList; offset?: number; limit?: number; wallet?: string | null }) =>
  getJson<TopPage>(`/api/top?list=${list}&offset=${offset}&limit=${limit}${wallet ? `&wallet=${encodeURIComponent(wallet)}` : ''}`);
export const findTop = (query: string) => getJson<TopFind>(`/api/top/find?q=${encodeURIComponent(query)}`);
