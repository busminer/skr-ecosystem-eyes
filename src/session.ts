import AsyncStorage from '@react-native-async-storage/async-storage';

// The one place that knows where the connected address is kept, so the screen
// that shows the position and the screen that arms the alert cannot drift into
// disagreeing about which wallet they mean.
export const SESSION_KEY = 'skr.lab.session';

export async function readSessionAddress(): Promise<string | null> {
  try {
    const raw = await AsyncStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw) as { address?: unknown };
    return typeof saved.address === 'string' && saved.address ? saved.address : null;
  } catch {
    return null;
  }
}
