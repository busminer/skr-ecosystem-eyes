import { Buffer } from 'buffer';
import { PublicKey, SystemProgram, Transaction, type TransactionInstruction } from '@solana/web3.js';

// The app's own look at a transaction the Eye service built, before any of it
// reaches the wallet.
//
// The eye-mint server builds the open and the Blink, the Seeker wallet signs,
// and the server checks every instruction of its own byte for byte before it
// co-signs (the eye-mint repo's src/tx.mjs). That protects the collection. It
// does not protect the person holding the phone: whoever can change what the
// server answers (a broken server, a stolen Cloudflare account, somebody on
// the route) could hand the app a transfer of everything in the wallet, and
// the app would pass it on as "open my Eye". So the app reads the bytes
// itself and refuses anything that is not the shape the server builds:
//
//   open  = one System transfer to the maker, then one Metaplex Core createV2
//           of an asset in the SKR Eyes collection, owned and paid for by the
//           wallet, carrying only the Attributes plugin and, when Eyes are
//           minted frozen, the PermanentFreezeDelegate;
//   Blink = one System transfer to the maker, then one Metaplex Core
//           updatePluginV1 of the Eye's Attributes, paid for by the wallet.
//
// ComputeBudget is allowed as well, because the wallet world uses it, and any
// priority fee it would set is counted with the transfers. Nothing else: no
// SPL Token, no Token-2022, no other program, no other kind of System call. A
// legacy transaction only, with the wallet as the fee payer, and every SOL
// transfer only to the maker's wallet written into the app below, in total no
// more than the screen showed plus a tenth, and never more than the server's
// own ceiling for that move.
//
// A second rail, SKR (research/skr-pay, a prototype): the same open and the
// same Blink, paid in SKR instead of SOL. Then the maker's money is exactly
// one SPL Token transferChecked of SKR from the wallet's own SKR account to
// the maker's, for exactly the SKR the screen showed, and no System call at
// all: the rent of a new Eye and the network fee still come from the
// wallet's SOL, but Core takes the rent itself inside its create, so the
// transaction names no SOL transfer. Both SKR accounts are derived here from
// the two wallets and the SKR mint, never read from the server. Lighthouse,
// which the Seeker wallet puts in front after this check (mwa.ts), is not
// something the server builds, so here it stays a foreign program.
//
// This file is pure on purpose: no React Native, no i18n, nothing but
// web3.js and Buffer, so `npm run test:eye` can run it in Node against
// transactions built by the server's own builder (scripts/test-eye-tx.mjs).
// The words a person reads when a transaction is refused are move.ts's.

// Where the money of a mint and a Blink goes: the maker of SKR Eyes, kosa.skr.
// Written into the app, never read from the server.
export const MAKER_WALLET = 'BmJaEmaEURBDpj91GUTvJcpKy2MAu8ZtRFRPaMpEuuax';

// The SKR Eyes collection on mainnet (owner kosa.skr, created 28.09.2026).
// The lab build uses its own collection; config.ts chooses between them by
// the build's package.
export const PRODUCTION_COLLECTION = '3FY7WBpvYFXTh4yMdFWp15C2LVVQdA6qKRfvPiBFdvgU';

export const CORE_PROGRAM_ID = 'CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d';
// SKR: the classic SPL Token program (not Token-2022), 6 decimals.
export const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
export const ASSOCIATED_TOKEN_PROGRAM_ID = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
export const SKR_MINT = 'SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3';
export const SKR_DECIMALS = 6;
// The maker's SKR account, the associated account of kosa.skr for the SKR
// mint. Written here only to be compared with what is derived: a derivation
// that ever gives anything else refuses every SKR move.
export const MAKER_SKR_ACCOUNT = 'CmTWwMrSusqhxrABLMnMfTKnZHosoHWczRbnsj5cLGX4';
export const COMPUTE_BUDGET_PROGRAM_ID = 'ComputeBudget111111111111111111111111111111';
const SYSTEM_PROGRAM_ID = SystemProgram.programId.toBase58();

// The most a move may ever send to the maker, whatever the screen said: the
// server's own bounds for a dollar-priced open (0.002 to 0.05 SOL) and Blink
// (0.0001 to 0.002 SOL), the eye-mint repo's src/config.mjs. A server that
// raises its ceiling past these needs a new app, which is the point.
export const OPEN_MAX_LAMPORTS = 50_000_000;
export const BLINK_MAX_LAMPORTS = 2_000_000;
// How far over the amount on screen a transaction may go before it is
// refused: a tenth, for a price that moved between the screen and the build.
export const SHOWN_MARGIN = 0.1;
// SKR, in its smallest units (6 decimals). A mint is 100 SKR for the first
// thousand Eyes (the next tier is not set yet), a Blink 1 SKR. The SKR
// amount must be exactly what the screen showed, with no margin, and never
// past these ceilings, twice today's amounts.
export const OPEN_MAX_SKR_UNITS = 200_000_000;
export const BLINK_MAX_SKR_UNITS = 2_000_000;
// In SKR mode no SOL goes to the maker; the only SOL the transaction itself
// can ask for is a ComputeBudget priority fee, and never more than this.
export const SKR_MODE_MAX_PRIORITY_LAMPORTS = 100_000;
// SPL Token's TransferChecked: amount (u64) and decimals (u8).
const TOKEN_TRANSFER_CHECKED = 12;

// What the new Eye's own account holds once it exists, so the last screen can
// say it before the wallet opens. Rent: 5 080 lamports per byte of the
// account plus its 128 bytes of overhead (mainnet, 28.09.2026:
// getMinimumBalanceForRentExemption(295) = 2 148 840). Metaplex Core also
// puts a flat 1 500 000 lamports into every asset it creates (the lab's
// EYE #0001 and #0002, 295 bytes each, hold 3 648 840). Both can change on
// chain; the screen says "about".
export const RENT_LAMPORTS_PER_BYTE = 5_080;
export const RENT_ACCOUNT_OVERHEAD = 128;
export const CORE_CREATE_FEE_LAMPORTS = 1_500_000;
// An Eye's account is about 330 bytes and its Attributes about 150. Anything
// far past that is not an Eye, and would only make the wallet pay for room.
const MAX_ASSET_BYTES = 600;
const MAX_ATTRIBUTE_BYTES = 512;

export type EyeTxKind = 'open' | 'blink';
// Which rail pays the maker: SOL (the only one until now) or SKR.
export type EyeTxPay = 'sol' | 'skr';

export type EyeTxExpect = {
  kind: EyeTxKind;
  // The wallet the app works for: it must pay the fee, and the Eye is its.
  wallet: string;
  // The collection the Eye lives in (config.ts EYE_COLLECTION).
  collection: string;
  // The lamports the screen showed for this move, to the maker. Null when the
  // screen had no number: then only the ceiling above holds.
  shownLamports?: number | null;
  // For a Blink, the Eye it must touch, when the app knows it.
  asset?: string | null;
  // Defaults to MAKER_WALLET; only the test passes another.
  maker?: string;
  // Defaults to 'sol'. In 'skr' mode `shownSkr` is the SKR, in its smallest
  // units, the screen showed, and the transfer must be exactly that;
  // `shownLamports` is then not used.
  pay?: EyeTxPay;
  shownSkr?: number | null;
};

// What the transaction asks of the wallet, read from its bytes: lamports to
// the maker, the priority fee a ComputeBudget price would add, and for an
// open, what the new Eye's own account will hold (rent and Core's fee).
export type EyeTxSummary = {
  kind: EyeTxKind;
  pay: EyeTxPay;
  toMaker: number;
  // SKR to the maker, in its smallest units; 0 when paid in SOL.
  toMakerSkr: number;
  priorityFee: number;
  storage: number;
  assetBytes: number | null;
};

// A refusal: `code` is short and stable, for the screen's small print and
// for a log; `why` says it in a sentence, for whoever reads the code.
export class EyeTxRefused extends Error {
  readonly code: string;
  readonly why: string;
  constructor(code: string, why: string) {
    super(`${code}: ${why}`);
    this.name = 'EyeTxRefused';
    this.code = code;
    this.why = why;
  }
}

function refuse(code: string, why: string): never {
  throw new EyeTxRefused(code, why);
}

// A strict reader over instruction data: every read is bounds-checked, and
// the caller checks at the end that nothing was left over.
type Reader = { bytes: Uint8Array; at: number };

function need(reader: Reader, count: number): void {
  if (reader.at + count > reader.bytes.length) refuse('shape', 'instruction data ends early');
}

function u8(reader: Reader): number {
  need(reader, 1);
  const value = reader.bytes[reader.at] as number;
  reader.at += 1;
  return value;
}

function u32(reader: Reader): number {
  need(reader, 4);
  const b = reader.bytes;
  const at = reader.at;
  const value = ((b[at] as number) | ((b[at + 1] as number) << 8) | ((b[at + 2] as number) << 16)) + (b[at + 3] as number) * 0x1000000;
  reader.at += 4;
  return value;
}

// A u64 as a Number, refused past 2^53: no amount this file meets comes near.
function u64(reader: Reader): number {
  const low = u32(reader);
  const high = u32(reader);
  if (high >= 0x200000) refuse('shape', 'a 64-bit number is out of range');
  return high * 0x100000000 + low;
}

function bool(reader: Reader): boolean {
  const value = u8(reader);
  if (value > 1) refuse('shape', 'a boolean is neither 0 nor 1');
  return value === 1;
}

// A Borsh string: u32 length, then UTF-8. Returns its byte length too,
// which is what the account will store.
function text(reader: Reader): { value: string; bytes: number } {
  const length = u32(reader);
  if (length > 1_000) refuse('shape', 'a string is too long');
  need(reader, length);
  const slice = reader.bytes.subarray(reader.at, reader.at + length);
  reader.at += length;
  return { value: Buffer.from(slice).toString('utf8'), bytes: length };
}

function pubkey(reader: Reader): string {
  need(reader, 32);
  const slice = reader.bytes.subarray(reader.at, reader.at + 32);
  reader.at += 32;
  return new PublicKey(slice).toBase58();
}

function done(reader: Reader): void {
  if (reader.at !== reader.bytes.length) refuse('shape', 'instruction data has bytes left over');
}

// Core's Attributes plugin body: a list of key and value strings. Returns the
// bytes the plugin takes in the account (its one-byte tag included).
function attributes(reader: Reader): number {
  const count = u32(reader);
  if (count > 32) refuse('shape', 'too many attributes');
  let size = 1 + 4;
  for (let index = 0; index < count; index += 1) {
    size += 4 + text(reader).bytes;
    size += 4 + text(reader).bytes;
  }
  if (size > MAX_ATTRIBUTE_BYTES) refuse('shape', 'the attributes are larger than an Eye ever has');
  return size;
}

// Core's BasePluginAuthority. Returns the bytes it takes in the plugin
// registry (Address carries a key) and, for an Address, which one.
function authority(reader: Reader): { kind: 'None' | 'Owner' | 'UpdateAuthority' | 'Address'; address: string | null; bytes: number } {
  const tag = u8(reader);
  if (tag === 0) return { kind: 'None', address: null, bytes: 1 };
  if (tag === 1) return { kind: 'Owner', address: null, bytes: 1 };
  if (tag === 2) return { kind: 'UpdateAuthority', address: null, bytes: 1 };
  if (tag === 3) return { kind: 'Address', address: pubkey(reader), bytes: 33 };
  return refuse('shape', `unknown plugin authority ${tag}`);
}

// Core's Plugin enum, only the two variants an Eye carries: 5 is
// PermanentFreezeDelegate { frozen }, 6 is Attributes { attributeList }.
// Anything else, a transfer or burn delegate above all, is refused.
const PLUGIN_PERMANENT_FREEZE = 5;
const PLUGIN_ATTRIBUTES = 6;

// createV2 (discriminator 20): dataState, name, uri, Option<Vec<plugin and
// authority>>, Option<Vec<external plugin adapter>>. Accounts, as the server's
// umi builder lays them out: asset, collection, authority, payer, owner,
// updateAuthority (Core's own id for none), System, logWrapper. Returns the
// size the asset account will have.
function checkCreate(instruction: TransactionInstruction, expect: EyeTxExpect, maker: string): number {
  const keys = instruction.keys.map((meta) => meta.pubkey.toBase58());
  if (keys.length !== 8) refuse('shape', `createV2 has ${keys.length} accounts, not 8`);
  const [asset, collection, , payer, owner, updateAuthority, system] = keys;
  if (collection !== expect.collection) refuse('collection', `the Eye would be created in ${collection}, not in the SKR Eyes collection`);
  if (payer !== expect.wallet) refuse('payer', 'the create is not paid for by this wallet');
  if (owner !== expect.wallet) refuse('owner', 'the new Eye would belong to another wallet');
  if (updateAuthority !== CORE_PROGRAM_ID) refuse('shape', 'the create names its own update authority');
  if (system !== SYSTEM_PROGRAM_ID) refuse('shape', 'the create does not name the System program');
  if (!instruction.keys[0]?.isSigner || asset === expect.wallet || asset === maker || asset === expect.collection) refuse('shape', 'the asset is not a fresh account');

  const reader: Reader = { bytes: new Uint8Array(instruction.data), at: 0 };
  if (u8(reader) !== 20) refuse('core_instruction', 'the Core instruction is not a createV2');
  if (u8(reader) !== 0) refuse('shape', 'the Eye would not be an ordinary account');
  const name = text(reader);
  const uri = text(reader);
  // The asset: key, owner, update authority (the collection), name, uri,
  // and an empty sequence number.
  let size = 1 + 32 + 33 + 4 + name.bytes + 4 + uri.bytes + 1;

  let pluginBytes = 0;
  let registryBytes = 0;
  let count = 0;
  if (bool(reader)) {
    count = u32(reader);
    if (count > 4) refuse('shape', 'too many plugins');
    for (let index = 0; index < count; index += 1) {
      const tag = u8(reader);
      if (tag === PLUGIN_ATTRIBUTES) pluginBytes += attributes(reader);
      else if (tag === PLUGIN_PERMANENT_FREEZE) {
        bool(reader);
        pluginBytes += 2;
      } else refuse('plugin', `the Eye would carry plugin ${tag}, which an Eye never has`);
      // Who manages the plugin. Absent means the plugin's default, the
      // collection's update authority. A freeze may be held by the update
      // authority or by the maker's own address (EYE_FREEZE_EYES=owner) and
      // by nobody else; the Attributes only by the update authority.
      let held = 1;
      if (bool(reader)) {
        const who = authority(reader);
        held = who.bytes;
        const fine = who.kind === 'UpdateAuthority' || (tag === PLUGIN_PERMANENT_FREEZE && who.kind === 'Address' && who.address === maker);
        if (!fine) refuse('plugin', 'a plugin on the Eye would be held by somebody else');
      }
      // Its record in the plugin registry: type, authority, offset.
      registryBytes += 1 + held + 8;
    }
  }
  if (bool(reader)) {
    if (u32(reader) !== 0) refuse('plugin', 'the Eye would carry an external plugin adapter');
  }
  done(reader);

  // With plugins, the account also carries the plugin header (key and the
  // registry's offset) and the registry itself (key, the records, and the
  // empty list of external records).
  if (count > 0) size += 9 + pluginBytes + 1 + 4 + registryBytes + 4;
  if (size > MAX_ASSET_BYTES) refuse('shape', 'the Eye would be larger than an Eye ever is');
  return size;
}

// updatePluginV1 (discriminator 6) with the Attributes plugin. Accounts:
// asset, collection, payer, authority, System, logWrapper.
function checkUpdate(instruction: TransactionInstruction, expect: EyeTxExpect): void {
  const keys = instruction.keys.map((meta) => meta.pubkey.toBase58());
  if (keys.length !== 6) refuse('shape', `updatePluginV1 has ${keys.length} accounts, not 6`);
  const [asset, collection, payer, , system] = keys;
  if (expect.asset && asset !== expect.asset) refuse('asset', 'the Blink would touch another Eye');
  if (collection !== expect.collection) refuse('collection', `the Blink names ${collection}, not the SKR Eyes collection`);
  if (payer !== expect.wallet) refuse('payer', 'the Blink is not paid for by this wallet');
  if (system !== SYSTEM_PROGRAM_ID) refuse('shape', 'the Blink does not name the System program');

  const reader: Reader = { bytes: new Uint8Array(instruction.data), at: 0 };
  if (u8(reader) !== 6) refuse('core_instruction', 'the Core instruction is not an updatePluginV1');
  if (u8(reader) !== PLUGIN_ATTRIBUTES) refuse('plugin', 'the Blink would change a plugin other than the Attributes');
  attributes(reader);
  done(reader);
}

// A System instruction: a plain Transfer (index 2, u64 lamports) and nothing
// else. Returns the lamports and where they go.
function checkTransfer(instruction: TransactionInstruction): { to: string; lamports: number } {
  const reader: Reader = { bytes: new Uint8Array(instruction.data), at: 0 };
  if (u32(reader) !== 2) refuse('system_instruction', 'a System instruction is not a plain transfer');
  const lamports = u64(reader);
  done(reader);
  if (instruction.keys.length !== 2) refuse('shape', 'a transfer has the wrong accounts');
  return { to: (instruction.keys[1] as { pubkey: PublicKey }).pubkey.toBase58(), lamports };
}

// The associated token account of `owner` for `mint` under the classic Token
// program: the address every wallet shows as its SKR account.
export function associatedTokenAccount(owner: string, mint: string = SKR_MINT): string {
  const [address] = PublicKey.findProgramAddressSync(
    [new PublicKey(owner).toBuffer(), new PublicKey(TOKEN_PROGRAM_ID).toBuffer(), new PublicKey(mint).toBuffer()],
    new PublicKey(ASSOCIATED_TOKEN_PROGRAM_ID),
  );
  return address.toBase58();
}

// The one SPL Token instruction an SKR move may carry: TransferChecked
// (index 12) of SKR, 6 decimals, from the wallet's own SKR account, signed by
// the wallet alone, to `destination`. Accounts: source, mint, destination,
// authority. Anything else the Token program can do, a plain Transfer (3)
// or an Approve (4) above all, is refused. Returns the amount.
function checkSkrTransfer(instruction: TransactionInstruction, wallet: string, destination: string): number {
  const reader: Reader = { bytes: new Uint8Array(instruction.data), at: 0 };
  const tag = u8(reader);
  if (tag !== TOKEN_TRANSFER_CHECKED) refuse('token_instruction', `SPL Token instruction ${tag} is not a checked transfer`);
  const amount = u64(reader);
  const decimals = u8(reader);
  done(reader);
  const keys = instruction.keys.map((meta) => meta.pubkey.toBase58());
  if (keys.length !== 4) refuse('shape', `a token transfer has ${keys.length} accounts, not 4`);
  const [source, mint, to, owner] = keys;
  if (mint !== SKR_MINT) refuse('skr_mint', `the token transfer moves ${mint}, not SKR`);
  if (decimals !== SKR_DECIMALS) refuse('skr_mint', `the token transfer says ${decimals} decimals, not SKR's ${SKR_DECIMALS}`);
  if (owner !== wallet || !instruction.keys[3]?.isSigner) refuse('skr_source', 'the token transfer is not signed by this wallet');
  if (source !== associatedTokenAccount(wallet)) refuse('skr_source', "the SKR would come from an account other than this wallet's own SKR account");
  if (to !== destination) refuse('transfer_elsewhere', `${amount} SKR units would go to ${to}, not to the maker's SKR account`);
  return amount;
}

// ComputeBudget: the heap, the unit limit, the unit price, the loaded-data
// limit. The price is what could cost the wallet money, so it is returned.
function checkComputeBudget(instruction: TransactionInstruction): { limit: number | null; price: number | null } {
  if (instruction.keys.length !== 0) refuse('shape', 'a ComputeBudget instruction names accounts');
  const reader: Reader = { bytes: new Uint8Array(instruction.data), at: 0 };
  const tag = u8(reader);
  let limit: number | null = null;
  let price: number | null = null;
  if (tag === 1 || tag === 4) u32(reader);
  else if (tag === 2) limit = u32(reader);
  else if (tag === 3) price = u64(reader);
  else refuse('compute_budget', `unknown ComputeBudget instruction ${tag}`);
  done(reader);
  return { limit, price };
}

// The whole check. Returns what the transaction asks of the wallet, or
// throws EyeTxRefused and nothing is signed.
export function checkEyeTransaction(base64: string, expect: EyeTxExpect): EyeTxSummary {
  const maker = expect.maker ?? MAKER_WALLET;
  const bytes = Buffer.from(String(base64 ?? ''), 'base64');
  if (!bytes.length) refuse('not_legacy', 'the transaction is empty');

  // web3.js reads legacy transactions only and throws on a versioned one,
  // which is exactly the refusal wanted here.
  let tx: Transaction;
  try {
    tx = Transaction.from(bytes);
  } catch (error) {
    return refuse('not_legacy', `not a legacy transaction: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!tx.feePayer || tx.feePayer.toBase58() !== expect.wallet) refuse('fee_payer', 'the fee payer is not this wallet');

  const pay: EyeTxPay = expect.pay === 'skr' ? 'skr' : 'sol';
  // In SKR mode the maker's SKR account, derived, and checked against the
  // one written above when the maker is kosa.skr.
  let makerSkr: string | null = null;
  if (pay === 'skr') {
    makerSkr = associatedTokenAccount(maker);
    if (maker === MAKER_WALLET && makerSkr !== MAKER_SKR_ACCOUNT) refuse('maker_account', "the maker's SKR account does not derive to the one written in the app");
  }

  let toMaker = 0;
  let toMakerSkr = 0;
  let skrTransfers = 0;
  let limit: number | null = null;
  let price: number | null = null;
  let creates = 0;
  let updates = 0;
  let others = 0;
  let assetBytes: number | null = null;

  for (const instruction of tx.instructions) {
    const program = instruction.programId.toBase58();
    if (program === SYSTEM_PROGRAM_ID) {
      if (pay === 'skr') refuse('system_instruction', 'a move paid in SKR sends no SOL and makes no other System call');
      const transfer = checkTransfer(instruction);
      if (transfer.to !== maker) refuse('transfer_elsewhere', `a transfer of ${transfer.lamports} lamports goes to ${transfer.to}, not to the maker`);
      toMaker += transfer.lamports;
      others += 1;
    } else if (program === COMPUTE_BUDGET_PROGRAM_ID) {
      const budget = checkComputeBudget(instruction);
      if (budget.limit != null) limit = budget.limit;
      if (budget.price != null) price = budget.price;
    } else if (program === CORE_PROGRAM_ID) {
      const tag = instruction.data[0];
      if (tag === 20) {
        assetBytes = checkCreate(instruction, expect, maker);
        creates += 1;
      } else if (tag === 6) {
        checkUpdate(instruction, expect);
        updates += 1;
      } else refuse('core_instruction', `Core instruction ${tag} is neither a mint nor a Blink`);
      others += 1;
    } else if (pay === 'skr' && program === TOKEN_PROGRAM_ID) {
      toMakerSkr += checkSkrTransfer(instruction, expect.wallet, makerSkr as string);
      skrTransfers += 1;
      if (skrTransfers > 1) refuse('shape', 'a move paid in SKR carries more than one token transfer');
      others += 1;
    } else {
      refuse('foreign_program', `an instruction calls ${program}, which a mint or a Blink never does`);
    }
  }

  if (expect.kind === 'open' && (creates !== 1 || updates !== 0)) refuse('shape', 'an open must create exactly one Eye and change nothing else');
  if (expect.kind === 'blink' && (updates !== 1 || creates !== 0)) refuse('shape', 'a Blink must change exactly one Eye and create nothing');

  // A priority fee: the price per compute unit, in micro-lamports, times the
  // units the transaction may use (the limit, or 200 000 per instruction up
  // to 1 400 000 when it sets none).
  const units = limit ?? Math.min(1_400_000, 200_000 * others);
  const priorityFee = price ? Math.ceil((price * units) / 1_000_000) : 0;

  const storage = assetBytes == null ? 0 : (RENT_ACCOUNT_OVERHEAD + assetBytes) * RENT_LAMPORTS_PER_BYTE + CORE_CREATE_FEE_LAMPORTS;

  if (pay === 'skr') {
    // Exactly one SKR transfer, of exactly what the screen showed, under the
    // ceiling; and of SOL nothing but a small priority fee.
    if (skrTransfers !== 1) refuse('shape', 'a move paid in SKR must carry exactly one SKR transfer');
    const skrCeiling = expect.kind === 'open' ? OPEN_MAX_SKR_UNITS : BLINK_MAX_SKR_UNITS;
    if (toMakerSkr > skrCeiling) refuse('over_amount', `the transaction takes ${toMakerSkr} SKR units, more than the ${skrCeiling} a ${expect.kind} ever takes`);
    const shownSkr = typeof expect.shownSkr === 'number' && Number.isSafeInteger(expect.shownSkr) && expect.shownSkr > 0 ? expect.shownSkr : null;
    if (shownSkr == null || toMakerSkr !== shownSkr) refuse('skr_amount', `the transaction takes ${toMakerSkr} SKR units, not the ${String(expect.shownSkr)} the screen showed`);
    if (priorityFee > SKR_MODE_MAX_PRIORITY_LAMPORTS) refuse('over_amount', `the priority fee of ${priorityFee} lamports is more than the ${SKR_MODE_MAX_PRIORITY_LAMPORTS} allowed`);
    return { kind: expect.kind, pay, toMaker, toMakerSkr, priorityFee, storage, assetBytes };
  }

  const ceiling = expect.kind === 'open' ? OPEN_MAX_LAMPORTS : BLINK_MAX_LAMPORTS;
  const shown = typeof expect.shownLamports === 'number' && Number.isFinite(expect.shownLamports) && expect.shownLamports > 0 ? expect.shownLamports : null;
  const allowed = shown == null ? ceiling : Math.min(ceiling, Math.floor(shown * (1 + SHOWN_MARGIN)));
  const outflow = toMaker + priorityFee;
  if (outflow > allowed) refuse('over_amount', `the transaction takes ${outflow} lamports, more than the ${allowed} allowed for what the screen showed`);

  return { kind: expect.kind, pay, toMaker, toMakerSkr, priorityFee, storage, assetBytes };
}
