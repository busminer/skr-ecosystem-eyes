import test from 'node:test';
import assert from 'node:assert/strict';
import { buildProvenance } from '../src/provenance.js';
import { MINT, PROGRAM_ID, STAKE_CONFIG, STAKE_VAULT } from '../src/constants.js';

test('buildProvenance maps primary metrics to finalized source accounts and slots', () => {
  const provenance = buildProvenance({
    metrics: { updatedAt: 1_800_000_000 },
    analytics: { coverageFrom: 1_799_900_000 },
    sourceSlots: { stakeConfig: 101, stakeVault: 102, mint: 103, userStake: 104 },
  });

  assert.deepEqual(provenance.activeStaked.sources, [{ label: 'Stake Config PDA', account: STAKE_CONFIG, slot: 101 }]);
  assert.match(provenance.activeStaked.derivation, /total shares/i);
  assert.equal(provenance.activeStaked.commitment, 'finalized');
  assert.equal(provenance.activeStaked.observedAt, 1_800_000_000);

  assert.deepEqual(provenance.pendingUnstake.sources, [{ label: 'UserStake accounts', account: PROGRAM_ID, slot: 104 }]);
  assert.match(provenance.pendingUnstake.derivation, /complete filtered scan/i);
  assert.deepEqual(provenance.vaultBalance.sources, [{ label: 'Stake Vault token account', account: STAKE_VAULT, slot: 102 }]);
  assert.deepEqual(provenance.stakedPercent.sources, [
    { label: 'Stake Config PDA', account: STAKE_CONFIG, slot: 101 },
    { label: 'SKR mint', account: MINT, slot: 103 },
  ]);
});

test('buildProvenance makes local event coverage and historical unstake caveat explicit', () => {
  const provenance = buildProvenance({
    metrics: { updatedAt: 1_800_000_000 },
    analytics: { coverageFrom: 1_799_900_000 },
    sourceSlots: {},
  });

  assert.equal(provenance.flow24h.coverageFrom, 1_799_900_000);
  assert.match(provenance.flow24h.caveat, /local index/i);
  assert.match(provenance.eventAmount.caveat, /unstake/i);
});

test('buildProvenance marks UserStake scans as single-response best-effort', () => {
  const provenance = buildProvenance({
    metrics: { updatedAt: 1_800_000_000 },
    analytics: {},
    sourceSlots: { userStake: 55 },
    scan: {
      userStakeMode: 'single-response-filtered',
      userStakeAccountCount: 42,
      userStakeCaveat: 'RPC providers can truncate oversized responses',
    },
  });

  assert.equal(provenance.pendingUnstake.scanMode, 'single-response-filtered');
  assert.match(provenance.pendingUnstake.derivation, /42 UserStake accounts/i);
  assert.match(provenance.pendingUnstake.caveat, /truncate/i);
  assert.match(provenance.unlockHorizon.caveat, /truncate/i);
  assert.match(provenance.guardianPools.caveat, /truncate/i);
});

test('buildProvenance records a complete paginated UserStake scan', () => {
  const provenance = buildProvenance({
    metrics: { updatedAt: 1_800_000_000 },
    analytics: {},
    sourceSlots: { userStake: 700 },
    scan: {
      userStakeMode: 'paginated-filtered',
      userStakeAccountCount: 49873,
      userStakePageCount: 4,
      userStakeCaveat: null,
    },
  });

  assert.equal(provenance.pendingUnstake.scanMode, 'paginated-filtered');
  assert.match(provenance.pendingUnstake.derivation, /49873 UserStake accounts.*4 paginated/i);
  assert.equal(provenance.pendingUnstake.caveat, null);
});

test('buildProvenance remains safe before the first metrics snapshot exists', () => {
  const provenance = buildProvenance({ metrics: null, analytics: null, sourceSlots: null });
  assert.equal(provenance.activeStaked.observedAt, null);
  assert.equal(provenance.activeStaked.sources[0].slot, null);
  assert.match(provenance.pendingUnstake.caveat, /getProgramAccounts/i);
});
