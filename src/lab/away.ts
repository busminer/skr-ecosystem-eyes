import AsyncStorage from '@react-native-async-storage/async-storage';

// "While you were away" needs one honest number: the moment the person last
// had the live floor in front of them. Everything larger than the threshold
// that landed after it is news to them; everything before it, they saw.
//
// It lives on the phone and nowhere else, and a first run has no mark at all —
// a new user is not greeted with a summary of a day they never missed.

const SEEN_KEY = 'skr.lab.flow.seen';

export async function readSeenAt(): Promise<number> {
  try {
    const raw = await AsyncStorage.getItem(SEEN_KEY);
    const value = raw ? Number(raw) : 0;
    return Number.isFinite(value) && value > 0 ? value : 0;
  } catch {
    return 0;
  }
}

export async function writeSeenAt(seconds: number): Promise<void> {
  if (!Number.isFinite(seconds) || seconds <= 0) return;
  await AsyncStorage.setItem(SEEN_KEY, String(Math.floor(seconds))).catch(() => undefined);
}
