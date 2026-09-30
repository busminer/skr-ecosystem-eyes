// Does the stake instruction still fit inside the Eye's real transaction?
//
// D-035 puts `Stake` into the very transaction the buyer signs. The buyer's
// wallet on the Seeker then REWRITES that transaction, adding ComputeBudget
// twice and a Lighthouse guard, so the room we leave is not the room we get.
// This takes the server's own transactions from scripts/fixtures/eye-tx.json,
// appends the stake instruction and measures, against the 1232-byte limit.
//
// Run: node scripts/sim-stake-fits.mjs
import { readFileSync } from 'node:fs';
import { PublicKey, VersionedTransaction, Transaction, TransactionMessage } from '@solana/web3.js';

const LIMIT = 1232;
const PROGRAM = new PublicKey('SKRskrmtL83pcL4YqLWt6iPefDqwXQWHSw9S9vz94BZ');
const SKR_MINT = new PublicKey('SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3');
const GUARDIAN_POOL = new PublicKey('DPJ58trLsF9yPrBa2pk6UaRkvqW8hWUYjawe788WBuqr');
const TOKEN_PROGRAM = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const SYSTEM = new PublicKey('11111111111111111111111111111111');
const EVENT_AUTHORITY = new PublicKey('8rUTGg1XoyuvK9G64S7d37m3HtLZH24oPeMmXkpJH8ir');
const STAKE_CONFIG = new PublicKey('4HQy82s9CHTv1GsYKnANHMiHfhcqesYkK6sB3RDSYyqw');
const STAKE_VAULT = new PublicKey('8isViKbwhuhFhsv2t8vaFL74pKCqaFPQXo1KkeQwZbB8');
const DISC = Buffer.from([206, 176, 202, 18, 200, 209, 179, 108]);

// What the Seeker's wallet adds on top before the person signs: two
// ComputeBudget instructions and a Lighthouse guard. Measured generously —
// Lighthouse grows with how much it asserts.
const WALLET_REWRITE_BYTES = { 'ComputeBudget ×2': 24, 'Lighthouse (щедро)': 210 };

const fixture = JSON.parse(readFileSync(new URL('./fixtures/eye-tx.json', import.meta.url), 'utf8'));

function decode(base64) {
  const raw = Buffer.from(base64, 'base64');
  try {
    const tx = VersionedTransaction.deserialize(raw);
    return { kind: 'v0', message: TransactionMessage.decompile(tx.message), raw };
  } catch {
    const legacy = Transaction.from(raw);
    return {
      kind: 'legacy',
      message: new TransactionMessage({
        payerKey: legacy.feePayer ?? legacy.instructions[0].keys[0].pubkey,
        recentBlockhash: legacy.recentBlockhash,
        instructions: legacy.instructions,
      }),
      raw,
    };
  }
}

function stakeIx(payer, treasury, payerSkr) {
  const userStake = PublicKey.findProgramAddressSync(
    [Buffer.from('user_stake'), STAKE_CONFIG.toBuffer(), treasury.toBuffer(), GUARDIAN_POOL.toBuffer()],
    PROGRAM,
  )[0];
  const data = Buffer.concat([DISC, Buffer.alloc(8)]);
  return {
    programId: PROGRAM,
    keys: [
      { pubkey: userStake, isSigner: false, isWritable: true },
      { pubkey: STAKE_CONFIG, isSigner: false, isWritable: true },
      { pubkey: GUARDIAN_POOL, isSigner: false, isWritable: true },
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: treasury, isSigner: false, isWritable: false },
      { pubkey: payerSkr, isSigner: false, isWritable: true },
      { pubkey: STAKE_VAULT, isSigner: false, isWritable: true },
      { pubkey: SKR_MINT, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM, isSigner: false, isWritable: false },
      { pubkey: SYSTEM, isSigner: false, isWritable: false },
      { pubkey: EVENT_AUTHORITY, isSigner: false, isWritable: false },
      { pubkey: PROGRAM, isSigner: false, isWritable: false },
    ],
    data,
  };
}

const treasury = new PublicKey('4sa5Rsxw3jpankMaCjJZyLMp1FkU2TDJVE32kBcYWTaC');
const payerSkr = new PublicKey('CmTWwMrSusqhxrABLMnMfTKnZHosoHWczRbnsj5cLGX4');
const rewrite = Object.values(WALLET_REWRITE_BYTES).reduce((a, b) => a + b, 0);

console.log(`Предел транзакции Solana: ${LIMIT} байт`);
console.log(`Кошелёк Seeker дописывает сверху: ${rewrite} байт (${Object.entries(WALLET_REWRITE_BYTES).map(([k, v]) => `${k} ${v}`).join(', ')})\n`);

for (const name of ['open', 'blink']) {
  if (!fixture[name]) continue;
  const { message, raw, kind } = decode(fixture[name]);
  const payer = message.payerKey;
  const before = raw.length;

  message.instructions.push(stakeIx(payer, treasury, payerSkr));
  const grown = new VersionedTransaction(message.compileToV0Message());
  // Подписей столько же, сколько было: стейк не добавляет подписантов.
  const after = grown.serialize().length;

  const total = after + rewrite;
  const verdict = total <= LIMIT ? 'ВЛЕЗАЕТ' : 'НЕ ВЛЕЗАЕТ';
  console.log(`${name} (${kind}):`);
  console.log(`  сейчас                       ${before} байт`);
  console.log(`  со стейком                   ${after} байт  (+${after - before})`);
  console.log(`  со стейком и правкой кошелька ${total} байт  -> ${verdict}, запас ${LIMIT - total}`);
  console.log('');
}
