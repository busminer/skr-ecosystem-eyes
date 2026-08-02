# Premium design research

## Brief

The July 2026 redesign replaced a rejected marketing-style hero with a true Monitor surface. The product must feel like a high-end live protocol instrument while remaining an original, independent community product—not a copy of Solana Mobile's website or a generic neon crypto dashboard.

## Direct sources inspected

- [Solana Mobile](https://solanamobile.com/) — dark hardware-tech visual vocabulary, restrained electric blue, technical labels, sharp structure and cinematic pacing.
- [Solana Mobile Terms](https://solanamobile.com/tos-homepage-web) — do not copy or derive the official page layout, animations, imagery, text or unique trade dress.
- [Solana Brand & Press](https://solana.com/branding) — official trademark and attribution context.

## GitHub reconnaissance

GitHub was searched directly through the authenticated `gh` CLI. Repositories were evaluated for license, dependency weight and transferable interaction ideas. No repository source code was copied into SKR Ecosystem Eyes.

| Repository | License observed | Useful reference | Decision |
|---|---:|---|---|
| [mrdoob/three.js](https://github.com/mrdoob/three.js) | MIT | performant WebGL scene architecture | Not added; excessive for the required semantic field |
| [pixijs/pixijs](https://github.com/pixijs/pixijs) | MIT | high-performance 2D/WebGL rendering | Not added; native Canvas is sufficient |
| [theatre-js/theatre](https://github.com/theatre-js/theatre) | Apache-2.0 | disciplined motion timelines | Reference only; no timeline editor needed |
| [pmndrs/react-three-fiber](https://github.com/pmndrs/react-three-fiber) | MIT | declarative 3D scene composition | Rejected because the project is dependency-free vanilla JS |
| [tengbao/vanta](https://github.com/tengbao/vanta) | MIT | animated atmospheric backgrounds | Rejected as decorative/generic and not data-semantic |
| [vasturiano/3d-force-graph](https://github.com/vasturiano/3d-force-graph) | MIT | data-linked spatial nodes | Reference only; 3D would reduce analytic legibility |
| [PavelDoGreat/WebGL-Fluid-Simulation](https://github.com/PavelDoGreat/WebGL-Fluid-Simulation) | MIT | fluid motion and GPU restraint | Reference only; fluid effects would imply false data semantics |
| [tabler/tabler](https://github.com/tabler/tabler) | MIT | dense dashboard hierarchy and responsive tables | Reference only; no Bootstrap/runtime added |
| [grafana/grafana](https://github.com/grafana/grafana) | AGPL-3.0 | observability density and status hierarchy | Visual research only; no code reused |
| [koala73/worldmonitor](https://github.com/koala73/worldmonitor) | non-permissive/Other | situational-awareness composition | Research only; license is unsuitable for copying |

An independent second GitHub pass also ranked the following current sources:

| Repository | License | Best transferable idea | Decision |
|---|---:|---|---|
| [magicuidesign/magicui](https://github.com/magicuidesign/magicui) | MIT | semantic animated beams and restrained bento hierarchy | Pattern reference only; React/Tailwind not added |
| [ibelick/motion-primitives](https://github.com/ibelick/motion-primitives) | MIT | number transitions and compact inspection transitions | Translate principles to CSS/Web Animations if needed; beta library not added |
| [shuding/cobe](https://github.com/shuding/cobe) | MIT | tiny zero-dependency cinematic Canvas discipline | No globe used because geography would be false semantics |
| [f5/unovis](https://github.com/f5/unovis) | Apache-2.0 | crosshair-linked charts, Sankey and timeline brushing | Gallery/interaction reference; broad dependency surface rejected |
| [jacomyal/sigma.js](https://github.com/jacomyal/sigma.js) | MIT | semantic zoom for future Guardian/delegator topology | Defer until real topology answers an intelligence question |
| [tremorlabs/template-dashboard-oss](https://github.com/tremorlabs/template-dashboard-oss) | Apache-2.0 | data-product information architecture | Structure reference only; Next/React stack is too heavy |
| [apache/echarts](https://github.com/apache/echarts) | Apache-2.0 | streaming charts and coordinated crosshairs | Native SVG remains sufficient for MVP |
| [tsparticles/tsparticles](https://github.com/tsparticles/tsparticles) | MIT | bounded ambient signal field | Dependency rejected; synthetic ambient particles were removed entirely |

React Bits was reviewed only as visual research because its MIT + Commons Clause terms are not equivalent to standard permissive MIT. OGL was not copied because its package metadata and missing root license file create avoidable ambiguity.

Searches also surfaced many nominally “premium animated dashboard” repositories with no declared license, negligible adoption and weak maintenance signals. Those were rejected rather than treated as templates.

## Chosen direction: SKR Operations Console

Primary surface: **Monitor**. Secondary surface: **Inspect**. The July 20 continuation evolved the Observatory into a professional Operations Console while preserving the verified staking semantics and dependency-free runtime.

The first viewport is a command center, not a landing page. Its hierarchy now combines observability discipline inspired by Grafana/Datadog, Linear-like luminance precision and Carbon-like productive density without copying any product composition or code:

```text
NETWORK STATE | CAPITAL ROUTING FIELD | EXIT PRESSURE
24H SIGNAL STRIP
FLOW VELOCITY | PROTOCOL INTEGRITY
```

Operations Console additions:

- persistent labeled desktop navigation and compact mobile section navigation;
- one auditable generated verdict: `Partial view`, `Accumulating`, `Balanced` or `Exit pressure rising`;
- verdicts remain `Partial view` until a complete local 24-hour window exists;
- accumulating/exit verdicts require net flow to exceed ±10% of gross stake + unstake flow;
- exact `READY`, `0–6H`, `6–12H`, `12–24H` and `24–48H` unlock bands from the complete UserStake scan, never the Top-25 display sample;
- keyboard-accessible Provenance Drawer for primary metrics, with finalized source accounts/slots, observed time, derivation, accuracy and coverage caveats;
- Evidence Drill-down for finalized transaction, wallet, Guardian and UserStake queue objects, with explicit `EXACT`, `ESTIMATED` and `UNAVAILABLE` amount methods;
- restrained flat surfaces, explicit coverage and productive tables instead of decorative card effects.

The central scene now centers one explicit protocol object instead of presenting three equal-looking rails:

```text
WALLET -- STAKE --> STAKING VAULT -- UNSTAKE --> 48H QUEUE (HELD IN VAULT)
                                          WITHDRAW = EXIT CONFIRMED receipt
```

Native Canvas renders fixed-weight semantic routes plus labeled flights for **newly detected finalized events only**. Route thickness does not encode totals or velocity. Historical events are seeded as `LAST CONFIRMED` context on page load and are not replayed as live. Every moving event carries action, signed/qualified SKR amount, shortened wallet and finalization age:

- `stake` → forward into `STAKING VAULT`, exact positive amount;
- `unstake` → reverse from active state toward `48H QUEUE`, approximate negative amount because current share price is used; this is a state change and the tokens remain held in the vault;
- `cancel_unstake` → return from cooldown toward the vault, amount unavailable until state-delta decoding exists;
- `withdraw` → compact red `EXIT CONFIRMED` receipt with the exact negative vault delta; it never owns a persistent route.

Desktop permits up to two concurrent flights, one per persistent route, with collision-managed cards. Mobile serializes to one flight and uses one centered withdraw receipt dock above the caption. Events older than two minutes remain static backfill context instead of flying as live. Hidden-tab arrivals coalesce into one `WHILE AWAY` receipt rather than replaying as a burst. The browser dedupe ledger retains the newest 2,000 IDs. Reduced-motion users receive a static arrival receipt instead of travel.

## System decisions

- zero new npm/runtime dependencies;
- `Instrument Sans` + `Fragment Mono` open web fonts;
- practical floor of 10px for Canvas/mobile operational copy, with 9px reserved for tertiary compact notes; 11px labels, 12px tables, 18px panel titles and 14–16px event amounts;
- brighter secondary text, larger line-height and increased row/panel breathing room so the type scale reads as deliberate hierarchy rather than browser zoom;
- near-black metal surfaces, thin white-alpha structure, one cool interactive accent;
- semantic green/amber/red/violet reserved for protocol meaning;
- shallow radii and asymmetric industrial framing rather than pill/card soup;
- luminance steps and top-edge highlights provide depth;
- no giant marketing hero, decorative orbit, fake 3D phone or official campaign imagery;
- motion must explain state and honor `prefers-reduced-motion`;
- mobile removes the desktop rail instead of covering live content with a fixed dock.

## Release gate

The Observatory was checked at 1568×1000 and true 390×844 through Chrome DevTools Protocol:

- live API values rendered;
- Canvas backing dimensions non-zero;
- web fonts loaded;
- browser runtime errors: zero;
- page-level horizontal overflow: zero;
- tests: 21 passed, 0 failed;
- visual slop score after repair: 2/10;
- visual review: zero release blockers.

The Operations Console continuation was rechecked at the same 1568×1000 and true 390×844 viewports:

- live API and exact unlock-horizon values rendered;
- desktop and mobile visual review: PASS;
- browser runtime errors: zero;
- page-level horizontal overflow: zero;
- tests: 22 passed, 0 failed;
- no new npm or runtime dependencies.

The Provenance/Evidence continuation was verified at the same two viewports:

- primary metric, transaction event and UserStake queue inspectors opened successfully;
- drawer background is inert, focus remains inside the modal surface and Escape closes it;
- finalized source slots and Solscan evidence links rendered from the live API;
- desktop and mobile visual review: PASS;
- browser runtime errors: zero;
- page-level horizontal overflow: zero;
- tests: 28 passed, 0 failed.

## High-value design backlog

Do not add these as decorative widgets. Each requires defensible data semantics:

1. **Mobile event ledger** — stacked signed event rows instead of relying on a horizontally scrollable desktop table.
2. **Guardian topology** — only after multiple meaningful pools/relationships exist; never a decorative blockchain force graph.
