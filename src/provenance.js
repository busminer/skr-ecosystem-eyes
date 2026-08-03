import { MINT, PROGRAM_ID, STAKE_CONFIG, STAKE_VAULT } from './constants.js';

const USER_STAKE_SCAN_CAVEAT = 'UserStake totals come from one finalized getProgramAccounts response filtered by dataSize=169. This is a complete filtered scan of the returned set, but RPC providers can truncate oversized responses without a follow-up page; if that happens aggregates may under-count until the next successful full scan.';

export function buildProvenance({ metrics = {}, analytics = {}, sourceSlots = {}, scan = {} } = {}) {
  metrics ||= {};
  analytics ||= {};
  sourceSlots ||= {};
  scan ||= {};
  const observedAt = metrics.updatedAt || null;
  const source = (label, account, slot) => ({ label, account, slot: slot ?? null });
  const record = ({ title, sources, derivation, accuracy = 'Exact arithmetic from the reported finalized source slot(s)', caveat = null, coverageFrom = null, scanMode = null }) => ({
    title,
    commitment: 'finalized',
    observedAt,
    sources,
    derivation,
    accuracy,
    caveat,
    coverageFrom,
    scanMode,
  });

  const config = source('Stake Config PDA', STAKE_CONFIG, sourceSlots.stakeConfig);
  const vault = source('Stake Vault token account', STAKE_VAULT, sourceSlots.stakeVault);
  const mint = source('SKR mint', MINT, sourceSlots.mint);
  const positions = source('UserStake accounts', PROGRAM_ID, sourceSlots.userStake);
  const program = source('SKR staking program transactions', PROGRAM_ID, null);
  const positionScanMode = scan.userStakeMode || 'single-response-filtered';
  const positionCaveat = Object.prototype.hasOwnProperty.call(scan, 'userStakeCaveat')
    ? scan.userStakeCaveat
    : USER_STAKE_SCAN_CAVEAT;
  const accountCount = Number.isFinite(scan.userStakeAccountCount) ? scan.userStakeAccountCount : null;
  const pageCount = Number.isFinite(scan.userStakePageCount) ? scan.userStakePageCount : null;
  const multiSlotCaveat = 'Inputs are individually finalized but may come from nearby, non-identical slots; every source slot is reported separately.';
  const combineCaveats = (...values) => values.filter(Boolean).join(' ');

  const positionDerivation = positionScanMode === 'paginated-filtered'
    ? `Sum of pending amounts from ${accountCount ?? 'all'} UserStake accounts returned across ${pageCount ?? 'all'} paginated finalized getProgramAccounts responses.`
    : accountCount == null
      ? 'Sum of pending amounts from the complete filtered scan of UserStake accounts returned by one finalized getProgramAccounts call.'
      : `Sum of pending amounts from the complete filtered scan of ${accountCount} UserStake accounts returned by one finalized getProgramAccounts call.`;

  return {
    activeStaked: record({
      title: 'Active staked',
      sources: [config],
      derivation: 'Stake Config total shares × finalized share price, scaled to 6-decimal SKR.',
    }),
    sharePrice: record({
      title: 'Share price',
      sources: [config],
      derivation: 'Stake Config share_price_raw ÷ 1,000,000,000.',
    }),
    stakedPercent: record({
      title: 'Supply capture',
      sources: [config, mint],
      derivation: 'Active staked SKR ÷ finalized SKR mint supply × 100.',
      caveat: multiSlotCaveat,
    }),
    pendingUnstake: record({
      title: 'Pending unstake',
      sources: [positions],
      derivation: positionDerivation,
      caveat: positionCaveat,
      scanMode: positionScanMode,
    }),
    withdrawable: record({
      title: 'Withdrawable now',
      sources: [positions],
      derivation: 'Pending UserStake amounts whose unstake timestamp + configured cooldown is at or before observation time.',
      caveat: positionCaveat,
      scanMode: positionScanMode,
    }),
    unlockHorizon: record({
      title: '48-hour unlock horizon',
      sources: [positions, config],
      derivation: 'Complete filtered UserStake scan partitioned into ready, 0–6h, 6–12h, 12–24h and 24–48h maturity bands.',
      caveat: combineCaveats(positionCaveat, multiSlotCaveat),
      scanMode: positionScanMode,
    }),
    vaultBalance: record({
      title: 'Vault balance',
      sources: [vault],
      derivation: 'Finalized SPL token balance of the protocol Stake Vault.',
    }),
    guardianPools: record({
      title: 'Guardian concentration',
      sources: [positions, config],
      derivation: 'Active shares grouped by Guardian pool and converted with the finalized share price.',
      caveat: combineCaveats(positionCaveat, multiSlotCaveat),
      scanMode: positionScanMode,
    }),
    flow24h: record({
      title: 'Indexed capital flow',
      sources: [program],
      derivation: 'Locally indexed finalized stake, unstake and withdraw instructions inside the selected time window.',
      accuracy: 'Exact for indexed stake and withdraw amounts; historical unstake SKR is estimated with the current share price.',
      caveat: 'Coverage is limited to the local index and must not be interpreted before coverageFrom.',
      coverageFrom: analytics.coverageFrom || null,
    }),
    eventAmount: record({
      title: 'Event amount evidence',
      sources: [program],
      derivation: 'Stake comes from instruction data; withdraw comes from the finalized vault token-balance delta.',
      accuracy: 'Exact for stake and withdraw; cancel_unstake has no amount until state-delta reconstruction is implemented.',
      caveat: 'Historical unstake SKR is approximate because the current share price is used.',
      coverageFrom: analytics.coverageFrom || null,
    }),
  };
}

export { USER_STAKE_SCAN_CAVEAT };
