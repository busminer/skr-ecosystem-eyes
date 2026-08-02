# SKR Ecosystem Eyes

Independent, read-only intelligence for the SKR staking ecosystem on Solana.

**Live community beta:** [skr.alexkosa.dev](https://skr.alexkosa.dev/)

![Node 22+](https://img.shields.io/badge/Node-22%2B-68f5b2?style=flat-square) ![Dependencies](https://img.shields.io/badge/runtime_dependencies-0-68f5b2?style=flat-square) ![Mode](https://img.shields.io/badge/mode-read--only-8b7cff?style=flat-square)

## What works now

- live on-chain active stake, vault balance, supply ratio and share price;
- pending/withdrawable totals from filtered UserStake scans with explicit pagination and completeness provenance;
- largest 48-hour unlocks with wallet and Solscan proof;
- exact five-band 48-hour unlock horizon aggregated from every UserStake account;
- decoded `stake`, `unstake`, `cancel_unstake` and `withdraw` feed;
- withdrawal amounts derived from vault token-balance deltas;
- 1h/24h/7d/30d flows, unique wallets and net flow backed by retained SQLite history; longer windows remain coverage-gated until enough local history exists;
- Guardian pool distribution and concentration in `/api/guardians`;
- metric provenance with finalized source slots, observation time, derivation, accuracy and coverage caveats;
- evidence drill-down for finalized transactions, wallets, Guardian pools and individual UserStake queue positions;
- event filters and whale threshold;
- Server-Sent Events for live browser updates;
- restart-safe SQLite event history with automatic migration from the legacy JSON cache;
- responsive Operations Console with auditable state verdicts, desktop/mobile navigation, exact unlock horizon and a two-route Staking Vault: signed SKR amounts, wallet labels, forward stake / reverse unstake motion, compact withdraw receipts, mirrored flow chart and clear independent identity;
- zero npm runtime dependencies and no wallet connection.

## Start

Requires Node.js 22 or newer.

```bash
npm start
```

Open [http://127.0.0.1:4173](http://127.0.0.1:4173).

Run verification:

```bash
npm run check
```

## Community

This project is released by Alex Kosa under the MIT License. Contributions are welcome; see [`CONTRIBUTING.md`](CONTRIBUTING.md) and [`SECURITY.md`](SECURITY.md).

No `npm install` is necessary. Copy `.env.example` to `.env` only if your process manager loads env files; Node does not automatically load them. Environment variables can also be supplied by the host/service.

## On-chain sources

| Role | Address |
|---|---|
| Staking program | `SKRskrmtL83pcL4YqLWt6iPefDqwXQWHSw9S9vz94BZ` |
| SKR mint | `SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3` |
| Stake Config PDA | `4HQy82s9CHTv1GsYKnANHMiHfhcqesYkK6sB3RDSYyqw` |
| Stake Vault | `8isViKbwhuhFhsv2t8vaFL74pKCqaFPQXo1KkeQwZbB8` |
| Known Guardian pool | `DPJ58trLsF9yPrBa2pk6UaRkvqW8hWUYjawe788WBuqr` |

The indexer reads finalized public Solana data. It can use a separate `SOLANA_RPC_SCAN_URL` for the heavy UserStake scan while keeping regular reads on `SOLANA_RPC_URL`. It never requests a wallet connection, signature or private credential.

## Architecture

```text
Solana JSON-RPC
  ├─ Config + mint + vault refresh (60s)
  ├─ UserStake sliced scan (15m)
  └─ Program signature/transaction poll (8s)
              ↓
       cursor-safe decoder
              ↓
  data/events.sqlite + bounded in-memory state
              ↓
     REST API + SSE + static UI
```

The UserStake scan requests bytes `41..168`: wallet, Guardian pool, shares, cost basis, cumulative rewards, pending amount and timestamp. This avoids downloading the unused account prefix while enabling exact queue and Guardian metrics.

## API

| Endpoint | Purpose |
|---|---|
| `GET /api/health` | indexer/RPC health |
| `GET /api/state` | dashboard state, metric provenance and per-event evidence |
| `GET /api/stats` | 1h/24h/7d/30d aggregates and chart buckets |
| `GET /api/events` | paginated/filterable events |
| `GET /api/queue` | largest pending exits |
| `GET /api/guardians` | Guardian distribution/concentration |
| `GET /api/config` | public protocol identifiers |
| `GET /api/stream` | SSE live updates |

Event filters:

```text
/api/events?limit=100&offset=0
/api/events?type=unstake
/api/events?min=100000
/api/events?wallet=HyXLe
```

All non-GET methods return `405 Read-only service`.

## Accuracy notes

- `stake` amount is decoded from instruction data.
- `unstake` stores shares; displayed SKR is currently calculated with the latest config share price and is therefore approximate for historical events. Exact historical precision requires config snapshots stored per slot.
- `withdraw` has no amount argument; a single withdraw uses the successful transaction's vault token-balance decrease. Multiple withdraw instructions are represented once as an exact transaction total, while mixed staking transactions are explicitly labeled as a net estimate.
- `cancel_unstake` has no amount argument and is displayed without an amount until Anchor event decoding/state-delta reconstruction is added.
- Primary account metrics expose the finalized source slot used for the snapshot. Event evidence preserves finalized transaction slot, signature, instruction index and linked accounts.
- Historical windows cover only locally indexed events. The UI explicitly shows their coverage start.
- Incremental sync paginates finalized signatures back to a persisted cursor. A fresh installation deliberately begins with a small 25-transaction coverage boundary; subsequent cycles do not advance the cursor when transaction retrieval is incomplete.
- SQLite retains 35 days by default. The in-memory limit controls only the live UI window and does not truncate persisted analytics or `/api/events` history.

## Visual identity and official assets

The interface translates Solana Mobile's restrained black/hairline/electric-blue hardware-tech vocabulary into an original **Operations Console**. The first frame combines an auditable generated verdict, data freshness, staking position and a semantic capital-routing field centered on one Staking Vault. Stake enters, unstake changes active state into a 48-hour queue while tokens remain held in the vault, and withdraw appears only as an `EXIT CONFIRMED` receipt. The wider product structure uses professional observability patterns—persistent navigation, explicit coverage, event ledger, protocol health and drill-down-ready sections—without copying another dashboard or the official site's Framer code, device hero, marketing layout, animations, copy or proprietary fonts.

The local SKR token mark comes from the public [Solana Seeker Press Kit](https://drive.google.com/drive/folders/1nBAP8JjbqvqDgIhzdESU_GjmuG3QWQDZ) linked by the [official Solana Mobile site](https://solanamobile.com/). The product visibly states that it is independent and not affiliated with or endorsed by Solana Foundation or Solana Mobile. Solana Mobile is referenced through a normal text attribution link; its wordmark is not used in the active UI.

See [`docs/BRAND.md`](docs/BRAND.md) for asset provenance, trademark caution and visual rules. See [`docs/DESIGN-RESEARCH.md`](docs/DESIGN-RESEARCH.md) for the GitHub template/library audit, license decisions and Observatory rationale.

## Deployment needs

Nothing else is required for local beta. A stable public deployment needs:

1. a dedicated Solana RPC URL (Helius Developer or equivalent);
2. a small always-on Node host/VPS;
3. the built-in SQLite store for the community beta; PostgreSQL remains optional at substantially larger scale;
4. a domain and HTTPS reverse proxy;
5. independent reconciliation/uptime monitoring.

Static frontend hosting alone is insufficient because the indexer must run continuously. See [`docs/ROADMAP.md`](docs/ROADMAP.md) for cheap additions and cost-aware sequencing.
