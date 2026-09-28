import { Buffer } from 'buffer';
import { t } from '../i18n';
import { getSeekerWitness, WITNESS_ERROR } from '../../modules/seeker-witness';
import { fetchWitnessChallenge, type WitnessProof } from './api';
import { enrollWitness, forgetWitness, readWitness, registerRecord, WitnessError, witnessSign, type WitnessRecord, type WitnessStageListener } from './witness';

// What EyePanel does with the finger, kept out of EyePanel.
//
// One shape, two moments. Before the Eye opens and before every Blink, the
// server hands out a single-use challenge for the wallet, the hardware key
// signs it under a finger, and the proof rides along in the request. The
// first time, the phone is enrolled with the attestor and the verdict is
// handed to the server, so it knows which key belongs to this wallet. All of
// it is behind EYE_FINGER_ENABLED in config.ts; with the flag off nothing
// here runs.

// The bytes the hardware key signs. Domain-separated and spelt out, so the
// server reproduces exactly this from the wallet and the challenge it issued,
// and no other message this key ever signs can be replayed as one.
export const BLINK_DOMAIN = 'SKR-EYES|BLINK|1';

export function blinkText(wallet: string, challenge: string): string {
  return `${BLINK_DOMAIN}|${wallet}|${challenge}`;
}

export function blinkMessage(wallet: string, challenge: string): Uint8Array {
  return new Uint8Array(Buffer.from(blinkText(wallet, challenge), 'utf8'));
}

// The server's challenge is 32 random bytes, hex (the eye-mint repo's
// src/witness.mjs). Anything else is not a challenge, and the hardware key is
// not asked to sign it: whatever the finger signs must be exactly the one text
// above, for this wallet, and nothing a server could dress up as something
// else. When the server says whose challenge it is and what text it expects,
// both must be what the app builds itself, as with the wallet's claim.
//
// The text is the same for an open and a Blink. The server checks one text,
// SKR-EYES|BLINK|1|<wallet>|<challenge>, for both moves, so a different text
// per move would need the server first; the single-use challenge, issued per
// wallet and spent by the very request it rides in, is what stops a replay.
function checkChallenge(wallet: string, offer: { challenge: unknown; wallet?: unknown; message?: unknown }): string {
  const challenge = typeof offer.challenge === 'string' ? offer.challenge : '';
  const fine = /^[0-9a-f]{64}$/i.test(challenge)
    && (offer.wallet === undefined || offer.wallet === wallet)
    && (offer.message === undefined || offer.message === blinkText(wallet, challenge));
  if (!fine) throw new WitnessError('E_EYE_SERVICE', t('The Eye service asked to sign something else. Nothing was signed.'));
  return challenge;
}

// The wallet's witness: the record on file while its key is still in the
// phone, a fresh enrollment otherwise. A reinstall keeps the key and drops the
// record, a new fingerprint drops the key and keeps the record; either way the
// pair starts over, because the verdict names one key. A record the server
// never received is handed over here before it is used, with the wallet's
// signed claim, so the wallet opens then, once. `onStage` hears a fresh
// enrollment's steps as they happen; the on-file path says only the wallet's
// two moments, and only when it still has a hand-over to make.
export async function ensureWitness(wallet: string, onStage?: WitnessStageListener): Promise<WitnessRecord> {
  const stored = await readWitness(wallet);
  const module = getSeekerWitness();
  if (stored && module && await module.hasKey().catch(() => false)) return registerRecord(stored, onStage);
  if (stored) await forgetWitness(wallet);
  return enrollWitness(wallet, onStage);
}

// The server's challenge, signed under a finger. `purpose` only chooses the
// words on the prompt; the bytes and the proof are the same for both.
// `onStage` hears the two moments a screen can show: the challenge being
// fetched, and the prompt going up.
export type ProofStage = 'challenge' | 'finger';
export async function witnessProof(wallet: string, purpose: 'open' | 'blink', onStage?: (stage: ProofStage) => void): Promise<WitnessProof> {
  onStage?.('challenge');
  const record = await ensureWitness(wallet);
  const challenge = checkChallenge(wallet, await fetchWitnessChallenge(wallet));
  onStage?.('finger');
  try {
    const { derSignatureBase64 } = await witnessSign(blinkMessage(wallet, challenge), purpose);
    return { p256: record.p256, signature: derSignatureBase64, challenge };
  } catch (caught) {
    // The key died under us (new fingerprint) or is simply gone: forget the
    // record so the next attempt enrolls again instead of failing the same way.
    if (caught instanceof WitnessError && (caught.code === WITNESS_ERROR.KEY_INVALIDATED || caught.code === WITNESS_ERROR.NO_KEY)) {
      await forgetWitness(wallet);
    }
    throw caught;
  }
}

export const witnessBeforeOpen = (wallet: string) => witnessProof(wallet, 'open');
export const witnessBeforeBlink = (wallet: string) => witnessProof(wallet, 'blink');

// The person backed out of the fingerprint prompt. Like a wallet cancel: not
// an error, and not worth a red line.
export function isFingerCancel(error: unknown): boolean {
  return error instanceof WitnessError && error.code === WITNESS_ERROR.CANCELLED;
}
