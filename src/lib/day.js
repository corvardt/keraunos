// The session's long view.
//
// Every other window in the instrument is measured in minutes: sixty seconds of
// rate, four of burn, twelve of clustering, an hour of history. None of them can
// show the thing lightning does most reliably, which is a daily cycle. The
// planet fires hardest over land in the afternoon, so the global rate rises and
// falls three times a day as Africa, then the Americas, then Asia come around
// into the sun. An hour of history cannot contain that; a day of it is the
// difference between a heartbeat and a climatology.
//
// Nothing new is stored to get it. A strike costs about 64 bytes and the history
// already holds 120,000 of them; what is kept here is one count per minute, and
// a day is 1,440 counts. The strikes themselves are not retained past the hour
// they were always retained for, which is why this is a curve and not a longer
// rewind: it can say how hard the world was firing at four this morning, and
// nothing whatever about where.
//
// Session-scoped, like everything else here. It would be easy to keep in
// localStorage and come back to a real day, and it is deliberately not: the
// burn-in, the history and the ranking are all this session's own and go when
// the tab does, and one figure that quietly outlived the tab would be the only
// thing on the screen you could not account for by having watched it.

const MINUTE_MS = 60000;
const SPAN = 24 * 60; // minutes held; the ring wraps and the oldest rolls off

export function createDay() {
  // A ring of counts, plus the minute each slot belongs to. Without the second
  // array a slot cannot say whether it holds this hour's traffic or yesterday's
  // at the same clock position, and a quiet session would read as a busy one a
  // day stale.
  //
  // Integers because strikes are counted, not measured: what arrives here is
  // the length of a batch.
  const counts = new Int32Array(SPAN);
  const stamps = new Int32Array(SPAN).fill(-1);
  // The first minute anything landed in. A session almost never begins on a
  // minute boundary, so that minute holds only the part of itself that was
  // watched and reads low by the rest — the same defect as the minute in
  // progress, at the other end, and it has to go for the same reason. Left in,
  // every session opens on a ramp from nothing up to the true rate, which is a
  // picture of the tab being opened rather than of the weather.
  let first = null;

  // The reading is rebuilt only when the minute rolls over, and handed back by
  // identity in between. It is read twice a second by a panel that re-renders
  // on the same cadence, and a fresh array each time would be a fresh array
  // 120 times per minute for a curve that moves once.
  let cached = null;
  let cachedAt = -1;

  return {
    /** Adds a batch of arrivals to whichever minute they landed in. */
    record(n, now) {
      const minute = Math.floor(now / MINUTE_MS);
      const slot = ((minute % SPAN) + SPAN) % SPAN;
      if (stamps[slot] !== minute) {
        stamps[slot] = minute;
        counts[slot] = 0;
      }
      counts[slot] += n;
      if (first === null) first = minute;
    },

    /**
     * The curve, oldest first, in strikes per minute.
     *
     * Both ends are trimmed, and for one reason. The minute in progress holds
     * only as much of itself as has happened, and the minute the session opened
     * in holds only as much as was watched; each reads low by the rest, and
     * drawn they are a dive at the right-hand end every single minute and a
     * ramp up from nothing at the left. Neither is weather. The trace above is
     * already showing the present at full resolution, so this one can afford to
     * start and end a minute short and be true.
     */
    read(now) {
      const current = Math.floor(now / MINUTE_MS);
      if (cached && cachedAt === current) return cached;

      const series = [];
      let peak = null;
      for (let minute = current - SPAN; minute < current; minute++) {
        const slot = ((minute % SPAN) + SPAN) % SPAN;
        // A minute the session was not running for is absent rather than zero.
        // Drawn, a gap and a lull look the same and only one of them is
        // weather, so the session's own start has to stay visible.
        if (stamps[slot] !== minute || minute === first) continue;
        const point = { t: minute * MINUTE_MS, rate: counts[slot] };
        series.push(point);
        if (!peak || point.rate > peak.rate) peak = point;
      }

      cachedAt = current;
      cached = {
        series,
        peak,
        // How much of a day this actually is. The curve is as long as the
        // session has been running, and says so, rather than drawing a day's
        // worth of axis with twenty minutes of reading in the corner of it.
        spanMs: series.length * MINUTE_MS,
      };
      return cached;
    },
  };
}
