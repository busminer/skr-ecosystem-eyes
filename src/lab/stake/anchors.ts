import { Buffer } from 'buffer';
import { PublicKey } from '@solana/web3.js';
import { fetchAccounts, type RawAccount } from './gateway';
import { NONCE_ACCOUNT_BYTES, type Anchor } from './deferred';

// Reading the anchors through the same door as everything else.
//
// This used to ask a public endpoint directly, and on a real Seeker it failed in
// two separate ways: api.mainnet-beta.solana.com is served under a certificate
// root the phone does not carry, so the handshake never completed, and the free
// endpoint kept as a fallback throttles hard enough to refuse an ordinary
// refresh. Neither is fixable from inside the app.
//
// The wallet does not have this problem because it talks to a host it trusts,
// and neither do we: our own route already answers this phone. So the read goes
// there, the endpoint list is gone, and there is one door again.

const SYSTEM_PROGRAM = '11111111111111111111111111111111';

// version | state | authority(32) | stored nonce(32) | fee calculator(8)
const AUTHORITY_OFFSET = 8;
const NONCE_OFFSET = 40;

// Rent for an eighty-byte account is a fixed function of its size on mainnet, so
// asking the chain for it on every screen buys nothing. Measured 29 Aug 2026.
export const ANCHOR_RENT_LAMPORTS = 1_447_680;

export type AnchorState = Anchor & {
  exists: boolean;
  value: string | null;
  authority: string | null;
  usable: boolean;
};

export function anchorRent(): number {
  return ANCHOR_RENT_LAMPORTS;
}

/**
 * What each anchor is right now — made or not, holding which value, answering to
 * whom — and the wallet's SOL, in a single request.
 *
 * An anchor whose authority is not the wallet is not ours to advance, and saying
 * so here is cheaper than a transaction that fails on chain.
 */
export async function readAnchorsAndBalance(anchors: Anchor[], wallet: string): Promise<{
  anchors: AnchorState[];
  lamports: number | null;
}> {
  const accounts = await fetchAccounts([...anchors.map((anchor) => anchor.address), wallet]);
  const walletAccount = accounts[anchors.length];

  return {
    anchors: anchors.map((anchor, index) => decodeAnchor(anchor, accounts[index] ?? null, wallet)),
    lamports: walletAccount ? walletAccount.lamports : null,
  };
}

export async function readAnchors(anchors: Anchor[], wallet: string): Promise<AnchorState[]> {
  const accounts = await fetchAccounts(anchors.map((anchor) => anchor.address));
  return anchors.map((anchor, index) => decodeAnchor(anchor, accounts[index] ?? null, wallet));
}

function decodeAnchor(anchor: Anchor, account: RawAccount | null, wallet: string): AnchorState {
  if (!account || account.owner !== SYSTEM_PROGRAM) {
    return { ...anchor, exists: false, value: null, authority: null, usable: false };
  }

  const data = new Uint8Array(Buffer.from(account.data[0], 'base64'));
  if (data.length !== NONCE_ACCOUNT_BYTES) {
    return { ...anchor, exists: true, value: null, authority: null, usable: false };
  }

  const authority = new PublicKey(data.slice(AUTHORITY_OFFSET, AUTHORITY_OFFSET + 32)).toBase58();
  const value = new PublicKey(data.slice(NONCE_OFFSET, NONCE_OFFSET + 32)).toBase58();
  return { ...anchor, exists: true, value, authority, usable: authority === wallet };
}
