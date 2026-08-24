import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';

// Small switches the person flips — alerts, buzz, sound. They live on the
// phone and nowhere else, and they have to survive leaving the screen: a
// toggle that forgets itself the moment you look at another tab is a toggle
// nobody trusts.

const PREFIX = 'skr-eyes:pref:';
const cache = new Map<string, boolean>();
const listeners = new Map<string, Set<(value: boolean) => void>>();

function announce(key: string, value: boolean) {
  cache.set(key, value);
  listeners.get(key)?.forEach((listener) => listener(value));
}

export function usePref(key: string, fallback: boolean): [boolean, (value: boolean) => void] {
  const [value, setValue] = useState(() => cache.get(key) ?? fallback);

  useEffect(() => {
    let alive = true;
    const listener = (next: boolean) => { if (alive) setValue(next); };
    const group = listeners.get(key) ?? new Set();
    group.add(listener);
    listeners.set(key, group);

    if (cache.has(key)) setValue(cache.get(key) as boolean);
    else {
      void AsyncStorage.getItem(`${PREFIX}${key}`).then((raw) => {
        if (!alive) return;
        const stored = raw === null ? fallback : raw === '1';
        announce(key, stored);
      }).catch(() => undefined);
    }

    return () => { alive = false; group.delete(listener); };
  }, [key, fallback]);

  const write = useCallback((next: boolean) => {
    announce(key, next);
    void AsyncStorage.setItem(`${PREFIX}${key}`, next ? '1' : '0').catch(() => undefined);
  }, [key]);

  return [value, write];
}

// Every switch the app reads from outside React. They have to be in the cache
// before the first screen paints, because prefValue cannot wait for anything.
const STORED_KEYS = ['sound', 'buzz', 'alert:large'] as const;

// Without this the cache filled only when a screen mounted the matching hook,
// and the hook for sound and buzz lives on Flow. The app opens on Pulse, where
// the flip board reads the switches through prefValue — so a person who had
// turned sound off got a beep on every cold start until they visited Flow.
let hydration: Promise<void> | null = null;

export function hydratePrefs(): Promise<void> {
  hydration ??= (async () => {
    try {
      const pairs = await AsyncStorage.multiGet(STORED_KEYS.map((key) => `${PREFIX}${key}`));
      pairs.forEach(([storageKey, raw]) => {
        if (raw === null) return;
        announce(storageKey.slice(PREFIX.length), raw === '1');
      });
    } catch {
      // Storage that will not answer leaves the defaults standing, which is the
      // same answer a first run gets.
    }
  })();
  return hydration;
}

// Anything that would otherwise act on a default before the saved answer is
// known waits on this. The launch sound is the reason it exists: it plays a
// quarter of a second in, long before any screen has mounted a hook, and a
// person who switched sound off should not be greeted by a chime anyway.
export const prefsReady = hydratePrefs();

// Read-only access for code outside React, e.g. the sound helper.
export function prefValue(key: string, fallback: boolean): boolean {
  return cache.get(key) ?? fallback;
}
