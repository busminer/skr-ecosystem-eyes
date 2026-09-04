import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { t } from './i18n';
import type { WalletProfile } from './types';

const STORAGE_PREFIX = 'skr-eyes:unlock-alerts:';
const CHANNEL_ID = 'skr-unlocks';
const NUDGE_CHANNEL_ID = 'skr-nudges';
const NUDGE_ID_KEY = 'skr-eyes:nudge:id';
const ASKED_KEY = 'skr-eyes:notifications:asked';

type StoredSchedule = { unlockAt: number; notificationIds: string[] };

export async function configureNotifications() {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldPlaySound: true,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
      name: 'SKR unlocks',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 140, 80, 140],
      lightColor: '#67DFFF',
    });
    // The daily nudge is a lighter thing than an unlock: its own channel, so a
    // person can mute the nudge in Android and keep the unlock.
    await Notifications.setNotificationChannelAsync(NUDGE_CHANNEL_ID, {
      name: 'Daily sixteen',
      importance: Notifications.AndroidImportance.DEFAULT,
      vibrationPattern: [0, 80],
      lightColor: '#C9A96A',
    });
  }
}

// Asked once, on the first launch after the opening, so the unlock alert and
// the nudge can both work without a second dialog later. Android remembers
// the answer; a refusal is respected and never asked about again by us.
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

// One gentle reminder a day, around six in the evening, to stake the sixteen.
// Scheduled on the phone itself, nothing leaves it. Off is honoured by
// cancelling whatever was scheduled.
export async function scheduleDailyNudge(on: boolean): Promise<void> {
  try {
    const previous = await AsyncStorage.getItem(NUDGE_ID_KEY);
    if (previous) {
      await Notifications.cancelScheduledNotificationAsync(previous).catch(() => undefined);
      await AsyncStorage.removeItem(NUDGE_ID_KEY);
    }
    if (!on) return;
    const permission = await Notifications.getPermissionsAsync();
    if (!permission.granted) return;
    const id = await Notifications.scheduleNotificationAsync({
      content: {
        title: t('Sixteen today?'),
        body: t('16 parts of 1 SKR, one approval. A small habit that keeps your stake moving.'),
        sound: 'default',
        data: { nudge: true },
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DAILY, hour: 18, minute: 0, channelId: NUDGE_CHANNEL_ID },
    });
    await AsyncStorage.setItem(NUDGE_ID_KEY, id);
  } catch {
    // A nudge that could not be set is not worth a crash.
  }
}

export async function clearStoredSchedule(wallet: string) {
  const key = `${STORAGE_PREFIX}${wallet}`;
  const raw = await AsyncStorage.getItem(key);
  if (raw) {
    const stored = JSON.parse(raw) as StoredSchedule;
    await Promise.all(stored.notificationIds.map((id) => Notifications.cancelScheduledNotificationAsync(id)));
  }
  await AsyncStorage.removeItem(key);
}

// The switch on the Alerts screen must reflect what is really scheduled, not a
// remembered intention. This is the only honest source: the schedule itself.
export async function hasUnlockAlerts(wallet: string): Promise<boolean> {
  try {
    const raw = await AsyncStorage.getItem(`${STORAGE_PREFIX}${wallet}`);
    if (!raw) return false;
    const stored = JSON.parse(raw) as StoredSchedule;
    return Array.isArray(stored.notificationIds) && stored.notificationIds.length > 0;
  } catch {
    return false;
  }
}

export async function scheduleUnlockAlerts(profile: WalletProfile): Promise<number> {
  const unlockAt = profile.nextUnlockAt;
  if (!unlockAt) throw new Error(t('This wallet has no pending SKR unlock.'));

  const permission = await Notifications.requestPermissionsAsync();
  if (!permission.granted) throw new Error('Notification permission was not granted.');
  await clearStoredSchedule(profile.wallet);

  const now = Date.now();
  const unlockMs = unlockAt * 1000;
  const plans = [
    { at: unlockMs - 3_600_000, title: t('SKR unlocks in 1 hour'), body: t('Your pending SKR is approaching its withdrawable time.') },
    { at: unlockMs, title: t('Your SKR is now withdrawable'), body: t('Open SKR Eyes to verify the finalized position and evidence.') },
  ].filter((plan) => plan.at > now + 5_000);

  const notificationIds: string[] = [];
  try {
    for (const plan of plans) {
      notificationIds.push(await Notifications.scheduleNotificationAsync({
        content: { title: plan.title, body: plan.body, sound: 'default', data: { wallet: profile.wallet, unlockAt } },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(plan.at), channelId: CHANNEL_ID },
      }));
    }
  } catch (caught) {
    // The ids are only written down once every reminder exists. If the second
    // one fails, the first is already scheduled and nothing would remember it:
    // the screen would say the alert is off while the phone still went off,
    // and there would be no way left to cancel it. Take it back first.
    await Promise.all(notificationIds.map((id) => Notifications.cancelScheduledNotificationAsync(id).catch(() => undefined)));
    throw caught;
  }
  await AsyncStorage.setItem(`${STORAGE_PREFIX}${profile.wallet}`, JSON.stringify({ unlockAt, notificationIds } satisfies StoredSchedule));
  return notificationIds.length;
}

export async function scheduleNotificationProof(): Promise<void> {
  const permission = await Notifications.requestPermissionsAsync();
  if (!permission.granted) throw new Error('Notification permission was not granted.');

  await Notifications.scheduleNotificationAsync({
    content: {
      title: t('SKR Eyes alerts are ready'),
      body: t('Test complete. Real unlock alerts will use finalized on-chain time.'),
      sound: 'default',
      data: { proof: true },
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds: 10,
      channelId: CHANNEL_ID,
    },
  });
}
