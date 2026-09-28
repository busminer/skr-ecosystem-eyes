// The app's check of the Eye service's transactions (src/eye/txCheck.ts),
// run against transactions built by the server's own builder. Run:
// npm run test:eye
//
// The builder is the eye-mint repo's src/tx.mjs, read from EYE_MINT_DIR or,
// by default, C:\Users\Alex Kosa\skr-eye-mint. Where that repo is not on the
// disk, the same transactions are read from scripts/fixtures/eye-tx.json,
// which `npm run test:eye -- --write-fixture` writes from the live builder.
// Either way the good ones must pass exactly as the server makes them, and
// every hostile change of them must be refused before a wallet would see it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction, ComputeBudgetProgram, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import { BLINK_MAX_LAMPORTS, CORE_PROGRAM_ID, EyeTxRefused, MAKER_WALLET, OPEN_MAX_LAMPORTS, PRODUCTION_COLLECTION, checkEyeTransaction } from '../src/eye/txCheck.ts';

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(here, 'fixtures', 'eye-tx.json');
const EYE_MINT_DIR = process.env.EYE_MINT_DIR || 'C:/Users/Alex Kosa/skr-eye-mint';
const LAB_COLLECTION = 'FCB6vdAbVoerZWd97JQaMSEc2hzPFYgukyVpqd3Jrwd9';

// Fixed keys, so the fixture and a fresh build are the same transactions.
const seed = (byte) => Uint8Array.from({ length: 32 }, (_, index) => (byte + index) & 0xff);
const authority = Keypair.fromSeed(seed(1));
const user = Keypair.fromSeed(seed(2));
const blockhash = Keypair.fromSeed(seed(3)).publicKey.toBase58();
const wallet = user.publicKey.toBase58();
const OPEN = 8_000_000;
const BLINK = 250_000;

// The transactions as the server builds them: production (frozen, the thaw is
// the owner's address), the lab (frozen by the update authority), the lab as
// it minted EYE #0002 on chain on 28.09 (no freeze), and a Blink.
async function buildLive() {
  const { createTxKit, attributeList } = await import(pathToFileURL(join(EYE_MINT_DIR, 'src', 'tx.mjs')).href);
  const kit = (collection, freeze, publicBaseUrl) => createTxKit({
    rpcUrl: 'http://127.0.0.1:1', authority, collection, feeWallet: MAKER_WALLET,
    prices: { openLamports: OPEN, blinkLamports: BLINK }, publicBaseUrl, freeze,
  });
  const prod = kit(PRODUCTION_COLLECTION, { type: 'Address', address: MAKER_WALLET }, 'https://skr.alexkosa.dev');
  const lab = kit(LAB_COLLECTION, { type: 'UpdateAuthority' }, 'https://skr.alexkosa.dev/eye-lab');
  const labPlain = kit(LAB_COLLECTION, null, 'https://skr.alexkosa.dev/eye-lab');
  const opened = attributeList({ serial: 1234, opened: '2026-09-28', streak: 1, blinks: 1, lastBlinkDay: '2026-09-28', event: 'regular', witnessed: 1 });
  const onChain = attributeList({ serial: 2, opened: '2026-09-28', streak: 1, blinks: 1, lastBlinkDay: '2026-09-28', event: 'regular', witnessed: 0 });
  const blinked = attributeList({ serial: 1234, opened: '2026-09-28', streak: 2, blinks: 2, lastBlinkDay: '2026-09-29', event: 'regular', witnessed: 1 });
  const open = prod.buildOpen({ wallet, serial: 1234, intentId: 'fixture-open', attributes: opened, blockhash });
  const blink = prod.buildBlink({ wallet, asset: open.asset, attributes: blinked, blockhash });
  const labOpen = lab.buildOpen({ wallet, serial: 1234, intentId: 'fixture-lab', attributes: opened, blockhash });
  const labEye2 = labPlain.buildOpen({ wallet, serial: 2, intentId: 'fixture-eye2', attributes: onChain, blockhash });
  const overcharged = prod.buildOpen({ wallet, serial: 1234, intentId: 'fixture-over', attributes: opened, blockhash, feeLamports: OPEN * 2 });
  return {
    from: 'live',
    wallet,
    asset: open.asset,
    open: prod.serialize(open.transaction),
    blink: prod.serialize(blink.transaction),
    labOpen: lab.serialize(labOpen.transaction),
    labEye2: labPlain.serialize(labEye2.transaction),
    overcharged: prod.serialize(overcharged.transaction),
  };
}

const live = existsSync(join(EYE_MINT_DIR, 'src', 'tx.mjs'));
const built = live ? await buildLive() : { ...JSON.parse(readFileSync(FIXTURE, 'utf8')), from: 'fixture' };
if (process.argv.includes('--write-fixture')) {
  if (!live) throw new Error(`no eye-mint repo at ${EYE_MINT_DIR} to build the fixture from`);
  mkdirSync(dirname(FIXTURE), { recursive: true });
  const { from, ...rest } = built;
  writeFileSync(FIXTURE, `${JSON.stringify(rest, null, 2)}\n`);
}
console.log(`# transactions from the ${built.from === 'live' ? `server's builder in ${EYE_MINT_DIR}` : 'fixture'}`);

const openExpect = { kind: 'open', wallet, collection: PRODUCTION_COLLECTION, shownLamports: OPEN };
const blinkExpect = { kind: 'blink', wallet, collection: PRODUCTION_COLLECTION, shownLamports: BLINK, asset: built.asset };

// Rebuilds a transaction with its instructions (and maybe its fee payer)
// changed, the way a hostile server would hand it out.
function tamper(base64, { mutate = (instructions) => instructions, feePayer = null } = {}) {
  const issued = Transaction.from(Buffer.from(base64, 'base64'));
  const next = new Transaction({ feePayer: feePayer ?? issued.feePayer, recentBlockhash: issued.recentBlockhash });
  next.add(...mutate(issued.instructions));
  return Buffer.from(next.serialize({ requireAllSignatures: false, verifySignatures: false })).toString('base64');
}

function refused(base64, expect, code) {
  assert.throws(() => checkEyeTransaction(base64, expect), (error) => {
    assert.ok(error instanceof EyeTxRefused, `expected a refusal, got ${error}`);
    assert.equal(error.code, code, error.message);
    return true;
  });
}

const stranger = Keypair.fromSeed(seed(9)).publicKey;
const TOKEN_PROGRAM = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const TOKEN_2022_PROGRAM = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');

test('the open the server builds passes, and the screen gets the amounts from its bytes', () => {
  const summary = checkEyeTransaction(built.open, openExpect);
  assert.equal(summary.toMaker, OPEN);
  assert.equal(summary.priorityFee, 0);
  // EYE #1234, frozen with the owner's address: 337 bytes on chain.
  assert.equal(summary.assetBytes, 337);
  assert.equal(summary.storage, (128 + 337) * 5_080 + 1_500_000);
});

test('the account size matches the lab EYE #0002 on chain (295 bytes, 3 648 840 lamports)', () => {
  const summary = checkEyeTransaction(built.labEye2, { ...openExpect, collection: LAB_COLLECTION });
  assert.equal(summary.assetBytes, 295);
  assert.equal(summary.storage, 3_648_840);
});

test('the lab open, frozen by the update authority, passes in the lab collection only', () => {
  assert.equal(checkEyeTransaction(built.labOpen, { ...openExpect, collection: LAB_COLLECTION }).toMaker, OPEN);
  refused(built.labOpen, openExpect, 'collection');
});

test('the Blink the server builds passes', () => {
  const summary = checkEyeTransaction(built.blink, blinkExpect);
  assert.equal(summary.toMaker, BLINK);
  assert.equal(summary.storage, 0);
});

test('a Blink on another Eye, or an open handed out as a Blink, is refused', () => {
  refused(built.blink, { ...blinkExpect, asset: stranger.toBase58() }, 'asset');
  refused(built.open, { ...blinkExpect, shownLamports: OPEN }, 'shape');
  refused(built.blink, openExpect, 'shape');
});

test('a transfer to another address is refused', () => {
  const tx = tamper(built.open, {
    mutate: (ixs) => [SystemProgram.transfer({ fromPubkey: user.publicKey, toPubkey: stranger, lamports: OPEN }), ...ixs.slice(1)],
  });
  refused(tx, openExpect, 'transfer_elsewhere');
  const extra = tamper(built.blink, {
    mutate: (ixs) => [...ixs, SystemProgram.transfer({ fromPubkey: user.publicKey, toPubkey: stranger, lamports: 1 })],
  });
  refused(extra, blinkExpect, 'transfer_elsewhere');
});

test('an extra SPL Token or Token-2022 instruction is refused', () => {
  for (const programId of [TOKEN_PROGRAM, TOKEN_2022_PROGRAM]) {
    // A Token Transfer (3) of the wallet's tokens to a stranger.
    const drain = new TransactionInstruction({
      programId,
      keys: [
        { pubkey: Keypair.fromSeed(seed(10)).publicKey, isSigner: false, isWritable: true },
        { pubkey: stranger, isSigner: false, isWritable: true },
        { pubkey: user.publicKey, isSigner: true, isWritable: false },
      ],
      data: Buffer.from([3, 0, 0, 0, 0, 1, 0, 0, 0]),
    });
    refused(tamper(built.open, { mutate: (ixs) => [...ixs, drain] }), openExpect, 'foreign_program');
    refused(tamper(built.blink, { mutate: (ixs) => [drain, ...ixs] }), blinkExpect, 'foreign_program');
  }
});

test('a different fee payer is refused', () => {
  refused(tamper(built.open, { feePayer: stranger }), openExpect, 'fee_payer');
  refused(built.open, { ...openExpect, wallet: stranger.toBase58() }, 'fee_payer');
});

test('an overcharge is refused: past the screen plus a tenth, and past the ceiling', () => {
  refused(built.overcharged, openExpect, 'over_amount');
  // Up to a tenth over what the screen showed is taken; past it is not.
  assert.doesNotThrow(() => checkEyeTransaction(built.open, { ...openExpect, shownLamports: Math.ceil(OPEN / 1.1) }));
  refused(built.open, { ...openExpect, shownLamports: Math.floor(OPEN / 1.1) - 1_000 }, 'over_amount');
  // With no number on screen, the ceiling still holds.
  const huge = tamper(built.open, {
    mutate: (ixs) => [SystemProgram.transfer({ fromPubkey: user.publicKey, toPubkey: new PublicKey(MAKER_WALLET), lamports: OPEN_MAX_LAMPORTS + 1 }), ...ixs.slice(1)],
  });
  refused(huge, { ...openExpect, shownLamports: null }, 'over_amount');
  refused(huge, { ...openExpect, shownLamports: OPEN_MAX_LAMPORTS * 2 }, 'over_amount');
  const hugeBlink = tamper(built.blink, {
    mutate: (ixs) => [SystemProgram.transfer({ fromPubkey: user.publicKey, toPubkey: new PublicKey(MAKER_WALLET), lamports: BLINK_MAX_LAMPORTS + 1 }), ...ixs.slice(1)],
  });
  refused(hugeBlink, { ...blinkExpect, shownLamports: null }, 'over_amount');
});

test('a priority fee counts with the transfers', () => {
  const pricey = tamper(built.blink, {
    mutate: (ixs) => [ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }), ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1_000_000 }), ...ixs],
  });
  refused(pricey, blinkExpect, 'over_amount');
  const modest = tamper(built.blink, {
    mutate: (ixs) => [ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }), ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 10 }), ...ixs],
  });
  assert.equal(checkEyeTransaction(modest, blinkExpect).priorityFee, 2);
});

test('any other System call is refused, an Assign above all', () => {
  const assign = SystemProgram.assign({ accountPubkey: user.publicKey, programId: stranger });
  refused(tamper(built.open, { mutate: (ixs) => [assign, ...ixs] }), openExpect, 'system_instruction');
});

test('any other Core call, and a plugin an Eye never has, is refused', () => {
  const [transfer, create] = Transaction.from(Buffer.from(built.open, 'base64')).instructions;
  // Core TransferV1 (14) of whatever the wallet holds.
  const move = new TransactionInstruction({ programId: new PublicKey(CORE_PROGRAM_ID), keys: create.keys, data: Buffer.from([14, 0]) });
  refused(tamper(built.open, { mutate: () => [transfer, move] }), openExpect, 'core_instruction');
  // The frozen plugin turned into a PermanentTransferDelegate (7).
  const data = Buffer.from(create.data);
  const at = data.lastIndexOf(Buffer.from([5, 1, 1, 3]));
  assert.ok(at > 0, 'the freeze plugin is in the create');
  data[at] = 7;
  const swapped = new TransactionInstruction({ programId: create.programId, keys: create.keys, data });
  refused(tamper(built.open, { mutate: () => [transfer, swapped] }), openExpect, 'plugin');
  // The new Eye handed to somebody else.
  const keys = create.keys.map((meta, index) => (index === 4 ? { ...meta, pubkey: stranger } : meta));
  refused(tamper(built.open, { mutate: () => [transfer, new TransactionInstruction({ programId: create.programId, keys, data: create.data })] }), openExpect, 'owner');
});

test('a versioned transaction is refused', () => {
  const issued = Transaction.from(Buffer.from(built.open, 'base64'));
  const message = new TransactionMessage({ payerKey: user.publicKey, recentBlockhash: blockhash, instructions: issued.instructions }).compileToV0Message();
  const versioned = Buffer.from(new VersionedTransaction(message).serialize()).toString('base64');
  refused(versioned, openExpect, 'not_legacy');
});
