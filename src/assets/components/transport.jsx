import { memo, useRef } from "react";

// Below this there is not enough behind you to be worth scrubbing into: a
// second of window under the finger, and a drag that lands wherever it likes.
const ARM_MS = 30000;

// The speeds the clock can be set running at. Life size is the reading; the
// other two exist because the window is now half an hour on arrival, and half
// an hour at life size is half an hour of watching. Thirty puts the whole of it
// under a minute, which is the pace a storm's own movement reads at.
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
 * A session opens holding the half hour the relay handed over and fills the
 * rest of the ruler as it runs, so the line is drawn only where there are
 * strikes behind it and the bare end is roll not yet paid out. There is nothing
 * to scrub to before that, and pretending otherwise would be the only dishonest
 * thing a transport could do.
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
 * to drag to. This says where in the last half hour the sky was working, which
 * is the question somebody reaching for it already has.
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

  return (
    <div
      data-tour="transport"
      // Centred and long. It used to sit in the right-hand corner at 260px,
      // which was the right size for a control that was mostly a promise: there
      // was nothing behind it for the first minutes of a session and little to
      // read on it after. It now opens on half an hour of weather and carries
      // the shape of it, so it is given the width that makes that shape legible
      // and the position of the thing you are meant to reach for.
      className="pointer-events-auto absolute inset-x-3 bottom-3 flex items-center gap-3 sm:left-1/2 sm:right-auto sm:w-[min(720px,62vw)] sm:-translate-x-1/2"
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      {armed ? (
        <button
          type="button"
          onClick={() => onSeek(0)}
          title="Return to the live feed"
          className={`w-16 shrink-0 text-left text-xs uppercase tracking-label tabular-nums transition-colors touch:-ml-1.5 touch:px-1.5 touch:py-3 ${
            behind ? "text-dim hover:text-text active:text-text" : "text-text glow"
          }`}
        >
          {label()}
        </button>
      ) : (
        // Named rather than counted down: what it is going to be is the useful
        // thing to say, and how many seconds until a control you have not used
        // yet starts working is not something anyone is waiting on.
        <span
          className="w-16 shrink-0 text-left text-xs uppercase tracking-label text-dim"
          title="The last twelve minutes, playable once there is enough behind you to rewind into"
        >
          rewind
        </span>
      )}

      {/* Taller under a finger than under a cursor. A 24px strip is a generous
          target for a mouse and a coin toss for a thumb, and the mark it
          carries is a hairline either way: what grows is the box the drag is
          picked up in, not anything drawn. */}
      <div
        {...handles}
        className={`group relative h-9 flex-1 touch-none touch:h-12 ${armed ? "cursor-ew-resize" : ""}`}
      >
        {/* The window, as a shape. One weight throughout, and that is the
            correction rather than the shortcut: carrying the played part
            brighter, as the hairline below does, broke the histogram into two
            blocks at the mark and read as the same curve drawn twice at two
            exposures. Position is the line's job and the mark's. This is a
            reading, and a reading does not change because you have watched
            part of it. Hidden from a screen reader, which is given the same
            window as a position in seconds. */}
        {armed && shape.length > 0 && (
          <span className="absolute inset-x-0 bottom-1/2 flex h-4 items-end gap-px" aria-hidden="true">
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

        {/* Hairline, drawn only where there is window. The roll is a fixed
            hour and a session holds less than that until it has run for one, so
            the line starts where the strikes do: the bare end is how much roll
            has yet to be paid out, which is a reading rather than an absence.
            The played part is carried at reading weight over it. */}
        <span
          className="absolute top-1/2 right-0 h-px -translate-y-1/2 bg-line"
          style={{ width: `${Math.min(1, span / roll) * 100}%` }}
        />
        <span
          className="absolute top-1/2 h-px -translate-y-1/2 bg-dim"
          style={{ left: `${begins * 100}%`, width: `${Math.max(0, Math.min(1, filled) - begins) * 100}%` }}
        />
        <span
          className={`absolute top-1/2 h-5 w-px -translate-y-1/2 ${behind ? "bg-text glow" : "bg-dim"}`}
          style={{ left: across }}
        />
      </div>

      {/* Shown only once the clock is down, and its width held in reserve
          before then. Live, there is no speed to set: the world runs at one and
          the control would be a switch with nothing on the other side of it.
          But a control that comes and goes takes the track's width with it, and
          near the live end, where a click can land either side of the
          threshold, that made the whole strip and everything drawn on it jump
          sideways every time it crossed. So it holds its place while it has
          nothing to say. The label at the other end is fixed for the same
          reason: "live" and "−12:40" are not the same number of characters.

          Cycled rather than laid out as three, because this is a switch with
          three positions and three buttons would be most of the strip. */}
      <button
        type="button"
        onClick={() => onPace(PACES[(PACES.indexOf(pace) + 1) % PACES.length])}
        title="How fast the replay runs: life size, eight times, thirty times"
        aria-label={`Replay speed, ${pace} times life size. Click to change.`}
        aria-hidden={armed && behind > 0 ? undefined : true}
        tabIndex={armed && behind > 0 ? undefined : -1}
        className={`w-10 shrink-0 text-right text-xs uppercase tracking-label tabular-nums transition-colors touch:-mr-1.5 touch:px-1.5 touch:py-3 ${
          armed && behind > 0 ? "text-dim hover:text-text active:text-text" : "invisible"
        }`}
      >
        ×{pace}
      </button>
    </div>
  );
}

export default memo(Transport);
