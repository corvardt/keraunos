// The rate window: how hard the world is firing, right now.
//
// This was a ring of 120 slots, one per half-second flush, summed and called
// strikes per minute. That is only a minute if the flushes are half a second
// apart, and a background tab is exactly where they are not: a browser
// throttles timers it cannot see, and measured in a hidden tab this
// instrument's own 500ms interval was firing every five seconds, then every
// minute. A hundred and twenty of those is hours of arrivals presented as one
// minute: the panel read 173 strikes a second against a planet that makes 44,
// which is the reading this project exists to be honest about, inverted into a
// boast.
//
// So the window is measured in time rather than counted in ticks, and a flush
// carries the stretch of time it covered rather than a single instant. That
// second half matters as much as the first: a throttled tab hands over a minute
// of arrivals in one call, and a window that counted such a batch as landing at
// one moment would still be a third too high at the boundary, better than ten
// times and still wrong. Each batch is spread across the interval it actually
// covered, and the part of that interval lying inside the last sixty seconds is
// the part that counts.
//
// The session day (`day.js`) never had this defect, because it banks by
// wall-clock minute. Same fix, arrived at from the other end, and it is why a
// throttled tab could draw a correct day curve beside a rate ten times too big.

/** The window every reading here is over. */
export const WINDOW_MS = 60000;

/**
 * @param startedAt when the window opened, so the first flush has a real
 *   interval behind it rather than a zero-length one.
 */
export function createRate(startedAt = Date.now()) {
  // The stretches of time that make up the window, oldest first: when a batch
  // began accumulating, when it was flushed, and how many were in it. Flushes
  // arrive in order, so expiry is always a prefix and never a scan.
  let spans = [];
  let last = startedAt;

  // Everything before `at` has left the window. Slicing a prefix on every flush
  // is a fresh array twice a second for a list that is mostly unchanged; the
  // cursor moves instead, and the array is compacted only when the dead prefix
  // is worth the copy.
  let at = 0;

  const expire = (now) => {
    const cutoff = now - WINDOW_MS;
    while (at < spans.length && spans[at].to <= cutoff) at++;
    if (at > 64) {
      spans = spans.slice(at);
      at = 0;
    }
  };

  return {
    /**
     * Files a flushed batch across the interval it accumulated over.
     *
     * In front, that interval is the 500ms flush and this is indistinguishable
     * from filing it at an instant. Hidden, it can be the whole window, and the
     * difference is the whole reading.
     */
    record(n, now) {
      spans.push({ from: last, to: now, n });
      last = now;
      expire(now);
    },

    /**
     * The rate, and the shape of the minute behind it.
     *
     * A span lying wholly inside the window counts whole. One straddling the
     * far edge counts for the fraction of itself that is still inside it, which
     * assumes its arrivals were spread evenly across it, the same assumption
     * every rate over an interval makes, and the only one available without
     * keeping the strikes themselves, which this deliberately does not.
     *
     * `perMinute` is therefore a sum and not an extrapolation. A session
     * younger than the window reports the traffic actually watched and ramps up
     * over its first minute, rather than guessing what a full minute would have
     * held.
     */
    read(now) {
      expire(now);
      const cutoff = now - WINDOW_MS;
      const live = at ? spans.slice(at) : spans;

      let sum = 0;
      const samples = [];
      for (const span of live) {
        const width = span.to - span.from;
        // A flush with no interval behind it cannot be prorated and cannot have
        // a rate read off it; it counts whole and contributes no shape.
        if (width <= 0) {
          sum += span.n;
          continue;
        }
        const inside = Math.min(span.to, now) - Math.max(span.from, cutoff);
        if (inside <= 0) continue;
        sum += span.n * (inside / width);
        // Per second, not per flush. The trace draws the shape of the window
        // across its own width, and under a throttle a flush holds ten times as
        // many strikes because it covered ten times as long. Plotted raw, that
        // is a spike where the reading did not change at all.
        samples.push((span.n / width) * 1000);
      }

      return {
        perMinute: Math.round(sum),
        samples,
        spanMs: live.length ? Math.min(WINDOW_MS, now - Math.max(live[0].from, cutoff)) : 0,
      };
    },
  };
}
