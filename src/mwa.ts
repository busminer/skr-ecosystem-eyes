import AsyncStorage from '@react-native-async-storage/async-storage';
import { Buffer } from 'buffer';
import { transact, type Web3MobileWallet } from '@solana-mobile/mobile-wallet-adapter-protocol-web3js';
import { SolanaMobileWalletAdapterError, SolanaMobileWalletAdapterProtocolError } from '@solana-mobile/mobile-wallet-adapter-protocol';
import { base64ToUint8Array } from '@solana-mobile/mobile-wallet-adapter-protocol/encoding';
import { t } from './i18n';
import { PublicKey, Transaction } from '@solana/web3.js';

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

type Authorization = Awaited<ReturnType<Web3MobileWallet['authorize']>>;

async function rememberToken(token: unknown): Promise<void> {
  if (typeof token !== 'string' || !token) return;
  await AsyncStorage.setItem(AUTH_KEY, token).catch(() => undefined);
}

// Disconnecting has to drop this too, or the next person to open the app on
// this phone is handed the last person's wallet without being asked.
export async function forgetWalletAuthorization(): Promise<void> {
  await AsyncStorage.removeItem(AUTH_KEY).catch(() => undefined);
}

// One session with the wallet, authorized. The stored token first, and the
// full question only when the token no longer answers.
//
// A stored token can be stale: the wallet may have been reset, the app
// reinstalled, or the person may have revoked us. Any failure there is not an
// error to show, it just means we ask properly again.
async function authorizeSession(wallet: Web3MobileWallet, stored: string | null): Promise<Authorization> {
  let authorization: Authorization | null = null;

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
  return authorization;
}

export async function connectReadOnlyWallet(): Promise<ConnectedAccount> {
  const stored = await AsyncStorage.getItem(AUTH_KEY).catch(() => null);

  return transact(async (wallet) => {
    const authorization = await authorizeSession(wallet, stored);

    const account = authorization.accounts[0];
    if (!account) throw new Error(t('The wallet did not return an account.'));
    return {
      address: new PublicKey(base64ToUint8Array(account.address)).toBase58(),
      label: account.label,
    };
  });
}

// Sign a transaction somebody else built, and hand the signed bytes back
// without sending them. The server that built it verifies and co-signs before
// anything reaches the chain, which is why this is `signTransactions` and not
// `signAndSendTransactions`.
//
// The Seeker wallet rewrites what it is given before signing — a ComputeBudget
// pair and a Lighthouse guard go in front — so the bytes that come back are
// not the bytes that went in. That is expected; the server knows to look past
// them. Serialized with `requireAllSignatures: false` because the server's own
// signature is still missing at this point, and `verifySignatures: false`
// because there is nothing here to verify against.
export async function signTransactionBase64(base64: string): Promise<string> {
  const stored = await AsyncStorage.getItem(AUTH_KEY).catch(() => null);

  return transact(async (wallet) => {
    await authorizeSession(wallet, stored);
    const transaction = Transaction.from(Buffer.from(base64, 'base64'));
    const [signed] = await wallet.signTransactions({ transactions: [transaction] });
    if (!signed) throw new Error(t('The wallet did not return a signed transaction.'));
    return signed.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64');
  });
}

// The person closed the wallet, declined, or let it time out. None of those
// is an error worth a red line: the screen simply goes back to how it was.
export function isWalletCancel(error: unknown): boolean {
  if (error instanceof SolanaMobileWalletAdapterProtocolError) {
    const code = error.code as number;
    return code === -1 || code === -3;
  }
  if (error instanceof SolanaMobileWalletAdapterError) {
    const code = error.code as string;
    return code === 'ERROR_SESSION_CLOSED' || code === 'ERROR_SESSION_TIMEOUT' || code === 'ERROR_ASSOCIATION_CANCELLED';
  }
  const message = error instanceof Error ? error.message.toLowerCase() : '';
  return /cancel|declin|reject|dismiss/.test(message);
}
