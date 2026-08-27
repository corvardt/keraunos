// The half hour that happened before you got here.
//
// Everything this instrument shows is accumulated: the map is empty on arrival
// and fills as the sky works, which means the first five minutes of a visit are
// spent watching an instrument that has nothing to say yet. Storm cells need
// twelve minutes of strikes before they exist at all, and a heading needs ten
// more than that, so the one thing this map does that a dot plot does not was
// unavailable to anybody who did not stay. The relay is already holding the
// feed for everybody; holding the last half hour of it costs a quarter of a
// megabyte and hands a visitor a running instrument in the time it takes to
// open a socket.
//
// Thirty minutes and not an hour, because the value is not linear in the
// window. Twelve minutes is where cells appear, twenty-five is the window a
// heading is regressed over, six is what a surge is read from, and twenty is
// two of the three burn bands. Thirty covers all of that. The second half hour
// buys the third burn band and a longer rewind track for the same weight again.
//
// This file is the wire format, and it is imported by both ends: the relay
// packs, the browser unpacks. One definition, because a format described twice
// is a format that drifts.

// Four bytes that a control frame cannot begin with. The relay's two kinds of
// binary message have to be told apart synchronously, and its other kind is
// JSON, which starts with a brace.
const MAGIC = 0x314e524b; // "KRN1", little-endian

// Position as microdegrees in an int32: eleven centimetres, which is finer than
// the network fixes a strike by four orders of magnitude, and the same six
// decimals the feed itself prints. The time is milliseconds from the anchor,
// which at a uint32 covers seven weeks of window.
const HEAD = 12; // magic, then the anchor as a float64
const RECORD = 12;

/**
 * Strikes to bytes. Oldest first, and each needs `at` (the flash, epoch ms),
 * `lon` and `lat`. Anything at a negative offset from the first strike is
 * dropped rather than wrapped: the caller hands these over in order.
 */
export function pack(strikes) {
  const anchor = strikes.length ? strikes[0].at : 0;
  const buffer = new ArrayBuffer(HEAD + strikes.length * RECORD);
  const view = new DataView(buffer);
  view.setUint32(0, MAGIC, true);
  view.setFloat64(4, anchor, true);
  let n = 0;
  for (const strike of strikes) {
    const offset = Math.round(strike.at - anchor);
    if (offset < 0) continue;
    const at = HEAD + n * RECORD;
    view.setUint32(at, offset, true);
    view.setInt32(at + 4, Math.round(strike.lon * 1e6), true);
    view.setInt32(at + 8, Math.round(strike.lat * 1e6), true);
    n++;
  }
  return n === strikes.length ? buffer : buffer.slice(0, HEAD + n * RECORD);
}

/**
 * Bytes back to strikes, or null if this was not one of ours.
 *
 * Null rather than a throw, because the caller is a socket handler deciding
 * what kind of frame it just got, and "not a backfill" is an answer rather than
 * a fault.
 */
export function unpack(buffer) {
  if (!buffer || buffer.byteLength < HEAD) return null;
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== MAGIC) return null;
  const anchor = view.getFloat64(4, true);
  const strikes = [];
  for (let at = HEAD; at + RECORD <= buffer.byteLength; at += RECORD) {
    strikes.push({
      at: anchor + view.getUint32(at, true),
      lon: view.getInt32(at + 4, true) / 1e6,
      lat: view.getInt32(at + 8, true) / 1e6,
    });
  }
  return strikes;
}
