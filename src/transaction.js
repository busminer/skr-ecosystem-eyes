import { decodeInstructionData } from './decoder.js';
import { MINT, PROGRAM_ID, TOKEN_DECIMALS } from './constants.js';

function publicKey(value) {
  return typeof value === 'string' ? value : value?.pubkey;
}

function accountKeys(transaction) {
  const messageKeys = (transaction?.transaction?.message?.accountKeys || []).map(publicKey);
  const loaded = transaction?.meta?.loadedAddresses || {};
  return [...messageKeys, ...(loaded.writable || []), ...(loaded.readonly || [])];
}

function instructions(transaction) {
  const top = (transaction?.transaction?.message?.instructions || []).map((instruction, index) => ({
    instruction, id: String(index), instructionIndex: index,
  }));
  const inner = [];
  for (const group of transaction?.meta?.innerInstructions || []) {
    for (let index = 0; index < group.instructions.length; index += 1) {
      inner.push({
        instruction: group.instructions[index],
        id: `${group.index}.${index}`,
        instructionIndex: `${group.index}.${index}`,
      });
    }
  }
  return [...top, ...inner];
}

function tokenAmountMap(balances) {
  return new Map((balances || [])
    .filter((balance) => balance.mint === MINT)
    .map((balance) => [balance.accountIndex, BigInt(balance.uiTokenAmount?.amount || '0')]));
}

function vaultDelta(transaction, vaultAccountIndex, type) {
  if (!Number.isInteger(vaultAccountIndex)) return null;
  const pre = tokenAmountMap(transaction.meta?.preTokenBalances).get(vaultAccountIndex) ?? 0n;
  const post = tokenAmountMap(transaction.meta?.postTokenBalances).get(vaultAccountIndex) ?? 0n;
  const delta = type === 'withdraw' ? pre - post : post - pre;
  return delta > 0n ? delta : null;
}

const WALLET_ACCOUNT = { stake: 4, unstake: 3, cancel_unstake: 3, withdraw: 2 };
const GUARDIAN_ACCOUNT = { stake: 2, unstake: 2, cancel_unstake: 2 };
const VAULT_ACCOUNT = { stake: 6, unstake: 4, cancel_unstake: 4, withdraw: 3 };

export function parseStakingTransaction(transaction, sharePriceRaw = 1_000_000_000n) {
  if (!transaction || transaction.meta?.err) return [];
  const keys = accountKeys(transaction);
  const signature = transaction.transaction?.signatures?.[0];
  if (!signature) return [];

  const events = [];
  for (const { instruction, id, instructionIndex } of instructions(transaction)) {
    const programId = instruction.programId || keys[instruction.programIdIndex];
    if (programId !== PROGRAM_ID || typeof instruction.data !== 'string') continue;

    const decoded = decodeInstructionData(instruction.data, sharePriceRaw);
    if (!decoded) continue;
    const accountIndexes = instruction.accounts || [];
    const accountAt = (position) => {
      const indexOrKey = accountIndexes[position];
      return Number.isInteger(indexOrKey) ? keys[indexOrKey] : publicKey(indexOrKey);
    };

    let rawAmount = decoded.rawAmount;
    if (decoded.type === 'withdraw') {
      rawAmount = vaultDelta(transaction, accountIndexes[VAULT_ACCOUNT.withdraw], decoded.type);
    }

    events.push({
      id: `${signature}:${id}`,
      signature,
      instructionIndex,
      slot: transaction.slot ?? null,
      blockTime: transaction.blockTime ?? null,
      type: decoded.type,
      wallet: accountAt(WALLET_ACCOUNT[decoded.type]) || null,
      guardianPool: accountAt(GUARDIAN_ACCOUNT[decoded.type]) || null,
      amount: rawAmount === null ? null : Number(rawAmount) / 10 ** TOKEN_DECIMALS,
      rawAmount: rawAmount === null ? null : rawAmount.toString(),
    });
  }
  return events;
}
