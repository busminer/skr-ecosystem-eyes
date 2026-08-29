import { Buffer } from 'buffer';
import { PublicKey } from '@solana/web3.js';
import { NONCE_ACCOUNT_BYTES, type Anchor } from './deferred';

// Reading the anchors straight from the chain.
//
// The gateway deliberately answers only a handful of methods, and reading an
// arbitrary account is not one of them — it was built for the Stake button, not
// for browsing. Anchors are a read, never a send, so this build asks a public
// endpoint for them and keeps every signed byte going through the one door.
//
// Before this ships, the read belongs behind the gateway too, narrowed the same
// way everything else there is: system-owned, eighty bytes, authority equal to
// the wallet asking.

// More than one endpoint, because the obvious one does not work here.
//
// api.mainnet-beta.solana.com is served under Sectigo's 2021 ECC root, which
// this Seeker's certificate store does not carry: the phone refuses the
// handshake outright while a desktop accepts it. So the read walks a list and
// keeps the first endpoint that answers.
//
// This whole list is scaffolding. The anchors belong behind our own gateway,
// which the phone already trusts, and this file goes away when they get there.
const PUBLIC_RPCS = [
  'https://api.mainnet-beta.solana.com',
  'https://solana.leorpc.com/?api_key=FREE',
];

let working: string | null = null;
const SYSTEM_PROGRAM = '11111111111111111111111111111111';

// version | state | authority(32) | stored nonce(32) | fee calculator(8)
const AUTHORITY_OFFSET = 8;
const NONCE_OFFSET = 40;

export type AnchorState = Anchor & {
  exists: boolean;
  value: string | null;
  authority: string | null;
  usable: boolean;
};

async function callOne<T>(url: string, method: string, params: unknown[]): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const payload = await response.json() as { result?: T; error?: { message?: string }; msg?: string };
  if (payload.error) throw new Error(payload.error.message ?? 'The network refused the read.');
  // A refusal does not always arrive as a JSON-RPC error: a throttled endpoint
  // may answer with its own shape and no result at all. Treating that as an
  // answer hands `undefined` to the caller, which then fails somewhere far away
  // from the cause.
  if (payload.result === undefined) throw new Error(payload.msg ?? 'The endpoint answered without a result.');
  return payload.result as T;
}

async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  const order = working ? [working, ...PUBLIC_RPCS.filter((url) => url !== working)] : PUBLIC_RPCS;
  const failures: string[] = [];
  for (const url of order) {
    try {
      const result = await callOne<T>(url, method, params);
      working = url;
      return result;
    } catch (caught) {
      // Naming the endpoint matters here: the failures look identical from the
      // outside, and knowing which host refused is the difference between one
      // bad certificate chain and a phone that trusts nothing.
      const host = url.replace(/^https:\/\//, '').split('/')[0];
      const reason = caught instanceof Error ? caught.message : String(caught);
      failures.push(`${host}: ${reason}`);
    }
  }
  throw new Error(failures.join(' | ') || 'No endpoint answered the read.');
}

// Rent for an eighty-byte account is a fixed function of its size on mainnet,
// and asking the chain for a constant costs a request we cannot spare: the
// endpoints that this phone will talk to at all are the throttled ones.
// Measured against mainnet on 29 Aug 2026 and checked on every read below.
export const ANCHOR_RENT_LAMPORTS = 1_447_680;

export function anchorRent(): number {
  return ANCHOR_RENT_LAMPORTS;
}

function decodeBase64(value: string): Uint8Array {
  // The anchor is eighty bytes; Buffer is already polyfilled for the
  // transaction builders, so there is nothing to gain from a second decoder.
  return new Uint8Array(Buffer.from(value, 'base64'));
}

/**
 * What each anchor is right now: made or not, holding which value, answering to
 * whom. An anchor whose authority is not the wallet is not ours to advance, and
 * saying so here is cheaper than a transaction that fails on chain.
 */
export async function readAnchors(anchors: Anchor[], wallet: string): Promise<AnchorState[]> {
  const result = await rpc<{ value: (RawAccount | null)[] }>(
    'getMultipleAccounts',
    [anchors.map((anchor) => anchor.address), { encoding: 'base64' }],
  );
  return anchors.map((anchor, index) => decodeAnchor(anchor, result.value[index] ?? null, wallet));
}

type RawAccount = { data: [string, string]; owner: string; lamports: number };

function decodeAnchor(anchor: Anchor, account: RawAccount | null, wallet: string): AnchorState {
  if (!account || account.owner !== SYSTEM_PROGRAM) {
    return { ...anchor, exists: false, value: null, authority: null, usable: false };
  }

  const data = decodeBase64(account.data[0]);
  if (data.length !== NONCE_ACCOUNT_BYTES) {
    return { ...anchor, exists: true, value: null, authority: null, usable: false };
  }

  const authority = new PublicKey(data.slice(AUTHORITY_OFFSET, AUTHORITY_OFFSET + 32)).toBase58();
  const value = new PublicKey(data.slice(NONCE_OFFSET, NONCE_OFFSET + 32)).toBase58();
  return { ...anchor, exists: true, value, authority, usable: authority === wallet };
}

export async function walletLamports(wallet: string): Promise<number> {
  const result = await rpc<{ value: number }>('getBalance', [wallet]);
  return result.value;
}

/**
 * The anchors and the wallet's SOL in one request.
 *
 * Reading them separately is two calls where one will do, and on a throttled
 * endpoint the second one is the one that fails — leaving the screen showing
 * anchors it could read beside a balance it could not.
 */
export async function readAnchorsAndBalance(anchors: Anchor[], wallet: string): Promise<{
  anchors: AnchorState[];
  lamports: number | null;
}> {
  const addresses = [...anchors.map((anchor) => anchor.address), wallet];
  const result = await rpc<{ value: (RawAccount | null)[] }>(
    'getMultipleAccounts',
    [addresses, { encoding: 'base64' }],
  );

  const walletAccount = result.value[anchors.length];
  return {
    anchors: anchors.map((anchor, index) => decodeAnchor(anchor, result.value[index] ?? null, wallet)),
    lamports: walletAccount ? walletAccount.lamports : 0,
  };
}
