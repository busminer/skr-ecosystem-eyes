import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SESSION_KEY } from './session';

// The one wallet that answered Mobile Wallet Adapter, kept in one place.
//
// Me and Eyes both need it: Me to draw the card, Eyes to open and blink an
// Eye and to find your own ring on the Iris. Each screen used to parse the
// stored session for itself, and two readers of one key drift the moment one
// of them writes. Now the address lives here, both screens read it through
// the hook, and whichever screen connects or disconnects tells the other by
// writing here.
//
// Only a wallet that actually connected counts. A pasted address is somebody
// being looked at: it is remembered by Me for the card, but it is not a wallet
// this phone can sign for, so it is never a connected wallet.

export type ConnectedWallet = { address: string; label: string | null };

let current: ConnectedWallet | null = null;
const listeners = new Set<(wallet: ConnectedWallet | null) => void>();

function announce() {
  listeners.forEach((listener) => listener(current));
}

// Read once, before anything asks. Connect saves the label key even when the
// wallet gave no label; a look-up saves only the address. That difference is
// how a connected wallet is told from a pasted one.
export const walletReady: Promise<void> = (async () => {
  try {
    const raw = await AsyncStorage.getItem(SESSION_KEY);
    if (raw) {
      const saved = JSON.parse(raw) as { address?: unknown; label?: unknown };
      if ('label' in saved && typeof saved.address === 'string' && saved.address) {
        current = { address: saved.address, label: typeof saved.label === 'string' && saved.label ? saved.label : null };
      }
    }
  } catch {
    // A session that cannot be read is a session we do not have.
  }
  announce();
})();

export function connectedWallet(): ConnectedWallet | null {
  return current;
}

// The wallet just answered: keep it, on disk and in memory, and tell everyone.
export function rememberConnectedWallet(wallet: ConnectedWallet): void {
  current = wallet;
  void AsyncStorage.setItem(SESSION_KEY, JSON.stringify({ address: wallet.address, label: wallet.label })).catch(() => undefined);
  announce();
}

// Disconnect erases the stored session itself (and the card, the token and
// the alerts that hang on it); this only drops the address from memory so
// the other screen stops using it at once.
export function forgetConnectedWallet(): void {
  current = null;
  announce();
}

export function useConnectedWallet(): ConnectedWallet | null {
  const [wallet, setWallet] = useState(current);
  useEffect(() => {
    listeners.add(setWallet);
    setWallet(current);
    return () => { listeners.delete(setWallet); };
  }, []);
  return wallet;
}
