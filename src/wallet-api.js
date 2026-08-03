import { isExactPublicKey } from './http-utils.js';

export function resolveWalletProfile(indexer, wallet) {
  if (!isExactPublicKey(wallet)) {
    return { status: 400, payload: { error: 'Invalid Solana public key' } };
  }

  const profile = indexer.getWalletProfile(wallet);
  if (!profile) {
    return {
      status: 503,
      payload: { error: 'Wallet profile is not ready', status: indexer.publicStatus() },
    };
  }

  return { status: 200, payload: profile };
}
