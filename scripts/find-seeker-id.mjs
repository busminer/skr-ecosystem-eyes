// Looks for the Seeker ID that belongs to a wallet.
//
// The .skr name lives on chain, not in the wallet app, so we walk the wallet's
// token accounts, read each Metaplex metadata account, and keep whatever calls
// itself a .skr name. Public RPC only, no keys.

import { Connection, PublicKey } from '@solana/web3.js';

const RPC = 'https://api.mainnet-beta.solana.com';
const METADATA_PROGRAM = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');
const TOKEN_PROGRAM = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const TOKEN_2022 = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');

function readMetadataName(data) {
  // key(1) + updateAuthority(32) + mint(32) = 65, then borsh strings.
  let offset = 65;
  const readString = () => {
    const length = data.readUInt32LE(offset);
    offset += 4;
    const value = data.subarray(offset, offset + length).toString('utf8').replace(/\0+$/, '').trim();
    offset += length;
    return value;
  };
  const name = readString();
  const symbol = readString();
  const uri = readString();
  return { name, symbol, uri };
}

const wallet = new PublicKey(process.argv[2]);
const connection = new Connection(RPC, 'confirmed');

const holdings = [];
for (const programId of [TOKEN_PROGRAM, TOKEN_2022]) {
  const accounts = await connection.getParsedTokenAccountsByOwner(wallet, { programId }).catch(() => ({ value: [] }));
  for (const entry of accounts.value) {
    const info = entry.account.data.parsed.info;
    if (info.tokenAmount.decimals === 0 && Number(info.tokenAmount.amount) > 0) holdings.push(info.mint);
  }
}

console.log('non-fungible holdings:', holdings.length);

const pdas = holdings.map((mint) => PublicKey.findProgramAddressSync(
  [Buffer.from('metadata'), METADATA_PROGRAM.toBuffer(), new PublicKey(mint).toBuffer()],
  METADATA_PROGRAM,
)[0]);

for (let index = 0; index < pdas.length; index += 100) {
  const slice = pdas.slice(index, index + 100);
  const infos = await connection.getMultipleAccountsInfo(slice);
  infos.forEach((account, position) => {
    if (!account) return;
    try {
      const meta = readMetadataName(account.data);
      console.log(`${holdings[index + position]}  ${meta.name} | ${meta.symbol} | ${meta.uri}`);
    } catch {
      console.log(`${holdings[index + position]}  <unreadable metadata>`);
    }
  });
}
