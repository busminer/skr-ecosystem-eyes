// Does a gift stake work? The Eye's buyer pays, and the SKR lands in the
// collection's own staking position, inside the buyer's own transaction.
//
// ONCHAIN.md says `Stake` needs no signature from the receiver, and the IDL
// layout backs it: account 3 `payer` signs, account 4 `user` does not, and the
// position PDA is derived from `user`. That is the whole idea of D-035, so it
// gets simulated before a single line of it reaches the app.
//
// Two questions, and nothing else:
//   1. Does the program accept payer != user (a gift into someone else's
//      position), when that position does not exist yet?
//   2. Account 5 is named `user_token_account`. Whose is it really — the
//      payer's ATA or the position owner's? The name says one thing and the
//      gift only works if it is the other.
//
// Read-only: simulateTransaction with sigVerify off. Nothing is signed and
// nothing is broadcast. Run: node scripts/sim-gift-stake.mjs
import { Connection, PublicKey, TransactionMessage, VersionedTransaction, Keypair, ComputeBudgetProgram } from '@solana/web3.js';

const RPC = process.env.RPC || 'https://api.mainnet-beta.solana.com';

const PROGRAM = new PublicKey('SKRskrmtL83pcL4YqLWt6iPefDqwXQWHSw9S9vz94BZ');
const SKR_MINT = new PublicKey('SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3');
const GUARDIAN_POOL = new PublicKey('DPJ58trLsF9yPrBa2pk6UaRkvqW8hWUYjawe788WBuqr');
const TOKEN_PROGRAM = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const ATA_PROGRAM = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
const SYSTEM = new PublicKey('11111111111111111111111111111111');
const EVENT_AUTHORITY = new PublicKey('8rUTGg1XoyuvK9G64S7d37m3HtLZH24oPeMmXkpJH8ir');

// From the on-chain IDL, recorded in docs/research/01-mechanics.md.
const STAKE_DISCRIMINATOR = Buffer.from([206, 176, 202, 18, 200, 209, 179, 108]);
// 100 SKR opens an Eye; a Blink costs 1 SKR, which is also the exact minimum
// stake the program allows, so simulating with it tests the tightest case.
const OPEN_SKR_UNITS = 100_000_000n;
const BLINK_SKR_UNITS = 1_000_000n;

const pda = (seeds) => PublicKey.findProgramAddressSync(seeds, PROGRAM)[0];
const ata = (owner) =>
  PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM.toBuffer(), SKR_MINT.toBuffer()],
    ATA_PROGRAM,
  )[0];

const u64 = (value) => {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64LE(value);
  return buffer;
};

// `stake`, exactly the twelve accounts in the IDL's order.
function stakeIx({ payer, user, userTokenAccount, stakeConfig, stakeVault, amount }) {
  const userStake = pda([Buffer.from('user_stake'), stakeConfig.toBuffer(), user.toBuffer(), GUARDIAN_POOL.toBuffer()]);
  return {
    userStake,
    ix: {
      programId: PROGRAM,
      keys: [
        { pubkey: userStake, isSigner: false, isWritable: true },
        { pubkey: stakeConfig, isSigner: false, isWritable: true },
        { pubkey: GUARDIAN_POOL, isSigner: false, isWritable: true },
        { pubkey: payer, isSigner: true, isWritable: true },
        { pubkey: user, isSigner: false, isWritable: false },
        { pubkey: userTokenAccount, isSigner: false, isWritable: true },
        { pubkey: stakeVault, isSigner: false, isWritable: true },
        { pubkey: SKR_MINT, isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM, isSigner: false, isWritable: false },
        { pubkey: SYSTEM, isSigner: false, isWritable: false },
        { pubkey: EVENT_AUTHORITY, isSigner: false, isWritable: false },
        { pubkey: PROGRAM, isSigner: false, isWritable: false },
      ],
      data: Buffer.concat([STAKE_DISCRIMINATOR, u64(amount)]),
    },
  };
}

async function simulate(connection, payer, instructions, label, blockhash) {
  const message = new TransactionMessage({ payerKey: payer, recentBlockhash: blockhash, instructions }).compileToV0Message();
  const tx = new VersionedTransaction(message);
  const size = tx.serialize().length;
  const result = await connection.simulateTransaction(tx, { sigVerify: false, replaceRecentBlockhash: true, commitment: 'confirmed' });
  const err = result.value.err;
  console.log(`\n--- ${label} ---`);
  console.log(`размер транзакции: ${size} байт из 1232`);
  console.log(`результат: ${err ? 'ОШИБКА ' + JSON.stringify(err) : 'OK, err: null'}`);
  const logs = result.value.logs || [];
  for (const line of logs.filter((l) => /Error|error|failed|Instruction:|insufficient/.test(l)).slice(0, 8)) {
    console.log('  ' + line);
  }
  return { err, size, logs };
}

const main = async () => {
  const connection = new Connection(RPC, 'confirmed');

  const stakeConfig = pda([Buffer.from('stake_config')]);
  const stakeVault = pda([Buffer.from('stake_vault')]);
  console.log('stake_config:', stakeConfig.toBase58(), stakeConfig.toBase58() === '4HQy82s9CHTv1GsYKnANHMiHfhcqesYkK6sB3RDSYyqw' ? '(сходится с ONCHAIN.md)' : '(НЕ СХОДИТСЯ)');
  console.log('stake_vault: ', stakeVault.toBase58(), stakeVault.toBase58() === '8isViKbwhuhFhsv2t8vaFL74pKCqaFPQXo1KkeQwZbB8' ? '(сходится)' : '(НЕ СХОДИТСЯ)');

  // The maker's own wallet stands in for a buyer: its SKR account holds the
  // 1 SKR of Alex's own Blink, which is both the Blink price and the exact
  // minimum stake, so one simulation answers both questions at once. The
  // public RPC rate-limits account lookups, so these come from txCheck.ts.
  const payer = new PublicKey('BmJaEmaEURBDpj91GUTvJcpKy2MAu8ZtRFRPaMpEuuax');
  const payerSkr = new PublicKey('CmTWwMrSusqhxrABLMnMfTKnZHosoHWczRbnsj5cLGX4');
  console.log('плательщик:', payer.toBase58(), '(1 SKR на счету)');
  console.log('его ATA совпадает с MAKER_SKR_ACCOUNT:', ata(payer).equals(payerSkr) ? 'да' : `НЕТ, вывелось ${ata(payer).toBase58()}`);

  // The collection's treasury: a wallet with no position yet, exactly as it
  // would be on the day we switch this on.
  const treasury = Keypair.generate().publicKey;
  console.log('казна (свежий кошелёк, позиции ещё нет):', treasury.toBase58());

  const priority = ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1 });
  const limit = ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 });

  const { blockhash } = await connection.getLatestBlockhash();

  // Вопрос 2, вариант А: токены берём с ATA плательщика.
  const a = stakeIx({ payer, user: treasury, userTokenAccount: payerSkr, stakeConfig, stakeVault, amount: BLINK_SKR_UNITS });
  console.log('позиция казны (PDA):', a.userStake.toBase58());
  await simulate(connection, payer, [limit, priority, a.ix], 'А: подарок в чужую позицию, токены с ATA ПЛАТЕЛЬЩИКА', blockhash);

  // Вариант Б: токены берём с ATA владельца позиции, как намекает имя аккаунта.
  const b = stakeIx({ payer, user: treasury, userTokenAccount: ata(treasury), stakeConfig, stakeVault, amount: BLINK_SKR_UNITS });
  await simulate(connection, payer, [limit, priority, b.ix], 'Б: подарок в чужую позицию, токены с ATA ВЛАДЕЛЬЦА ПОЗИЦИИ', blockhash);

  // Контроль: обычный стейк себе. Если и он падает, дело в раскладке, а не в подарке.
  const c = stakeIx({ payer, user: payer, userTokenAccount: payerSkr, stakeConfig, stakeVault, amount: BLINK_SKR_UNITS });
  await simulate(connection, payer, [limit, priority, c.ix], 'В (контроль): обычный стейк себе', blockhash);

  // Сколько места стейк съедает в транзакции открытия глаза: Core create +
  // перевод SKR уже лежат там, и кошелёк Seeker дописывает своё сверху.
  console.log('\n--- запас по размеру ---');
  console.log('одна инструкция stake добавляет 12 аккаунтов и 16 байт данных;');
  console.log('точный размер полной транзакции считаем на builder-е eye-mint, задача в TASKS.');
};

main().catch((e) => {
  console.error('упало:', e.message);
  process.exit(1);
});
