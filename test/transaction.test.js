import test from 'node:test';
import assert from 'node:assert/strict';
import { parseStakingTransaction } from '../src/transaction.js';
import { PROGRAM_ID, STAKE_CONFIG, STAKE_VAULT, MINT } from '../src/constants.js';

const USER = '3xMZwaVNe4kH3722hEnT21MP4fg8EcWAV2QSFfQDW6Ma';
const USER_STAKE = '62iwp8TEmQmT2NfLfgj48tjMbELM4hyZbV1pLQBdnz7L';
const GUARDIAN = 'DPJ58trLsF9yPrBa2pk6UaRkvqW8hWUYjawe788WBuqr';

function transactionFixture({ data, accounts, preTokenBalances = [], postTokenBalances = [] }) {
  const keys = [USER_STAKE, STAKE_CONFIG, GUARDIAN, USER, USER, 'UserAta1111111111111111111111111111111111', STAKE_VAULT, MINT, PROGRAM_ID];
  return {
    slot: 123,
    blockTime: 1_700_000_000,
    meta: { err: null, preTokenBalances, postTokenBalances, innerInstructions: [] },
    transaction: {
      signatures: ['signature-1'],
      message: {
        accountKeys: keys,
        instructions: [{ programIdIndex: 8, accounts, data }],
      },
    },
  };
}

test('parseStakingTransaction extracts a successful stake and wallet', () => {
  const tx = transactionFixture({
    data: 'SXLVHmrGRvoUgsKGA44HWf',
    accounts: [0, 1, 2, 3, 4, 5, 6, 7, 8],
  });
  assert.deepEqual(parseStakingTransaction(tx, 1_100_000_000n), [{
    id: 'signature-1:0', signature: 'signature-1', instructionIndex: 0,
    slot: 123, blockTime: 1_700_000_000, type: 'stake', wallet: USER,
    guardianPool: GUARDIAN, amount: 123.456, rawAmount: '123456000',
  }]);
});

test('parseStakingTransaction derives withdraw amount from vault token delta', () => {
  const tx = transactionFixture({
    data: 'Xd2GMpFXgQ1',
    accounts: [0, 1, 3, 6, 5, 8],
    preTokenBalances: [{ accountIndex: 6, mint: MINT, owner: STAKE_CONFIG, uiTokenAmount: { amount: '5000000000', decimals: 6 } }],
    postTokenBalances: [{ accountIndex: 6, mint: MINT, owner: STAKE_CONFIG, uiTokenAmount: { amount: '4750000000', decimals: 6 } }],
  });
  assert.equal(parseStakingTransaction(tx)[0].amount, 250);
  assert.equal(parseStakingTransaction(tx)[0].wallet, USER);
});

test('parseStakingTransaction ignores failed and irrelevant transactions', () => {
  const failed = transactionFixture({ data: 'SXLVHmrGRvoUgsKGA44HWf', accounts: [0, 1, 2, 3, 4] });
  failed.meta.err = { InstructionError: [0, 'Custom'] };
  assert.deepEqual(parseStakingTransaction(failed), []);

  const irrelevant = transactionFixture({ data: '2', accounts: [0] });
  assert.deepEqual(parseStakingTransaction(irrelevant), []);
});
