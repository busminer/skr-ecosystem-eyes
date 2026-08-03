import assert from 'node:assert/strict';
import test from 'node:test';
import { formatAmount, walletFromPath, walletPath } from '../public/wallet-profile.js';

test('wallet page helpers preserve shareable public-key routes', () => {
  const wallet = '11111111111111111111111111111111';
  assert.equal(walletPath(wallet), `/w/${wallet}`);
  assert.equal(walletFromPath(`/w/${wallet}`), wallet);
  assert.equal(walletFromPath('/w/'), '');
  assert.equal(walletFromPath('/wallet.html'), '');
});

test('wallet page amounts remain precise without raw floating noise', () => {
  assert.equal(formatAmount(1234.56789), '1,234.568');
  assert.equal(formatAmount(null), '0');
});
