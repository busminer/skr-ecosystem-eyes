# SKR Eyes 1.2.0 «Top»

versionCode 7 · arm64-v8a · signed with the release key
(`d90bb194498ee4dce0669aa5ddcc30c6a13d43750fac4768a240ade9228e4763`)

Ships alongside server release `391b928` (the leaderboard: `/api/top` and
`/api/top/find`, places among people, daily rank snapshots). The server has to
be out first: the Top tab says "still being counted" until it is.

Build state: **in progress**, see `skr-control/tasks/release-1.2.md`.

## What's new in this version (paste into the New Version form)

```
Top: everybody who stakes, in order. Find yourself among people, not among the treasury wallets: by stake, by what your position has earned, and by places moved since yesterday. Search any .skr name. Your own place on a card with a live dial, and the whole radar behind it.

Your place on Me, beside your weight, and on the staker card you share: #39 of 46 113 stakers, top 0.1%, how many hold less. A third privacy switch turns it off.

Classic: a fourth Motion setting brings back the old main screen, no scene, the day as a heat strip.

The opening from 1.0 is back, the phone that turns and blinks. Choose it or the first stone on Alerts.
```

## What actually changed since 1.1.0

**Top.** A fifth tab. The list arrives a hundred rows at a time from the
server, three orders over the same people: by active stake, by earned (the
same estimate Me shows, `shares × (sharePrice − entryPrice)`), and movers, the
places gained or lost since yesterday's snapshot among the top 1 000. Places are
counted among people: the 51 treasury-size wallets are set aside by the server
and named as one line at the foot. Each row: place with its arrow (▲n / ▼n / —
/ new), the phone from the scene, the .skr name or a short address, tier and
earned, the amount. Top three in cyan, #1 and your own row in gold. Search by
.skr name or a piece of an address filters what is loaded and asks the server
for the rest. Your own card: place, "of N people", tier, the day's move, stake,
earned and the place by earned, a 64 px dial that sweeps, Share my place. A
tap on the card opens the full radar: six rings by tier, the top people as
phones with names on the inner ring, dust for the rest, the sweeping beam, you
in gold with a thread to the centre, the vault's own monument in the middle.
Pinch, drag, tap a phone or a ring. Motion Off stops the beam. A Me button
floats up when your card scrolls away and takes you to your row. Without a
wallet: "Connect on Me to see your place".

**Me and the card.** A "Your place" row beside the weight, with how many people
hold less; a tap opens Top on your row. A third privacy switch, "Show my place
on the card", on by default, with a plain warning when the amount is hidden
but the place shown. The card carries the line under the positions line, Sora,
in the calm zone left of the ring, split onto two lines past fifty characters.
The share caption names the place too.

**Classic.** A fourth position of the Motion switch on Vault: the scene is not
mounted at all; the flip board stands large where it was, the day is the heat
strip, the cards, tiles, rail and queue stay as they were.

**The turn is back.** The opening from 1.0, `SplashTurn`, returns as a choice
on Alerts beside the nudge. It is the default because people asked for it; the
first stone stays one tap away.

**Server (`391b928`).** `src/top.js` rebuilds the board once per position scan
from the same accounts the metrics read, batched and yielding like the scan
itself, with a base58 cache so a wallet is encoded once and kept. Yesterday's
places live in `data/top.sqlite`, one row per person per UTC day, written by
the day's first scan and kept for 35 days; `top.sqlite` joins the nightly
backup when present. `/api/top` answers with an ETag per board version and a
304 for a page the phone already has; `/api/top/find` answers a name, a piece
of an address or a full address wherever it stands. The treasury list is
`src/treasury-wallets.js`, 51 addresses from the scan of 06.09.2026,
replaceable through `SKR_TREASURY_WALLETS`. 164 tests, among them the board
on the top 400 of that scan and the route over a live HTTP server.

**Languages.** 54 new strings in ten tables, translated through Hermes with
Alex's ChatGPT subscription, one request per language, checked by machine for
lost placeholders, lost names and length.

## Not in this release

- The card's hand-made finish (release plan, item 4): mockups first.
- "So far: N SKR from M people" under the tip button: waiting for the word.
- Device language in the request counter; the move to `/api/mobile/pulse`.
- Weekly movers: the snapshots have to pile up first.

## Media to redo before submission

| Item | State |
|---|---|
| Screenshot 6, Top | to shoot on the Seeker |
| Long description | add a paragraph on Top |
| Publisher contact | replace the personal address with the domain one |
