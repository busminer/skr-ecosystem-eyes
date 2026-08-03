import { decodeStakeConfig, sharesToRawTokens } from './decoder.js';
import { TOKEN_DECIMALS } from './constants.js';

function decimal(raw, decimals) {
  const value = BigInt(raw);
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const scale = 10n ** BigInt(decimals);
  const whole = absolute / scale;
  const fraction = String(absolute % scale).padStart(decimals, '0').replace(/0+$/, '');
  return `${negative ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`;
}

export function buildProtocolSnapshot({ configData, vaultRaw, sourceSlots = {}, unixTs = Math.floor(Date.now() / 1000) }) {
  const config = decodeStakeConfig(configData);
  const activeRaw = sharesToRawTokens(config.totalSharesRaw, config.sharePriceRaw);
  const sharePrice = decimal(config.sharePriceRaw, 9);
  const rewardIndexRaw = config.sharePriceRaw - 1_000_000_000n;
  return {
    slot: Number(sourceSlots.stakeConfig ?? sourceSlots.stakeVault),
    unixTs: Number(unixTs),
    sharePrice,
    totalShares: decimal(config.totalSharesRaw, TOKEN_DECIMALS),
    activeStaked: decimal(activeRaw, TOKEN_DECIMALS),
    vaultBalance: decimal(vaultRaw, TOKEN_DECIMALS),
    rewardIndex: decimal(rewardIndexRaw, 7),
  };
}
