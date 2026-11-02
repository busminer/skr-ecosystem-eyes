import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { useEffect, useState } from 'react';
import { AppState, Platform } from 'react-native';
import { lang, t } from './i18n';
import { requestTab } from './nav';
import { connectedWallet, walletReady } from './wallet';
import { asPerDay, checkinLine, planCheckins, speakableName, type PerDay, type Slot } from './checkinPlan';

// The position check-ins on the phone (Alex, 02.11.2026): up to three
// invitations a day to look at your own position, planned by
// src/checkinPlan.ts and kept as weekly local notifications. Nothing leaves
// the phone: no push server, no address sent anywhere. A tap lands on Me.
//
// How many a day is the person's setting, two by default. A phone that had
// switched the old "daily look" off in 1.x starts with none: that answer was
// about the same thing and is kept.
//
// Replaced, never added to. Every sync first cancels every check-in the phone
// holds (found by their payload, not by a remembered list of ids, so nothing
// scheduled by an older run can survive) and then schedules the week again.
// That is what keeps one phone from showing the same invitation twice (the
// old nudges reached Alex sixteen times, 29.09).

const CHANNEL_ID = 'skr-checkins';
const SETTING_KEY = 'skr-eyes:checkins:v1';
const LEGACY_NUDGE_KEY = 'skr-eyes:pref:nudge:daily';
const STAMP_KEY = 'skr-eyes:checkins:stamp';
// The card Me keeps on disk: its name is the name the Iris knows the wallet by.
const CARD_KEY = 'skr-eyes.card';

export const isCheckin = (data: unknown): boolean => Boolean(data && typeof data === 'object' && (data as { checkin?: unknown }).checkin === true);
const isSample = (data: unknown): boolean => Boolean(data && typeof data === 'object' && (data as { sample?: unknown }).sample === true);

let perDay: PerDay = 2;
const listeners = new Set<(value: PerDay) => void>();

function announce() {
  listeners.forEach((listener) => listener(perDay));
}

// Read once, before the first screen paints, like the other switches.
export const checkinsReady: Promise<void> = (async () => {
  try {
    const raw = await AsyncStorage.getItem(SETTING_KEY);
    if (raw) {
      perDay = asPerDay((JSON.parse(raw) as { perDay?: unknown }).perDay, 2);
    } else {
      const legacy = await AsyncStorage.getItem(LEGACY_NUDGE_KEY);
      perDay = legacy === '0' ? 0 : 2;
    }
  } catch {
    // Storage that will not answer leaves the default standing.
  }
  announce();
})();

export function checkinsPerDay(): PerDay {
  return perDay;
}

export function setCheckinsPerDay(next: PerDay): void {
  perDay = next;
  void AsyncStorage.setItem(SETTING_KEY, JSON.stringify({ perDay: next })).catch(() => undefined);
  announce();
  void syncCheckins();
}

export function useCheckinsPerDay(): [PerDay, (next: PerDay) => void] {
  const [value, setValue] = useState(perDay);
  useEffect(() => {
    listeners.add(setValue);
    setValue(perDay);
    return () => { listeners.delete(setValue); };
  }, []);
  return [value, setCheckinsPerDay];
}

let channelReady: Promise<void> | null = null;

function ensureChannel(): Promise<void> {
  if (Platform.OS !== 'android') return Promise.resolve();
  channelReady ??= Notifications.setNotificationChannelAsync(CHANNEL_ID, {
    name: t('Position check-ins'),
    // HIGH: the invitation shows as a banner, the way the person set it to.
    // DEFAULT only put an icon in the status bar, and "Show me one" then
    // seemed to do nothing at all.
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 80],
    lightColor: '#56E0FF',
  }).then(() => undefined).catch(() => undefined);
  return channelReady;
}

// Who the phone speaks to and whether it has a position to speak of. Only
// the wallet that connected is "you": a pasted address is somebody being
// looked at, and the phone must not greet a stranger's name every morning.
// The card Me writes after a successful read carries the .skr name; a name
// the person chose to hide on the card is not spoken on the lock screen either.
async function whoAndWhat(): Promise<{ name: string | null; hasPosition: boolean }> {
  try {
    await walletReady;
    if (!connectedWallet()) return { name: null, hasPosition: false };
    const card = await AsyncStorage.getItem(CARD_KEY);
    if (!card) return { name: null, hasPosition: false };
    const facts = JSON.parse(card) as { name?: unknown; hideName?: unknown };
    const name = facts.hideName === true ? null : speakableName(typeof facts.name === 'string' ? facts.name : null);
    return { name, hasPosition: true };
  } catch {
    return { name: null, hasPosition: false };
  }
}

// The phone's time zone, so a trip re-plans the week at the new hours.
const zone = (): string => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? '';
  } catch {
    return '';
  }
};

async function cancelCheckins(): Promise<void> {
  try {
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    await Promise.all(scheduled.map((request) => {
      const data = request.content.data;
      if (!isCheckin(data) || isSample(data)) return Promise.resolve();
      return Notifications.cancelScheduledNotificationAsync(request.identifier).catch(() => undefined);
    }));
  } catch {
    // Nothing to cancel, or the module is not there.
  }
}

let syncing: Promise<void> | null = null;

// Make the phone hold exactly what the setting, the name and the language
// call for. Called on launch, when the setting moves, when Me draws or
// drops a card, and when the language changes. Two calls overlapping would
// cancel each other's work, so they are run one after another.
export function syncCheckins(): Promise<void> {
  const run = async () => {
    try {
      await checkinsReady;
      const { name, hasPosition } = await whoAndWhat();
      const plans = planCheckins(t, perDay, name, hasPosition);
      const stamp = JSON.stringify({ perDay, name, hasPosition, lang: lang(), tz: zone(), count: plans.length });
      let scheduledCount = 0;
      try {
        scheduledCount = (await Notifications.getAllScheduledNotificationsAsync()).filter((request) => isCheckin(request.content.data) && !isSample(request.content.data)).length;
      } catch {
        // Counted as none; the week is then written again, which is harmless.
      }
      const previous = await AsyncStorage.getItem(STAMP_KEY).catch(() => null);
      if (previous === stamp && scheduledCount === plans.length) return;
      await cancelCheckins();
      await AsyncStorage.setItem(STAMP_KEY, '').catch(() => undefined);
      if (!plans.length) return;
      const permission = await Notifications.getPermissionsAsync();
      if (!permission.granted) return;
      await ensureChannel();
      for (const plan of plans) {
        await Notifications.scheduleNotificationAsync({
          content: { title: plan.title, body: plan.body, sound: 'default', data: { checkin: true } },
          trigger: { type: Notifications.SchedulableTriggerInputTypes.WEEKLY, weekday: plan.weekday, hour: plan.hour, minute: plan.minute, channelId: CHANNEL_ID },
        });
      }
      await AsyncStorage.setItem(STAMP_KEY, stamp).catch(() => undefined);
    } catch {
      // A check-in that could not be set is not worth a crash.
    }
  };
  syncing = (syncing ?? Promise.resolve()).then(run, run);
  return syncing;
}

// One check-in a few seconds from now, so the setting can show what it
// sends rather than describe it. It is marked a sample and never counted or
// cancelled by a sync.
export async function sampleCheckin(): Promise<boolean> {
  try {
    const permission = await Notifications.getPermissionsAsync();
    if (!permission.granted) return false;
    await ensureChannel();
    const { name, hasPosition } = await whoAndWhat();
    // The line of this hour of this day, as it would really arrive.
    const now = new Date();
    const slot: Slot = now.getHours() < 12 ? 'morning' : now.getHours() < 17 ? 'midday' : 'evening';
    const plan = checkinLine(t, slot, now.getDay() + 1, name, hasPosition);
    await Notifications.scheduleNotificationAsync({
      content: { title: plan.title, body: plan.body, sound: 'default', data: { checkin: true, sample: true } },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: 4, channelId: CHANNEL_ID },
    });
    return true;
  } catch {
    return false;
  }
}

// A tap on a check-in opens Me, from a cold start too. The last response
// survives app restarts, so each one is acted on only once.
const TAPPED_KEY = 'skr-eyes:checkins:tapped';

export function useCheckinTaps(): void {
  useEffect(() => {
    const open = async (response: Notifications.NotificationResponse | null) => {
      if (!response || !isCheckin(response.notification.request.content.data)) return;
      const id = `${response.notification.request.identifier}@${response.notification.date}`;
      if ((await AsyncStorage.getItem(TAPPED_KEY).catch(() => null)) === id) return;
      await AsyncStorage.setItem(TAPPED_KEY, id).catch(() => undefined);
      requestTab({ tab: 'me' });
    };
    void Notifications.getLastNotificationResponseAsync().then(open).catch(() => undefined);
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => { void open(response); });
    // Back in the app: notifications allowed in the system settings meanwhile,
    // a new time zone, a card that changed. The stamp makes it a no-op when
    // nothing did.
    const app = AppState.addEventListener('change', (next) => { if (next === 'active') void syncCheckins(); });
    return () => { subscription.remove(); app.remove(); };
  }, []);
}
