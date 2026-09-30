import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { useEffect } from 'react';
import { Platform } from 'react-native';
import { t } from '../i18n';
import { requestTab } from '../nav';
import type { EyeStatus } from './api';

// The Eye's reminders (Alex, 28.09: a Blink every eight hours, and the phone
// has to say so on time, worked out by the app itself).
//
// Everything comes from the server's own clock, read with the Eye's status:
// blink.nextAt is the wallet's last Blink plus the cooldown, blink.doneToday
// says whether the current UTC day already has its Blink. From that the phone
// keeps at most two local notifications, replaced every time the status is
// read or a Blink lands:
//
//   1. at nextAt, when that Blink would count for a new UTC day: the Eye can
//      blink again;
//   2. three hours before the UTC day ends, if today has no Blink yet and one
//      is possible by then: a calm note that today is still open.
//
// The words change with the moment and turn with every Blink (Alex, 28.09:
// the app should talk to the person, not repeat one sentence): day 2 after the
// mint, the new ring on day 7, gold on day 30, the next ring or gold coming
// close. Never a second Blink on a day already kept (a Blink is paid, and a
// reminder does not sell one), and never pressure about losing the streak:
// the evening note says where the streak is, not what would be lost (audit
// R-6, 28.09).
//
// Nothing leaves the phone. The alarms are exact (USE_EXACT_ALARM in the
// manifest), so "in eight hours" means eight hours, not whenever Android
// batches its wake-ups. A tap opens the Eyes tab.

const CHANNEL_ID = 'eye-blink';
const IDS_KEY = 'skr-eyes:eye:reminder-ids';
const ASKED_KEY = 'skr-eyes:eye:reminder-asked';
const STREAK_WARNING_MS = 3 * 3_600_000;
// The Iris's rings by streak (src/iris.mjs in the service), for "days to the next ring".
const RING_DAYS = [1, 2, 3, 5, 7, 10, 14, 21, 30];

let channelReady: Promise<void> | null = null;

function ensureChannel(): Promise<void> {
  if (Platform.OS !== 'android') return Promise.resolve();
  channelReady ??= Notifications.setNotificationChannelAsync(CHANNEL_ID, {
    name: 'Eye reminders',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 90, 70, 90],
    lightColor: '#56E0FF',
  }).then(() => undefined).catch(() => undefined);
  return channelReady;
}

const asTime = (value: string | number | null | undefined): number | null => {
  if (value == null) return null;
  const ms = typeof value === 'number' ? (value < 1e12 ? value * 1000 : value) : Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
};

async function cancelStored(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(IDS_KEY);
    if (!raw) return;
    const ids = JSON.parse(raw) as string[];
    await Promise.all(ids.map((id) => Notifications.cancelScheduledNotificationAsync(id).catch(() => undefined)));
    await AsyncStorage.removeItem(IDS_KEY);
  } catch {
    // A reminder we could not cancel will at worst say something true late.
  }
}

// What the phone should hold for this status; pure, so it can be reasoned
// about without a phone. `name` is the wallet's own name on the Iris
// (kosa.skr), and the reminders speak it (Alex, 30.09: the app talks to a
// member of its own community, not to a user): warm, by name, never a
// threat about what would be lost (audit R-6 still stands).
export function remindersFor(status: EyeStatus, name: string | null = null, now = Date.now()): Array<{ at: number; title: string; body: string }> {
  const eye = status.eye;
  const blink = status.blink;
  if (!eye || !blink) return [];
  const plans: Array<{ at: number; title: string; body: string }> = [];
  const nextAt = asTime(blink.nextAt) ?? (blink.ready ? now : null);

  const streak = Math.max(0, eye.streak ?? 0);
  const blinks = Math.max(0, eye.blinks ?? 0);
  const who = name ?? t('legend');
  // Which one of several lines: turns with every Blink, so the phone does not
  // say the same sentence twice in a row.
  const pick = <T,>(lines: T[]): T => lines[(blinks + streak) % lines.length] as T;

  if (nextAt != null && nextAt > now + 30_000) {
    // Will the Blink this reminder asks for keep a new day, or is today
    // already kept? A new UTC day at nextAt means the streak grows by one.
    const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
    const newDay = eye.lastBlinkDay ? utcDay(nextAt) !== eye.lastBlinkDay : true;
    const day = streak + 1;
    const toRing = (RING_DAYS.find((d) => d > streak) ?? 30) - streak;
    const toGold = Math.max(0, 30 - streak);
    // A Blink that would land on a day already kept gets no reminder at all.
    let line: { title: string; body: string } | null = null;
    if (!newDay) {
      line = null;
    } else if (day === 30) {
      line = { title: t('Gold day, {name}', { name: who }), body: t('One Blink and your Eye turns gold. Days like this make legends.') };
    } else if (day === 7) {
      line = { title: t('Day 7, {name}', { name: who }), body: t('Blink today and your Eye moves to a new ring.') };
    } else if (day === 2) {
      line = { title: t('{name}, day 2 is calling', { name: who }), body: t('One Blink keeps your brand-new streak alive.') };
    } else {
      const lines = [
        { title: t('Hey {name} — time to blink', { name: who }), body: t('Day {count} is open. Your Eye is waiting on you.', { count: day }) },
        { title: t('{name}, your Eye is ready', { name: who }), body: t('8 hours passed. One touch keeps day {count}.', { count: day }) },
        { title: t('The Iris misses you, {name}', { name: who }), body: t('Blink and day {count} is yours.', { count: day }) },
      ];
      if (toRing > 0 && toRing <= 2) lines.push({ title: toRing === 1 ? t('1 day to the next ring') : t('{count} days to the next ring', { count: toRing }), body: t('Blink today to get closer to the centre.') });
      if (toGold > 0 && toGold <= 7) lines.push({ title: toGold === 1 ? t('1 day to gold') : t('{count} days to gold', { count: toGold }), body: t('Day 30 turns your Eye gold.') });
      line = pick(lines);
    }
    if (line) plans.push({ at: nextAt, ...line });
  }

  // The end of the current UTC day, and whether it still needs its Blink.
  const dayEnd = Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), new Date(now).getUTCDate() + 1);
  const warnAt = dayEnd - STREAK_WARNING_MS;
  const blinkPossibleBy = nextAt ?? now;
  if (!blink.doneToday && warnAt > now + 30_000 && blinkPossibleBy <= dayEnd - 10 * 60_000) {
    const at = Math.max(warnAt, blinkPossibleBy);
    const line = streak > 1
      ? pick([
        { title: t('{name}, today is still open', { name: who }), body: t('{count} days in a row so far.', { count: streak }) },
        { title: t('Your Eye has not blinked today'), body: t('Your streak is at {count} days. A quiet Blink keeps it breathing.', { count: streak }) },
      ])
      : { title: t('{name}, your Eye waits', { name: who }), body: t('One tap keeps your Eye going.') };
    plans.push({ at, ...line });
  }
  return plans.sort((a, b) => a.at - b.at);
}

// Replace whatever is scheduled with what this status calls for. Quiet when
// notifications are off: the person said no, and we do not ask again here.
export async function syncEyeReminders(status: EyeStatus | null): Promise<void> {
  try {
    await cancelStored();
    if (!status?.eye) return;
    const permission = await Notifications.getPermissionsAsync();
    if (!permission.granted) return;
    await ensureChannel();
    // The Iris's name for this wallet, kept by the Eyes tab: the reminder
    // speaks to kosa.skr, not to a wallet address.
    let name: string | null = null;
    try {
      const raw = await AsyncStorage.getItem('skr-eyes:me-name:v1');
      if (raw) {
        const parsed = JSON.parse(raw) as { wallet?: string; name?: string | null };
        if (parsed?.wallet === status.wallet && typeof parsed.name === 'string' && parsed.name) name = parsed.name;
      }
    } catch {
      // A missing name greets a legend instead.
    }
    const ids: string[] = [];
    for (const plan of remindersFor(status, name)) {
      ids.push(await Notifications.scheduleNotificationAsync({
        content: { title: plan.title, body: plan.body, sound: 'default', data: { eye: true } },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(plan.at), channelId: CHANNEL_ID },
      }));
    }
    await AsyncStorage.setItem(IDS_KEY, JSON.stringify(ids));
  } catch {
    // A reminder that could not be set is not worth a crash.
  }
}

// After the first Eye opens, once: the reminders are why an eight-hour Blink
// is possible at all, so a phone that has notifications off is asked one time.
export async function askForEyeRemindersOnce(): Promise<boolean> {
  try {
    const current = await Notifications.getPermissionsAsync();
    if (current.granted) return true;
    if (await AsyncStorage.getItem(ASKED_KEY)) return false;
    await AsyncStorage.setItem(ASKED_KEY, '1');
    if (!current.canAskAgain) return false;
    return (await Notifications.requestPermissionsAsync()).granted;
  } catch {
    return false;
  }
}

// A tap on an Eye reminder opens the Eyes tab, from a cold start too. The
// last response survives app restarts, so each one is acted on only once.
const TAPPED_KEY = 'skr-eyes:eye:reminder-tapped';

export function useEyeReminderTaps(): void {
  useEffect(() => {
    const open = async (response: Notifications.NotificationResponse | null) => {
      if (!response?.notification.request.content.data?.eye) return;
      const id = `${response.notification.request.identifier}@${response.notification.date}`;
      if ((await AsyncStorage.getItem(TAPPED_KEY).catch(() => null)) === id) return;
      await AsyncStorage.setItem(TAPPED_KEY, id).catch(() => undefined);
      requestTab({ tab: 'eyes' });
    };
    void Notifications.getLastNotificationResponseAsync().then(open).catch(() => undefined);
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => { void open(response); });
    return () => subscription.remove();
  }, []);
}
