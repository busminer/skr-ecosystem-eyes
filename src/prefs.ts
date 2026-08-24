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

// Read-only access for code outside React, e.g. the sound helper.
export function prefValue(key: string, fallback: boolean): boolean {
  return cache.get(key) ?? fallback;
}
