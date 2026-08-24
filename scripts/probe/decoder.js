import { decodeBase58 } from './base58.js';
import { INSTRUCTION_DISCRIMINATORS, SHARE_SCALE, TOKEN_DECIMALS } from './constants.js';

function readU128LE(buffer, offset) {
  if (buffer.length < offset + 16) throw new RangeError('Missing u128 bytes');
  return buffer.readBigUInt64LE(offset) + (buffer.readBigUInt64LE(offset + 8) << 64n);
}

function displayAmount(rawAmount) {
  return Number(rawAmount) / 10 ** TOKEN_DECIMALS;
}

export function decodeInstructionData(encoded, sharePriceRaw = SHARE_SCALE) {
  try {
    const data = decodeBase58(encoded);
    if (data.length < 8) return null;
    const type = INSTRUCTION_DISCRIMINATORS[data.subarray(0, 8).toString('hex')];
    if (!type) return null;

    if (type === 'stake') {
      if (data.length !== 16) return null;
      const rawAmount = data.readBigUInt64LE(8);
      return { type, rawAmount, rawShares: null, amount: displayAmount(rawAmount) };
    }

    if (type === 'unstake') {
      if (data.length !== 24) return null;
      const rawShares = readU128LE(data, 8);
      const rawAmount = (rawShares * BigInt(sharePriceRaw)) / SHARE_SCALE;
      return { type, rawAmount, rawShares, amount: displayAmount(rawAmount) };
    }

    if (data.length !== 8) return null;
    return { type, rawAmount: null, rawShares: null, amount: null };
  } catch {
    return null;
  }
}

export function decodeStakeConfig(data) {
  if (!Buffer.isBuffer(data) || data.length < 153) throw new Error('Invalid StakeConfig account data');
  return {
    minimumStakeRaw: data.readBigUInt64LE(105),
    cooldownSeconds: Number(data.readBigUInt64LE(113)),
    totalSharesRaw: readU128LE(data, 121),
    sharePriceRaw: readU128LE(data, 137),
  };
}

export function sharesToRawTokens(shares, sharePrice) {
  return (BigInt(shares) * BigInt(sharePrice)) / SHARE_SCALE;
}
