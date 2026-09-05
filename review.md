# Keraunos: sensitive, important and critical surfaces

A read of the full data path end to end: relay worker, Pages proxy, socket
client, ingest/flush loops, replay, archive, tile pyramid. Ranked by blast
radius if it breaks or is wrong.

## Tier 1 — critical (whole system depends on it)

**1. `relay/src/index.js` — the `Feed` Durable Object**
Single global instance (`idFromName("world")`) holding the only upstream socket
to Blitzortung for every visitor on earth. `ensure()` / `alarm()` / the
once-a-minute `scheduled()` wake are a three-part liveness mechanism guarding
against DO eviction, which is silent and undetectable from the client. If this
stalls, everyone sees a dead map with no error. The most load-bearing 429 lines
in the repo.

**2. `relay/src/index.js:fetch` — the `ALLOWED_ORIGINS` gate**
The *only* access control in the system. An unset var now **fails closed**: no
list is a 503, and `wrangler dev` says `OPEN_RELAY=1` in `.dev.vars` to get the
old behaviour. The trailing-slash strip exists because the opposite typo fails
closed silently. Note: `Origin` is browser-enforced only, so any non-browser
client can forge it, which is what the per-address catch-up limit is for.

**3. `src/lib/backfill.js` — the `pack`/`unpack` wire format**
Imported by *both* the worker and the browser. `MAGIC` (`KRN1`) is what
synchronously distinguishes a backfill blob from a JSON control frame on the
same binary channel. Change `HEAD`/`RECORD`/`MAGIC` on one side and you get
silently misparsed coordinates, not an error.

**4. Dedup key agreement: `relay keep()` ↔ `Seeker.onmessage` ↔ `src/lib/repeat.js`**
Both ends must compute `Math.round(time / 1e6)` identically, because a strike
can arrive by two doors (backfill and live wire) and must key the same way. If
these drift, every strike double-counts: double flash, double rate, double storm
weight, double thunder.

**5. `functions/msg.js` — the EUMETSAT proxy**
Exists solely because EUMETSAT sends no CORS header and `getImageData` on a
tainted canvas throws. The `LAYERS` Set, `MAX_SIDE`, and the
rebuild-don't-forward param loop are the open-proxy gate: without them anyone
can route arbitrary traffic through your hostname on your bill.

## Tier 2 — important (subtle, high-consequence correctness)

**6. `Seeker.jsx` socket lifecycle**
`binaryType = "arraybuffer"` (blob would force async type detection), the
`socket !== ws` guard preventing stacked reconnect timers on a flapping link,
jittered backoff, and the close-on-open teardown for `CONNECTING`. Callbacks
*must* stay referentially stable or the socket tears down every render.

**7. `App.jsx:handleDataReceived`**
The hot path, ~8×/s, deliberately stable (empty dep array) and closing over refs
only. Feeds five accumulators plus thunder scheduling. The `MAX_QUEUE * 2` slack
trim exists because a hidden tab gets no animation frames while the socket keeps
delivering.

**8. `App.jsx:absorb` + the sorted-history invariant**
Backfill deliberately bypasses the live door (14k strikes through it would be
one white frame and a rate of 30k/min). Everything downstream binary-searches
via `since()`, so `history.current` must stay append-ordered by `t`; the
`strike.at > from` filter enforces suffix-only insertion.

**9. `src/lib/lag.js:clock()`**
Min-floor-with-leak estimator for clock offset + transit. Drives thunder timing;
getting it wrong puts the bang seconds off. The `LEAK` constant is the
anti-lucky-sample correction.

**10. `src/lib/archive.js:parseArchive`**
The only genuinely untrusted input in the app. Bounds-checked (`MAX_BYTES`,
`MAX_ROWS`, lon/lat ranges, `SKEW_MS`) before anything can become a NaN in a
render loop. `loadArchive` pre-checks `file.size` before `text()`.

**11. Relay bucket persistence — `save()`/`restore()`/`trim()`**
What makes the hour survive a deploy. Two-bucket writes (not whole-window
rewrites), `BUCKETS` slack, orphan sweep in `restore()`. Fire-and-forget by
design so storage latency never fronts the feed.

**12. `src/lib/settings.js`**
`{...DEFAULTS, ...JSON.parse(saved)}` merge with legacy-key fallback; every
visual and layer toggle in the app funnels through it.

## Tier 3 — architecture choices worth knowing

**13. `src/lib/field.js` (1714 lines)**
Source-agnostic Mercator tile pyramid: center-out fetch queue, eviction budget,
ancestor substitution, crossfade. `ir.js`, `rain.js`, `polar.js` are just sources
supplying four functions. The single biggest reuse decision in the repo.

**14. Replay by re-derivation, not snapshots**
`walk()` re-runs `detectStorms`/`trackStorms` across the window instead of
storing per-step cell snapshots. Trades CPU-on-scrub for tens of MB never
allocated. `SEED_BUDGET_MS`/`idle()` slicing keeps the 130ms seeding walk from
dropping frames at first paint.

**15. Refs-not-state buffering with tiered cadences**
`FLUSH_MS` 500 / `STORM_EVERY_MS` 2000 / `MAX_HISTORY` 120000 /
`STORM_WINDOW_MS` 12min deliberately separate from `HISTORY_MS` 1h. That split
is called out in-code as a past bug: they used to be one number.

**16. `ir.js` pixel-budget metering**
WMS over the tile API specifically because RealEarth meters anonymous use at
500 MP/day and returns *watermarked* (not refused) imagery past it.
`SAMPLES = 64` cut a tab's daily spend from 264 MP to 17.

**17. Palette via CSS custom properties**
`usePalette` writes tokens, canvas reads computed style. `paletteKey` is the only
part React sees.

**18. Geolocation**
Opt-in only, session-held, never stored, never transmitted. Correct as built.

**19. CI deliberately excludes `npm run check`**
Network checks live in `upstream.yml` so third-party outages don't train people
to ignore red marks. It does bundle the relay now, which needs nothing external.

## Gaps worth a look — closed 2026-09-05

- **Backfill send amplification**: `catchUp` sent up to `MAX_HISTORY × 12`
  ≈ 1.4 MB to every connecting socket, behind an `Origin` header anything but a
  browser writes for itself. `Feed.mayCatchUp` now counts catch-ups per
  `cf-connecting-ip`, eight a minute; over that the socket is still served and
  still gets the live wire, it just starts empty. Counted in the object because
  the worker in front of it is request-scoped. `scripts/check-relay.cjs`.
- **No CSP or security headers**: `public/_headers` now carries
  `default-src 'none'` with the four services and the relay named, the head
  script as a hash, and nosniff / no-referrer, following Oikos's file. Verified
  by serving `dist` with those headers and driving it headless: zero violations,
  and gibs and realearth were both reached during the run.
- **Cross-package import coupling**: `ci.yml` now runs `wrangler deploy
  --dry-run` in `relay/` after the site build, which bundles the worker exactly
  as a deploy would and needs no credentials. A change to lzw/backfill/repeat
  that breaks the worker now fails CI.
- **`restore()` dedup re-seed is partial**: the comment was the wrong half. The
  behaviour was already right, a Set keeping its last `WINDOW` insertions ends
  up holding the newest end either way; what was wrong was walking 120k strikes
  to get there and a comment that read broader than the filter. Now
  `slice(-WINDOW)`, with `WINDOW` imported from repeat.js rather than repeated.

Found while closing them: `npm run check` named eleven scripts that were not on
disk. Ten were restored from before `e066029` and pass; `check-palette.cjs`
needed its baseline read from crt.css, which is where the palette moved, and
`check-ir.cjs` needed the disc that `flat` now takes. `check-land.cjs` and
`build-land.cjs` are deleted: `src/lib/land.js` went with the new map, so their
subject no longer exists. The chain runs clean end to end, and now starts with
`check:relay`.
