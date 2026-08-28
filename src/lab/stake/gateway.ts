import { API_BASE_URL } from '../../api';

// The only door between the phone and Solana. It refuses every method except
// the five it was built for, checks a signed stake transaction byte by byte
// before relaying it, and never hands out the credentialed RPC url.

const RPC_PATH = '/api/stake/rpc';
const CAPABILITY_PATH = '/api/stake/gateway';
const TIMEOUT_MS = 20_000;

export type GatewayCapability = {
  schemaVersion: number;
  routeId: string | null;
  cluster: string;
  submission: 'enabled' | 'locked';
  instruction: string;
  programId: string;
  transactionVersion: number;
  maxWireBytes: number;
  methods?: string[];
  proof: string;
};

export type Blockhash = { blockhash: string; lastValidBlockHeight: number; slot: number };

export class GatewayError extends Error {
  constructor(message: string, public readonly code: string | null, public readonly status: number) {
    super(message);
    this.name = 'GatewayError';
  }
}

async function withTimeout<T>(run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await run(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchCapability(): Promise<GatewayCapability> {
  return withTimeout(async (signal) => {
    const response = await fetch(`${API_BASE_URL}${CAPABILITY_PATH}`, { headers: { accept: 'application/json' }, signal });
    if (!response.ok) throw new GatewayError('The staking route is unavailable.', null, response.status);
    return response.json() as Promise<GatewayCapability>;
  });
}

let requestId = 0;

async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  return withTimeout(async (signal) => {
    requestId += 1;
    const response = await fetch(`${API_BASE_URL}${RPC_PATH}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: requestId, method, params }),
      signal,
    });
    const payload = await response.json().catch(() => null) as
      { result?: T; error?: { message?: string; data?: { code?: string } } } | null;
    if (payload?.error) {
      throw new GatewayError(payload.error.message || 'The staking route refused the request.', payload.error.data?.code ?? null, response.status);
    }
    if (!response.ok || payload == null) {
      throw new GatewayError('The staking route is unavailable.', null, response.status);
    }
    return payload.result as T;
  });
}

export async function fetchBlockhash(): Promise<Blockhash> {
  const result = await rpc<{ context: { slot: number }; value: { blockhash: string; lastValidBlockHeight: number } }>(
    'getLatestBlockhash',
    [{ commitment: 'confirmed' }],
  );
  return { blockhash: result.value.blockhash, lastValidBlockHeight: result.value.lastValidBlockHeight, slot: result.context.slot };
}

// Returns the signature the cluster accepted. It must equal the signature the
// phone already saved, otherwise something replaced the transaction.
export async function sendWire(wireBase64: string, minContextSlot: number): Promise<string> {
  return rpc<string>('sendTransaction', [
    wireBase64,
    { encoding: 'base64', skipPreflight: false, preflightCommitment: 'confirmed', minContextSlot },
  ]);
}

export type SignatureState = { confirmationStatus: 'processed' | 'confirmed' | 'finalized' | null; err: unknown | null } | null;

export async function fetchStatus(signature: string): Promise<SignatureState> {
  const result = await rpc<{ value: SignatureState[] }>('getSignatureStatuses', [[signature], { searchTransactionHistory: true }]);
  return result?.value?.[0] ?? null;
}

export type WalletBalance = {
  wallet: string;
  rawBalance: string;
  balance: number;
  tokenAccounts: number;
  observedAt: number;
};

// What the wallet has to hand, asked when the stake sheet opens.
//
// Without it the app builds a stake it cannot pay for: sixteen parts of sixteen
// SKR on a wallet holding twenty-eight, and the chain refuses every part but the
// first. Fifteen red rows and not a word about why.
export async function fetchWalletBalance(wallet: string): Promise<WalletBalance> {
  return withTimeout(async (signal) => {
    const response = await fetch(`${API_BASE_URL}/api/wallet/${encodeURIComponent(wallet)}/balance`, {
      headers: { accept: 'application/json' },
      signal,
    });
    if (!response.ok) throw new GatewayError('The balance could not be read.', null, response.status);
    return response.json() as Promise<WalletBalance>;
  });
}
