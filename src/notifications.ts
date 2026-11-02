import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { isCheckin } from './checkins';

// The only notifications SKR Eyes sends are the position check-ins
// (src/checkins.ts, channel `skr-checkins`, data `{ checkin: true }`): up to
// three invitations a day to look at your own position, set by the person,
// scheduled on the phone itself.
//
// Everything else is swept away on every launch. Older builds scheduled seven
// weekly "daily look" lines about the vault and stakers (channel `skr-nudges`)
// and two unlock alerts per wallet (channel `skr-unlocks`); Alex saw those
// arrive sixteen times (29.09.2026). The 2.0 release candidates carried the
// Eye's Blink reminders (channel `eye-blink`), and this build has no Eye.
// Scheduled notifications outlive an app update, so each launch cancels
// whatever is scheduled or shown that is not a check-in, removes their
// bookkeeping, and deletes the channels so Android forgets them too.

const OLD_CHANNELS = ['skr-unlocks', 'skr-nudges', 'eye-blink'];
const OLD_KEYS = ['skr-eyes:nudge:id', 'skr-eyes:nudge:ids', 'skr-eyes:eye:reminder-ids'];
const OLD_PREFIX = 'skr-eyes:unlock-alerts:';
const ASKED_KEY = 'skr-eyes:notifications:asked';

export async function purgeForeignNotifications(): Promise<void> {
  try {
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    await Promise.all(scheduled
      .filter((request) => !isCheckin(request.content.data))
      .map((request) => Notifications.cancelScheduledNotificationAsync(request.identifier).catch(() => undefined)));
  } catch {
    // Nothing to sweep, or the module is not there: nothing to do.
  }
  try {
    const shown = await Notifications.getPresentedNotificationsAsync();
    await Promise.all(shown
      .filter((notification) => !isCheckin(notification.request.content.data))
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
  await purgeForeignNotifications();
}

// Asked once, after the opening, so the check-ins can work without a second
// dialog later. Android remembers the answer; a refusal is respected and
// never asked about again by us (the setting on Me offers the system
// settings instead).
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
