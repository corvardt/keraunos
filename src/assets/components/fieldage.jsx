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
export default function FieldAge({ kind, replayAt }) {
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

  return (
    <span
      className="hidden shrink-0 sm:inline"
      title={`${field.label} imagery for ${new Date(at).toISOString().slice(11, 16)} UTC, or the newest frame before it`}
    >
      {field.label} {minutes}m old
    </span>
  );
}
