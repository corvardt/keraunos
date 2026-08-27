import { memo, useRef } from "react";

// Below this there is not enough behind you to be worth scrubbing into: a
// second of window under the finger, and a drag that lands wherever it likes.
const ARM_MS = 30000;

// The speeds the clock can be set running at. Life size is the reading; the
// other two exist because the window is now an hour on arrival, and an hour at
// life size is an hour of watching. Thirty puts the whole of it under two
// minutes, which is the pace a storm's own movement reads at.
const PACES = [1, 8, 30];

/**
 * The roll.
 *
 * A chart recorder keeps the last of itself where you can pull it back, and
 * this is that: the retained window as a track, the present at its right-hand
 * end. Dragging anywhere on it sets the clock down at that moment and lets it
 * run forward again from there, at life size, until it catches up.
 *
 * The track is an hour of roll, always, because an hour is what the map keeps.
 * A session opens holding the hour the relay handed over, so the ruler is
 * normally full from the first frame; a relay with less than an hour to give
 * leaves the far end bare, and the line is drawn only where there are strikes
 * behind it. There is nothing to scrub to before that, and pretending otherwise
 * would be the only dishonest thing a transport could do.
 *
 * Which is why it is drawn from the first frame and armed later. The unarmed
 * state used to be the first minutes of every session and is now the exception
 * rather than the rule: a reader with a relay behind them arrives with the
 * strip already working. It is kept for the sessions that do not, an archive
 * being read in or a relay with nothing to hand over, and the reasoning is
 * unchanged. It used to be absent until there were thirty seconds behind it,
 * and then it simply appeared: on a map nobody was watching the corner of, in
 * the one moment the weather had their attention. A control learned by being
 * noticed arriving is a control most people never learn they have. So the strip
 * is there from the start, inert and dim, with the hairline filling toward the
 * moment it starts working.
 *
 * What it carries is the window itself: a few dozen bars, each as tall as its
 * slice of the window was busy. A bare line says only that there is somewhere
 * to drag to. This says where in the last hour the sky was working, which is
 * the question somebody reaching for it already has.
 *
 * The two meanings of that fill meet at 100%. Filling, it is how much of the
 * arming window has arrived; armed, it is where the clock sits in the retained
 * one, and at the instant it arms both are full, so the mark changes job
 * without moving.
 */
function Transport({ from, roll, shape, at: instant, pace, onSeek, onPace }) {
  const trackRef = useRef(null);
  const dragging = useRef(false);

  // The window and the position in it, measured here and off one clock.
  //
  // Both used to arrive as durations worked out by the parent: `span` on a
  // two-second timer, `behind` at whatever moment the map happened to render.
  // A stepped denominator under a continuous numerator is a mark that lurches
  // twice a second, and at life size, where the replayed clock and the present
  // move together and the gap between them never changes, the lurch was the
  // only thing moving: the label read the same figure for a minute while the
  // mark walked several pixels to the right. What moves is the ends of the
  // window, so those are what is passed, and the arithmetic happens where it is
  // drawn, at the rate it is drawn.
  const now = Date.now();
  const span = from ? Math.max(0, now - from) : 0;
  const behind = instant ? Math.max(0, now - instant) : 0;
  const armed = span >= ARM_MS;

  const at = (event) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return;
    const fraction = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    // Left is the oldest the roll can reach, right is now: the direction a roll
    // comes off a drum. Clamped to what is actually held, so the empty end of
    // the roll parks you at the far edge of the window rather than at a moment
    // there is nothing to draw.
    onSeek(Math.min(span, (1 - fraction) * roll));
  };

  const label = () => {
    if (!behind) return "live";
    const seconds = Math.round(behind / 1000);
    const minutes = Math.floor(seconds / 60);
    return `−${minutes}:${String(seconds % 60).padStart(2, "0")}`;
  };

  // Against the whole roll, not against what is held.
  //
  // It used to be a fraction of the window, which made the mark's position mean
  // "how far back you are as a share of what there is" and moved it whenever
  // the window grew, which is every two seconds for the first hour of a
  // session. At life size the replayed clock keeps pace with the present, so
  // the gap never changes and the mark should not move at all: the label said
  // so and the mark disagreed, sliding right about a pixel a second under a
  // figure that had not changed in minutes. An hour of roll is a fixed ruler.
  // Time moves along it, the window's far end fills in behind, and where you
  // are standing stays where you are standing.
  const filled = armed ? 1 - behind / roll : span / ARM_MS;
  const across = `${Math.max(0, Math.min(1, filled)) * 100}%`;
  // Where the roll begins: the rest of the hour has not been paid out yet, and
  // nothing is drawn over it, the played line included.
  const begins = armed ? Math.max(0, 1 - span / roll) : 0;

  // Everything the track needs to be a control, and nothing while it is only a
  // promise of one: an inert strip that still took focus and answered to the
  // arrow keys would be the same broken control with better manners.
  const handles = armed
    ? {
        ref: trackRef,
        role: "slider",
        tabIndex: 0,
        "aria-label": "Replay the retained window",
        "aria-valuemin": 0,
        "aria-valuemax": Math.round(span / 1000),
        "aria-valuenow": Math.round((span - behind) / 1000),
        "aria-valuetext": behind ? `${Math.round(behind / 1000)} seconds ago` : "live",
        // Pointer capture rather than window listeners: a drag that leaves the
        // strip should keep scrubbing, and should stop when the finger lifts
        // wherever that happens to be.
        onPointerDown: (event) => {
          dragging.current = true;
          event.currentTarget.setPointerCapture?.(event.pointerId);
          at(event);
        },
        onPointerMove: (event) => dragging.current && at(event),
        onPointerUp: () => (dragging.current = false),
        onPointerCancel: () => (dragging.current = false),
        onKeyDown: (event) => {
          // A fraction of the track rather than a fixed number of seconds. The
          // window this rides is no longer always twelve minutes: it grows to
          // an hour, and shrinks again when the world is busy enough to hit the
          // memory ceiling. Five seconds of an hour is a third of a pixel, so a
          // fixed step would have left the arrow keys apparently doing nothing
          // at one end and jumping at the other. A hundredth moves the mark by
          // about two pixels wherever the window happens to be.
          const step = Math.max(2000, roll / (event.shiftKey ? 10 : 100));
          if (event.key === "ArrowLeft") onSeek(Math.min(span, behind + step));
          else if (event.key === "ArrowRight") onSeek(Math.max(0, behind - step));
          else if (event.key === "Home") onSeek(span);
          else if (event.key === "End") onSeek(0);
          else return;
          event.preventDefault();
        },
      }
    : { "aria-hidden": true };

  // The scale, in fifths of an hour of roll. Minor ticks every five minutes,
  // named every fifteen: enough to find a moment by, few enough that the row
  // reads as a ruler rather than as a second histogram.
  const ticks = [];
  for (let i = 0; i <= 12; i++) ticks.push({ at: i / 12, major: i % 3 === 0 });

  return (
    <div
      data-tour="transport"
      // Centred and long, and now two rows: the roll, and the readouts that
      // belong to it. It used to sit in the right-hand corner at 260px, which
      // was the right size for a control that was mostly a promise. It opens on
      // an hour of weather and carries the shape of it, so it is given the width
      // that makes the shape legible and the position of the thing you are
      // meant to reach for.
      className="pointer-events-auto absolute inset-x-3 bottom-3 sm:left-1/2 sm:right-auto sm:w-[min(860px,68vw)] sm:-translate-x-1/2"
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      {/* The readouts, over the roll they describe: where the clock is standing
          on the left, how fast it is running on the right. Both are labels in
          the one idiom the rest of the instrument uses, and only the position
          blooms, because only the position is a live value. */}
      <div className="mb-1.5 flex items-baseline justify-between gap-4">
        {armed ? (
          <button
            type="button"
            onClick={() => onSeek(0)}
            title="Return to the live feed"
            className={`shrink-0 text-2xs uppercase tracking-label tabular-nums transition-colors touch:-ml-1.5 touch:px-1.5 touch:py-2 ${
              behind ? "text-dim hover:text-text focus-visible:text-text active:text-text" : "text-text glow"
            }`}
          >
            {label()}
          </button>
        ) : (
          // Named rather than counted down: what it is going to be is the useful
          // thing to say, and how many seconds until a control you have not used
          // yet starts working is not something anyone is waiting on.
          <span
            className="shrink-0 text-2xs uppercase tracking-label text-dim"
            title="The retained window, playable once there is enough behind you to rewind into"
          >
            rewind
          </span>
        )}

        {/* Three stops rather than one button cycling through them. The strip is
            wide enough now to show the whole switch, and a switch you can read
            the positions of is one you can use without pressing it first. Held
            in place while the clock is live: a control that comes and goes takes
            the width of the roll with it, and near the live end, where a click
            can land either side of the threshold, that made the whole thing jump
            sideways every time it crossed. */}
        <div
          className={`flex shrink-0 items-baseline gap-2.5 text-2xs uppercase tracking-label tabular-nums ${
            armed && behind > 0 ? "" : "invisible"
          }`}
          aria-hidden={armed && behind > 0 ? undefined : true}
        >
          <span className="text-line">speed</span>
          {PACES.map((rate) => (
            <button
              key={rate}
              type="button"
              onClick={() => onPace(rate)}
              tabIndex={armed && behind > 0 ? undefined : -1}
              aria-pressed={rate === pace}
              title={rate === 1 ? "Life size: the gap to the present holds" : `${rate} times life size`}
              className={`transition-colors touch:px-1 touch:py-2 ${
                rate === pace
                  ? "text-text"
                  : "text-dim hover:text-text focus-visible:text-text active:text-text"
              }`}
            >
              ×{rate}
            </button>
          ))}
        </div>
      </div>

      {/* The roll. Bars above the line, scale below it, the way a chart recorder
          lays out paper: what was drawn on top, what it is measured against
          underneath. The whole block is the drag target, not just the line. */}
      <div
        {...handles}
        className={`group relative h-10 touch-none touch:h-12 ${armed ? "cursor-ew-resize" : ""}`}
      >
        {/* The window, as a shape. One weight throughout: carrying the played
            part brighter, as the hairline does, broke the histogram into two
            blocks at the mark and read as the same curve drawn twice at two
            exposures. Position is the line's job and the mark's. Hidden from a
            screen reader, which is given the same window as a position in
            seconds. */}
        {armed && shape.length > 0 && (
          <span className="absolute inset-x-0 top-0 flex h-4 items-end gap-px" aria-hidden="true">
            {shape.map((height, index) => (
              <span
                key={index}
                className="flex-1 bg-line"
                // A minimum on anything at all, because a slice with strikes in
                // it and a slice with none are different readings and a
                // hundredth of the peak would draw as neither.
                style={{ height: height > 0 ? `${Math.max(height * 100, 10)}%` : 0 }}
              />
            ))}
          </span>
        )}

        {/* Hairline, drawn only where there is window. The roll is a fixed hour
            and a session holds less than that until it has run for one, so the
            line starts where the strikes do: the bare end is roll not yet paid
            out, which is a reading rather than an absence. The played part is
            carried at reading weight over it. */}
        <span
          className="absolute top-4 right-0 h-px bg-line"
          style={{ width: `${Math.min(1, span / roll) * 100}%` }}
        />
        <span
          className="absolute top-4 h-px bg-dim"
          style={{ left: `${begins * 100}%`, width: `${Math.max(0, Math.min(1, filled) - begins) * 100}%` }}
        />

        {/* The scale. Ticks hang below the line and the named ones carry the
            minute they stand for, so a moment can be found on the roll before
            the clock is set down on it rather than after. */}
        <span className="absolute inset-x-0 top-[17px] block h-2" aria-hidden="true">
          {ticks.map((tick) => (
            <span
              key={tick.at}
              className={`absolute top-0 w-px ${tick.major ? "h-2 bg-dim" : "h-1 bg-line"}`}
              style={{ left: `${tick.at * 100}%` }}
            />
          ))}
        </span>
        <span
          className="absolute inset-x-0 top-[22px] hidden h-3 text-2xs uppercase tracking-label text-dim sm:block"
          aria-hidden="true"
        >
          {ticks
            .filter((tick) => tick.major)
            .map((tick, index, majors) => (
              <span
                key={tick.at}
                className="absolute top-0 whitespace-nowrap"
                // The ends are hung off their own edge rather than centred on
                // it: a label centred on the last tick is half outside the roll.
                style={
                  index === 0
                    ? { left: 0 }
                    : index === majors.length - 1
                      ? { right: 0 }
                      : { left: `${tick.at * 100}%`, transform: "translateX(-50%)" }
                }
              >
                {tick.at === 1 ? "now" : `\u2212${Math.round((1 - tick.at) * roll) / 60000}m`}
              </span>
            ))}
        </span>

        {/* Where the clock is standing. The one thing here that blooms, and the
            only mark that crosses the line: the bars are what happened, the
            scale is what it is measured against, and this is you. */}
        <span
          className={`absolute top-2 h-3 w-px ${behind ? "bg-text glow" : "bg-dim"}`}
          style={{ left: across }}
        />
      </div>
    </div>
  );
}

export default memo(Transport);
