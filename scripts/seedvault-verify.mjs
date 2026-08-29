// Checks that what the vault handed back are real signatures over the exact
// messages we asked it to sign, made by the key the person believes is theirs.
//
// The probe printing "SIGNED: 3 of 3" proves only that the vault returned 64
// bytes. Whether those bytes verify against the wallet's public key is a
// different question, and it is the one that matters: an instrument that lies
// is worse than no instrument.

import { readFileSync } from 'node:fs';
import { createPublicKey, verify } from 'node:crypto';
import { PublicKey } from '@solana/web3.js';

const payloads = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const signatures = JSON.parse(readFileSync(process.argv[3], 'utf8'));

// Node wants an SPKI-wrapped key; an ed25519 public key is those 32 raw bytes
// behind a fixed 12-byte header.
const SPKI_ED25519_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
const raw = new PublicKey(payloads.user).toBytes();
const key = createPublicKey({
  key: Buffer.concat([SPKI_ED25519_PREFIX, Buffer.from(raw)]),
  format: 'der',
  type: 'spki',
});

let allGood = true;
payloads.payloads.forEach((payload, index) => {
  const message = Buffer.from(payload, 'base64');
  const signature = Buffer.from(signatures[index], 'base64');
  const ok = verify(null, message, key, signature);
  if (!ok) allGood = false;
  console.log(`part ${index}: ${ok ? 'VALID' : 'INVALID'}  signature ${signature.length}B over ${message.length}B message`);
});

console.log(allGood
  ? `\nAll ${signatures.length} signatures verify against ${payloads.user}.`
  : '\nAt least one signature does not verify.');
process.exit(allGood ? 0 : 1);
