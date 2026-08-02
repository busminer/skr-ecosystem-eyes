const AMOUNT_EVIDENCE = Object.freeze({
  stake: {
    status: 'exact',
    method: 'Decoded token amount from finalized SKR staking instruction data.',
    caveat: null,
  },
  unstake: {
    status: 'estimated',
    method: 'Decoded unstake shares converted to SKR with the current finalized share price.',
    caveat: 'Historical unstake SKR uses the current share price and is therefore an estimate.',
  },
  withdraw: {
    status: 'exact',
    method: 'Finalized Stake Vault token-balance delta across the transaction.',
    caveat: null,
  },
  cancel_unstake: {
    status: 'unavailable',
    method: 'Lifecycle instruction contains no token amount.',
    caveat: 'Amount remains unavailable until UserStake state-delta reconstruction is implemented.',
  },
});

export function buildEventEvidence(event = {}) {
  const definition = AMOUNT_EVIDENCE[event.type] || {
    status: 'unavailable', method: 'Unsupported event type.', caveat: 'No evidence method is registered.',
  };
  return {
    transaction: {
      commitment: 'finalized',
      signature: event.signature || null,
      slot: event.slot ?? null,
      blockTime: event.blockTime ?? null,
      instructionIndex: event.instructionIndex ?? null,
    },
    accounts: {
      wallet: event.wallet || null,
      guardianPool: event.guardianPool || null,
    },
    amount: {
      value: event.amount ?? null,
      rawValue: event.rawAmount ?? null,
      ...definition,
    },
  };
}
