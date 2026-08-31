// When the flash actually happened, on this machine's clock.
//
// Every frame carries two times: `time`, the strike's own UTC moment as the
// network solved it, exact to the microsecond, and `delay`, how far behind that
// the network was when it let go of the frame. Neither is the thing the
// countdown needs, which is that moment as this browser's clock would have read
// it. Taking `Date.now()` at arrival and subtracting `delay` looks like an
// answer and is not: `delay` stops being counted at the far end, so everything
// after it (the send, the relay's hop, the socket into here) is added silently
// on top, and the flash is placed that much later than it happened. Sound
// covers a third of a kilometre a second, so two seconds of it is a bang that
// arrives while the panel still says seven.
//
// The strike's own time is exact but sits on a clock this browser does not
// share; the arrival is on the right clock but late by an unknown amount. The
// difference between them is therefore the clock offset plus the trip, and
// while the offset holds still, the trip does not: it is a queue, and a queue
// has a floor. The smallest difference seen lately is that floor, which is the
// offset plus the one hop nothing can remove, and it is the closest thing to
// the flash's local time that can be had without asking anybody the time.
//
// It self-corrects, which is the point: a browser five seconds off UTC, a relay
// on the far side of the planet and a feed having a slow minute all move the
// floor rather than the reading.

// How fast the floor is allowed to climb back, in milliseconds per millisecond
// of quiet. Without it the session's single luckiest frame, or a clock stepped
// backwards by NTP, would hold the floor down for as long as the tab was left
// open, and every bang after it would be early. At this rate a bad sample is
// forgotten over a minute or two, while a feed arriving many times a second
// refreshes the minimum long before the leak is worth anything: at this rate a
// second of quiet is worth fifty milliseconds of doubt.
const LEAK = 0.05;

/**
 * A clock for one session.
 *
 * Returns a function of (strike time, arrival time), both in epoch
 * milliseconds, giving when the flash happened as this machine's clock reads
 * it, or null where the frame carried no time of its own. Never later than the
 * arrival: the sound cannot have set off after we heard about it.
 *
 * The floor it is working from is carried on the function itself, because it is
 * worth reading and there is nowhere else it exists. It is the offset between
 * the two clocks plus the one hop nothing can remove, and those two cannot be
 * told apart from here, so it is not a latency: a browser five seconds off UTC
 * reads five seconds of floor and is not five seconds from the relay. What it
 * honestly is, is the correction this session is applying, and therefore how
 * far out the arrival time would be without it. Infinity until the first frame
 * that carried a time of its own.
 */
export function clock(leak = LEAK) {
  let floor = Infinity;
  let last = 0;
  const at = (struck, arrived) => {
    if (!Number.isFinite(struck)) return null;
    floor = Math.min(arrived - struck, floor + (arrived - last) * leak);
    last = arrived;
    at.floor = floor;
    return struck + floor;
  };
  at.floor = Infinity;
  return at;
}
