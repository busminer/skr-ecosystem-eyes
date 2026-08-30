import { transact } from '@solana-mobile/mobile-wallet-adapter-protocol-web3js';
import { base64ToUint8Array } from '@solana-mobile/mobile-wallet-adapter-protocol/encoding';
import { t } from './i18n';
import { PublicKey } from '@solana/web3.js';

const APP_IDENTITY = {
  name: 'SKR Eyes',
  uri: 'https://skr.alexkosa.dev',
  icon: 'favicon.ico',
};

export type ConnectedAccount = { address: string; label?: string };

export async function connectReadOnlyWallet(): Promise<ConnectedAccount> {
  return transact(async (wallet) => {
    const authorization = await wallet.authorize({
      chain: 'solana:mainnet',
      identity: APP_IDENTITY,
      features: [],
    });
    const account = authorization.accounts[0];
    if (!account) throw new Error(t('The wallet did not return an account.'));
    return {
      address: new PublicKey(base64ToUint8Array(account.address)).toBase58(),
      label: account.label,
    };
  });
}

