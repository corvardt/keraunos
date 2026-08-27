// The same strike, twice.
//
// The feed repeats itself. Measured on the upstream directly, 961 frames over
// two minutes: 26 of them, 2.7%, were a strike already reported arriving again
// rather than a second stroke, and they came back fast, a median of 0.23s after
// the first copy and none later than 2.4s. Nothing downstream here can tell
// the difference on its own, so a repeat is a second flash on the map, a second
// entry in the feed, a point of rate that never happened, one more strike in
// the cluster that decides a storm, and, since the countdown was fixed, a
// second bang for a sound that only ever left once.
//
// Exact repeats only, and deliberately. Steropes rejects anything within 25.6us
// of a frame it has already taken, which is right for what it does: it needs
// frames that are statistically independent, and it can afford to throw away
// half the sky to get them. This is a map. Two strikes a microsecond apart in
// Sumatra and Nebraska are two strikes, and a stroke five milliseconds after
// the one before it is a real second stroke of a real flash, which is a thing
// worth drawing. So the test is identity: same instant, same place.
//
// Position is part of the key rather than trusting the timestamp alone, and
// that is not caution: over the same two minutes, 25 frames carried a timestamp
// already seen from somewhere else on the planet, as many as there were real
// repeats. The solver mixes 1us and 100ns precision and `JSON.parse` has
// already rounded the low digits off a number too big to hold exactly, so a
// shared printed timestamp is common. A shared timestamp and a shared position
// to six decimals is the same strike.

// How far back a repeat can arrive and still be caught. Measured at 8.0 frames
// a second, so this is a minute, against a slowest observed repeat of 2.4s and
// a feed that reports a strike up to twelve seconds late and out of order. The
// margin is deliberate: the rate is what the sky is doing, and an hour of storm
// over Java is not the two quiet minutes this was measured in.
const WINDOW = 512;

/**
 * A filter for one session.
 *
 * Returns a predicate: true the first time a strike is offered, false every
 * time after. Insertion-ordered rather than time-ordered, because what expires
 * is the oldest thing heard, not the oldest thing struck.
 */
export function createFilter(window = WINDOW) {
  const seen = new Set();
  const order = [];
  return (time, lon, lat) => {
    const key = `${time}|${lon}|${lat}`;
    if (seen.has(key)) return false;
    seen.add(key);
    order.push(key);
    if (order.length > window) seen.delete(order.shift());
    return true;
  };
}
