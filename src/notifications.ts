import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import type { WalletProfile } from './types';

const STORAGE_PREFIX = 'skr-eyes:unlock-alerts:';
const CHANNEL_ID = 'skr-unlocks';

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
  if (!unlockAt) throw new Error('This wallet has no pending SKR unlock.');

  const permission = await Notifications.requestPermissionsAsync();
  if (!permission.granted) throw new Error('Notification permission was not granted.');
  await clearStoredSchedule(profile.wallet);

  const now = Date.now();
  const unlockMs = unlockAt * 1000;
  const plans = [
    { at: unlockMs - 3_600_000, title: 'SKR unlocks in 1 hour', body: 'Your pending SKR is approaching its withdrawable time.' },
    { at: unlockMs, title: 'Your SKR is now withdrawable', body: 'Open SKR Eyes to verify the finalized position and evidence.' },
  ].filter((plan) => plan.at > now + 5_000);

  const notificationIds: string[] = [];
  for (const plan of plans) {
    notificationIds.push(await Notifications.scheduleNotificationAsync({
      content: { title: plan.title, body: plan.body, sound: 'default', data: { wallet: profile.wallet, unlockAt } },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(plan.at), channelId: CHANNEL_ID },
    }));
  }
  await AsyncStorage.setItem(`${STORAGE_PREFIX}${profile.wallet}`, JSON.stringify({ unlockAt, notificationIds } satisfies StoredSchedule));
  return notificationIds.length;
}

export async function scheduleNotificationProof(): Promise<void> {
  const permission = await Notifications.requestPermissionsAsync();
  if (!permission.granted) throw new Error('Notification permission was not granted.');

  await Notifications.scheduleNotificationAsync({
    content: {
      title: 'SKR Eyes alerts are ready',
      body: 'Test complete. Real unlock alerts will use finalized on-chain time.',
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
