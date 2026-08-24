// Builds a stake transaction exactly the way the phone will, signs it with a
// throwaway key, and runs it through the real gateway validator copied from
// production. Nothing is ever sent: this only proves the byte layout.

import {
  Keypair,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import { validateSignedStakeTransaction } from './stake-gateway.js';
import { MINT as MINT_ID, PROGRAM_ID as PROGRAM, STAKE_CONFIG as CONFIG_ID, STAKE_VAULT as VAULT_ID } from './constants.js';

const PROGRAM_ID = new PublicKey(PROGRAM);
const MINT = new PublicKey(MINT_ID);
const STAKE_CONFIG = new PublicKey(CONFIG_ID);
const STAKE_VAULT = new PublicKey(VAULT_ID);
const GUARDIAN_POOL = new PublicKey('DPJ58trLsF9yPrBa2pk6UaRkvqW8hWUYjawe788WBuqr');
const TOKEN_PROGRAM = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const ASSOCIATED_TOKEN_PROGRAM = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
const SYSTEM_PROGRAM = new PublicKey('11111111111111111111111111111111');
const STAKE_DISCRIMINATOR = Buffer.from([206, 176, 202, 18, 200, 209, 179, 108]);

function stakeInstruction({ user, guardianPool, amountRaw }) {
  const [userStake] = PublicKey.findProgramAddressSync(
    [Buffer.from('user_stake'), STAKE_CONFIG.toBuffer(), user.toBuffer(), guardianPool.toBuffer()],
    PROGRAM_ID,
  );
  const [eventAuthority] = PublicKey.findProgramAddressSync([Buffer.from('__event_authority')], PROGRAM_ID);
  const [userTokenAccount] = PublicKey.findProgramAddressSync(
    [user.toBuffer(), TOKEN_PROGRAM.toBuffer(), MINT.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM,
  );

  const data = Buffer.alloc(16);
  STAKE_DISCRIMINATOR.copy(data, 0);
  data.writeBigUInt64LE(BigInt(amountRaw), 8);

  return {
    eventAuthority,
    userStake,
    userTokenAccount,
    instruction: new TransactionInstruction({
      programId: PROGRAM_ID,
      data,
      keys: [
        { pubkey: userStake, isSigner: false, isWritable: true },
        { pubkey: STAKE_CONFIG, isSigner: false, isWritable: true },
        { pubkey: guardianPool, isSigner: false, isWritable: true },
        { pubkey: user, isSigner: true, isWritable: true },
        { pubkey: user, isSigner: true, isWritable: true },
        { pubkey: userTokenAccount, isSigner: false, isWritable: true },
        { pubkey: STAKE_VAULT, isSigner: false, isWritable: true },
        { pubkey: MINT, isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM, isSigner: false, isWritable: false },
        { pubkey: SYSTEM_PROGRAM, isSigner: false, isWritable: false },
        { pubkey: eventAuthority, isSigner: false, isWritable: false },
        { pubkey: PROGRAM_ID, isSigner: false, isWritable: false },
      ],
    }),
  };
}

const payer = Keypair.generate();
const { instruction, userStake, userTokenAccount, eventAuthority } = stakeInstruction({
  user: payer.publicKey,
  guardianPool: GUARDIAN_POOL,
  amountRaw: 1_000_000n,
});

// A real blockhash is not needed to prove the layout; any non-zero 32 bytes do.
const message = new TransactionMessage({
  payerKey: payer.publicKey,
  recentBlockhash: new PublicKey(Keypair.generate().publicKey).toBase58(),
  instructions: [instruction],
}).compileToV0Message();

const transaction = new VersionedTransaction(message);
transaction.sign([payer]);
const wire = Buffer.from(transaction.serialize()).toString('base64');

console.log('derived user_stake       ', userStake.toBase58());
console.log('derived event_authority  ', eventAuthority.toBase58());
console.log('derived user token acct  ', userTokenAccount.toBase58());
console.log('wire bytes               ', Buffer.from(transaction.serialize()).length);

try {
  const inspected = validateSignedStakeTransaction(wire, { minimumStakeRaw: 1_000_000n });
  console.log('VALIDATOR: PASS');
  console.log('  amountRaw    ', inspected.amountRaw.toString());
  console.log('  guardianPool ', inspected.guardianPool);
  console.log('  signature    ', inspected.signature);
} catch (error) {
  console.log('VALIDATOR: FAIL —', error.message);
}
