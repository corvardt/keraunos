import { useEffect, useState } from "react";

import { fieldFor, momentFor } from "../../lib/sources.js";

/**
 * How old the weather behind the map is.
 *
 * The one layer on this instrument that is not live and cannot be. Strikes
 * arrive in seconds; a satellite has to finish sweeping a disc and an agency
 * has to publish it, so the sky under the strikes is always some tens of
 * minutes behind them. Unsaid, that is a quiet lie of exactly the kind this map
 * is otherwise careful about — a reader watching a cell fire over a clear patch
 * has no way to know the cloud simply has not caught up yet.
 *
 * Off when the field is, because then there is no age to report and a footer
 * that says something about a layer nobody turned on is noise.
 *
 * Owns its own tick, for the reason `Clock` does: a minute passing is not a
 * reason to re-render the map, the feed and the panels. Thirty seconds rather
 * than sixty so the figure is never more than half a minute behind its own
 * rounding — it is cheap, this is one span.
 */
/**
 * Whether the layer is whole, in the fewest words that are still true.
 *
 * Silence is the default and has to be: this footer is read past, not read, and
 * a caveat that appears while a tile is in the air would be a warning about the
 * network being a network. So nothing is said until enough of the view is
 * missing that the picture itself is misleading.
 *
 * A fifth, because of what the gap looks like. A missing tile is not drawn as a
 * hole — the ancestor beneath it is stretched over the ground instead — and a
 * dish that failed leaves its territory drawn as clear sky. Both are plausible
 * weather. One tile short of thirty is a corner nobody is reading; a fifth of
 * the sky is a reading, and a reader deciding whether a cell is firing into
 * clear air deserves to know the clear air might be missing data.
 */
const SHORT = 0.2;

function shortfall(health) {
  if (!health || !health.whole) return null;
  const absent = health.whole - health.held;
  // Counted together because they are the same failure to a reader: ground the
  // layer is drawing something for without having been told what is there.
  const unsure = absent + health.partial;
  if (unsure / health.whole < SHORT) return null;
  return absent >= health.partial ? "incomplete" : "dishes short";
}

export default function FieldAge({ kind, replayAt, health }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const field = fieldFor(kind);
  const at = momentFor(kind, replayAt, now);
  if (!field) return null;

  // Rounded up, not to nearest, and the direction is the whole point. This
  // figure is already a lower bound on the true age — the services answer a
  // named moment with the newest frame at or before it, so what is drawn may be
  // a step older than the moment it was asked for. Rounding down would push the
  // one number a reader has for the staleness of this layer further in the
  // direction it is already wrong in. Erring old is free; erring fresh is the
  // lie the readout exists to prevent.
  const minutes = Math.max(0, Math.ceil((now - at) / 60_000));

  const missing = shortfall(health);

  return (
    <span
      className="hidden shrink-0 sm:inline"
      title={
        `${field.label} imagery for ${new Date(at).toISOString().slice(11, 16)} UTC, ` +
        `or the newest frame before it` +
        (missing && health
          ? `. ${health.held} of ${health.whole} tiles under this view have answered` +
            (health.partial ? `, ${health.partial} of them with a satellite missing` : "") +
            ` — where they have not, the map is drawing coarser imagery or clear sky rather than what is actually there.`
          : "")
      }
    >
      {field.label} {minutes}m old
      {missing && <span className="ml-1 text-text">· {missing}</span>}
    </span>
  );
}
