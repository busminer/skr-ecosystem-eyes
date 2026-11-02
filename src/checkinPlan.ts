// The position check-ins, planned (Alex, 02.11.2026).
//
// SKR Eyes invites a person to look at their own position up to three times a
// day: in the morning, around midday, in the evening. The number is theirs
// to set, two a day by default. Each is an invitation to look and nothing
// more: the app never asks anybody to stake (Alex, 06.09), never promises a
// reward, and never says what would be lost. It speaks to the person by the
// name the Iris knows them by (kosa.skr), the way a friend would.
//
// Pure: no phone, no storage, no React. The phone side (src/checkins.ts)
// turns this plan into weekly notifications; the test (scripts/
// test-checkins.mjs) reads it without a phone. The app's t() is handed in,
// so the plan can be read in Node; it is called t here so the i18n check
// still sees every sentence.
//
// Nothing in a line can go stale. A check-in repeats weekly until the app is
// opened again and re-plans it, so no line carries a day count, a rank or an
// amount that could be a week old by the time it is read.

export type PerDay = 0 | 1 | 2 | 3;
export const PER_DAY_OPTIONS: PerDay[] = [0, 1, 2, 3];

export type Slot = 'morning' | 'midday' | 'evening';

// Local phone time. One a day is the evening, when people look back on the
// day; two adds the morning; three adds midday.
export const SLOT_TIME: Record<Slot, { hour: number; minute: number }> = {
  morning: { hour: 9, minute: 0 },
  midday: { hour: 13, minute: 30 },
  evening: { hour: 19, minute: 30 },
};

export function slotsFor(perDay: PerDay): Slot[] {
  if (perDay >= 3) return ['morning', 'midday', 'evening'];
  if (perDay === 2) return ['morning', 'evening'];
  if (perDay === 1) return ['evening'];
  return [];
}

export function asPerDay(value: unknown, fallback: PerDay = 2): PerDay {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return n === 0 || n === 1 || n === 2 || n === 3 ? n : fallback;
}

export type Translate = (text: string, vars?: Record<string, string | number>) => string;

export type CheckinLine = { title: string; body: string };

// A name the phone may speak. Only a .skr name is one: a wallet's own label
// ("Seed Vault") or a shortened address is not something to greet a person by.
export function speakableName(name: string | null | undefined): string | null {
  if (!name) return null;
  const clean = name.trim();
  return /^[a-z0-9][a-z0-9-]{0,62}\.skr$/i.test(clean) ? clean : null;
}

// `own` lines speak of the person's own position and are kept for a phone
// that has one (a card was drawn). A phone with no wallet connected is
// invited to look at the vault itself instead.
type Pool = Array<{ body: (t: Translate) => string; own?: boolean }>;

const POOLS: Record<Slot, Pool> = {
  morning: [
    { body: (t) => t('See what the vault did while you slept.') },
    { body: (t) => t('Your place among stakers may have moved overnight. One look.'), own: true },
    { body: (t) => t('Who came in, who asked out: the night, in one look.') },
    { body: (t) => t('Your position is ready for a look before the day starts.'), own: true },
  ],
  midday: [
    { body: (t) => t('Your position, in one look: days, weight, what unlocks next.'), own: true },
    { body: (t) => t('The queue is turning. See who asked out and who came back.') },
    { body: (t) => t('Large moves land at any hour. See today\'s so far.') },
    { body: (t) => t('Thirty seconds in the vault, then back to your day.') },
  ],
  evening: [
    { body: (t) => t('Another day held. See what the vault did today.'), own: true },
    { body: (t) => t('The day\'s moves, in one look: in, out, and your weight in it.'), own: true },
    { body: (t) => t('Tomorrow\'s unlocks are already in the queue. See who is leaving.') },
    { body: (t) => t('Your card is ready whenever you feel like sharing it.'), own: true },
  ],
};

function title(t: Translate, slot: Slot, name: string | null): string {
  if (slot === 'morning') return name ? t('Good morning, {name}', { name }) : t('Good morning');
  if (slot === 'midday') return name ? t('{name}, a quiet minute?', { name }) : t('A quiet minute?');
  return name ? t('Good evening, {name}', { name }) : t('Good evening');
}

// Which line a given weekday gets: the pool is walked by weekday, offset per
// slot, so one day's three check-ins never read alike and a week does not
// repeat a sentence on the same day twice. `weekday` is 1 (Sunday) to 7.
export function checkinLine(t: Translate, slot: Slot, weekday: number, name: string | null, hasPosition: boolean): CheckinLine {
  const pool = POOLS[slot].filter((line) => hasPosition || !line.own);
  const offset = slot === 'morning' ? 0 : slot === 'midday' ? 1 : 2;
  const line = pool[(Math.max(1, Math.min(7, weekday)) - 1 + offset) % pool.length] as Pool[number];
  return { title: title(t, slot, name), body: line.body(t) };
}

export type PlannedCheckin = CheckinLine & { slot: Slot; weekday: number; hour: number; minute: number };

// The whole week, for this many a day.
export function planCheckins(t: Translate, perDay: PerDay, name: string | null, hasPosition: boolean): PlannedCheckin[] {
  const plans: PlannedCheckin[] = [];
  for (const slot of slotsFor(perDay)) {
    const at = SLOT_TIME[slot];
    for (let weekday = 1; weekday <= 7; weekday += 1) {
      plans.push({ slot, weekday, hour: at.hour, minute: at.minute, ...checkinLine(t, slot, weekday, name, hasPosition) });
    }
  }
  return plans;
}

// "09:00 · 19:30", for the setting's own note.
export function slotTimesLabel(perDay: PerDay): string {
  return slotsFor(perDay).map((slot) => `${String(SLOT_TIME[slot].hour).padStart(2, '0')}:${String(SLOT_TIME[slot].minute).padStart(2, '0')}`).join(' · ');
}
