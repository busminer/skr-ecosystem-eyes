// Builds real stake transactions and writes their message bytes out for the
// Seed Vault probe to sign on the phone.
//
// The probe has so far only signed random bytes. That proved the vault batches
// and asks for one fingerprint, but not that it will sign the thing we actually
// need signed. This script produces that thing: the same message the production
// gateway accepts, for a real account, with a real blockhash.
//
// Nothing here is broadcast, and a recent blockhash expires in about a minute,
// so a signature made from these payloads is worthless by the time anyone reads
// this line.

import { writeFileSync } from 'node:fs';
import { PublicKey } from '@solana/web3.js';
import { buildStakeTransaction, DEFAULT_GUARDIAN_POOL, MIN_STAKE_RAW } from '../src/lab/stake/stakeTx.ts';

const RPC = 'https://api.mainnet-beta.solana.com';

const user = new PublicKey(process.argv[2] ?? (() => { throw new Error('pass the wallet address'); })());
const derivationPath = process.argv[3] ?? "bip32:/m/44'/501'/0'/0'";
const parts = Number(process.argv[4] ?? 3);

const response = await fetch(RPC, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getLatestBlockhash', params: [{ commitment: 'confirmed' }] }),
});
const { result } = await response.json();
const blockhash = result.value.blockhash;

const payloads = [];
for (let index = 0; index < parts; index++) {
  const transaction = buildStakeTransaction({
    user,
    guardianPool: DEFAULT_GUARDIAN_POOL,
    amountRaw: MIN_STAKE_RAW,
    blockhash,
    nonce: index,
  });
  // The signature covers the message, not the envelope: this is exactly what an
  // on-chain verification checks, so it is what the vault must sign.
  payloads.push(Buffer.from(transaction.message.serialize()).toString('base64'));
}

const out = { user: user.toBase58(), derivationPath, blockhash, amountRaw: MIN_STAKE_RAW.toString(), payloads };
writeFileSync(process.argv[5] ?? 'payloads.json', JSON.stringify(out, null, 2));
console.log(`blockhash ${blockhash}`);
console.log(`${payloads.length} stake messages for ${user.toBase58()}`);
