import { signTransactionBase64 } from '../mwa';
import { blinkEye, openEye, submitEye, type EyeIntent, type EyeSubmitResult, type WitnessProof } from './api';
import { EYE_FINGER_ENABLED } from './config';
import { witnessProof } from './finger';
import { epochMs } from './time';

// A move: opening the Eye, or one Blink. The same road every time, and every
// step of it announced, so the sheet that shows it (MoveSheet.tsx) turns the
// right ring at the right moment and never has to guess.
//
// Finger: the server's single-use challenge, signed under a fingerprint by
// the key in the phone's StrongBox (only while EYE_FINGER_ENABLED). Wallet:
// the server builds the transaction, the Seeker wallet signs it. Network: the
// server verifies, co-signs and sends it, and answers once it has confirmed.
//
// A move can be picked up where it stopped. The wallet declined or timed out:
// the intent is still good until the server's `expiresAt`, so the retry goes
// straight back to the wallet with the same transaction. The submit never
// reached the server: the signed bytes are still in hand, so the retry sends
// them again. Anything the server itself refused starts over from the top,
// because a refusal means the intent it built is spent.

export type MoveKind = 'open' | 'blink';

export type MoveStage =
  // Finger: asking the Eye service for its challenge (and, on a phone that
  // lost its record, enrolling again first).
  | { stage: 'challenge' }
  // Finger: the fingerprint prompt is up.
  | { stage: 'finger' }
  // Finger done: the challenge is signed by this key.
  | { stage: 'signed'; p256: string }
  // Wallet: asking the Eye service to build the transaction.
  | { stage: 'intent' }
  // Wallet: the transaction is in hand and the Seeker wallet is opening.
  | { stage: 'wallet'; intent: EyeIntent }
  // Network: signed; handing it to the server to verify, co-sign and send.
  | { stage: 'network'; intent: EyeIntent; signed: string };

export type MoveStageListener = (stage: MoveStage) => void;

// What a stopped move keeps for the retry.
export type MoveResume = { intent: EyeIntent; signed: string | null };

// The intent is good until the server's `expiresAt`, less a margin for the
// round trip; an intent with no expiry is trusted as it is.
const EXPIRY_MARGIN_MS = 15_000;
export function intentFresh(intent: EyeIntent): boolean {
  const at = epochMs(intent.expiresAt);
  return at == null || at - Date.now() > EXPIRY_MARGIN_MS;
}

export async function runMove(kind: MoveKind, wallet: string, onStage: MoveStageListener, resume: MoveResume | null = null): Promise<EyeSubmitResult> {
  let intent = resume && intentFresh(resume.intent) ? resume.intent : null;
  let signed = intent ? resume?.signed ?? null : null;

  if (!intent) {
    let proof: WitnessProof | undefined;
    if (EYE_FINGER_ENABLED) {
      proof = await witnessProof(wallet, kind, (stage) => onStage({ stage }));
      onStage({ stage: 'signed', p256: proof.p256 });
    }
    onStage({ stage: 'intent' });
    intent = kind === 'open' ? await openEye(wallet, proof) : await blinkEye(wallet, proof);
  }

  if (!signed) {
    onStage({ stage: 'wallet', intent });
    signed = await signTransactionBase64(intent.transaction);
  }

  onStage({ stage: 'network', intent, signed });
  return submitEye(intent.intent, signed);
}

// The step a stage belongs to, which is where a failure during it is shown.
export type MoveStep = 'finger' | 'wallet' | 'network';
export function stepFor(stage: MoveStage['stage'] | null): MoveStep {
  if (stage === null || stage === 'challenge' || stage === 'finger') return 'finger';
  if (stage === 'signed' || stage === 'intent' || stage === 'wallet') return 'wallet';
  return 'network';
}
