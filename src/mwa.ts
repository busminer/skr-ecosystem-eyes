import AsyncStorage from '@react-native-async-storage/async-storage';
import { transact } from '@solana-mobile/mobile-wallet-adapter-protocol-web3js';
import { base64ToUint8Array } from '@solana-mobile/mobile-wallet-adapter-protocol/encoding';
import { t } from './i18n';
import { PublicKey } from '@solana/web3.js';

const APP_IDENTITY = {
  name: 'SKR Eyes',
  uri: 'https://skr.alexkosa.dev',
  icon: 'favicon.ico',
};

// The wallet used to ask for permission on every single connect, because this
// app threw the authorization away the moment it had an address. The token the
// wallet hands back is what makes the second time silent, so it is kept here,
// beside the session and the card, one key per thing.
const AUTH_KEY = 'skr-eyes.mwa';

export type ConnectedAccount = { address: string; label?: string };

async function rememberToken(token: unknown): Promise<void> {
  if (typeof token !== 'string' || !token) return;
  await AsyncStorage.setItem(AUTH_KEY, token).catch(() => undefined);
}

// Disconnecting has to drop this too, or the next person to open the app on
// this phone is handed the last person's wallet without being asked.
export async function forgetWalletAuthorization(): Promise<void> {
  await AsyncStorage.removeItem(AUTH_KEY).catch(() => undefined);
}

export async function connectReadOnlyWallet(): Promise<ConnectedAccount> {
  const stored = await AsyncStorage.getItem(AUTH_KEY).catch(() => null);

  return transact(async (wallet) => {
    let authorization = null as Awaited<ReturnType<typeof wallet.authorize>> | null;

    // A stored token can be stale: the wallet may have been reset, the app
    // reinstalled, or the person may have revoked us. Any failure here is not
    // an error to show, it just means we ask properly again.
    if (stored) {
      try {
        authorization = await wallet.reauthorize({ auth_token: stored, identity: APP_IDENTITY });
      } catch {
        await AsyncStorage.removeItem(AUTH_KEY).catch(() => undefined);
        authorization = null;
      }
    }

    if (!authorization) {
      authorization = await wallet.authorize({
        chain: 'solana:mainnet',
        identity: APP_IDENTITY,
        features: [],
      });
    }

    await rememberToken((authorization as { auth_token?: unknown }).auth_token);

    const account = authorization.accounts[0];
    if (!account) throw new Error(t('The wallet did not return an account.'));
    return {
      address: new PublicKey(base64ToUint8Array(account.address)).toBase58(),
      label: account.label,
    };
  });
}
