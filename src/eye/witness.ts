import AsyncStorage from '@react-native-async-storage/async-storage';
import { Buffer } from 'buffer';
import { t } from '../i18n';
import { getSeekerWitness, WITNESS_ERROR, witnessErrorCode, type CreatedKey, type WitnessErrorCode, type WitnessSignature } from '../../modules/seeker-witness';
import { registerWitness } from './api';
import { ATTESTOR_BASE_URL, ATTESTOR_LAB_BASE_URL, LAB_PACKAGE } from './config';

// The Eye's witness: a key born in this phone's StrongBox under a fingerprint,
// and the attestor's word that it was.
//
// Enrolling is one round trip each way and one hand-over. The attestor issues
// a single-use challenge for the wallet; the phone generates the key with that
// challenge inside Google's attestation chain; the attestor reads the chain
// and answers with a signed verdict: real Seeker, StrongBox, locked
// bootloader, our APK, finger-bound key, and the wallet's Seeker Genesis
// Token. That verdict record goes to the eye-mint server as it came, so the
// server binds the key to the wallet, and it is kept here too, keyed by
// wallet, for the walkthrough to show and for the hand-over to be retried.
//
// Signing is one fingerprint prompt. The message is handed to the hardware;
// the hardware refuses until a finger is on the sensor; one DER signature
// comes back. The app never sees the fingerprint and never holds the key.

// What the attestor answers with on success (SEEKIN docs/PROTOCOL.md §5),
// minus the per-check detail and the chain, which the attestor stores itself
// under `store/<p256>.json`. `attestor_sig` is ed25519 by `attestor` over
// `SEEKIN|ATTEST|1| p256 | wallet | sgt_mint | attestation_hash | flags` and is
// what lets the eye-mint server believe the binding without calling anyone.
export type AttestorVerdict = {
  p256: string;
  sgt_mint: string;
  sgt_token_account: string | null;
  attestation_hash: string;
  flags: number;
  attestor: string;
  attestor_sig: string;
  verified_at: string;
};

// What the attestor read out of Google's certificate, kept so the walkthrough
// can show the person the facts rather than tell them a verdict was reached.
// Every field is exactly as the attestor reported it; null when it did not.
export type WitnessChecks = {
  chainLength: number | null;
  securityLevel: string | null;
  deviceLocked: boolean | null;
  verifiedBootState: string | null;
  brand: string | null;
  model: string | null;
  manufacturer: string | null;
  product: string | null;
  osVersion: number | null;
  fingerBound: boolean | null;
  packages: string[];
};

export type WitnessRecord = {
  wallet: string;
  // 33-byte compressed public key, hex. The same string the verdict carries.
  p256: string;
  // Where the key actually lives; TEE only when the phone has no StrongBox.
  strongBox: boolean;
  attestation: AttestorVerdict;
  checks: WitnessChecks;
  // The attestor's answer exactly as it came, for `POST /eye/witness`.
  verdict: unknown;
  // Whether the eye-mint server has been handed the verdict. False when the
  // hand-over failed after the attestor said yes; retried before the next use.
  registered: boolean;
  enrolledAt: string;
};

type AttestorResponse =
  | ({ ok: true; checks?: Record<string, unknown> } & AttestorVerdict)
  | { ok: false; reason?: string; checks?: Record<string, unknown> };

function pickChecks(raw: Record<string, unknown> | undefined): WitnessChecks {
  const source = raw ?? {};
  const str = (key: string) => (typeof source[key] === 'string' ? source[key] as string : null);
  const num = (key: string) => (typeof source[key] === 'number' ? source[key] as number : null);
  const bool = (key: string) => (typeof source[key] === 'boolean' ? source[key] as boolean : null);
  const packages = Array.isArray(source.packages) ? (source.packages as unknown[]).filter((p): p is string => typeof p === 'string') : [];
  return {
    chainLength: num('chain_length'),
    securityLevel: str('securityLevel'),
    deviceLocked: bool('deviceLocked'),
    verifiedBootState: str('verifiedBootState'),
    brand: str('brand'),
    model: str('model'),
    manufacturer: str('manufacturer'),
    product: str('product'),
    osVersion: num('osVersion'),
    fingerBound: bool('fingerBound'),
    packages,
  };
}

// Every failure is one of these, with a code the screen can act on and a
// message already in the person's language.
export type WitnessFailure =
  | WitnessErrorCode
  // No module in this build, or not Android.
  | 'E_WITNESS_UNAVAILABLE'
  // The attestor read the chain and said no; the message carries its reason.
  | 'E_ATTESTOR_REJECTED'
  // The attestor could not be reached or answered nonsense.
  | 'E_ATTESTOR_UNREACHABLE'
  // The eye-mint server did not take the verdict; the record is kept unregistered.
  | 'E_EYE_SERVICE';

// What the walkthrough is told while an enrollment runs, in the order it
// happens, so each card on the screen turns when its check actually starts
// and settles when it actually ends. `challenge`: the attestor is being asked
// for its single-use challenge. `vault`: the challenge is in hand and the
// phone is about to make the key. `key`: the key is born; Google's chain is
// about to go to the attestor. `verdict`: the attestor said yes; the verdict
// is about to go to the eye-mint server. A refusal is the thrown error, and
// whichever stage was last announced is where it happened.
export type WitnessStage =
  | { stage: 'challenge' }
  | { stage: 'vault' }
  | { stage: 'key'; created: CreatedKey }
  | { stage: 'verdict'; record: WitnessRecord };
// The listener is awaited: a screen may hold the enrollment at a stage until
// the person has read it. The calls and their order do not change.
export type WitnessStageListener = (stage: WitnessStage) => void | Promise<void>;

export class WitnessError extends Error {
  // `detail` is the attestor's own reason, in its words, when it refused.
  constructor(public readonly code: WitnessFailure, message: string, public readonly detail: string | null = null) {
    super(message);
    this.name = 'WitnessError';
  }
}

const STORE_PREFIX = 'skr-eyes:witness:';
const storeKey = (wallet: string) => `${STORE_PREFIX}${wallet}`;

// /verify walks the chain, fetches Google's roots and status list when its
// cache is cold, and asks a Solana RPC for the Genesis Token: slow on a bad
// morning, so a longer patience than the eye-mint client's.
const TIMEOUT_MS = 45_000;

// Which attestor this build may talk to. The attestor checks the package and
// signing certificate that Google's chain names, so a sideloaded lab build
// (`dev.alexkosa.skreyes.lab`, debug key) has its own instance; every other
// build is held to the store's package and key.
export function attestorBaseUrl(): string {
  return getSeekerWitness()?.PACKAGE === LAB_PACKAGE ? ATTESTOR_LAB_BASE_URL : ATTESTOR_BASE_URL;
}

async function attestor<T>(path: string, body?: object): Promise<T> {
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`${attestorBaseUrl()}${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    // The attestor answers 200 with `ok: false` for a verdict it will not give;
    // anything else is the service itself misbehaving.
    if (!response.ok) throw new Error(`attestor ${response.status}`);
    return await response.json() as T;
  } catch {
    throw new WitnessError('E_ATTESTOR_UNREACHABLE', t('The attestor did not answer'));
  } finally {
    clearTimeout(deadline);
  }
}

// The module's own codes, given words. A cancel keeps a bare message: the
// screen says nothing for it.
function fromModule(error: unknown): WitnessError {
  const code = witnessErrorCode(error);
  switch (code) {
    case WITNESS_ERROR.NO_BIOMETRICS:
      return new WitnessError(code, t('Set up a fingerprint on this phone first'));
    case WITNESS_ERROR.LOCKOUT:
      return new WitnessError(code, t('Too many tries. The fingerprint sensor is locked for now'));
    case WITNESS_ERROR.KEY_INVALIDATED:
      return new WitnessError(code, t('A new fingerprint was added to this phone, so the Eye key was reset. Try again to make a new one.'));
    case WITNESS_ERROR.CANCELLED:
      return new WitnessError(code, 'cancelled');
    case WITNESS_ERROR.UNSUPPORTED:
    case WITNESS_ERROR.KEYGEN:
      return new WitnessError(code, t('This phone cannot make a hardware key'));
    default:
      return new WitnessError(code ?? WITNESS_ERROR.FAILED, t('The phone did not sign'));
  }
}

function requireModule() {
  const module = getSeekerWitness();
  if (!module) throw new WitnessError('E_WITNESS_UNAVAILABLE', t('This phone cannot make a hardware key'));
  return module;
}

// The record kept for this wallet, if it was ever enrolled on this phone.
// Whether the key itself is still in the keystore is a separate question
// (`hasKey`); a reinstall keeps the key and loses this, a new fingerprint
// keeps this and loses the key.
export async function readWitness(wallet: string): Promise<WitnessRecord | null> {
  try {
    const raw = await AsyncStorage.getItem(storeKey(wallet));
    if (!raw) return null;
    const saved = JSON.parse(raw) as Partial<WitnessRecord>;
    if (typeof saved.p256 !== 'string' || !saved.attestation || typeof saved.attestation.attestor_sig !== 'string' || !saved.checks) return null;
    return { ...saved, registered: saved.registered === true } as WitnessRecord;
  } catch {
    return null;
  }
}

// Forgets the wallet's record and destroys the key. The next enrollment
// starts from nothing, with a fresh challenge and a fresh verdict.
export async function forgetWitness(wallet: string): Promise<void> {
  await AsyncStorage.removeItem(storeKey(wallet)).catch(() => undefined);
  const module = getSeekerWitness();
  if (module) await module.deleteKey().catch(() => undefined);
}

// Challenge from the attestor, key born with it, chain read by the attestor,
// verdict kept. Replaces any key already in the phone: the attestation
// challenge is baked into the certificate at birth, so a verdict always needs
// a key born for it.
export async function enrollWitness(wallet: string, onStage?: WitnessStageListener): Promise<WitnessRecord> {
  const module = requireModule();

  await onStage?.({ stage: 'challenge' });
  const { challenge } = await attestor<{ challenge: string }>(`/challenge?wallet=${encodeURIComponent(wallet)}`);
  if (typeof challenge !== 'string' || !/^[0-9a-f]{64}$/i.test(challenge)) {
    throw new WitnessError('E_ATTESTOR_UNREACHABLE', t('The attestor did not answer'));
  }

  let created: CreatedKey;
  await onStage?.({ stage: 'vault' });
  try {
    created = await module.createKey(Buffer.from(challenge, 'hex').toString('base64'));
  } catch (caught) {
    throw fromModule(caught);
  }

  await onStage?.({ stage: 'key', created });

  let verdict: AttestorResponse;
  try {
    verdict = await attestor<AttestorResponse>('/verify', { wallet, challenge, chain_pem: created.chainPem });
  } catch (caught) {
    // The challenge is spent either way; the key born for it is no use now.
    await module.deleteKey().catch(() => undefined);
    throw caught;
  }

  if (!verdict.ok) {
    await module.deleteKey().catch(() => undefined);
    const reason = verdict.reason || '?';
    throw new WitnessError('E_ATTESTOR_REJECTED', t('The attestor did not accept this phone: {reason}', { reason }), reason);
  }
  if (typeof verdict.p256 !== 'string' || verdict.p256.toLowerCase() !== created.p256Compressed.toLowerCase()) {
    // The attestor vouched for a key that is not the one in this phone.
    await module.deleteKey().catch(() => undefined);
    throw new WitnessError('E_ATTESTOR_UNREACHABLE', t('The attestor did not answer'));
  }

  const record: WitnessRecord = {
    wallet,
    p256: created.p256Compressed.toLowerCase(),
    strongBox: created.strongBox,
    attestation: {
      p256: verdict.p256.toLowerCase(),
      sgt_mint: verdict.sgt_mint,
      sgt_token_account: verdict.sgt_token_account ?? null,
      attestation_hash: verdict.attestation_hash,
      flags: verdict.flags,
      attestor: verdict.attestor,
      attestor_sig: verdict.attestor_sig,
      verified_at: verdict.verified_at,
    },
    checks: pickChecks(verdict.checks),
    verdict,
    registered: false,
    enrolledAt: new Date().toISOString(),
  };
  // Kept before the hand-over, so a hand-over that fails leaves a key, a
  // verdict and one thing to retry rather than a spent challenge and nothing.
  await AsyncStorage.setItem(storeKey(wallet), JSON.stringify(record)).catch(() => undefined);
  await onStage?.({ stage: 'verdict', record });
  return registerRecord(record);
}

// Hands the attestor's verdict to the eye-mint server, as it came, so the
// server binds the key it names to the wallet. Idempotent: a record already
// registered is returned as is.
export async function registerRecord(record: WitnessRecord): Promise<WitnessRecord> {
  if (record.registered) return record;
  try {
    await registerWitness(record.wallet, record.verdict);
  } catch (caught) {
    throw new WitnessError('E_EYE_SERVICE', caught instanceof Error && caught.message ? caught.message : t('The Eye service did not answer'));
  }
  const registered: WitnessRecord = { ...record, registered: true };
  await AsyncStorage.setItem(storeKey(record.wallet), JSON.stringify(registered)).catch(() => undefined);
  return registered;
}

// One signature over the payload, after the system fingerprint prompt.
// ECDSA-SHA256 over exactly these bytes, DER, base64. The prompt's title says
// what the touch is for: opening the Eye, or one Blink.
export async function witnessSign(payload: Uint8Array, purpose: 'open' | 'blink' = 'blink'): Promise<WitnessSignature> {
  const module = requireModule();
  try {
    return await module.sign(Buffer.from(payload).toString('base64'), {
      title: purpose === 'open' ? t('Open your Eye') : t('Sign this Blink'),
      subtitle: t('Your Seeker signs with its own key'),
      description: t('The key cannot sign without your finger.'),
      cancel: t('Cancel'),
    });
  } catch (caught) {
    throw fromModule(caught);
  }
}
