# Product question map: SKR Eyes and HyperLazy

This pass compares products by the staking questions they answer, not by visual imitation. The original HyperLazy SKR Monitor is offline, and no preserved screen inventory or source export was found in the project workspace. HyperLazy entries below are therefore limited to the product behavior previously documented by the team and must not be treated as a complete reconstruction.

| Staker question | SKR Eyes today | HyperLazy evidence | Product decision |
|---|---|---|---|
| What is the protocol-wide staking state right now? | Exact active stake, vault, supply capture and share price with provenance. | Known to have presented staking state in a compact mobile-friendly form. | Keep the Operations Console as the authoritative deep view. |
| Is capital entering or leaving? | Finalized stake, unstake, cancel and withdraw events; honest 1h/24h/7d/30d coverage. | No preserved evidence detailed enough to compare calculation methods. | Existing web coverage is stronger; do not add another overview. |
| How much exit pressure is coming, and when? | Exact READY/0-6h/6-12h/12-24h/24-48h bands plus largest unlocks. | The old service is remembered as easy to check from mobile, but its queue method is not preserved. | Keep the exact console view; mobile should summarize rather than duplicate it. |
| Can I verify a number? | Reconciliation matrix, Evidence inspector, finalized signatures, source accounts and caveats. | No preserved provenance model found. | Web-only strength; never simplify it away. |
| What is happening to my own position? | Read-only `/w/<address>` page now exists locally: active, pending, withdrawable, next unlock and evidence. | Personal staking lookup was part of the remembered convenience, but exact fields are not preserved. | Ship the web page after production approval; app can make this the three-second home view. |
| How much have staking rewards earned over time? | Snapshot collection is live, but public history is not yet mature enough for an honest long-range answer. | Historical earning visibility is part of the remembered product value, but its method is unavailable. | Build only after enough finalized snapshots exist and semantics are validated. |
| Which Guardian is my stake with, and how concentrated is the network? | Aggregate Guardian distribution and concentration exist; personal position data includes the pool. | No reliable preserved comparison. | Improve the personal presentation later; a new topology page is not justified yet. |
| Will the product alert me when something important happens? | Web console is observational; no push channel. | Mobile convenience is remembered, but no alert specification is preserved. | App-only: personal unlock and data-derived rare-event alerts. |

## Recommended additions

No more than three additions are justified:

1. **Personal position** — `/w/<address>` is the lowest-cost, highest-value web addition because the backend already has exact position and queue data. It remains read-only, shareable and `noindex`.
2. **Rewards history** — a compact share-price/reward history answering “what did staking earn?” once finalized snapshot coverage is long enough. Until then the UI must say unavailable rather than extrapolate.
3. **Guardian detail** — a focused Guardian comparison and personal delegation context, only after labels and movement semantics have reproducible evidence. Do not build a decorative network graph.

Everything else already belongs in the existing Overview, Capital flows, Event ledger, Protocol health and Evidence inspector. Adding more top-level sections now would make the console denser without answering a new question.

## Surface split

- **Web only:** reconciliation, provenance, full ledger and filters, broad comparisons.
- **App only:** three-second personal glance, unlock reminders and rare-event notifications.
- **Both, differently:** personal position and rewards; concise in the app, auditable on the web.
