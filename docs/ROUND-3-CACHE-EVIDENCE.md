# Round 3 cache evidence

The external handoff recorded the failing state more than 12 hours earlier: the clean URL returned the old `skr-token-white.svg`, old visitor-counter footer, no OG tags and no `INCLUDE DUST`, while a cache-busted URL returned the current markup. Exact response headers were not preserved in that observation, so they cannot be reconstructed honestly.

On 2026-08-04, before the Round 3 deployment, both the clean URL and a cache-busted URL returned:

```text
HTTP/1.1 200 OK
Content-Type: text/html; charset=utf-8
Cache-Control: no-cache, must-revalidate
cf-cache-status: DYNAMIC
Server: cloudflare
```

Neither response included `Age`, `ETag` or `Last-Modified`. The origin at `127.0.0.1:4173` returned the same HTML cache policy. Both public responses contained `skr-eyes-mark.svg`, `INDEXED SINCE AUG 2026`, `INCLUDE DUST` and `og:title`, and did not contain the old mark or visitor counter.

Conclusion: the stale response had been an edge/intermediate cached HTML object, not the current origin response. The current `DYNAMIC` result plus origin `no-cache, must-revalidate` closes the immediate fault. Fingerprinted assets and the mandatory purge/verification release gate prevent recurrence.
