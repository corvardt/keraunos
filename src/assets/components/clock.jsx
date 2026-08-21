import { useEffect, useState } from "react";

/**
 * Owns its own tick. Held apart from App because the clock changing is not a
 * reason to re-render the map, the feed and the panels once a second, which
 * is exactly what it did while the time lived in App's state.
 *
 * `offset` is how far the instrument's own clock has been moved to play an
 * archive: the file is pinned to the moment it starts so that every window and
 * decay in the instrument goes on being measured against now, and this is the
 * one place that has to know it. Taking it back off is what makes the corner
 * read as the afternoon the strikes are from rather than as this one. Zero on a
 * live map, which is every other time.
 */
export default function Clock({ offset = 0 }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  return <span className="glow">{new Date(now - offset).toISOString().slice(11, 19)} UTC</span>;
}
