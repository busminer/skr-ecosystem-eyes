# SKR Eyes 1.1.0

versionCode 6 · arm64-v8a · signed with the release key
(`d90bb194498ee4dce0669aa5ddcc30c6a13d43750fac4768a240ade9228e4763`)

Ships alongside server release `20f93be` (names in the wallet profile and in the
state's recent events, earned per position), deployed 04.09.2026. Release build:
lab tag `lab-AZ`, commit `05f205e`, `builds/skr-eyes-1.1.0-release.apk`.

Listing texts and media are in the portal (saved 04.09.2026, 15:50). The short
description stays as it is: it passed review and fits the 30-character limit.

```
Stake SKR. See everything.
```

## Long description

```
SKR Eyes shows the SKR staking vault as it actually is, second by second,
and lets you stake from the same screen.

The living vault
Every stake falls into the vault as a phone with the staker's .skr name
under it; every exit hangs above it, cooling for its 48 hours, and drops
when it is withdrawn. Larger stakes fall larger and slower. The pile under
it all is the 4.95 billion SKR that stays. Nothing here is drawn from
imagination: every phone is a finalized move on chain, and you can tap any
of them for its receipt.

Live from the vault
The feed of stakes, exits and withdrawals as they finalize, filtered by kind
and size, with the day's biggest moves pinned at the top. A large stake
rings the vault bell, a large exit lands with a low boom, on any screen,
each with a short buzz. Or switch both off.

Your staker card
Your .skr name, your days in stake, your position and your weight in the
vault, on a card you can share as a picture. Two switches let you hide your
name, or your amount, before it leaves the phone.

Stake without leaving
Sign once and stake in as many parts as you like, or tap Sixteen: 16 parts
of 1 SKR with one approval, a small daily habit. The app checks your
balance first and says plainly what you can afford.

The exit queue
What is cooling down, what is ready, and when each position matures. Your
phone can wake you at the exact on-chain unlock time; the alert is set on
the device itself, and no address is sent anywhere for it.

Ten languages
English, 中文, Русский, Español, Português, Türkçe, Tiếng Việt, Indonesia,
한국어, 日本語. The app follows your phone's language and can be switched by
hand on the Alerts screen.

Free and open source, built by one Seeker. Tips in SKR go to kosa.skr and
are staked right away, all of them. Built on our own indexer, read at
finalized commitment. Nothing about you leaves your phone except the public
address you look up.
```

## What's new in this version (paste into the New Version form)

```
The vault is alive. Every stake falls in with its .skr name, every exit hangs and cools above the pile of what stays, and you can tap any move for its receipt.

What people asked for: earned on staking, read from the chain, and two privacy switches on the card, to hide your name or your amount before you share it.

Sounds you can feel: a glass chime for a large stake, the vault bell for a huge one, a low boom for a large exit, each with a short buzz. Or switch them off.

Sixteen: 16 parts of 1 SKR with one approval, and a gentle daily nudge you can switch off. Flow filtered by kind and size, with the day's biggest moves pinned and the day drawn hour by hour. All ten languages reviewed end to end. Tips in SKR, staked right away.
```

## What actually changed since 1.0.4

**The living vault.** Pulse became Vault: a canvas scene in a WebView, fed by the
same finalized feed as Flow. Every stake falls as a phone with the staker's .skr
name under it, sized by amount on a log scale; stakes from 10K fall slower, larger
and brighter with their figure in bold; a 100K stake is a shower. Every unstake
in cooldown hangs above the pile with a ring that closes over 48 hours; withdrawals
drop, cancelled exits fall back. The pile is the held stake: bedrock laid at start
never washes away, the day's three largest stakes rest on it as lit nests, your own
position sits on it as a gold cluster. The SKR mark stands far behind the rain, the
sky runs up behind the header, night mode lights windows after 21:00, a story
replays the vault's growth on first open, double-tap zooms to your place, any
phone opens its receipt with the Solscan link. Motion Live / Calm / Off, calm
after three idle minutes at 24 fps, one still frame a second when off, pause in the
background. Three watchdogs so the scene can never stay black: a still scene
redraws every second, a page that never says ready or stops beating is replaced,
and a lost Android renderer mounts a fresh WebView refilled from memory.

**Sounds and touch.** Glass chime for a stake from 10K, the vault bell from 100K,
a low boom for an exit from 100K, on every tab while the app is in front, each with
a short buzz, never closer than four seconds apart, one per batch, governed by the
Large moves switch on Alerts plus the sound and buzz pills. The flip board is felt,
not heard. The opening is the first stone: a phone falls into the dark, lands with
the glass chime, a wave reveals the pile, the eye opens over it and winks; 4.7 s.

**Flow.** Headline cards rotate the day's biggest stake, exit and withdrawal, read
from the whole day, not the last page. Chips filter by kind (server-side) and by
size (all, 1K+, 100K+). Large moves keep their place in the list for a quarter of
an hour instead of being pushed out by dust. Rows open a receipt.

**Me.** Earned on staking, estimated from the share price at the position's last
move and labelled as such. Sixteen: 16 parts of 1 SKR with one approval. Two
privacy switches for the shared card, hide name (the card says A Seeker, the eye
closes) and hide amount, with a plain warning about fingerprints. Names from the
.skr registry come first, the wallet label second. A looked-up address is looked
at, not signed for; only the connected wallet gets Stake and Sixteen, and the
wallet that answers is checked against the address on screen before it signs.
A run the wallet held when the app died is restored with a warning, never
silently forgotten.

**Alerts.** Honest copy for the sounds that exist; the language picker; the tip
sheet: any amount in SKR to kosa.skr, SPL TransferChecked signed by the wallet,
staked right away, marked checked only when the chain answered.

**Languages.** Nine tables read end to end by native-level editors; finance terms
set straight, 60 new strings, the Vault tab and Flow chips named everywhere.

**Server (f00c26c, 20f93be).** The wallet profile and the state's recent events
carry .skr names; the profile reports earned and the entry share price; events
take a type filter.

**Reviews.** Three independent reviews on 04.09 (two agents, Codex read-only):
25 defects fixed, among them a duplicate-stake recovery hole, an unreachable
first stake, a wrong wallet allowed to sign, a false "confirmed" on the tip
sheet, two parallel pollers, a dead switch, and a flip board that ticked.

## Media to redo before submission

| Item | State |
|---|---|
| Screenshot 1, the card | done, neutral card (name hidden, A Seeker) |
| Screenshot 2, the vault scene | done |
| Screenshot 3, Flow with the headline cards | done |
| Screenshot 4, Me with earned, Sixteen and the privacy switches | done |
| Screenshot 5, languages and the tip | done |
| Banner 1200×600 | done, the living vault, mark left, copy inside the safe zone |
| Feature graphic 1200×1200 | done, the scene with the 4.95 board |
| `store/make-media.py` footer | done, Vault · Flow · Me · Alerts |

## Portal

Details saved. Contact email is skr-eyes@alexkosa.dev. Left for Alex: Connect Wallet on
the Home page, New Version, upload `builds/skr-eyes-1.1.0-release.apk` (40 MB, above the
10 MB the browser tool can carry), paste the what's-new above, publish.
