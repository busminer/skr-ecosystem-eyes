# Share-price snapshots: schema proposal

Status: **proposal only**. Do not apply to production until Alex approves the schema.

## Storage contract

Snapshots contain finalized facts only. Decimal on-chain values are stored as canonical text rather than SQLite `REAL`, so u128-derived values never lose precision.

```sql
CREATE TABLE protocol_snapshots (
  slot INTEGER PRIMARY KEY CHECK(slot > 0),
  unix_ts INTEGER NOT NULL CHECK(unix_ts > 0),
  share_price TEXT NOT NULL,
  total_shares TEXT NOT NULL,
  active_staked TEXT NOT NULL,
  vault_balance TEXT NOT NULL,
  reward_index TEXT NOT NULL,
  inserted_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX protocol_snapshots_unix_ts_slot_idx
  ON protocol_snapshots(unix_ts, slot);

CREATE TABLE protocol_snapshots_hourly (
  hour_ts INTEGER PRIMARY KEY,
  first_slot INTEGER NOT NULL,
  last_slot INTEGER NOT NULL,
  open_share_price TEXT NOT NULL,
  high_share_price TEXT NOT NULL,
  low_share_price TEXT NOT NULL,
  close_share_price TEXT NOT NULL,
  close_total_shares TEXT NOT NULL,
  close_active_staked TEXT NOT NULL,
  close_vault_balance TEXT NOT NULL,
  close_reward_index TEXT NOT NULL,
  sample_count INTEGER NOT NULL CHECK(sample_count > 0)
);
```

## Write and retention rules

- Write at most once per finalized slot and at least once every five minutes.
- Write immediately when the exact finalized reward index changes.
- Never interpolate during writes.
- Keep raw rows for 90 days.
- Before deleting an expired hour, transactionally insert its open/high/low/close aggregate and verify `sample_count`.
- Keep hourly rows indefinitely until an explicit storage policy replaces this one.
- Range reads use `unix_ts`; exact evidence lookups use `slot`.

## Safety gate

1. Create and populate the schema in a copied SQLite database.
2. Run `PRAGMA integrity_check`.
3. Exercise range reads and 90-day compaction.
4. Create a standard project backup and verify restore from that backup.
5. Only then enable production writes.

## Expected volume

At a strict five-minute cadence the raw table receives 288 rows/day, plus reward-index changes. Even with a conservative 250 bytes per row this is about 72 KB/day, 2.2 MB/month and 6.5 MB for 90 days before SQLite page overhead. The implementation must measure the actual first 24 hours rather than rely on this estimate.
