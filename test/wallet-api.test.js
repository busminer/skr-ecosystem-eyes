import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveWalletProfile } from '../src/wallet-api.js';

const WALLET = '11111111111111111111111111111111';

test('wallet profile API rejects malformed public keys before indexer access', () => {
  let called = false;
  const result = resolveWalletProfile({ getWalletProfile() { called = true; } }, 'not-a-wallet');
  assert.equal(result.status, 400);
  assert.deepEqual(result.payload, { error: 'Invalid Solana public key' });
  assert.equal(called, false);
});

test('wallet profile API reports indexer readiness honestly', () => {
  const publicStatus = { freshness: 'unavailable', phase: 'starting' };
  const result = resolveWalletProfile({
    getWalletProfile() { return null; },
    publicStatus() { return publicStatus; },
  }, WALLET);
  assert.equal(result.status, 503);
  assert.deepEqual(result.payload, { error: 'Wallet profile is not ready', status: publicStatus });
});

test('wallet profile API returns an exact ready profile unchanged', () => {
  const profile = {
    wallet: WALLET,
    found: true,
    totals: { activeStaked: 42 },
    provenance: { commitment: 'finalized', accuracy: 'exact' },
  };
  const result = resolveWalletProfile({ getWalletProfile() { return profile; } }, WALLET);
  assert.equal(result.status, 200);
  assert.equal(result.payload, profile);
});
