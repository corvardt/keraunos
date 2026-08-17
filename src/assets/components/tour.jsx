import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

/**
 * The guided pass.
 *
 * The key panel is the catalogue: every mark and every figure, in full, for
 * whenever one of them needs looking up. This is the other thing, and they are
 * not the same thing. It is a first minute in front of an instrument nobody has
 * seen before, spent pointing at the real controls while they are running,
 * rather than describing them somewhere the controls are not.
 *
 * So it lights the actual element and leaves a hole in the dim over it: the map
 * keeps drawing, the feed keeps releasing, and anything under the light can
 * still be clicked. Seven steps, skippable at every one of them, and then it is
 * gone for good unless it is asked for again.
 */

// Room between the lit element and the card, and between the card and the edge
// of the glass.
const GAP = 14;
const MARGIN = 12;
const CARD_W = 300;
// The light opens a little beyond what it contains, so a control sits inside it
// rather than pressed against its edge.
const PAD = 8;
const TICK = 9;

/** A key name, at reading weight against the body around it. */
const Key = ({ children }) => <span className="text-text">{children}</span>;

/**
 * Each step names the elements it is about by `data-tour`, and is dropped when
 * none of them is on screen: a reader who has turned the side panel off is not
 * walked through the feed. `side` is where the card would rather sit; it gives
 * way when there is no room there.
 */
const STEPS = [
  {
    id: "tube",
    title: "The tube",
    anchor: ["map"],
    side: "right",
    body: (
      <>
        Every mark on this glass is a real discharge, fixed by a network of
        volunteer detectors and here about five seconds later. A strike arrives
        at full white, throws a ring, and decays. Where they keep falling the map
        burns in, and a cluster big enough to be weather is ringed as a storm
        cell and carries the bearing it is travelling on.
      </>
    ),
  },
  {
    id: "pick",
    title: "Point and pick",
    anchor: ["map"],
    side: "right",
    body: (
      <>
        Pointing names whatever is under the cursor in the corner of the tube,
        with its coordinates and how many strikes that 1&deg; cell is holding.
        Clicking keeps it: the feed and the map narrow to that place until you
        click it again or press <Key>esc</Key>. Clicking a storm ring picks the
        cell rather than the country underneath it.
      </>
    ),
  },
  {
    id: "look",
    title: "Where to look",
    anchor: ["regions"],
    side: "below",
    body: (
      <>
        Drag to pan, wheel or pinch to zoom in to about a 200 km span; these
        names jump straight there, and <Key>+</Key> <Key>&minus;</Key>{" "}
        <Key>0</Key> do it from the keyboard. <Key>here</Key> asks this browser
        where you are (only when pressed, held for the session, sent
        nowhere) and then reads out how far the nearest strike fell and
        how long until you hear it.
      </>
    ),
  },
  {
    id: "readouts",
    title: "The readouts",
    anchor: ["rate", "stats"],
    side: "left",
    body: (
      <>
        Rate is the whole world&rsquo;s last minute, traced beneath itself, and
        Session is as much of a day as you have watched. Under Link the
        instrument reports on itself rather than on the weather: how long it took
        to place the last strikes, how many detectors solved them, and the fix
        gap: the widest direction those strikes were{" "}
        <Key>not</Key> heard from. Ringed by detectors, a strike reads low; heard
        from one side only it reads past 180&deg;, and is placed the more loosely
        for it.
      </>
    ),
  },
  {
    id: "panel",
    title: "The ranking and the feed",
    anchor: ["active", "feed"],
    side: "left",
    body: (
      <>
        Most active ranks the places holding the cells still burning on the map,
        so the list and the picture can never disagree. Under it, every arrival,
        newest first. Point at either and it marks itself on the tube; click to
        narrow to it. The feed stops advancing while your pointer rests on it and
        queues what lands behind.
      </>
    ),
  },
  {
    id: "rewind",
    title: "Rewind",
    anchor: ["transport"],
    side: "above",
    body: (
      <>
        The track along the bottom holds the last twelve minutes, and fills
        toward the half a minute it needs before there is anything worth pulling
        on. After that, set the clock down anywhere on it and the map runs
        forward from that moment at life size, until it catches up and hands back
        to live. Nothing pauses while you are back there: the window keeps
        filling behind you, so returning finds the present already arrived.
      </>
    ),
  },
  {
    id: "rest",
    title: "The rest of it",
    anchor: ["controls"],
    side: "below",
    body: (
      <>
        <Key>key</Key> names every mark on the map and every figure beside it;
        this pass was the short way round. <Key>cfg</Key> holds the palette, the
        layout, and how much the map carries. <Key>dark</Key> and{" "}
        <Key>light</Key> are the two modes, and they are genuinely two media:
        light added on glass, ink laid down on a sheet. All of it is on a single
        key:{" "}
        <Key>k</Key>, <Key>c</Key>, <Key>t</Key>, and <Key>g</Key> to walk
        through this again.
      </>
    ),
  },
];

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const elements = (anchor) =>
  anchor.map((name) => document.querySelector(`[data-tour="${name}"]`)).filter(Boolean);

/**
 * The union of every element a step names, opened out by PAD and clipped to
 * the glass.
 *
 * Clipped rather than drawn past the edge, because the light is four bands
 * around a hole and a hole extending off-screen is a band with a negative
 * width. Anything that ends up with nothing left gives back no light at all,
 * and the card centres itself instead: a lit rectangle of zero height would be
 * a worse answer than no rectangle.
 */
function measure(anchor) {
  let box = null;
  for (const el of elements(anchor)) {
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;
    box = box
      ? {
          left: Math.min(box.left, rect.left),
          top: Math.min(box.top, rect.top),
          right: Math.max(box.right, rect.right),
          bottom: Math.max(box.bottom, rect.bottom),
        }
      : { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
  }
  if (!box) return null;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const x = clamp(box.left - PAD, 0, vw);
  const y = clamp(box.top - PAD, 0, vh);
  const w = clamp(box.right + PAD, 0, vw) - x;
  const h = clamp(box.bottom + PAD, 0, vh) - y;
  return w > 0 && h > 0 ? { x, y, w, h } : null;
}

export default function Tour({ onClose }) {
  const [index, setIndex] = useState(0);
  const [spot, setSpot] = useState(null);
  const [place, setPlace] = useState(null);
  const cardRef = useRef(null);
  const nextRef = useRef(null);

  // Settled after the first commit rather than during it, because a step is
  // dropped for the absence of its elements and during render the document is
  // still the one from before this component existed; anything mounting in the
  // same commit would read as switched off. Settled once and not again, because
  // nothing the guide does changes which panels are on screen, and re-filtering
  // underneath the reader would renumber the steps mid-pass.
  const [steps, setSteps] = useState(STEPS);
  useLayoutEffect(() => {
    setSteps(
      STEPS.filter((s) => s.anchor.some((name) => document.querySelector(`[data-tour="${name}"]`)))
    );
  }, []);
  const step = steps[index];
  const last = index === steps.length - 1;

  const next = useCallback(() => {
    setIndex((at) => at + 1);
  }, []);
  const back = useCallback(() => setIndex((at) => Math.max(0, at - 1)), []);

  // Walked off the end, or opened with nothing on screen worth pointing at.
  useEffect(() => {
    if (index >= steps.length) onClose();
  }, [index, steps.length, onClose]);

  // Where the light falls. Re-measured on anything that can move the element
  // underneath it: the side panel scrolls on a narrow screen, and the strip of
  // region names scrolls sideways on any of them.
  useLayoutEffect(() => {
    if (!step) return;
    const take = () => setSpot(measure(step.anchor));

    // Narrow enough and the map and the side panel stack into one scrolling
    // column, which puts the readouts and the feed below the fold. Bring the
    // step's own element up before lighting it; the scroll listener below is
    // already watching, so the light travels with it rather than jumping to
    // where it lands.
    const [first] = elements(step.anchor);
    const rect = first?.getBoundingClientRect();
    if (rect && (rect.top < 0 || rect.bottom > window.innerHeight)) {
      first.scrollIntoView({
        block: "center",
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      });
    }

    take();
    window.addEventListener("resize", take);
    window.addEventListener("scroll", take, true);
    return () => {
      window.removeEventListener("resize", take);
      window.removeEventListener("scroll", take, true);
    };
  }, [step]);

  // Where the card goes. Measured rather than assumed, because the body is
  // prose and its height is whatever the words come to at this width.
  useLayoutEffect(() => {
    const card = cardRef.current;
    if (!card || !step) return;
    const { width: cw, height: ch } = card.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (!spot) {
      setPlace({ left: (vw - cw) / 2, top: (vh - ch) / 2 });
      return;
    }

    const room = {
      below: vh - (spot.y + spot.h) - GAP - MARGIN,
      above: spot.y - GAP - MARGIN,
      right: vw - (spot.x + spot.w) - GAP - MARGIN,
      left: spot.x - GAP - MARGIN,
    };
    const need = (side) => (side === "left" || side === "right" ? cw : ch);
    // What the step asked for, then the readable fallbacks, then whichever side
    // has the most room: by then nothing fits and the card is going to overlap
    // something whatever we do, so it may as well overlap the least of it.
    const order = [step.side, "below", "right", "left", "above"].filter(Boolean);
    const side =
      order.find((s) => room[s] >= need(s)) ??
      Object.keys(room).sort((a, b) => room[b] - need(b) - (room[a] - need(a)))[0];

    const cx = spot.x + spot.w / 2;
    const cy = spot.y + spot.h / 2;
    const across = clamp(cx - cw / 2, MARGIN, Math.max(MARGIN, vw - cw - MARGIN));
    const down = clamp(cy - ch / 2, MARGIN, Math.max(MARGIN, vh - ch - MARGIN));
    const at = {
      below: { left: across, top: spot.y + spot.h + GAP },
      above: { left: across, top: spot.y - GAP - ch },
      right: { left: spot.x + spot.w + GAP, top: down },
      left: { left: spot.x - GAP - cw, top: down },
    }[side];

    setPlace({
      left: clamp(at.left, MARGIN, Math.max(MARGIN, vw - cw - MARGIN)),
      top: clamp(at.top, MARGIN, Math.max(MARGIN, vh - ch - MARGIN)),
    });
  }, [spot, step]);

  // The guide owns the keyboard while it is up. Captured, so the map's own
  // shortcuts do not also act on a key meant for the card, except the zoom
  // keys, which are left alone deliberately: the step that mentions them is
  // more convincing if pressing them works.
  useEffect(() => {
    const onKey = (event) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const key = event.key;
      if (key === "Escape") onClose();
      else if (key === "ArrowRight" || key === "ArrowDown" || key === " " || key === "Enter") next();
      else if (key === "ArrowLeft" || key === "ArrowUp") back();
      else return;
      event.preventDefault();
      event.stopPropagation();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [next, back, onClose]);

  // Taken on open and handed back on close, so skipping the guide leaves the
  // keyboard where it was rather than at the top of the document.
  useEffect(() => {
    const previous = document.activeElement;
    nextRef.current?.focus();
    return () => previous?.focus?.();
  }, []);

  if (!step) return null;

  // Four bands rather than a mask: the hole is then genuinely a hole, and the
  // control under the light stays live. Clicking the dim is how you advance;
  // clicking through the hole works the instrument, which is the point.
  const bands = spot
    ? [
        { left: 0, top: 0, width: "100%", height: spot.y },
        { left: 0, top: spot.y + spot.h, width: "100%", bottom: 0 },
        { left: 0, top: spot.y, width: spot.x, height: spot.h },
        { left: spot.x + spot.w, top: spot.y, right: 0, height: spot.h },
      ]
    : [{ inset: 0 }];

  const corners = spot
    ? [
        { left: spot.x, top: spot.y, cls: "border-l border-t" },
        { left: spot.x + spot.w - TICK, top: spot.y, cls: "border-r border-t" },
        { left: spot.x, top: spot.y + spot.h - TICK, cls: "border-b border-l" },
        { left: spot.x + spot.w - TICK, top: spot.y + spot.h - TICK, cls: "border-b border-r" },
      ]
    : [];

  const pad = (n) => String(n).padStart(2, "0");
  const control = "text-2xs uppercase tracking-label transition-colors touch:px-2 touch:py-2";

  return (
    // Transparent to the pointer, so that what is not explicitly dimmed is not
    // merely undimmed but actually reachable: a full-viewport root would catch
    // every click over the hole it had just cut.
    <div className="tour-in pointer-events-none fixed inset-0 z-40">
      {bands.map((band, i) => (
        <div
          key={i}
          style={band}
          onClick={next}
          className="tour-band pointer-events-auto absolute bg-void/[0.82]"
          aria-hidden="true"
        />
      ))}

      {corners.map((corner) => (
        <span
          key={corner.cls}
          style={{ left: corner.left, top: corner.top, width: TICK, height: TICK }}
          className={`tour-band pointer-events-none absolute border-text ${corner.cls}`}
          aria-hidden="true"
        />
      ))}

      {/* Not aria-modal: the instrument underneath is deliberately still
          reachable, and claiming otherwise would be a lie to a screen reader. */}
      <div
        ref={cardRef}
        role="dialog"
        aria-label={`Guide, step ${index + 1} of ${steps.length}: ${step.title}`}
        style={{
          left: place?.left ?? 0,
          top: place?.top ?? 0,
          width: `min(88vw, ${CARD_W}px)`,
          visibility: place ? "visible" : "hidden",
        }}
        className="tour-card pointer-events-auto absolute border border-line bg-panel"
      >
        <header className="flex items-baseline justify-between border-b border-line px-4 py-2.5">
          <span className="text-2xs uppercase tracking-mark text-text glow">{step.title}</span>
          <span className="shrink-0 pl-3 text-2xs tracking-label text-dim">
            {pad(index + 1)} / {pad(steps.length)}
          </span>
        </header>

        <p className="px-4 py-3 text-xs leading-relaxed text-dim">{step.body}</p>

        <footer className="flex items-center justify-between border-t border-line px-4 py-2.5 touch:px-2 touch:py-1">
          <button type="button" onClick={onClose} className={`${control} text-dim hover:text-text active:text-text`}>
            [ skip ]
          </button>
          <span className="flex items-baseline gap-3">
            {index > 0 && (
              <button type="button" onClick={back} className={`${control} text-dim hover:text-text active:text-text`}>
                back
              </button>
            )}
            <button type="button" ref={nextRef} onClick={next} className={`${control} text-text glow`}>
              [ {last ? "begin" : "next"} ]
            </button>
          </span>
        </footer>
      </div>
    </div>
  );
}
