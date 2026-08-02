# Cheap expansion map

The MVP deliberately starts with one source of truth: finalized Solana state. Features below are ordered by **signal per infrastructure dollar**, not by hype.

## Already implemented

| Signal | Source | Extra recurring cost |
|---|---|---:|
| Active stake and share price | Stake Config PDA | none |
| Vault balance | SKR token account | none |
| Supply and staking ratio | SKR mint | none |
| Pending and withdrawable queue | sliced UserStake accounts | none; one large scan/15 min |
| Active accounts | sliced UserStake accounts | none |
| Guardian pool distribution/concentration | same UserStake slice | none |
| Stake/unstake/cancel/withdraw feed | staking program transactions | public RPC throughput |
| 1h/24h/7d flow and whale feed | locally indexed events | local disk only |

## Best next additions

### 1. Wallet intelligence — almost free

- wallet search and position page;
- active stake, pending exit and maturity time;
- realized/unrealized rewards approximation from cost basis and share price;
- wallet history, average stake duration and restake behavior.

The required wallet, shares, cost basis, cumulative rewards and queue fields are already present in the UserStake slice. Exact reward semantics need additional transaction validation before public labeling.

### 2. Guardian network view — almost free

- pool leaderboard;
- stake concentration and Nakamoto-style concentration thresholds;
- inflow/outflow by Guardian;
- migrations between Guardians;
- pool growth and retention.

Current backend already emits `/api/guardians`; only the dedicated UI view and historical snapshots remain.

### 3. Exit-pressure radar — local computation

- unlock calendar by hour/day;
- amount becoming withdrawable in the next 1h/6h/24h/48h;
- withdrawal conversion rate after cooldown;
- large unlock alerts;
- pending exits as a percentage of active stake;
- rolling stake-to-exit ratio.

### 4. Protocol health — a few RPC calls

- vault/config reconciliation;
- data freshness and missed-slot alarm;
- config changes: cooldown, minimum stake and authority;
- program upgrade-authority monitoring;
- share-price/reward-index snapshots;
- RPC divergence check against a second free endpoint.

### 5. Ecosystem contracts and vaults — address-dependent

Once authoritative addresses are confirmed, add independent cards for:

- SKR claim/distribution vaults;
- treasury and community vault balances;
- emissions and reward funding;
- known vesting/unlock accounts;
- circulating versus locked supply;
- transfers between known protocol-controlled accounts.

Never classify a wallet as treasury/team/vesting from guesswork. Every label needs an official source or reproducible on-chain derivation.

### 6. Market context — optional external dependency

- Jupiter spot price;
- staked and queued value in USD;
- liquidity depth and price impact;
- exit queue versus DEX liquidity;
- volume/volatility overlays.

Jupiter public endpoints can cover a prototype. Reliable historical OHLCV may require Birdeye, CoinGecko, DexScreener or another provider and should remain separate from staking truth.

### 7. Alerts — cheap after the indexer exists

- Telegram/Discord whale alerts;
- large unlock becoming withdrawable;
- unusual net outflow;
- config/program authority change;
- indexer stale or reconciliation mismatch.

## Storage strategy

Do not keep full RPC transaction JSON indefinitely. Persist:

- normalized staking events;
- hourly/daily aggregates;
- periodic protocol snapshots;
- current wallet/queue materialized state;
- a restart-safe signature/slot cursor.

For a public beta, move `data/events.json` to PostgreSQL while keeping the same read-only API contract.
