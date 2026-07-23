import { useEffect, useState } from "react";

/**
 * Owns its own tick. Held apart from App because the clock changing is not a
 * reason to re-render the map, the feed and the panels once a second — which
 * is exactly what it did while the time lived in App's state.
 */
export default function Clock() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  return <span className="glow">{now.toISOString().slice(11, 19)} UTC</span>;
}
