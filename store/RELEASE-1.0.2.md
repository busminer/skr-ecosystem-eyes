# SKR Eyes 1.0.2

versionCode 3 · arm64-v8a · signed with the release key
(`d90bb194498ee4dce0669aa5ddcc30c6a13d43750fac4768a240ade9228e4763`)

## Release notes for the store

Short form, for the "what's new" field:

```
Your staker card.

The Me tab now shows a card with your name, how many days you have held your
position, and how many stakers you are one of. One tap shares it as a picture,
with the caption already written.

Staking also got steadier: a run no longer stalls when you switch to your
wallet and back, and one slow transaction no longer holds up the rest.
```

## What actually changed

**The staker card.** A drawn card in the Me tab showing the `.skr` name the
wallet gave, days held, the date of the first stake, the size of the position
and how many stakers there are. The same drawing is what gets shared, not a
second design that resembles it.

**Sharing.** One tap hands the picture and its caption to the share sheet
together, so the text arrives in the post rather than in the clipboard. There
is no link in the caption on purpose: X pushes down anything carrying one, and
the address is printed on the card itself.

**The card no longer disappears.** The last card is kept on the phone and drawn
immediately at launch, so a cold start never leaves a hole where it belongs.

**Staking no longer looks stalled.** Confirmations used to be asked about one
part at a time, up to a hundred seconds each, so one silent part froze every
part behind it — twenty-six minutes in the worst case on a sixteen-part run.
Now every unfinished part is asked about once per round, and asking resumes the
moment the app is looked at again after the wallet took over the screen.

Nothing was ever at risk in the old behaviour: signatures are written to disk
the moment the wallet returns them and the chain is the judge. What was stuck
was the reporting, not the money.

**Smaller download.** The build carries code for arm64 only, which is what the
Seeker runs. This is what 1.0.1 shipped as well; the setting had been lost when
the native project was regenerated, and it is now held by a config plugin.

## Deliberately unchanged

**The double sound at launch.** Two plays of the same file 300 ms apart. It
looks like a bug and it is kept on purpose. Measured on this build: 239 ms
apart, the same as the published 1.0.1. Debug builds collapse the two into one
because the preferences read finishes later than both timers — so this is only
ever worth judging on a release build.

## Not in this release

- Reverse resolution of a wallet address to its `.skr` name. The name comes
  from what the wallet reports, which on a Seeker is the Seeker ID.
- A "never unstaked" badge. The chain does not prove it at a price worth
  paying: the field that looked like proof means "an unstake is running right
  now", so the badge would have gone to people who left and came back.
- Real background work. Finishing a run while the app is out of sight would
  need a foreground service and its permanent notification, which is a separate
  decision.
