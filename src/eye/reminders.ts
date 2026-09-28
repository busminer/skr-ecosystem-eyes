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
//   1. at nextAt: the Eye can blink again;
//   2. three hours before the UTC day ends, if today has no Blink yet and one
//      is possible by then: the streak ends tonight.
//
// Nothing leaves the phone. The alarms are exact (USE_EXACT_ALARM in the
// manifest), so "in eight hours" means eight hours, not whenever Android
// batches its wake-ups. A tap opens the Eyes tab.

const CHANNEL_ID = 'eye-blink';
const IDS_KEY = 'skr-eyes:eye:reminder-ids';
const ASKED_KEY = 'skr-eyes:eye:reminder-asked';
const STREAK_WARNING_MS = 3 * 3_600_000;

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
// about without a phone.
export function remindersFor(status: EyeStatus, now = Date.now()): Array<{ at: number; title: string; body: string }> {
  const eye = status.eye;
  const blink = status.blink;
  if (!eye || !blink) return [];
  const plans: Array<{ at: number; title: string; body: string }> = [];
  const nextAt = asTime(blink.nextAt) ?? (blink.ready ? now : null);

  if (nextAt != null && nextAt > now + 30_000) {
    plans.push({
      at: nextAt,
      title: t('{name} can blink again', { name: eye.name }),
      body: t('Eight hours have passed since your last Blink.'),
    });
  }

  // The end of the current UTC day, and whether it still needs its Blink.
  const dayEnd = Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), new Date(now).getUTCDate() + 1);
  const warnAt = dayEnd - STREAK_WARNING_MS;
  const blinkPossibleBy = nextAt ?? now;
  if (!blink.doneToday && warnAt > now + 30_000 && blinkPossibleBy <= dayEnd - 10 * 60_000) {
    const at = Math.max(warnAt, blinkPossibleBy);
    const streak = Math.max(0, eye.streak ?? 0);
    plans.push({
      at,
      title: t('Your streak ends tonight'),
      body: streak > 1
        ? t('{name} has not blinked today. One Blink keeps your {count} days going.', { name: eye.name, count: streak })
        : t('{name} has not blinked today. One Blink keeps your streak going.', { name: eye.name }),
    });
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
    const ids: string[] = [];
    for (const plan of remindersFor(status)) {
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
