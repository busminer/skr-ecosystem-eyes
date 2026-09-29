import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

// SKR Eyes sends no notification about staking, the vault or unlocks, ever
// (Alex, 29.09.2026: he saw them arrive sixteen times on his phones). The
// only notifications left are the Eye's own Blink reminders (src/eye/
// reminders.ts, channel `eye-blink`, data `{ eye: true }`).
//
// Older builds scheduled seven weekly "daily look" lines about the vault and
// stakers (channel `skr-nudges`) and two unlock alerts per wallet (channel
// `skr-unlocks`). Scheduled notifications outlive an app update, so every
// launch sweeps them away: everything scheduled or shown that is not the
// Eye's is cancelled, their bookkeeping is removed, and the two channels are
// deleted so Android forgets them too.

const OLD_CHANNELS = ['skr-unlocks', 'skr-nudges'];
const OLD_KEYS = ['skr-eyes:nudge:id', 'skr-eyes:nudge:ids'];
const OLD_PREFIX = 'skr-eyes:unlock-alerts:';
const ASKED_KEY = 'skr-eyes:notifications:asked';

const isEye = (data: unknown) => Boolean(data && typeof data === 'object' && (data as { eye?: unknown }).eye === true);

export async function purgeStakingNotifications(): Promise<void> {
  try {
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    await Promise.all(scheduled
      .filter((request) => !isEye(request.content.data))
      .map((request) => Notifications.cancelScheduledNotificationAsync(request.identifier).catch(() => undefined)));
  } catch {
    // Nothing to sweep, or the module is not there: nothing to do.
  }
  try {
    const shown = await Notifications.getPresentedNotificationsAsync();
    await Promise.all(shown
      .filter((notification) => !isEye(notification.request.content.data))
      .map((notification) => Notifications.dismissNotificationAsync(notification.request.identifier).catch(() => undefined)));
  } catch {
    // Same.
  }
  try {
    const keys = await AsyncStorage.getAllKeys();
    const old = keys.filter((key) => OLD_KEYS.includes(key) || key.startsWith(OLD_PREFIX));
    if (old.length) await AsyncStorage.multiRemove(old);
  } catch {
    // Bookkeeping only.
  }
  if (Platform.OS === 'android') {
    await Promise.all(OLD_CHANNELS.map((id) => Notifications.deleteNotificationChannelAsync(id).catch(() => undefined)));
  }
}

export async function configureNotifications() {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldPlaySound: true,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
  await purgeStakingNotifications();
}

// Asked once, after the opening, so the Eye's Blink reminders can work
// without a second dialog later. Android remembers the answer; a refusal is
// respected and never asked about again by us.
export async function askNotificationPermissionOnce(): Promise<boolean> {
  try {
    const asked = await AsyncStorage.getItem(ASKED_KEY);
    const current = await Notifications.getPermissionsAsync();
    if (current.granted) return true;
    if (asked) return false;
    await AsyncStorage.setItem(ASKED_KEY, '1');
    const answer = await Notifications.requestPermissionsAsync();
    return answer.granted;
  } catch {
    return false;
  }
}
