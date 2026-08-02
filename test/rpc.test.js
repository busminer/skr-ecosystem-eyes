import test from 'node:test';
import assert from 'node:assert/strict';
import { SolanaRpc } from '../src/rpc.js';

test('SolanaRpc core and UserStake snapshots preserve finalized source slots', async () => {
  const rpc = new SolanaRpc('https://example.invalid');
  const calls = [];
  rpc.call = async (method, params) => {
    calls.push({ method, params });
    if (method === 'getAccountInfo') return { context: { slot: 101 }, value: { data: [Buffer.from('config').toString('base64'), 'base64'] } };
    if (method === 'getTokenAccountBalance') return { context: { slot: 102 }, value: { amount: '2000000' } };
    if (method === 'getTokenSupply') return { context: { slot: 103 }, value: { amount: '3000000' } };
    if (method === 'getProgramAccounts') return { context: { slot: 104 }, value: [{ pubkey: 'stake-account' }] };
    throw new Error(`Unexpected method ${method}`);
  };

  const core = await rpc.getCoreInputs();
  const positions = await rpc.getUserStakeAccounts();

  assert.deepEqual(core.sourceSlots, { stakeConfig: 101, stakeVault: 102, mint: 103 });
  assert.deepEqual(positions, {
    accounts: [{ pubkey: 'stake-account' }],
    slot: 104,
    pageCount: 1,
    paginated: false,
  });
  for (const call of calls) {
    const options = call.params.at(-1);
    assert.equal(options.commitment, 'finalized');
  }
  assert.equal(calls.find((call) => call.method === 'getProgramAccounts').params[1].withContext, true);
});

test('SolanaRpc paginates getProgramAccounts when the provider returns pageKey', async () => {
  const rpc = new SolanaRpc('https://public.example.invalid', 'https://scan.example.invalid');
  const calls = [];
  rpc.call = async (method, params, attempts, url) => {
    calls.push({ method, params, attempts, url });
    return calls.length === 1
      ? { context: { slot: 200 }, value: [{ pubkey: 'a' }], pageKey: 'next-1' }
      : { context: { slot: 200 }, value: [{ pubkey: 'b' }] };
  };

  const result = await rpc.getUserStakeAccounts();

  assert.deepEqual(result, {
    accounts: [{ pubkey: 'a' }, { pubkey: 'b' }],
    slot: 200,
    pageCount: 2,
    paginated: true,
  });
  assert.equal(calls[0].params[1].pageKey, undefined);
  assert.equal(calls[1].params[1].pageKey, 'next-1');
  assert.equal(calls[1].params[1].commitment, 'finalized');
  assert.equal(calls[0].url, 'https://scan.example.invalid');
  assert.equal(calls[1].url, 'https://scan.example.invalid');
});

test('SolanaRpc event evidence requests finalized signatures and transactions', async () => {
  const rpc = new SolanaRpc('https://example.invalid');
  const calls = [];
  rpc.call = async (method, params) => {
    calls.push({ method, params });
    return [];
  };

  await rpc.getRecentSignatures(5);
  await rpc.getTransaction('signature');

  assert.equal(calls[0].params[1].commitment, 'finalized');
  assert.equal(calls[1].params[1].commitment, 'finalized');
});

test('SolanaRpc paginates signatures back to the persisted cursor', async () => {
  const rpc = new SolanaRpc('https://example.invalid');
  const calls = [];
  rpc.call = async (method, params) => {
    calls.push({ method, params });
    return calls.length === 1
      ? [{ signature: 'new-3' }, { signature: 'new-2' }]
      : [{ signature: 'new-1' }];
  };

  const signatures = await rpc.getSignaturesSince('known-cursor', { pageLimit: 2, maxPages: 3 });
  assert.deepEqual(signatures.map((item) => item.signature), ['new-3', 'new-2', 'new-1']);
  assert.equal(calls[0].params[1].until, 'known-cursor');
  assert.equal(calls[0].params[1].before, undefined);
  assert.equal(calls[1].params[1].before, 'new-2');
  assert.equal(calls[1].params[1].until, 'known-cursor');
});
