import { useEffect } from 'react';

// One screen asking for another. Me taps "Your place" and wants the Top tab
// on its own row; Top taps "Share my place" and wants Me with the card. The
// tab bar lives in App, so the request travels through here rather than
// through props threaded down every screen.

export type TabRequest = { tab: 'pulse' | 'flow' | 'top' | 'me' | 'alerts'; wallet?: string | null; share?: boolean };

const listeners = new Set<(request: TabRequest) => void>();
let last: TabRequest | null = null;

export function requestTab(request: TabRequest): void {
  last = request;
  listeners.forEach((listener) => listener(request));
}

// What the screen was opened for, read once by the screen that just mounted.
export function takeTabRequest(tab: TabRequest['tab']): TabRequest | null {
  if (!last || last.tab !== tab) return null;
  const taken = last;
  last = null;
  return taken;
}

export function useTabRequests(listener: (request: TabRequest) => void): void {
  useEffect(() => {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }, [listener]);
}
