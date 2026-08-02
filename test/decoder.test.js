import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeBase58, encodeBase58 } from '../src/base58.js';
import { decodeInstructionData } from '../src/decoder.js';

test('decodeBase58 handles canonical vectors and leading zero bytes', () => {
  assert.deepEqual([...decodeBase58('')], []);
  assert.deepEqual([...decodeBase58('1')], [0]);
  assert.deepEqual([...decodeBase58('2')], [1]);
  assert.equal(decodeBase58('JxF12TrwUP45BMd').toString('utf8'), 'Hello World');
});

test('encodeBase58 preserves leading zero bytes and canonical vectors', () => {
  assert.equal(encodeBase58(Buffer.from('Hello World')), 'JxF12TrwUP45BMd');
  assert.equal(encodeBase58(Buffer.from([0, 0, 1])), '112');
});

test('decodeInstructionData decodes stake token amount', () => {
  const event = decodeInstructionData('SXLVHmrGRvoUgsKGA44HWf', 1_100_000_000n);
  assert.deepEqual(event, {
    type: 'stake',
    rawAmount: 123_456_000n,
    rawShares: null,
    amount: 123.456,
  });
});

test('decodeInstructionData converts unstake shares using current share price', () => {
  const event = decodeInstructionData('9Er84sm5j2eRhyJrg2bHcEQxYk4yKWLo1', 1_100_000_000n);
  assert.deepEqual(event, {
    type: 'unstake',
    rawAmount: 99_000_000n,
    rawShares: 90_000_000n,
    amount: 99,
  });
});

test('decodeInstructionData recognizes no-argument lifecycle instructions', () => {
  assert.equal(decodeInstructionData('BkMNxfREpea')?.type, 'cancel_unstake');
  assert.equal(decodeInstructionData('Xd2GMpFXgQ1')?.type, 'withdraw');
});

test('decodeInstructionData ignores unknown or malformed instruction data', () => {
  assert.equal(decodeInstructionData('2'), null);
  assert.equal(decodeInstructionData('not-base58!'), null);
});
