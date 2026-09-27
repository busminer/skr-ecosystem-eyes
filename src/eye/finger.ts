import { Buffer } from 'buffer';
import { getSeekerWitness, WITNESS_ERROR } from '../../modules/seeker-witness';
import { fetchWitnessChallenge, type WitnessEnrollment, type WitnessProof } from './api';
import { enrollWitness, forgetWitness, readWitness, WitnessError, witnessSign, type WitnessRecord } from './witness';

// What EyePanel does with the finger, kept out of EyePanel.
//
// Two moments. Before the Eye first opens, the phone is enrolled with the
// attestor and the verdict rides along in the open request, so the eye-mint
// server learns which hardware key belongs to this wallet. Before every Blink,
// the server hands out a single-use challenge, the hardware key signs it under
// a finger, and the proof rides along in the blink request. All of it is
// behind EYE_FINGER_ENABLED in config.ts; with the flag off nothing here runs.

// The bytes the hardware key signs for a Blink. Domain-separated and spelt
// out, so the server reproduces exactly this from the wallet and the challenge
// it issued, and no other message this key ever signs can be replayed as one.
export const BLINK_DOMAIN = 'SKR-EYES|BLINK|1';

export function blinkMessage(wallet: string, challenge: string): Uint8Array {
  return new Uint8Array(Buffer.from(`${BLINK_DOMAIN}|${wallet}|${challenge}`, 'utf8'));
}

// The wallet's witness: the record on file while its key is still in the
// phone, a fresh enrollment otherwise. A reinstall keeps the key and drops the
// record, a new fingerprint drops the key and keeps the record; either way the
// pair starts over, because the verdict names one key.
export async function ensureWitness(wallet: string): Promise<WitnessRecord> {
  const stored = await readWitness(wallet);
  const module = getSeekerWitness();
  if (stored && module && await module.hasKey().catch(() => false)) return stored;
  if (stored) await forgetWitness(wallet);
  return enrollWitness(wallet);
}

// Before the Eye opens: the verdict, so the server can bind the key.
export async function witnessBeforeOpen(wallet: string): Promise<WitnessEnrollment> {
  const record = await ensureWitness(wallet);
  return { p256: record.p256, attestation: record.attestation };
}

// Before a Blink: the server's challenge, signed under a finger. The verdict
// rides along too, so a server that never saw this key (an Eye opened before
// the finger was on) can bind it here instead of refusing.
export async function witnessBeforeBlink(wallet: string): Promise<WitnessProof> {
  const record = await ensureWitness(wallet);
  const { challenge } = await fetchWitnessChallenge(wallet);
  try {
    const { derSignatureBase64 } = await witnessSign(blinkMessage(wallet, challenge));
    return { p256: record.p256, attestation: record.attestation, signature: derSignatureBase64, challenge };
  } catch (caught) {
    // The key died under us (new fingerprint) or is simply gone: forget the
    // record so the next attempt enrolls again instead of failing the same way.
    if (caught instanceof WitnessError && (caught.code === WITNESS_ERROR.KEY_INVALIDATED || caught.code === WITNESS_ERROR.NO_KEY)) {
      await forgetWitness(wallet);
    }
    throw caught;
  }
}

// The person backed out of the fingerprint prompt. Like a wallet cancel: not
// an error, and not worth a red line.
export function isFingerCancel(error: unknown): boolean {
  return error instanceof WitnessError && error.code === WITNESS_ERROR.CANCELLED;
}
