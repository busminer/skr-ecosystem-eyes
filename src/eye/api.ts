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
  // A Blink every eight hours: when this wallet last blinked, when it may
  // next, and whether it may right now. Optional until the server sends them;
  // without them the day's window rules as before.
  lastAt?: string | null;
  nextAt?: string | null;
  ready?: boolean;
  cooldownSeconds?: number;
};

// What an Eye costs, as the server says it right now. `tier` is where the
// open price steps up: `serial` is the last Eye sold at the current price,
// `left` how many of those remain. `openRentLamports` is the storage the
// wallet also pays the chain when the Eye is born; `solUsd` is the dollar
// hint, null when the server has none.
export type EyePrices = {
  openLamports: number;
  blinkLamports: number;
  tier?: { serial: number; afterLamports: number; left?: number };
  openRentLamports?: number;
  blinkCooldownSeconds?: number;
  solUsd?: number | null;
};

export type EyeStatus = {
  wallet: string;
  gates: EyeGates;
  eye: Eye | null;
  blink: BlinkWindow;
  prices: EyePrices;
  network: { eyes: number; watching: number };
};

export type EyeHealth = { prices?: EyePrices; openEnabled?: boolean };

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
  // `extra` is everything else the server put beside code and message, such
  // as `nextAt` on a Blink asked for too early.
  constructor(public readonly status: number, public readonly code: string | null, message: string, public readonly extra: Record<string, unknown> = {}) {
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
    let extra: Record<string, unknown> = {};
    try {
      const payload = await response.json() as { error?: unknown };
      if (typeof payload.error === 'string') message = payload.error;
      else if (payload.error && typeof payload.error === 'object') {
        const detail = payload.error as { code?: unknown; message?: unknown };
        if (typeof detail.message === 'string') message = detail.message;
        if (typeof detail.code === 'string') code = detail.code;
        extra = payload.error as Record<string, unknown>;
      }
    } catch {
      // Status remains authoritative when a proxy answers with non-JSON.
    }
    throw new EyeApiError(response.status, code, message || t('The Eye service returned {status}', { status: response.status }), extra);
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
  // `blinkHour`: the hour of the day (0..23) your Blink landed in today;
  // `percentile`: how many of all Eyes you are ahead of, 0..100. Both
  // optional until the server sends them.
  me: { serial: number; ring: number; streak: number; moons: number; blinkHour?: number | null; percentile?: number | null; lastBlinkAt?: string | null; nextBlinkAt?: string | null } | null;
  gazes: { received: Array<{ serial: number; name: string }>; sentToday: number; limit: number };
  circles: Array<{ pool: string; label: string; blinked: number; eyes: number }>;
  // The circles are drawn only when the server says there is more than one
  // to compare; with one Guardian the section says nothing.
  circlesShown?: boolean;
  // The day's pulse: blinks per hour of the day, 24 numbers.
  pulse?: { hours: number[] };
  // The ladder: how many Eyes stand on each of the nine rings, innermost first.
  ladder?: { rings: number[] };
  // The longest streaks, and the Eyes opened today, newest last.
  leaders?: {
    streaks: Array<{ serial: number; name: string; streak: number }>;
    newest: Array<{ serial: number; name: string }>;
  };
};

export type GazeResult = { ok: boolean; sentToday: number; limit: number };

export const fetchEyeNetwork = (wallet: string | null) => call<EyeNetwork>(`/eye/network${wallet ? `?wallet=${encodeURIComponent(wallet)}` : ''}`);
export const sendGaze = (wallet: string, target: number) => call<GazeResult>('/eye/gaze', { wallet, target });

// The finger (docs/FINGER.md). At enrollment the attestor's verdict record is
// posted to the server as it came, and the server binds the hardware key it
// names to the wallet. Every open and every Blink then carries one signature
// by that key, made under a fingerprint, over a challenge the server issued
// for this wallet moments before. `witness` is optional on the wire: with
// EYE_FINGER_ENABLED off the bodies are exactly what they were.
export type WitnessProof = {
  // 33-byte compressed P-256 public key, hex; the one the record binds.
  p256: string;
  // ECDSA-SHA256 over `SKR-EYES|BLINK|1|<wallet>|<challenge>` (UTF-8), DER, base64.
  signature: string;
  // The server's own challenge, echoed back.
  challenge: string;
};

// The wallet's own yes to the key (the server's docs/WITNESS.md, "The wallet's
// word"): a single-use nonce for this wallet and this key, and the text the
// wallet signs, which the app also builds itself (witness.ts claimMessage).
// The signature and the nonce go with the verdict when it is registered.
export type WitnessClaimOffer = { wallet: string; p256: string; nonce: string; expiresAt: string; message: string };
export type WitnessClaim = { nonce: string; signature: string };

export const fetchEyeHealth = () => call<EyeHealth>('/eye/health');
export const fetchEyeStatus = (wallet: string) => call<EyeStatus>(`/eye/status?wallet=${encodeURIComponent(wallet)}`);
export const fetchWitnessClaim = (wallet: string, p256: string) => call<WitnessClaimOffer>(`/eye/witness/claim?wallet=${encodeURIComponent(wallet)}&p256=${encodeURIComponent(p256)}`);
export const registerWitness = (wallet: string, record: unknown, claim: WitnessClaim) => call<unknown>('/eye/witness', { wallet, record, claim });
// The server also says whose challenge it is and the text it expects signed;
// the app builds that text itself and compares (finger.ts).
export type WitnessChallenge = { challenge: string; wallet?: string; message?: string; expiresAt?: string };
export const fetchWitnessChallenge = (wallet: string) => call<WitnessChallenge>(`/eye/witness/challenge?wallet=${encodeURIComponent(wallet)}`);
export const openEye = (wallet: string, witness?: WitnessProof) => call<EyeIntent>('/eye/open', witness ? { wallet, witness } : { wallet });
export const blinkEye = (wallet: string, witness?: WitnessProof) => call<EyeIntent>('/eye/blink', witness ? { wallet, witness } : { wallet });
export const submitEye = (intent: string, signedTransaction: string) => call<EyeSubmitResult>('/eye/submit', { intent, signedTransaction });

// A relative image path is the service's own; anything with a scheme is left alone.
export function eyeImageUrl(image: string): string {
  if (/^https?:\/\//i.test(image)) return image;
  return `${EYE_BASE_URL}${image.startsWith('/') ? '' : '/'}${image}`;
}
