import { AppState, type NativeEventSubscription } from 'react-native';
import { API_BASE_URL } from '../api';

// One ear for the whole app. The scene on Vault and the sounds in cues.ts used
// to run two identical pollers against the same page of the feed, six seconds
// apart each; now there is one request and everyone who cares reads from it.
// Every listener keeps its own memory of what it has seen, and gets a full
// page on its first delivery so it can seed that memory.

export type FeedEvent = { id: string; signature: string; type: string; wallet: string; name?: string | null; amount: number | null; blockTime: number };
export type FeedListener = (items: FeedEvent[], first: boolean) => void;

const POLL_MS = 6_000;
const TIMEOUT_MS = 15_000;
const PAGE = 60;

const listeners = new Map<FeedListener, { seeded: boolean }>();
let timer: ReturnType<typeof setInterval> | null = null;
let subscription: NativeEventSubscription | null = null;
let inFlight = false;

export async function fetchEvents(limit = 25, minimum = 0, type?: string): Promise<FeedEvent[]> {
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`${API_BASE_URL}/api/events?limit=${limit}&min=${minimum}${type ? `&type=${type}` : ''}`, { headers: { accept: 'application/json' }, signal: controller.signal });
    if (!response.ok) throw new Error(String(response.status));
    const payload = await response.json() as { items?: FeedEvent[] };
    return payload.items ?? [];
  } finally {
    clearTimeout(deadline);
  }
}

async function pull() {
  // A phone in a pocket must not keep asking, and a read that has not come
  // back is not helped by another one beside it.
  if (AppState.currentState !== 'active' || inFlight || listeners.size === 0) return;
  inFlight = true;
  try {
    const items = await fetchEvents(PAGE);
    listeners.forEach((state, listener) => {
      const first = !state.seeded;
      state.seeded = true;
      try { listener(items, first); } catch { /* one listener's trouble is its own */ }
    });
  } catch {
    // A missed poll is silence, which is the right sound for it.
  } finally {
    inFlight = false;
  }
}

export function subscribeFeed(listener: FeedListener): () => void {
  listeners.set(listener, { seeded: false });
  if (!timer) {
    timer = setInterval(() => void pull(), POLL_MS);
    subscription = AppState.addEventListener('change', (next) => { if (next === 'active') void pull(); });
  }
  // A late listener does not wait out the rest of the interval.
  void pull();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer) {
      clearInterval(timer); timer = null;
      subscription?.remove(); subscription = null;
    }
  };
}
