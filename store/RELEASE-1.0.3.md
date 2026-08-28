# SKR Eyes 1.0.3

versionCode 4 · arm64-v8a · signed with the release key
(`d90bb194498ee4dce0669aa5ddcc30c6a13d43750fac4768a240ade9228e4763`)

Ships alongside server release `0eb34ea`, deployed 28.08.2026.

## Release notes for the store

```
Two fixes people asked for.

Your days in stake are now read all the way back. Long-standing stakers were
being told a number far smaller than the truth: one holder of 216 days was
shown 74, because his position had more history than the app was willing to
walk through. That number is right now, and it corrected itself without this
update.

The stake screen now knows what your wallet holds. It shows your balance, dims
the splits you cannot afford, and tells you how many parts your amount will
actually fit into — instead of letting the chain refuse them one by one.
```

## What actually changed

**Days in stake are read to the end.** The walk back through a position's
history stopped after eight thousand signatures. A staker with 18 530 of them
was shown 74 days instead of 216 — and the people it got wrong were exactly the
longest-standing ones, because length and activity are what make a history long.
The ceiling is now forty thousand, which covers that account twice over, and the
answer is remembered for good once it is exact.

This half is server-side. It corrected itself for everyone the moment the server
was deployed; the update is not needed for it.

**The stake screen knows your balance.** It is read when the screen opens, shown
under the split options, and the options costing more than you hold are dimmed
rather than hidden — seeing that sixteen parts need 1 600 SKR when you hold 332
is the explanation. If the total is beyond the balance the screen says so in
words, with how many parts the amount does fit into, and will not sign.

This exists because of a real run on 27.08: sixteen parts of sixteen SKR against
a wallet holding twenty-eight. The chain took the first and refused fifteen with
"insufficient funds", and the person was left with fifteen red rows and no
reason. Only fees were lost, but the reading was "the app is broken".

If the balance cannot be read, staking is not blocked. The chain is still the
judge; this only saves a fee on a refusal that could be seen coming.

## Under the hood, no user-visible change

**Three RPC clients instead of one.** Everything used to share a single queue
with a half-second gap between calls, so somebody pressing Stake waited behind a
20 MB scan of the whole network and behind another person's forty-page history
walk — while the blockhash their transaction needs lives about a minute. The
Stake button now has its own queue, and the history walk runs on the free
endpoint where it belongs.

**The network scan no longer falls back onto the paid key.** It is the heaviest
call in the system, and it was configured to retry on the paid provider exactly
when the free one was already struggling.

## Deliberately unchanged

**The double sound at launch.** Two plays of the same file 300 ms apart. It
looks like a bug and is kept on purpose. Only ever judge it on a release build:
debug builds collapse the two into one.

## Still not done

- Visibility into RPC failures. The service writes about one line a day, so the
  failover counter is the only symptom available and the cause cannot be named.
- Reverse resolution of a wallet address to its `.skr` name.
- Any real background work while the app is out of sight.
