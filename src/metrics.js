import { encodeBase58 } from './base58.js';
import { decodeStakeConfig, sharesToRawTokens } from './decoder.js';
import { TOKEN_DECIMALS } from './constants.js';

const TOKEN_SCALE = 10n ** BigInt(TOKEN_DECIMALS);

function tokenAmount(raw) {
  const value = BigInt(raw);
  return Number(value / TOKEN_SCALE) + Number(value % TOKEN_SCALE) / Number(TOKEN_SCALE);
}

function parseUserStakeSlice(entry, cooldownSeconds, now) {
  try {
    const data = Buffer.from(entry.account.data[0], 'base64');
    if (data.length < 128) return null;
    const wallet = encodeBase58(data.subarray(0, 32));
    const guardianPool = encodeBase58(data.subarray(32, 64));
    const shares = data.readBigUInt64LE(64) + (data.readBigUInt64LE(72) << 64n);
    const pendingRaw = data.readBigUInt64LE(112);
    const unstakeTimestamp = Number(data.readBigInt64LE(120));
    const unlockAt = pendingRaw > 0n ? unstakeTimestamp + cooldownSeconds : null;
    return {
      stakeAccount: entry.pubkey,
      wallet,
      guardianPool,
      shares,
      pendingRaw,
      unstakeTimestamp,
      unlockAt,
      status: pendingRaw === 0n ? null : unlockAt <= now ? 'withdrawable' : 'cooldown',
    };
  } catch {
    return null;
  }
}

export function summarizeOnChainState({ configData, vaultRaw, supplyRaw, userStakeAccounts = [], now = Math.floor(Date.now() / 1000) }) {
  const config = decodeStakeConfig(configData);
  const activeStakedRaw = sharesToRawTokens(config.totalSharesRaw, config.sharePriceRaw);
  const positions = userStakeAccounts
    .map((entry) => parseUserStakeSlice(entry, config.cooldownSeconds, now))
    .filter(Boolean);
  const queuePositions = positions.filter((position) => position.pendingRaw > 0n);
  const pendingRaw = queuePositions.reduce((sum, position) => sum + position.pendingRaw, 0n);
  const withdrawableRaw = queuePositions
    .filter((position) => position.status === 'withdrawable')
    .reduce((sum, position) => sum + position.pendingRaw, 0n);
  const unlockHorizonRaw = { ready: 0n, next6h: 0n, next12h: 0n, next24h: 0n, next48h: 0n };
  for (const position of queuePositions) {
    const secondsUntilUnlock = position.unlockAt - now;
    if (secondsUntilUnlock <= 0) unlockHorizonRaw.ready += position.pendingRaw;
    else if (secondsUntilUnlock <= 6 * 3_600) unlockHorizonRaw.next6h += position.pendingRaw;
    else if (secondsUntilUnlock <= 12 * 3_600) unlockHorizonRaw.next12h += position.pendingRaw;
    else if (secondsUntilUnlock <= 24 * 3_600) unlockHorizonRaw.next24h += position.pendingRaw;
    else unlockHorizonRaw.next48h += position.pendingRaw;
  }
  const supply = tokenAmount(supplyRaw);
  const activeStaked = tokenAmount(activeStakedRaw);
  const guardianMap = new Map();
  for (const position of positions.filter((item) => item.shares > 0n)) {
    const current = guardianMap.get(position.guardianPool) || { shares: 0n, positions: 0 };
    current.shares += position.shares;
    current.positions += 1;
    guardianMap.set(position.guardianPool, current);
  }
  const guardianPools = [...guardianMap.entries()]
    .map(([guardianPool, item]) => ({
      guardianPool,
      activeRaw: sharesToRawTokens(item.shares, config.sharePriceRaw),
      positions: item.positions,
    }))
    .sort((a, b) => a.activeRaw === b.activeRaw ? 0 : a.activeRaw > b.activeRaw ? -1 : 1);

  return {
    activeStaked,
    vaultBalance: tokenAmount(vaultRaw),
    vaultExcess: tokenAmount(BigInt(vaultRaw) > activeStakedRaw ? BigInt(vaultRaw) - activeStakedRaw : 0n),
    supply,
    stakedPercent: supply > 0 ? activeStaked / supply * 100 : 0,
    sharePrice: Number(config.sharePriceRaw) / 1e9,
    rewardIndexPercent: (Number(config.sharePriceRaw) / 1e9 - 1) * 100,
    minimumStake: tokenAmount(config.minimumStakeRaw),
    cooldownSeconds: config.cooldownSeconds,
    pendingUnstake: tokenAmount(pendingRaw),
    withdrawable: tokenAmount(withdrawableRaw),
    totalPositions: positions.length,
    activePositions: positions.filter((position) => position.shares > 0n).length,
    pendingPositions: queuePositions.length,
    unlockHorizon: Object.fromEntries(
      Object.entries(unlockHorizonRaw).map(([band, amount]) => [band, tokenAmount(amount)]),
    ),
    guardians: {
      count: guardianPools.length,
      topConcentrationPercent: activeStakedRaw > 0n && guardianPools[0]
        ? Number(guardianPools[0].activeRaw * 1_000_000n / activeStakedRaw) / 10_000
        : 0,
      top: guardianPools.slice(0, 25).map(({ guardianPool, activeRaw, positions: count }) => ({
        guardianPool,
        activeStaked: tokenAmount(activeRaw),
        positions: count,
      })),
    },
    queue: queuePositions
      .sort((a, b) => a.pendingRaw === b.pendingRaw ? 0 : a.pendingRaw > b.pendingRaw ? -1 : 1)
      .slice(0, 25)
      .map((position) => ({
        stakeAccount: position.stakeAccount,
        wallet: position.wallet,
        amount: tokenAmount(position.pendingRaw),
        unstakeTimestamp: position.unstakeTimestamp,
        unlockAt: position.unlockAt,
        status: position.status,
      })),
    updatedAt: now,
  };
}
