import { memo, useRef } from "react";

/**
 * The roll.
 *
 * A chart recorder keeps the last of itself where you can pull it back, and
 * this is that: the retained window as a track, the present at its right-hand
 * end. Dragging anywhere on it sets the clock down at that moment and lets it
 * run forward again from there, at life size, until it catches up.
 *
 * The track grows for the first twelve minutes of a session and then holds,
 * because that is how much the map keeps. There is nothing to scrub to before
 * you arrived, and pretending otherwise would be the only dishonest thing a
 * transport could do.
 */
function Transport({ span, behind, onSeek }) {
  const trackRef = useRef(null);
  const dragging = useRef(false);

  // Below this there is not enough behind you to be worth offering.
  if (span < 30000) return null;

  const at = (event) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return;
    const fraction = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    // Left is oldest, right is now — the direction a roll comes off a drum.
    onSeek((1 - fraction) * span);
  };

  const label = () => {
    if (!behind) return "live";
    const seconds = Math.round(behind / 1000);
    const minutes = Math.floor(seconds / 60);
    return `−${minutes}:${String(seconds % 60).padStart(2, "0")}`;
  };

  const filled = span > 0 ? 1 - behind / span : 1;

  return (
    <div
      className="pointer-events-auto absolute inset-x-3 bottom-3 flex items-center gap-2.5 sm:left-auto sm:right-3 sm:w-[260px]"
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        onClick={() => onSeek(0)}
        title="Return to the live feed"
        className={`shrink-0 text-2xs uppercase tracking-label transition-colors ${
          behind ? "text-dim hover:text-text" : "text-text glow"
        }`}
      >
        {label()}
      </button>

      {/* The track is the control. Pointer capture rather than window listeners:
          a drag that leaves the strip should keep scrubbing, and should stop
          when the finger lifts wherever that happens to be. */}
      <div
        ref={trackRef}
        role="slider"
        tabIndex={0}
        aria-label="Replay the retained window"
        aria-valuemin={0}
        aria-valuemax={Math.round(span / 1000)}
        aria-valuenow={Math.round((span - behind) / 1000)}
        aria-valuetext={behind ? `${Math.round(behind / 1000)} seconds ago` : "live"}
        onPointerDown={(event) => {
          dragging.current = true;
          event.currentTarget.setPointerCapture?.(event.pointerId);
          at(event);
        }}
        onPointerMove={(event) => dragging.current && at(event)}
        onPointerUp={() => (dragging.current = false)}
        onPointerCancel={() => (dragging.current = false)}
        onKeyDown={(event) => {
          const step = event.shiftKey ? 30000 : 5000;
          if (event.key === "ArrowLeft") onSeek(Math.min(span, behind + step));
          else if (event.key === "ArrowRight") onSeek(Math.max(0, behind - step));
          else if (event.key === "Home") onSeek(span);
          else if (event.key === "End") onSeek(0);
          else return;
          event.preventDefault();
        }}
        className="group relative h-6 flex-1 cursor-ew-resize touch-none"
      >
        {/* Hairline, with the played part carried at reading weight. The hit
            area is the full height above; the mark is only what you see. */}
        <span className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-line" />
        <span
          className="absolute top-1/2 left-0 h-px -translate-y-1/2 bg-dim"
          style={{ width: `${Math.max(0, Math.min(1, filled)) * 100}%` }}
        />
        <span
          className={`absolute top-1/2 h-2.5 w-px -translate-y-1/2 ${behind ? "bg-text glow" : "bg-dim"}`}
          style={{ left: `${Math.max(0, Math.min(1, filled)) * 100}%` }}
        />
      </div>
    </div>
  );
}

export default memo(Transport);
