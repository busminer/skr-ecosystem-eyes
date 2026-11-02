import AsyncStorage from '@react-native-async-storage/async-storage';

// The installation's own name (Alex, 02.11.2026: count installs).
//
// A random UUID the phone makes once, on first run, and keeps until the app
// is uninstalled. It is dice, not a fingerprint: it says nothing about the
// person, the device or the wallet, and it is never written next to an
// address. It rides on every API request as the `x-skr-install` header, so
// the server can count installations that opened the app today and how many
// of them were here yesterday, which a wallet address cannot tell (one person
// has four phones, one phone changes wallets). The server keeps only a hash of
// it, per day. Disclosed in the privacy policy; Disconnect does not touch it,
// uninstalling the app erases it.

const KEY = 'skr-eyes:install:v1';

let current: string | null = null;

function uuid(): string {
  // crypto.getRandomValues is polyfilled by react-native-get-random-values (index.js).
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Read once at launch; the first request after a fresh install may go out
// before this settles and simply carries no header, which is fine.
export const installReady: Promise<void> = (async () => {
  try {
    const stored = await AsyncStorage.getItem(KEY);
    if (stored && SHAPE.test(stored)) {
      current = stored;
      return;
    }
    current = uuid();
    await AsyncStorage.setItem(KEY, current);
  } catch {
    // No storage, no name: the phone stays uncounted rather than renamed on every launch.
    current = null;
  }
})();

export function installId(): string | null {
  return current;
}
