import { useEffect, useRef, useState } from "react";

const LINES = [
  "BLITZORTUNG UPLINK ......... STANDBY",
  "GEODETIC INDEX ............. 177 REGIONS",
  "PHOSPHOR BUFFER ............ READY",
  "STRIKE MONITOR ............. ONLINE",
];

const STEP_MS = 190;
const HOLD_MS = 420;

/** Cold-start readout. Skipped entirely when motion is reduced. */
export default function Boot({ onDone }) {
  const [shown, setShown] = useState(0);
  const [leaving, setLeaving] = useState(false);

  // The sequence must survive its parent re-rendering (which it does twice a
  // second) so the callback is held in a ref and the effect never re-runs.
  const done = useRef(onDone);
  useEffect(() => {
    done.current = onDone;
  }, [onDone]);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      done.current();
      return;
    }
    const timers = LINES.map((_, i) => setTimeout(() => setShown(i + 1), i * STEP_MS));
    timers.push(setTimeout(() => setLeaving(true), LINES.length * STEP_MS + HOLD_MS));
    timers.push(setTimeout(() => done.current(), LINES.length * STEP_MS + HOLD_MS + 320));
    return () => timers.forEach(clearTimeout);
  }, []);

  return (
    <div
      className={`fixed inset-0 z-40 flex items-center justify-center bg-void ${leaving ? "boot-out" : ""}`}
      role="status"
      aria-live="polite"
    >
      <ul className="w-[min(90vw,420px)] space-y-1.5 text-xs">
        {LINES.slice(0, shown).map((line) => (
          <li key={line} className="boot-line flex gap-2 text-text glow">
            <span className="text-dim">&gt;</span>
            <span>{line}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
