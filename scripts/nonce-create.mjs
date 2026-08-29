// Creates the anchors a schedule stands on.
//
// A signed Solana transaction dies with its blockhash, about a minute after it
// is made, which is fatal for a part meant to be sent this afternoon. A durable
// nonce account replaces that expiry with an anchor the person owns: the
// transaction stays valid until the anchor moves, and it only moves when one of
// their own transactions consumes it.
//
// The addresses are derived from the wallet plus a fixed seed, so no second
// keypair exists and no second signature is needed - the person alone can make
// them, and the person alone can close them and take the rent back. Closing is
// the cancel button for every part not yet sent, and it works even against us.

import { writeFileSync } from 'node:fs';
import {
  NONCE_ACCOUNT_LENGTH,
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';

const RPC = 'https://api.mainnet-beta.solana.com';
const SYSTEM = SystemProgram.programId;

async function rpc(method, params) {
  const response = await fetch(RPC, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const body = await response.json();
  if (body.error) throw new Error(`${method}: ${body.error.message}`);
  return body.result;
}

const user = new PublicKey(process.argv[2]);
const derivationPath = process.argv[3];
const count = Number(process.argv[4] ?? 3);
const out = process.argv[5] ?? 'nonce-create.json';

const rent = await rpc('getMinimumBalanceForRentExemption', [NONCE_ACCOUNT_LENGTH]);
const blockhash = (await rpc('getLatestBlockhash', [{ commitment: 'confirmed' }])).value.blockhash;

const seeds = Array.from({ length: count }, (_, index) => `skr-stake-nonce-${index}`);
const instructions = [];
const anchors = [];

for (const seed of seeds) {
  const noncePubkey = await PublicKey.createWithSeed(user, seed, SYSTEM);
  // getAccountInfo answers with an envelope; the account itself is inside it,
  // and reading the envelope instead reports every anchor as already made.
  const existing = (await rpc('getAccountInfo', [noncePubkey.toBase58(), { encoding: 'base64' }])).value;
  anchors.push({ seed, address: noncePubkey.toBase58(), existed: existing !== null });
  if (existing !== null) continue;

  instructions.push(
    SystemProgram.createAccountWithSeed({
      fromPubkey: user,
      basePubkey: user,
      seed,
      newAccountPubkey: noncePubkey,
      lamports: rent,
      space: NONCE_ACCOUNT_LENGTH,
      programId: SYSTEM,
    }),
    SystemProgram.nonceInitialize({ noncePubkey, authorizedPubkey: user }),
  );
}

anchors.forEach((anchor) => {
  console.log(`${anchor.existed ? 'already there' : 'to create  '}  ${anchor.address}  (${anchor.seed})`);
});

if (instructions.length === 0) {
  console.log('\nEvery anchor already exists; nothing to sign.');
  writeFileSync(out, JSON.stringify({ user: user.toBase58(), derivationPath, anchors, payloads: [] }, null, 2));
  process.exit(0);
}

const message = new TransactionMessage({ payerKey: user, recentBlockhash: blockhash, instructions }).compileToV0Message();
const transaction = new VersionedTransaction(message);

writeFileSync(out, JSON.stringify({
  user: user.toBase58(),
  derivationPath,
  blockhash,
  rentPerAnchor: rent,
  anchors,
  payloads: [Buffer.from(transaction.message.serialize()).toString('base64')],
}, null, 2));

console.log(`\nrent per anchor ${(rent / 1e9).toFixed(8)} SOL, refundable when the anchor is closed`);
console.log(`one transaction to sign, written to ${out}`);
