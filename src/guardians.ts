import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import Constants from 'expo-constants';
import { API_BASE_URL, ApiError, fetchReleaseReceipt, fetchStoreGuardians } from './api';

// The dApp Store's guardians, as the server reads them from the chain
// (skr-eyes-server src/store-guardians.js, live since 15.11.2026).
//
// Every release to the store is asked for on chain, and each guardian votes
// on it on chain: Solana Mobile since 24.10, Jito since 03.11, Helius since
// 09.11. SKR Eyes watched the vault; now it watches the guardians too.
//
// Since 16.11.2026 every vote carries its verdict, and every release its store
// name and icon (Alex: the app turns green or red as its guardians vote, and
// is called by the name it has in the store, not by its package).

export type GuardianId = 'solana_mobile' | 'jito' | 'helius' | null;

export type Verdict = 'pending' | 'approved' | 'rejected';

export type StoreReleaseVote = {
  guardian: string;
  approve: boolean;
  at: number;
  seconds: number;
  sig: string;
};

// One release request of the last day, with its votes and its face.
export type StoreRelease = {
  key: string;
  app: string;
  pkg: string | null;
  versionCode: number;
  versionName: string | null;
  // The store's name; for an app the store does not list yet, the name its
  // publisher registered on chain.
  name: string | null;
  nameSource: 'store' | 'chain' | null;
  // A path on our server (/api/store-guardians/icon/<hash>), or null.
  icon: string | null;
  requestedAt: number;
  sig: string;
  votes: StoreReleaseVote[];
  verdict: Verdict;
  // When the store first served exactly this version, or null.
  liveAt: number | null;
  ours: boolean;
};

export type StoreGuardian = {
  key: string;
  id: GuardianId;
  name: string | null;
  votesTotal: number;
  votes24h: number;
  firstVoteAt: number | null;
  lastVoteAt: number | null;
  medianSeconds24h: number | null;
  medianSecondsAll: number | null;
};

export type GuardianEvent = {
  kind: 'request' | 'vote';
  at: number;
  slot: number;
  sig: string;
  app: string;
  pkg: string | null;
  versionCode: number;
  versionName?: string | null;
  name?: string | null;
  guardian?: string;
  approve?: boolean;
  seconds?: number | null;
};

export type StoreGuardians = {
  updatedAt: string;
  program: string;
  guardians: StoreGuardian[];
  // Absent on a server older than 16.11.2026.
  activeGuardians?: number;
  releases?: StoreRelease[];
  events: GuardianEvent[];
  today: { votes: number; releases: number; apps: number; medianSeconds: number | null };
  totals: { votes: number; releases: number; apps: number; since: number | null };
  pools: { count: number | null; top: Array<{ guardianPool: string; activeStaked: number; positions: number }> };
  status: { phase: string; lastSyncAt: string | null };
};

export type ReleaseVote = {
  key: string;
  id: GuardianId;
  name: string | null;
  approve: boolean;
  at: number;
  slot: number;
  sig: string;
  seconds: number;
  slots: number;
};

export type ReleaseReceipt = {
  package: string;
  name?: string | null;
  icon?: string | null;
  liveAt?: number | null;
  verdict?: Verdict;
  versionCode: number;
  versionName: string | null;
  request: { at: number; slot: number; sig: string; publisher: string };
  votes: ReleaseVote[];
  complete: boolean;
};

// This build's own number. app.json is embedded at build time; the constant is
// the floor, so a build that somehow lost its config still asks about itself
// and not about a stranger.
const BUILT_AS = 13;
export const BUILD_VERSION_CODE = Number(Constants.expoConfig?.android?.versionCode) || BUILT_AS;
export const BUILD_VERSION_NAME = Constants.expoConfig?.version || '1.6.0';

// Each guardian's colour, taken from its own mark. A key nobody has named yet
// gets the app's own grey and is shown by its address.
export const GUARDIAN_TONE: Record<string, string> = {
  solana_mobile: '#C9A96A',
  jito: '#7CF0BC',
  helius: '#FF8A4C',
};

export function guardianTone(id: GuardianId): string {
  return (id && GUARDIAN_TONE[id]) || '#8296A8';
}

// An icon path from the server made into an address the phone can load.
export function iconUrl(icon: string | null | undefined): string | null {
  if (!icon) return null;
  return icon.startsWith('/') ? `${API_BASE_URL}${icon}` : icon;
}

// What to call an app: its store name, else its package's last word.
export function releaseName(release: { name?: string | null; pkg: string | null }): string {
  if (release.name) return release.name;
  const tail = release.pkg?.split('.').filter((part) => !/^(app|android|seeker|mobile|io|com|dev|fun|xyz)$/i.test(part)).at(-1);
  return tail ? tail.charAt(0).toUpperCase() + tail.slice(1) : release.pkg || '—';
}

export function shortKey(key: string): string {
  return key.length > 10 ? `${key.slice(0, 4)}…${key.slice(-4)}` : key;
}

export function guardianLabel(guardian: { name: string | null; key: string }): string {
  return guardian.name || shortKey(guardian.key);
}

// One release request with the votes that answered it, newest first.
export type ReleaseRow = {
  request: GuardianEvent | null;
  app: string;
  pkg: string | null;
  versionCode: number;
  versionName: string | null;
  at: number;
  votes: GuardianEvent[];
};

export function releaseRows(events: GuardianEvent[], limit = 12): ReleaseRow[] {
  const rows = new Map<string, ReleaseRow>();
  for (const event of events) {
    const key = `${event.app}:${event.versionCode}`;
    let row = rows.get(key);
    if (!row) {
      row = { request: null, app: event.app, pkg: event.pkg, versionCode: event.versionCode, versionName: event.versionName ?? null, at: event.at, votes: [] };
      rows.set(key, row);
    }
    if (event.kind === 'request') {
      // A second request for the same version starts its count again.
      row.request = event;
      row.at = event.at;
      row.votes = [];
      row.versionName = event.versionName ?? row.versionName;
    } else {
      row.votes.push(event);
    }
  }
  return [...rows.values()].sort((a, b) => b.at - a.at).slice(0, limit);
}

// Polls while the screen is open and the app is in front; a phone in a pocket
// asks for nothing.
export function useStoreGuardians(active: boolean, everyMs = 15_000) {
  const [data, setData] = useState<StoreGuardians | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  useEffect(() => {
    if (!active) return undefined;
    let alive = true;
    const read = () => {
      if (busy.current || AppState.currentState !== 'active') return;
      busy.current = true;
      fetchStoreGuardians()
        .then((next) => { if (alive) { setData(next); setError(null); } })
        .catch((reason: unknown) => { if (alive) setError(reason instanceof Error ? reason.message : String(reason)); })
        .finally(() => { busy.current = false; });
    };
    read();
    const timer = setInterval(read, everyMs);
    const subscription = AppState.addEventListener('change', (next) => { if (next === 'active') read(); });
    return () => { alive = false; clearInterval(timer); subscription.remove(); };
  }, [active, everyMs]);
  return { data, error };
}

// This build's receipt. Asked for once when the screen opens, and again only
// while it is not complete; a complete receipt never changes.
export function useReleaseReceipt(active: boolean) {
  const [receipt, setReceipt] = useState<ReleaseReceipt | null>(null);
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    if (!active || receipt?.complete) return undefined;
    let alive = true;
    const read = () => fetchReleaseReceipt(BUILD_VERSION_CODE)
      .then((next) => { if (alive) { setReceipt(next); setMissing(false); } })
      .catch((reason: unknown) => { if (alive && reason instanceof ApiError && reason.status === 404) setMissing(true); });
    void read();
    const timer = setInterval(() => void read(), 20_000);
    return () => { alive = false; clearInterval(timer); };
  }, [active, receipt?.complete]);
  return { receipt, missing };
}
