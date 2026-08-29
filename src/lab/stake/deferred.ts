import { PublicKey, SystemProgram, SYSVAR_RECENT_BLOCKHASHES_PUBKEY, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import { stakeInstruction } from './stakeTx';

// Staking on a schedule, without anyone holding the person's signatures but
// their own phone.
//
// A signed Solana transaction dies with its blockhash about a minute later, so
// a part approved this morning cannot be sent this afternoon. A durable nonce
// replaces that clock with an anchor: the transaction stays valid until the
// anchor moves, and the anchor only moves when one of the person's own
// transactions consumes it.
//
// Three properties fall out of that, and all three are the point:
//   - the anchor address is derived from the wallet and a fixed word, so no
//     second key exists anywhere;
//   - closing the anchor invalidates every part not yet sent and returns the
//     rent, which makes cancelling work even against us;
//   - one anchor is consumed by exactly one part, so N parts need N anchors.

export const ANCHOR_SEED_PREFIX = 'skr-stake-nonce-';

// The vault signs a batch for one fingerprint but caps the batch, and on the
// Seeker the cap is three. The schedule is cut to that number rather than the
// other way round.
export const DEFAULT_BATCH = 3;

export type Anchor = { index: number; seed: string; address: string };

export function anchorSeed(index: number): string {
  return `${ANCHOR_SEED_PREFIX}${index}`;
}

export async function deriveAnchor(user: PublicKey, index: number): Promise<Anchor> {
  const seed = anchorSeed(index);
  const address = await PublicKey.createWithSeed(user, seed, SystemProgram.programId);
  return { index, seed, address: address.toBase58() };
}

export async function deriveAnchors(user: PublicKey, count: number): Promise<Anchor[]> {
  return Promise.all(Array.from({ length: count }, (_, index) => deriveAnchor(user, index)));
}

/**
 * The one-time setup: makes the anchors the schedule will stand on.
 *
 * It carries an ordinary blockhash because it is signed and sent while the
 * person is watching, so it never needs to outlive the moment. It also needs no
 * key but theirs — a seeded address belongs to the wallet that derived it.
 */
export function buildAnchorCreation({ user, anchors, rentLamports, blockhash }: {
  user: PublicKey;
  anchors: Anchor[];
  rentLamports: number;
  blockhash: string;
}): VersionedTransaction {
  const instructions = anchors.flatMap((anchor) => {
    const noncePubkey = new PublicKey(anchor.address);
    return [
      SystemProgram.createAccountWithSeed({
        fromPubkey: user,
        basePubkey: user,
        seed: anchor.seed,
        newAccountPubkey: noncePubkey,
        lamports: rentLamports,
        space: NONCE_ACCOUNT_BYTES,
        programId: SystemProgram.programId,
      }),
      SystemProgram.nonceInitialize({ noncePubkey, authorizedPubkey: user }),
    ];
  });

  return new VersionedTransaction(
    new TransactionMessage({ payerKey: user, recentBlockhash: blockhash, instructions }).compileToV0Message(),
  );
}

// A nonce account is exactly this long, and the rent to keep it alive is quoted
// against that size.
export const NONCE_ACCOUNT_BYTES = 80;

/**
 * One part of a schedule: advance the anchor, then stake.
 *
 * The advance must be the first instruction — Solana checks the anchor before
 * it runs anything else, and a transaction that puts it second is simply
 * invalid. The stake instruction is the same one the gateway already knows.
 *
 * There is no compute-unit instruction here. The immediate stake needs one to
 * make otherwise identical parts differ, but each part here already carries its
 * own anchor, so the messages differ by construction.
 */
export function buildDeferredStake({ user, guardianPool, amountRaw, anchorAddress, anchorValue }: {
  user: PublicKey;
  guardianPool: PublicKey;
  amountRaw: bigint;
  anchorAddress: string;
  anchorValue: string;
}): VersionedTransaction {
  const message = new TransactionMessage({
    payerKey: user,
    // The stored nonce takes the blockhash's place: this is what makes the part
    // outlive the morning.
    recentBlockhash: anchorValue,
    instructions: [
      SystemProgram.nonceAdvance({
        noncePubkey: new PublicKey(anchorAddress),
        authorizedPubkey: user,
      }),
      stakeInstruction(user, guardianPool, amountRaw),
    ],
  }).compileToV0Message();

  return new VersionedTransaction(message);
}

/**
 * A part of the day, as the phone keeps it.
 *
 * The signature lives here and nowhere else — not on a server, not in a backup.
 * `sendAfter` is a window rather than a moment: Android will not wake an
 * ordinary app to the minute, and pretending otherwise would make the app lie
 * about when it acts.
 */
export type DeferredPart = {
  index: number;
  amountRaw: string;
  anchorAddress: string;
  anchorValue: string;
  messageBase64: string;
  signatureBase64: string | null;
  sendAfter: number;
  sendBefore: number;
  state: 'unsigned' | 'ready' | 'sent' | 'confirmed' | 'spent' | 'unknown';
  signature: string | null;
};

export const RECENT_BLOCKHASHES_SYSVAR = SYSVAR_RECENT_BLOCKHASHES_PUBKEY.toBase58();
