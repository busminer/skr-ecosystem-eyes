import { Buffer } from 'buffer';
import { ComputeBudgetProgram, PublicKey, TransactionInstruction, TransactionMessage, VersionedTransaction } from '@solana/web3.js';

// Builds the exact stake transaction the production gateway accepts: version 0,
// one signature, eleven unique static accounts, one instruction with twelve
// ordered references and sixteen bytes of data. Anything else is rejected
// before it ever reaches Solana, which is the point.

export const PROGRAM_ID = new PublicKey('SKRskrmtL83pcL4YqLWt6iPefDqwXQWHSw9S9vz94BZ');
export const MINT = new PublicKey('SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3');
export const STAKE_CONFIG = new PublicKey('4HQy82s9CHTv1GsYKnANHMiHfhcqesYkK6sB3RDSYyqw');
export const STAKE_VAULT = new PublicKey('8isViKbwhuhFhsv2t8vaFL74pKCqaFPQXo1KkeQwZbB8');
export const DEFAULT_GUARDIAN_POOL = new PublicKey('DPJ58trLsF9yPrBa2pk6UaRkvqW8hWUYjawe788WBuqr');

const TOKEN_PROGRAM = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const ASSOCIATED_TOKEN_PROGRAM = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
const SYSTEM_PROGRAM = new PublicKey('11111111111111111111111111111111');
const STAKE_DISCRIMINATOR = Buffer.from([206, 176, 202, 18, 200, 209, 179, 108]);

export const TOKEN_DECIMALS = 6;
export const TOKEN_SCALE = 1_000_000n;
export const MIN_STAKE_RAW = 1_000_000n;
// Proven by simulation: a first stake creates the 169-byte position account and
// the payer covers its rent. Worth showing before anyone signs.
export const FIRST_STAKE_RENT_LAMPORTS = 2_067_120;

export function deriveUserStake(user: PublicKey, guardianPool: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('user_stake'), STAKE_CONFIG.toBuffer(), user.toBuffer(), guardianPool.toBuffer()],
    PROGRAM_ID,
  )[0];
}

export function deriveEventAuthority(): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from('__event_authority')], PROGRAM_ID)[0];
}

export function deriveTokenAccount(user: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [user.toBuffer(), TOKEN_PROGRAM.toBuffer(), MINT.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM,
  )[0];
}

export function stakeInstruction(user: PublicKey, guardianPool: PublicKey, amountRaw: bigint): TransactionInstruction {
  // The polyfilled Buffer types disagree about 64-bit writes, so the amount is
  // laid down through a DataView: same bytes, no ambiguity.
  const data = Buffer.alloc(16);
  STAKE_DISCRIMINATOR.copy(data, 0);
  new DataView(data.buffer, data.byteOffset, data.byteLength).setBigUint64(8, amountRaw, true);

  return new TransactionInstruction({
    programId: PROGRAM_ID,
    data,
    keys: [
      { pubkey: deriveUserStake(user, guardianPool), isSigner: false, isWritable: true },
      { pubkey: STAKE_CONFIG, isSigner: false, isWritable: true },
      { pubkey: guardianPool, isSigner: false, isWritable: true },
      { pubkey: user, isSigner: true, isWritable: true },
      { pubkey: user, isSigner: true, isWritable: true },
      { pubkey: deriveTokenAccount(user), isSigner: false, isWritable: true },
      { pubkey: STAKE_VAULT, isSigner: false, isWritable: true },
      { pubkey: MINT, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM, isSigner: false, isWritable: false },
      { pubkey: SYSTEM_PROGRAM, isSigner: false, isWritable: false },
      { pubkey: deriveEventAuthority(), isSigner: false, isWritable: false },
      { pubkey: PROGRAM_ID, isSigner: false, isWritable: false },
    ],
  });
}

// A transaction's identity on Solana is the signature over its message, so
// several identical stakes are not several transactions — they are one, sent
// repeatedly, and the cluster keeps the first. Each part therefore carries a
// compute-unit limit of its own: the content differs, the meaning does not,
// and the cost stays the same.
const BASE_COMPUTE_UNITS = 60_000;

export function buildStakeTransaction({ user, guardianPool, amountRaw, blockhash, nonce = 0 }: {
  user: PublicKey;
  guardianPool: PublicKey;
  amountRaw: bigint;
  blockhash: string;
  nonce?: number;
}): VersionedTransaction {
  const message = new TransactionMessage({
    payerKey: user,
    recentBlockhash: blockhash,
    instructions: [
      ComputeBudgetProgram.setComputeUnitLimit({ units: BASE_COMPUTE_UNITS + nonce }),
      stakeInstruction(user, guardianPool, amountRaw),
    ],
  }).compileToV0Message();
  return new VersionedTransaction(message);
}

export function toRaw(amount: string): bigint {
  const clean = amount.replace(',', '.').trim();
  if (!/^\d*\.?\d*$/.test(clean) || clean === '' || clean === '.') return 0n;
  const [whole = '', fraction = ''] = clean.split('.');
  const padded = (fraction + '000000').slice(0, TOKEN_DECIMALS);
  return BigInt(whole || '0') * TOKEN_SCALE + BigInt(padded || '0');
}

export function fromRaw(raw: bigint): string {
  const whole = raw / TOKEN_SCALE;
  const fraction = raw % TOKEN_SCALE;
  if (fraction === 0n) return whole.toLocaleString('en-US');
  return `${whole.toLocaleString('en-US')}.${fraction.toString().padStart(TOKEN_DECIMALS, '0').replace(/0+$/, '')}`;
}

// The user chooses what goes into one transaction and how many of them to
// send; the total is simply the product. Every part is its own on-chain stake,
// so every part carries the same amount and each must clear the minimum.
export const MAX_PARTS = 16;

export function equalParts(perPartRaw: bigint, count: number): bigint[] {
  const parts = Math.min(MAX_PARTS, Math.max(1, Math.floor(count)));
  if (perPartRaw < MIN_STAKE_RAW) throw new Error('Each transaction must stake at least 1 SKR.');
  return Array.from({ length: parts }, () => perPartRaw);
}
