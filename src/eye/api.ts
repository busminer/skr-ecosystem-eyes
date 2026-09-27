import { lang, t } from '../i18n';
import { EYE_BASE_URL } from './config';
import type { AttestorVerdict } from './witness';

// The eye-mint service: one read, two intents, one submit. The transaction
// travels as base64 of a legacy web3.js Transaction serialized with
// `requireAllSignatures: false`; the wallet signs it, the server verifies and
// co-signs before it goes anywhere.

export type EyeGates = { staked: boolean; activeStaked: boolean; sgt: boolean };

export type Eye = {
  serial: number;
  asset: string;
  name: string;
  openedAt: string | number;
  streak: number;
  blinks: number;
  lastBlinkDay: string | null;
  // May arrive relative (`/eye/1.png`); see eyeImageUrl.
  image: string;
  json: string;
  perfect: unknown[];
};

export type BlinkWindow = {
  day: string;
  event: { kind: string; label: string };
  open: boolean;
  opensAt: string | number;
  closesAt: string | number;
  witnesses: number;
  doneToday: boolean;
};

export type EyeStatus = {
  wallet: string;
  gates: EyeGates;
  eye: Eye | null;
  blink: BlinkWindow;
  prices: { openLamports: number; blinkLamports: number };
  network: { eyes: number; watching: number };
};

export type EyeIntent = {
  intent: string;
  kind: 'open' | 'blink';
  transaction: string;
  serial?: number;
  asset?: string;
  image?: string;
  expiresAt: string | number;
};

export type EyeSubmitResult = { signature: string; kind: string; serial: number; asset: string; eye: Eye };

export class EyeApiError extends Error {
  constructor(public readonly status: number, public readonly code: string | null, message: string) {
    super(message);
    this.name = 'EyeApiError';
  }
}

const TIMEOUT_MS = 20_000;

async function call<T>(path: string, body?: object): Promise<T> {
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(`${EYE_BASE_URL}${path}`, {
      method: body ? 'POST' : 'GET',
      headers: {
        accept: 'application/json',
        'x-skr-lang': lang(),
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(deadline);
  }
  if (!response.ok) {
    // The server's own words when it has them: `{ error: { code, message } }`.
    let code: string | null = null;
    let message = '';
    try {
      const payload = await response.json() as { error?: unknown };
      if (typeof payload.error === 'string') message = payload.error;
      else if (payload.error && typeof payload.error === 'object') {
        const detail = payload.error as { code?: unknown; message?: unknown };
        if (typeof detail.message === 'string') message = detail.message;
        if (typeof detail.code === 'string') code = detail.code;
      }
    } catch {
      // Status remains authoritative when a proxy answers with non-JSON.
    }
    throw new EyeApiError(response.status, code, message || t('The Eye service returned {status}', { status: response.status }));
  }
  return response.json() as Promise<T>;
}

// The finger (docs/FINGER.md). `attestation` is the attestor's signed verdict
// that binds the hardware key to this wallet; the server verifies it the first
// time it sees the key. A Blink adds one signature by that key over the
// server's own single-use challenge. Both are optional on the wire: with
// EYE_FINGER_ENABLED off the bodies are exactly what they were.
export type WitnessEnrollment = { p256: string; attestation: AttestorVerdict };
export type WitnessProof = WitnessEnrollment & { signature: string; challenge: string };

export const fetchEyeStatus = (wallet: string) => call<EyeStatus>(`/eye/status?wallet=${encodeURIComponent(wallet)}`);
export const fetchWitnessChallenge = (wallet: string) => call<{ challenge: string }>(`/eye/witness/challenge?wallet=${encodeURIComponent(wallet)}`);
export const openEye = (wallet: string, witness?: WitnessEnrollment) => call<EyeIntent>('/eye/open', witness ? { wallet, witness } : { wallet });
export const blinkEye = (wallet: string, witness?: WitnessProof) => call<EyeIntent>('/eye/blink', witness ? { wallet, witness } : { wallet });
export const submitEye = (intent: string, signedTransaction: string) => call<EyeSubmitResult>('/eye/submit', { intent, signedTransaction });

// A relative image path is the service's own; anything with a scheme is left alone.
export function eyeImageUrl(image: string): string {
  if (/^https?:\/\//i.test(image)) return image;
  return `${EYE_BASE_URL}${image.startsWith('/') ? '' : '/'}${image}`;
}
