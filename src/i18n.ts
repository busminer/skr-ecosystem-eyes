import { useEffect, useState } from 'react';
import { NativeModules, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { zh } from './strings/zh';
import { ru } from './strings/ru';
import { es } from './strings/es';
import { pt } from './strings/pt';
import { tr } from './strings/tr';
import { vi } from './strings/vi';
import { id } from './strings/id';
import { ko } from './strings/ko';
import { ja } from './strings/ja';

// The English sentence in the code is the key. There is no table of `home.title`
// style names to keep in step with the screens, so a string that has no
// translation yet still renders — in English — instead of showing its own key
// to somebody. The cost is that editing an English sentence orphans its
// translation, which `npm run i18n:check` reports.

export const LANGS = ['en', 'zh', 'ru', 'es', 'pt', 'tr', 'vi', 'id', 'ko', 'ja'] as const;
export type Lang = typeof LANGS[number];

// Each language named the way its own speakers write it. A person looking for
// their language scans for the shape of their own script, not for the English
// word for it.
export const LANG_LABEL: Record<Lang, string> = {
  en: 'English',
  zh: '中文',
  ru: 'Русский',
  es: 'Español',
  pt: 'Português',
  tr: 'Türkçe',
  vi: 'Tiếng Việt',
  id: 'Indonesia',
  ko: '한국어',
  ja: '日本語',
};

const TABLES: Record<Lang, Record<string, string>> = { en: {}, zh, ru, es, pt, tr, vi, id, ko, ja };
const STORE_KEY = 'skr-eyes:lang';

function isLang(value: unknown): value is Lang {
  return typeof value === 'string' && (LANGS as readonly string[]).includes(value);
}

// What language the phone itself is set to. Asked of Android directly rather
// than through a library: this is one string, and pulling in a native module
// for it would mean rebuilding the native project for no other gain.
//
// Matched on the language part alone. Brazilian and European Portuguese share
// one table, and so do the Spanishes — telling them apart would mean two more
// tables to keep in step for the sake of a handful of words.
function systemLang(): Lang {
  const candidates: string[] = [];
  try {
    const resolved = Intl?.DateTimeFormat?.().resolvedOptions?.().locale;
    if (resolved) candidates.push(resolved);
  } catch {
    // A Hermes build without Intl simply leaves this one out.
  }
  if (Platform.OS === 'android') {
    const identifier = (NativeModules as { I18nManager?: { localeIdentifier?: string } })?.I18nManager?.localeIdentifier;
    if (identifier) candidates.push(identifier);
  }
  for (const candidate of candidates) {
    const code = candidate.replace('_', '-').toLowerCase().split('-')[0] ?? '';
    // Indonesian was renamed from `in` to `id` in 1989 and some phones still
    // report the old code, so both answer to the same table.
    if (code === 'in') return 'id';
    if (isLang(code)) return code;
  }
  return 'en';
}

let current: Lang = 'en';
const listeners = new Set<(next: Lang) => void>();

// Read before the first screen paints, exactly like the switches in prefs:
// a person who chose Chinese should not watch the app open in English and
// then swap under them.
export const langReady: Promise<void> = (async () => {
  let stored: string | null = null;
  try {
    stored = await AsyncStorage.getItem(STORE_KEY);
  } catch {
    // Storage that will not answer leaves the phone's own language standing.
  }
  current = isLang(stored) ? stored : systemLang();
  listeners.forEach((listener) => listener(current));
})();

export function lang(): Lang {
  return current;
}

export function setLang(next: Lang): void {
  if (next === current) return;
  current = next;
  void AsyncStorage.setItem(STORE_KEY, next).catch(() => undefined);
  listeners.forEach((listener) => listener(next));
}

export function useLang(): Lang {
  const [value, setValue] = useState(current);
  useEffect(() => {
    const listener = (next: Lang) => setValue(next);
    listeners.add(listener);
    setValue(current);
    return () => { listeners.delete(listener); };
  }, []);
  return value;
}

// `t('Held at least {days} days', { days })` — the braces are filled in after
// the lookup, so a translator moves them wherever that language needs them.
export function t(text: string, vars?: Record<string, string | number>): string {
  let out = TABLES[current][text] ?? text;
  if (vars) {
    for (const [name, value] of Object.entries(vars)) out = out.split(`{${name}}`).join(String(value));
  }
  return out;
}
