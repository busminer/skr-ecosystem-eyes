export const PROGRAM_ID = 'SKRskrmtL83pcL4YqLWt6iPefDqwXQWHSw9S9vz94BZ';
export const MINT = 'SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3';
export const STAKE_CONFIG = '4HQy82s9CHTv1GsYKnANHMiHfhcqesYkK6sB3RDSYyqw';
export const STAKE_VAULT = '8isViKbwhuhFhsv2t8vaFL74pKCqaFPQXo1KkeQwZbB8';
export const DEFAULT_GUARDIAN_POOL = 'DPJ58trLsF9yPrBa2pk6UaRkvqW8hWUYjawe788WBuqr';
export const TOKEN_DECIMALS = 6;
export const SHARE_SCALE = 1_000_000_000n;
export const DEFAULT_RPC_URL = 'https://api.mainnet-beta.solana.com';
export const UNSTAKE_COOLDOWN_SECONDS = 172_800;

export const INSTRUCTION_DISCRIMINATORS = Object.freeze({
  ceb0ca12c8d1b36c: 'stake',
  '5a5f6b2acd7c32e1': 'unstake',
  '404135e37d9903a7': 'cancel_unstake',
  b712469c946da122: 'withdraw',
});
