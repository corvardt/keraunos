import { useEffect, useRef, useState } from "react";

// Long enough that the readout is something you read rather than something that
// flickers past, short enough that it is never the reason you are waiting. On a
// warm cache the work below finishes well inside this, so in practice this is
// the whole length of the screen.
const FLOOR_MS = 480;
// The one thing the screen waits on either resolves or rejects, and both land
// the same line, so this is only the escape from a fetch that does neither.
// Past it the map goes on naming coarsely, which is what it would have done
// anyway had the fetch failed outright.
const CEILING_MS = 3000;
const FADE_MS = 320;

const figure = (n) => n.toLocaleString("en-US");

// Seconds since the screen appeared, in the width a kernel log uses. Fixed
// width because these are printed one under another and a column that shifts
// is a column you have to read rather than glance down.
const stamp = (ms) => `[${(ms / 1000).toFixed(3).padStart(7)}]`;
const BLANK = " ".repeat(9);

/**
 * Cold-start readout.
 *
 * Every line is a fact about this session: what was actually indexed, which
 * node actually answered, and how long each of them actually took. There is no
 * scripted sequence, because a scripted sequence tells you nothing and takes
 * longer than the thing it is pretending to narrate.
 *
 * It is a curtain over a map that is already drawing: `WorldMap` mounts and
 * runs underneath from the first frame and never waits on this. So the screen
 * is not a loading state, it is the one thing standing between you and the
 * instrument, and it leaves the moment the map is whole — which is normally
 * before you have finished reading it.
 */
export default function Boot({ onDone, outlines, names, status }) {
  const [leaving, setLeaving] = useState(false);

  // The sequence must survive its parent re-rendering (which it does twice a
  // second) so the callback is held in a ref and the effect never re-runs.
  const done = useRef(onDone);
  useEffect(() => {
    done.current = onDone;
  }, [onDone]);

  const started = useRef(performance.now());
  const stamps = useRef(new Map());
  // When each step landed, measured from the moment the readout appeared. Taken
  // on the first render that sees the step settled rather than in an effect
  // afterwards: these are reported to the reader as timings, so they have to be
  // read at the moment the fact becomes true. Writing once per key makes the
  // call idempotent, which is what lets it sit in the render pass.
  const elapsed = (key, settled) => {
    if (!settled) return null;
    if (!stamps.current.has(key)) stamps.current.set(key, performance.now() - started.current);
    return stamps.current.get(key);
  };

  const linked = status.phase === "live";
  const lost = status.phase === "down" || status.phase === "error";

  const steps = [
    {
      key: "coastlines",
      label: "coastlines",
      // Bundled and indexed synchronously, so this is settled before the first
      // paint. It is still worth a line: it is the count the land matrix and
      // every place name are built from, and seeing it is how you know the
      // bundle arrived whole.
      settled: true,
      value: `${figure(outlines)} countries`,
      pending: "indexing",
    },
    {
      key: "names",
      label: "place names",
      settled: names !== null,
      // Naming is the one thing that degrades rather than fails: without these
      // a strike is still placed and still drawn, it is just called "USA"
      // instead of "Texas". The line says which of the two you are getting.
      value: names?.us ? `${figure(names.us)} states, ${figure(names.water)} waters` : "coarse only",
      pending: "fetching states and waters",
    },
    {
      key: "uplink",
      label: "uplink",
      settled: linked || lost,
      value: linked ? `receiving from ${status.host}` : "no answer",
      pending: status.host ? `reaching ${status.host}` : "opening socket",
    },
  ];

  const waiting = steps.find((step) => !step.settled);

  // Only one of the three holds the door: the names, because until they land
  // the map is naming Texas "USA" and the Coral Sea "open water", and that is
  // the one gap a reader would take for a fault rather than a wait. The
  // coastlines are already in the bundle. The uplink is a websocket to a
  // network run by volunteers and is allowed to be slow or absent — nothing on
  // the map needs it to draw, and the footer carries it from here on, so
  // holding a curtain over a working instrument until a stranger's socket
  // answers buys nothing. Its line simply goes unfinished, which is what a log
  // does when the machine stops reading it.
  const held = names === null;

  useEffect(() => {
    if (held) return;
    const wait = Math.max(0, FLOOR_MS - (performance.now() - started.current));
    const timer = setTimeout(() => setLeaving(true), wait);
    return () => clearTimeout(timer);
  }, [held]);

  useEffect(() => {
    const timer = setTimeout(() => setLeaving(true), CEILING_MS);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!leaving) return;
    const timer = setTimeout(() => done.current(), FADE_MS);
    return () => clearTimeout(timer);
  }, [leaving]);

  // Printed as they land, the way a log is. Only one line is ever unresolved,
  // and it carries no time because it hasn't happened yet: the blank column is
  // the whole of what marks it as still running, which is as much as it needs.
  const lines = steps
    .filter((step) => step.settled)
    .map((step) => ({
      key: step.key,
      at: stamp(elapsed(step.key, true)),
      text: `${step.label}: ${step.value}`,
    }));
  if (waiting) {
    lines.push({ key: waiting.key, at: BLANK, text: `${waiting.label}: ${waiting.pending}...` });
  } else {
    // Stamped like the rest rather than read off the clock here, or it would
    // count up on every render the parent makes while the screen fades.
    lines.push({ key: "ready", at: stamp(elapsed("ready", true)), text: "ready" });
  }

  return (
    <div
      className={`fixed inset-0 z-40 flex items-center justify-center overflow-hidden bg-void p-4 sm:p-6 ${leaving ? "boot-out" : ""}`}
      role="status"
      aria-live="polite"
    >
      {/* Centred as a block, but the lines inside it stay flush left and start
          at the top of it. Two reasons. The stamps are a column, and a column
          only reads as one if every line begins at the same x. And the lines
          arrive one at a time: a box that grew to fit them would drift upward
          under the eye while you were reading it, so it is the full four lines
          tall from the first frame and they fill it downward. Nothing is boxed
          or ruled — the point of the screen is that it is the machine talking,
          and a machine talking looks like this. */}
      <ul className="h-[4.875rem] whitespace-pre text-xs leading-relaxed">
        {lines.map((line) => (
          // Mounted as it is printed, so each line fades in once, on its own,
          // at the moment the thing it reports actually finished.
          <li key={line.key} className="boot-line">
            <span className="text-dim">{line.at}</span> {line.text}
          </li>
        ))}
      </ul>
    </div>
  );
}
