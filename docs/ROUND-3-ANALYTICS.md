# Round 3 analytics baseline

Captured from the production SQLite database on 2026-08-04. Integrity check: `ok`. The database contained 173,091 events but only 1.973 days of indexed coverage. Consequently, the 7-day and 30-day rows below are partial and identical; they must not be presented as complete windows or used to finalize alert thresholds.

## Event sizes (SKR)

| Window | Type | Count | p50 | p90 | p99 | p99.9 | Max |
|---|---:|---:|---:|---:|---:|---:|---:|
| 24h | stake | 101,985 | 1 | 3 | 50 | 1,675 | 1,140,280 |
| 24h | unstake | 589 | 68 | 5,566 | 103,633 | 418,850 | 418,850 |
| 24h | withdraw | 180 | 1,199 | 19,803 | 431,972 | 1,266,867 | 1,266,867 |
| 7d partial | stake | 171,705 | 1 | 3 | 58 | 2,000 | 1,140,280 |
| 7d partial | unstake | 1,052 | 20 | 5,000 | 103,633 | 900,000 | 1,017,090 |
| 7d partial | withdraw | 312 | 1,180 | 13,691 | 431,972 | 1,266,867 | 1,266,867 |
| 30d partial | stake | 171,705 | 1 | 3 | 58 | 2,000 | 1,140,280 |
| 30d partial | unstake | 1,052 | 20 | 5,000 | 103,633 | 900,000 | 1,017,090 |
| 30d partial | withdraw | 312 | 1,180 | 13,691 | 431,972 | 1,266,867 | 1,266,867 |

## Alert simulation

These are actual triggers in the available 1.973-day interval; weekly values are mechanical projections, not forecasts.

| Threshold | Stake | Unstake | Withdraw | Total observed | Mechanical / week |
|---:|---:|---:|---:|---:|---:|
| 10k | 61 | 82 | 47 | 190 | 674.0 |
| 50k | 18 | 26 | 14 | 58 | 205.7 |
| 100k | 10 | 11 | 13 | 34 | 120.6 |
| 500k | 3 | 3 | 2 | 8 | 28.4 |
| 1M | 2 | 1 | 1 | 4 | 14.2 |

None of the tested round thresholds currently meets the target of 1-3 alerts per week. This result also disproves the earlier assumption that events above 1,000 SKR were absent; that assumption came from a short display sample, not the accumulated database.

Provisional percentile references (not product settings): stake p99.5/p99.95 = 155/5,000; unstake = 312,490/1,017,090; withdraw = 764,770/1,266,867. The sample is too short to choose a global standard/critical threshold. Re-run weekly after at least 30 complete days and let Alex approve any change.

## Position sizes (finalized UserStake scan)

| State | Count | p50 | p90 | p99 | p99.9 | Max |
|---|---:|---:|---:|---:|---:|---:|
| Active | 48,716 | 8,880 | 41,271 | 328,761 | 51,537,610 | 1,116,932,042 |
| Pending | 2,203 | 1,800 | 11,073 | 100,000 | 651,455 | 1,017,090 |

Positions and events are intentionally reported separately.

The `10 SKR` ledger signal threshold was checked across the latest day: 25 boundary-inclusive hourly buckets, zero empty buckets, minimum 1 and maximum 341 qualifying events. The feed did not become empty, so an adaptive threshold is not justified now.

## Rewards-history release gate

Minimum coverage is seven complete days of finalized snapshots. Before that the feature is unavailable and may show the calculated availability timestamp. The prepared query computes protocol share-price return for a constant number of shares. It must not be labeled wallet PnL if the wallet changed its share balance during the interval.
