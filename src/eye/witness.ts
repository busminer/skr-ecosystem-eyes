import AsyncStorage from '@react-native-async-storage/async-storage';
import { Buffer } from 'buffer';
import { t } from '../i18n';
import { getSeekerWitness, WITNESS_ERROR, witnessErrorCode, type CreatedKey, type WitnessErrorCode, type WitnessSignature } from '../../modules/seeker-witness';
import { ATTESTOR_BASE_URL } from './config';

// The Eye's witness: a key born in this phone's StrongBox under a fingerprint,
// and the attestor's word that it was.
//
// Enrolling is one round trip each way. The attestor issues a single-use
// challenge for the wallet; the phone generates the key with that challenge
// inside Google's attestation chain; the attestor reads the chain and answers
// with a signed verdict: real Seeker, StrongBox, locked bootloader, our APK,
// finger-bound key, and the wallet's Seeker Genesis Token. The verdict and the
// key's public half are kept here, keyed by wallet, for every Blink after.
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

export type WitnessRecord = {
  wallet: string;
  // 33-byte compressed public key, hex. The same string the verdict carries.
  p256: string;
  // Where the key actually lives; TEE only when the phone has no StrongBox.
  strongBox: boolean;
  attestation: AttestorVerdict;
  enrolledAt: string;
};

type AttestorResponse =
  | ({ ok: true } & AttestorVerdict)
  | { ok: false; reason?: string };

// Every failure is one of these, with a code the screen can act on and a
// message already in the person's language.
export type WitnessFailure =
  | WitnessErrorCode
  // No module in this build, or not Android.
  | 'E_WITNESS_UNAVAILABLE'
  // The attestor read the chain and said no; the message carries its reason.
  | 'E_ATTESTOR_REJECTED'
  // The attestor could not be reached or answered nonsense.
  | 'E_ATTESTOR_UNREACHABLE';

export class WitnessError extends Error {
  constructor(public readonly code: WitnessFailure, message: string) {
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

async function attestor<T>(path: string, body?: object): Promise<T> {
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`${ATTESTOR_BASE_URL}${path}`, {
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
    if (typeof saved.p256 !== 'string' || !saved.attestation || typeof saved.attestation.attestor_sig !== 'string') return null;
    return saved as WitnessRecord;
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
export async function enrollWitness(wallet: string): Promise<WitnessRecord> {
  const module = requireModule();

  const { challenge } = await attestor<{ challenge: string }>(`/challenge?wallet=${encodeURIComponent(wallet)}`);
  if (typeof challenge !== 'string' || !/^[0-9a-f]{64}$/i.test(challenge)) {
    throw new WitnessError('E_ATTESTOR_UNREACHABLE', t('The attestor did not answer'));
  }

  let created: CreatedKey;
  try {
    created = await module.createKey(Buffer.from(challenge, 'hex').toString('base64'));
  } catch (caught) {
    throw fromModule(caught);
  }

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
    throw new WitnessError('E_ATTESTOR_REJECTED', t('The attestor did not accept this phone: {reason}', { reason: verdict.reason || '?' }));
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
    enrolledAt: new Date().toISOString(),
  };
  await AsyncStorage.setItem(storeKey(wallet), JSON.stringify(record)).catch(() => undefined);
  return record;
}

// One signature over the payload, after the system fingerprint prompt.
// ECDSA-SHA256 over exactly these bytes, DER, base64.
export async function witnessSign(payload: Uint8Array): Promise<WitnessSignature> {
  const module = requireModule();
  try {
    return await module.sign(Buffer.from(payload).toString('base64'), {
      title: t('Sign this Blink'),
      subtitle: t('Your Seeker signs with its own key'),
      description: t('The key cannot sign without your finger.'),
      cancel: t('Cancel'),
    });
  } catch (caught) {
    throw fromModule(caught);
  }
}
