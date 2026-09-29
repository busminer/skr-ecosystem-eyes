import { t } from '../i18n';
import { signTransactionBase64 } from '../mwa';
import { blinkEye, openEye, submitEye, type EyeIntent, type EyeSubmitResult, type WitnessProof } from './api';
import { EYE_COLLECTION, EYE_FINGER_ENABLED, EYE_PAY } from './config';
import { witnessProof } from './finger';
import { epochMs } from './time';
import { checkEyeTransaction, EyeTxRefused, type EyeTxSummary } from './txCheck';

// A move: opening the Eye, or one Blink. The same road every time, and every
// step of it announced, so the sheet that shows it (MoveSheet.tsx) turns the
// right ring at the right moment and never has to guess.
//
// Finger: the server's single-use challenge, signed under a fingerprint by
// the key in the phone's StrongBox (only while EYE_FINGER_ENABLED). Wallet:
// the server builds the transaction, the Seeker wallet signs it. Network: the
// server verifies, co-signs and sends it, and answers once it has confirmed.
// Between the server and the wallet the app reads the transaction itself
// (txCheck.ts): who pays, which programs, how much SOL goes where. One that
// is not the mint or the Blink the server always builds never reaches the
// wallet, and the amounts the last screen shows are read from its bytes.
//
// The listener may hold the move. `onStage` is awaited, so the sheet that
// shows the move can wait for the person to read a step before the next
// call is made. Every call and its order is exactly as before; only the
// pause between two of them can be the person's.
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
  // Wallet: the transaction is in hand, read and found to be what it should
  // be, and the Seeker wallet is opening. `summary` is what it asks of the
  // wallet, from its own bytes.
  | { stage: 'wallet'; intent: EyeIntent; summary: EyeTxSummary }
  // Network: signed; handing it to the server to verify, co-sign and send.
  | { stage: 'network'; intent: EyeIntent; signed: string };

export type MoveStageListener = (stage: MoveStage) => void | Promise<void>;

// What a stopped move keeps for the retry.
export type MoveResume = { intent: EyeIntent; signed: string | null };

// The intent is good until the server's `expiresAt`, less a margin for the
// round trip; an intent with no expiry is trusted as it is.
const EXPIRY_MARGIN_MS = 15_000;
export function intentFresh(intent: EyeIntent): boolean {
  const at = epochMs(intent.expiresAt);
  return at == null || at - Date.now() > EXPIRY_MARGIN_MS;
}

// What the screen told the person before the move: the SKR to the maker it
// showed (the status's open or Blink amount), and for a Blink, which Eye.
// The transaction must take exactly that SKR and no SOL for the maker.
export type MoveExpect = { shownSkr: number | null; asset?: string | null };

// A transaction the app would not hand to the wallet. The message is the
// person's, in their language; `code` is txCheck's short reason, shown small
// under it, and `why` the whole reason, for a log.
export class MoveRefused extends Error {
  readonly code: string;
  readonly why: string;
  constructor(kind: MoveKind, refusal: EyeTxRefused) {
    super(kind === 'open'
      ? t('This transaction does not look like an SKR Eyes mint. Nothing was signed.')
      : t('This transaction does not look like an SKR Eyes Blink. Nothing was signed.'));
    this.name = 'MoveRefused';
    this.code = refusal.code;
    this.why = refusal.why;
  }
}

// The app's own reading of the transaction, done every time it is about to
// go to the wallet, a retry with the same intent included: the check is
// cheap, and the wallet is the one place a wrong transaction costs money.
function inspect(kind: MoveKind, wallet: string, intent: EyeIntent, expect: MoveExpect): EyeTxSummary {
  try {
    if (intent.kind !== kind) throw new EyeTxRefused('shape', `the service answered a ${kind} with a ${String(intent.kind)}`);
    return checkEyeTransaction(intent.transaction, { kind, wallet, collection: EYE_COLLECTION, pay: EYE_PAY, shownSkr: expect.shownSkr, asset: expect.asset ?? null });
  } catch (caught) {
    if (caught instanceof EyeTxRefused) throw new MoveRefused(kind, caught);
    throw caught;
  }
}

export async function runMove(kind: MoveKind, wallet: string, onStage: MoveStageListener, resume: MoveResume | null = null, expect: MoveExpect = { shownSkr: null }): Promise<EyeSubmitResult> {
  let intent = resume && intentFresh(resume.intent) ? resume.intent : null;
  let signed = intent ? resume?.signed ?? null : null;

  if (!intent) {
    let proof: WitnessProof | undefined;
    if (EYE_FINGER_ENABLED) {
      proof = await witnessProof(wallet, kind, (stage) => onStage({ stage }));
      await onStage({ stage: 'signed', p256: proof.p256 });
    }
    await onStage({ stage: 'intent' });
    intent = kind === 'open' ? await openEye(wallet, proof) : await blinkEye(wallet, proof);
  }

  if (!signed) {
    const summary = inspect(kind, wallet, intent, expect);
    await onStage({ stage: 'wallet', intent, summary });
    signed = await signTransactionBase64(wallet, intent.transaction);
  }

  await onStage({ stage: 'network', intent, signed });
  return submitEye(intent.intent, signed);
}

// The step a stage belongs to, which is where a failure during it is shown.
export type MoveStep = 'finger' | 'wallet' | 'network';
export function stepFor(stage: MoveStage['stage'] | null): MoveStep {
  if (stage === null || stage === 'challenge' || stage === 'finger') return 'finger';
  if (stage === 'signed' || stage === 'intent' || stage === 'wallet') return 'wallet';
  return 'network';
}
