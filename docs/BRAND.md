# Brand and visual direction

## Intent

SKR Ecosystem Eyes is an independent community analytics product. Its interface is inspired by Solana Mobile's visual language, but it must not reproduce the official website or imply that it is an official staking portal.

Primary visual reference:

- [Solana Mobile](https://solanamobile.com/)
- [Official SKR page](https://solanamobile.com/skr)
- [Solana Seeker Press Kit](https://drive.google.com/drive/folders/1nBAP8JjbqvqDgIhzdESU_GjmuG3QWQDZ)

## Local official press assets

The following files were downloaded from the public press kit linked by the official Solana Mobile website:

| Local file | Press-kit source |
|---|---|
| `public/assets/brand/skr-token-white.svg` | `SKR Token Logo / S_Token_Circle_White.svg` |
| `public/assets/brand/solana-mobile-white.svg` | `Solana Mobile Logo Isolated / 02 White / Solana_Mobile_With_Logo_White.svg` |

The SVGs were inspected after download and contain static vector paths only—no script, external resource or executable content.

The public availability of a press kit does not establish an unrestricted trademark or copyright license. Solana Foundation brand guidance prohibits creating an impression of sponsorship or affiliation, modifying marks, combining them into a project identity, or commercial exploitation without permission. Solana Mobile Terms restrict copying or deriving page layout, text, imagery, forms, animations and other site content. Re-check current terms and obtain permission before commercial trademark use.

Authoritative references:

- [Solana Foundation Brand & Press](https://solana.com/branding)
- [Solana Foundation Brand Guidelines — June 2026](https://docs.google.com/document/d/1gOjdCVI2tp-hpCJciSNZAR93cxgw_gh2/edit?usp=sharing)
- [Solana Terms of Service](https://solana.com/tos)
- [Solana Mobile Terms of Use](https://solanamobile.com/tos-homepage-web)
- Permission contact: `operations@solana.foundation`

## Required identity separation

Always keep these messages visible:

```text
Independent community analytics
Not affiliated with, endorsed by or sponsored by Solana Foundation or Solana Mobile
On-chain data only · No wallet connection · No signing
```

Rules:

1. The SKR token mark may identify the tracked token beside the independent product name.
2. The safest public build uses a text link to Solana Mobile instead of its wordmark. The current wordmark is prototype-only unless current terms or written permission allow it.
3. Never merge the wordmark with `SKR Ecosystem Eyes` into a fake official logo lockup.
4. Never use an official mark as a wallet-connect, stake, purchase or signing button.
5. Preserve SVG aspect ratio, white treatment and clear space.
6. Do not use official device renders, campaign photography, marketing copy, animations, page composition or unique trade dress without separate permission.

## Visual tokens

Observed from the official website in July 2026:

```text
Canvas      #000000 / #0c0c0e
Surface     #101013 / #161618
Text        #ffffff / #f6f6f5
Hairline    rgba(255,255,255,.08)
Primary     #0099ff
```

The official website declares PP Mori and ABC Diatype Semi-Mono. Those are proprietary typefaces and are not copied into this project. The dashboard uses open substitutes:

```text
Display/body: Instrument Sans + system fallback
Technical:    Fragment Mono + monospace fallback
```

Composition rules:

- primary surface is a dense Monitor/Inspect command center, never a marketing hero;
- thin translucent structure, shallow industrial geometry and layered luminance provide depth;
- restrained electric-blue atmospheric light is interactive/structural, not generic crypto decoration;
- the central Canvas must map real states: active stake → cooldown → withdrawable;
- aggregate Canvas routes are proportional; only newly detected finalized SSE events move, with signed SKR amount, wallet, direction and arrival receipt;
- semantic chart colors remain distinct from the primary brand blue;
- official Solana Mobile wordmark is not used in the active UI; attribution is a text link;
- reduced-motion support is mandatory.

The rejected `Signal, not noise` hero and decorative orbital graphic must not be restored. See [`DESIGN-RESEARCH.md`](DESIGN-RESEARCH.md) for GitHub sources, license decisions and the full Observatory rationale.

## Verification

The responsive audit uses Chrome DevTools Protocol so that 390 means 390 CSS pixels on Windows:

```bash
CDP_PORT=9224 CDP_WIDTH=390 CDP_HEIGHT=844 CDP_MOBILE=1 \
  node scripts/audit-layout.mjs http://127.0.0.1:4173/
```

Pass criteria:

```text
document.scrollWidth == viewport.width
body.scrollWidth == viewport.width
runtimeErrors == []
```

Elements inside an explicitly scrollable table/filter container may exceed the viewport; the page itself may not. Use `scripts/capture-mobile.mjs` for visual evidence. Set `CDP_FULL_PAGE=1` for a full-page screenshot.
