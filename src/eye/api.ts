import { lang, t } from '../i18n';
import { EYE_BASE_URL } from './config';

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

// The Iris: every open Eye on its ring, the day's window, who gazed at you,
// and the Guardian circles. `eyes` may be capped at about two thousand; then
// `ringCounts` carries the whole count per ring and the rest are drawn as
// placeholders.
export type NetworkEye = {
  serial: number;
  name: string;
  streak: number;
  ring: number;
  blinkedToday: boolean;
  perfect: boolean;
  pool: string | null;
  moons: number;
};

export type EyeNetwork = {
  day: string;
  event: { kind: string; label: string };
  window: { open: boolean; opensAt: string | number; closesAt: string | number };
  totals: { eyes: number; watching: number; blinkedToday: number; perfect: number; newToday: number };
  rings: number;
  eyes: NetworkEye[];
  ringCounts?: number[];
  me: { serial: number; ring: number; streak: number; moons: number } | null;
  gazes: { received: Array<{ serial: number; name: string }>; sentToday: number; limit: number };
  circles: Array<{ pool: string; label: string; blinked: number; eyes: number }>;
};

export type GazeResult = { ok: boolean; sentToday: number; limit: number };

export const fetchEyeStatus = (wallet: string) => call<EyeStatus>(`/eye/status?wallet=${encodeURIComponent(wallet)}`);
export const fetchEyeNetwork = (wallet: string | null) => call<EyeNetwork>(`/eye/network${wallet ? `?wallet=${encodeURIComponent(wallet)}` : ''}`);
export const sendGaze = (wallet: string, target: number) => call<GazeResult>('/eye/gaze', { wallet, target });
export const openEye = (wallet: string) => call<EyeIntent>('/eye/open', { wallet });
export const blinkEye = (wallet: string) => call<EyeIntent>('/eye/blink', { wallet });
export const submitEye = (intent: string, signedTransaction: string) => call<EyeSubmitResult>('/eye/submit', { intent, signedTransaction });

// A relative image path is the service's own; anything with a scheme is left alone.
export function eyeImageUrl(image: string): string {
  if (/^https?:\/\//i.test(image)) return image;
  return `${EYE_BASE_URL}${image.startsWith('/') ? '' : '/'}${image}`;
}
