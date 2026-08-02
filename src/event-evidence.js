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
  let definition = AMOUNT_EVIDENCE[event.type] || {
    status: 'unavailable', method: 'Unsupported event type.', caveat: 'No evidence method is registered.',
  };
  if (event.type === 'withdraw' && event.rawAmount == null) {
    definition = {
      status: 'unavailable',
      method: 'The finalized transaction did not expose an attributable Stake Vault decrease.',
      caveat: 'No withdrawal amount is reported rather than inventing one.',
    };
  } else if (event.type === 'withdraw' && event.aggregation === 'transaction-total') {
    definition = {
      status: 'exact',
      method: 'Finalized aggregate Stake Vault token-balance decrease for all withdraw instructions in the transaction.',
      caveat: 'The total is transaction-level and is not attributed to individual withdraw instructions.',
    };
  } else if (event.type === 'withdraw' && event.aggregation === 'transaction-net') {
    definition = {
      status: 'estimated',
      method: 'Finalized net Stake Vault token-balance decrease across a mixed staking transaction.',
      caveat: 'Other Stake Vault movements in the same transaction can make the net decrease differ from gross withdrawn SKR.',
    };
  }
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
        aggregation: event.aggregation || null,
        ...definition,
    },
  };
}
