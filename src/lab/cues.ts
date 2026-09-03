import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { API_BASE_URL } from '../api';
import { prefValue } from '../prefs';
import { cueHaptic, playCue, type Cue } from '../sound';

// The app's ear. One listener on the event feed for the whole app, so a large
// exit sounds the same on Me or Alerts as it does on Flow. Screens draw what
// they like from the same feed; this is only about what the person hears and
// feels, and it stops the moment the app leaves the foreground.

const POLL_MS = 6_000;
const TIMEOUT_MS = 15_000;
const BIG = 100_000;
const LABEL = 1_000;
const GAP_MS = 4_000;

type FeedEvent = { id: string; type: string; amount: number | null };

async function fetchRecent(): Promise<FeedEvent[]> {
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`${API_BASE_URL}/api/events?limit=25&min=0`, { headers: { accept: 'application/json' }, signal: controller.signal });
    if (!response.ok) throw new Error(String(response.status));
    const payload = await response.json() as { items?: FeedEvent[] };
    return payload.items ?? [];
  } finally {
    clearTimeout(deadline);
  }
}

export function useEventCues() {
  const seen = useRef<Set<string>>(new Set());
  const seeded = useRef(false);
  const lastCue = useRef(0);

  useEffect(() => {
    let alive = true;
    const pull = async () => {
      if (AppState.currentState !== 'active') return;
      try {
        const items = await fetchRecent();
        if (!alive) return;
        if (!seeded.current) {
          seeded.current = true;
          items.forEach((item) => seen.current.add(item.id));
          return;
        }
        const arrived = items.filter((item) => item.id && !seen.current.has(item.id));
        if (arrived.length === 0) return;
        arrived.forEach((item) => seen.current.add(item.id));
        if (seen.current.size > 600) seen.current = new Set([...seen.current].slice(-200));
        const stamp = Date.now();
        if (stamp - lastCue.current < GAP_MS) return;
        const heavyExit = arrived.some((item) => (item.type === 'unstake' || item.type === 'withdraw') && (item.amount ?? 0) >= BIG);
        const heavyStake = arrived.some((item) => item.type === 'stake' && (item.amount ?? 0) >= BIG);
        const labelled = arrived.some((item) => item.type === 'stake' && (item.amount ?? 0) >= LABEL);
        const cue: Cue | null = heavyExit ? 'tudum' : heavyStake ? 'surge' : labelled ? 'stake' : null;
        if (!cue) return;
        lastCue.current = stamp;
        if (prefValue('sound', true)) playCue(cue, cue === 'stake' ? 0.5 : 0.6);
        else if (prefValue('buzz', true)) cueHaptic(cue);
      } catch {
        // A missed poll is silence, which is the right sound for it.
      }
    };
    void pull();
    const timer = setInterval(() => void pull(), POLL_MS);
    const subscription = AppState.addEventListener('change', (next) => { if (next === 'active') void pull(); });
    return () => { alive = false; clearInterval(timer); subscription.remove(); };
  }, []);
}
