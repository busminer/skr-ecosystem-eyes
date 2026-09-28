import { requireNativeModule } from 'expo-modules-core';
import { Platform } from 'react-native';

// Seeker Witness: a P-256 key that lives in this phone's StrongBox and signs
// only while a living finger is on the sensor. Google's attestation chain,
// handed back by `createKey`, is what lets a server believe both of those
// things without trusting the app.
//
// Android only, like skr-share next door: on any other platform the module is
// absent and the caller treats the Eye as unwitnessed.

// Stable codes on every rejection, mirrored from the Kotlin side. The screen
// reads `witnessErrorCode(error)` instead of the message: messages are for
// logs, and a cancelled prompt is not an error worth a red line.
export const WITNESS_ERROR = {
  // Android older than 12: no device-properties attestation.
  UNSUPPORTED: 'E_WITNESS_UNSUPPORTED',
  // No Class 3 biometric enrolled or usable right now.
  NO_BIOMETRICS: 'E_WITNESS_NO_BIOMETRICS',
  // No foreground activity to hang the prompt on.
  NO_ACTIVITY: 'E_WITNESS_NO_ACTIVITY',
  // The challenge was not base64, or too short to be a nonce.
  BAD_CHALLENGE: 'E_WITNESS_BAD_CHALLENGE',
  // The phone could not make an attestable finger-bound key at all.
  KEYGEN: 'E_WITNESS_KEYGEN',
  // `sign` was asked before `createKey`, or after `deleteKey`.
  NO_KEY: 'E_WITNESS_NO_KEY',
  // A new fingerprint was enrolled; the key is gone and has been removed.
  KEY_INVALIDATED: 'E_WITNESS_KEY_INVALIDATED',
  // The person backed out of the prompt.
  CANCELLED: 'E_WITNESS_CANCELLED',
  // Too many failed touches; the sensor is locked for now or until unlock.
  LOCKOUT: 'E_WITNESS_LOCKOUT',
  // Anything else.
  FAILED: 'E_WITNESS_FAILED',
} as const;

export type WitnessErrorCode = typeof WITNESS_ERROR[keyof typeof WITNESS_ERROR];

// The words on the system fingerprint prompt, already translated.
export type PromptTexts = {
  title: string;
  subtitle?: string;
  description?: string;
  cancel: string;
};

export type CreatedKey = {
  // 33 bytes, hex: 0x02/0x03 then X. What the attestor echoes back as `p256`.
  p256Compressed: string;
  // The attestation chain, leaf first, PEM.
  chainPem: string;
  // Where the key actually landed after the fallbacks.
  strongBox: boolean;
  // Read from the key itself: it refuses to sign without a finger.
  fingerBound: boolean;
};

export type WitnessSignature = {
  // ECDSA-SHA256 over the message bytes, DER, base64.
  derSignatureBase64: string;
};

export type SeekerWitnessModule = {
  // The application id this build runs under: `dev.alexkosa.skreyes`, or
  // `dev.alexkosa.skreyes.lab` for a sideloaded test build. Decides which
  // attestor the JS side talks to.
  readonly PACKAGE: string;
  readonly KEY_ALIAS: string;
  hasKey(): Promise<boolean>;
  // The key in the phone right now: 33-byte compressed P-256, hex, or null
  // when there is none. There is one key per phone and one record per wallet,
  // so this is how a record learns that another wallet's enrollment has since
  // replaced its key (src/eye/witness.ts keyMatches). Optional: a build
  // without it keeps the old behaviour.
  publicKey?(): Promise<string | null>;
  createKey(challengeBase64: string): Promise<CreatedKey>;
  sign(messageBase64: string, texts: PromptTexts): Promise<WitnessSignature>;
  deleteKey(): Promise<void>;
};

let cached: SeekerWitnessModule | null | undefined;

export function getSeekerWitness(): SeekerWitnessModule | null {
  if (cached !== undefined) return cached;
  if (Platform.OS !== 'android') {
    cached = null;
    return cached;
  }
  try {
    cached = requireNativeModule<SeekerWitnessModule>('SeekerWitness');
  } catch {
    // A build of the app without this module in it.
    cached = null;
  }
  return cached;
}

const CODES = new Set<string>(Object.values(WITNESS_ERROR));

// The module's own code on a rejection, or null for anything else.
export function witnessErrorCode(error: unknown): WitnessErrorCode | null {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' && CODES.has(code) ? (code as WitnessErrorCode) : null;
}
