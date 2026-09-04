import { useEffect, useRef } from 'react';
import { subscribeFeed } from './feed';
import { prefValue } from '../prefs';
import { cueHaptic, playCue, type Cue } from '../sound';

// The app's ear. One listener on the event feed for the whole app, so a large
// exit sounds the same on Me or Alerts as it does on Flow. Screens draw what
// they like from the same feed; this is only about what the person hears and
// feels, and it stops the moment the app leaves the foreground.

const BIG = 100_000;
const LABEL = 1_000;
const GAP_MS = 4_000;

export function useEventCues() {
  const seen = useRef<Set<string>>(new Set());
  const lastCue = useRef(0);

  useEffect(() => subscribeFeed((items, first) => {
    if (first) {
      items.forEach((item) => seen.current.add(item.id));
      return;
    }
    const arrived = items.filter((item) => item.id && !seen.current.has(item.id));
    if (arrived.length === 0) return;
    arrived.forEach((item) => seen.current.add(item.id));
    if (seen.current.size > 600) seen.current = new Set([...seen.current].slice(-200));
    // The switch on Alerts is the master for these; sound and buzz below it
    // say how a move is felt, this one says whether it is felt at all.
    if (!prefValue('alert:large', true)) return;
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
  }), []);
}
