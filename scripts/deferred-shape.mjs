// Prints the exact byte shape of a deferred stake part, so the gateway rules
// are written against real bytes instead of memory.
import { PublicKey } from '@solana/web3.js';
import { buildDeferredStake, deriveAnchors } from './.node/deferred.ts';
import { DEFAULT_GUARDIAN_POOL } from '../src/lab/stake/stakeTx.ts';

const user = new PublicKey(process.argv[2] ?? 'BmJaEmaEURBDpj91GUTvJcpKy2MAu8ZtRFRPaMpEuuax');
const [anchor] = await deriveAnchors(user, 1);
const tx = buildDeferredStake({
  user,
  guardianPool: DEFAULT_GUARDIAN_POOL,
  amountRaw: 1_000_000n,
  anchorAddress: anchor.address,
  anchorValue: '11111111111111111111111111111112',
});
const m = tx.message;
console.log('version', m.version, 'header', JSON.stringify(m.header));
console.log('static accounts', m.staticAccountKeys.length);
m.staticAccountKeys.forEach((k, i) => console.log('  ', i, k.toBase58()));
m.compiledInstructions.forEach((ix, i) => {
  console.log(`instruction ${i}: program[${ix.programIdIndex}]=${m.staticAccountKeys[ix.programIdIndex].toBase58()}`);
  console.log(`   accountIndexes=${JSON.stringify(ix.accountKeyIndexes)} dataBytes=${ix.data.length} data=${Buffer.from(ix.data).toString('hex')}`);
});
console.log('message bytes', m.serialize().length);
