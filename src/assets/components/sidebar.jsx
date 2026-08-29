import { memo, useEffect, useRef, useState } from "react";
import { BINS, STEP_KM } from "../../lib/reach.js";

const TRACE_W = 300;
const TRACE_H = 34;
// Taller than the 60s trace above it. That one is a heartbeat and is read as a
// level; this one is a shape, and a day of weather has more in it to resolve.
const DAY_H = 44;

/**
 * Whether the reader has a pointer that can hover at all.
 *
 * Watched rather than read once, like the motion query the map keeps: a tablet
 * with a keyboard folded on and off changes the answer mid-session, and a hint
 * that could only be opened the way it could not be opened is no hint.
 */
function useCoarse() {
  const [coarse, setCoarse] = useState(
    () => window.matchMedia("(pointer: coarse)").matches
  );
  useEffect(() => {
    const query = window.matchMedia("(pointer: coarse)");
    const onChange = (event) => setCoarse(event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return coarse;
}

/**
 * What a figure is, for as long as you are pointing at it.
 *
 * The panel is terse on purpose and the key panel says everything at length,
 * but there is a gap between those two: the moment you are looking straight at
 * a number and want one sentence, not a catalogue. This is that sentence.
 *
 * Drawn over what follows rather than pushing it down. A panel that reflowed
 * under the pointer would move the next figure out from under the eye that was
 * about to read it, which is the one thing an instrument must not do.
 *
 * A finger has no hover, and for as long as this was hover alone the sentence
 * simply did not exist on a phone: the terse panel with no way to the gloss,
 * which is the reading of the two that needs it most. So under a coarse pointer
 * the row becomes a button and the hint is held open by a tap until it is
 * tapped away. Held, not pressed: reading it is the whole point, and a hint
 * that lasts exactly as long as the finger covering it is worse than none.
 */
function Hint({ children, open }) {
  if (!children) return null;
  return (
    <p
      className={`pointer-events-none absolute left-0 right-0 top-full z-10 -translate-y-px border border-line bg-panel px-3 py-2 text-xs leading-snug text-dim ${
        open ? "block" : "hidden group-hover:block"
      }`}
    >
      {children}
    </p>
  );
}

/**
 * The tap route in, and nothing at all where there is a pointer that hovers.
 *
 * Returns the element the row should be, a real button when it has become one,
 * so it is reachable by tab and answers Enter without any of that being
 * reimplemented here, along with whether the hint is currently held open.
 */
function useTapHint(hint) {
  const coarse = useCoarse();
  const [open, setOpen] = useState(false);
  const tappable = Boolean(hint) && coarse;
  return {
    open: tappable && open,
    tag: tappable ? "button" : "div",
    props: tappable
      ? {
          type: "button",
          "aria-expanded": open,
          onClick: () => setOpen((was) => !was),
        }
      : {},
  };
}

/** Caps label trailed by a rule to the panel edge: a terminal section break. */
function Label({ children, trailing, hint, shut, onToggle }) {
  const { open, tag: Tag, props } = useTapHint(hint);

  // The heading of a group that can be folded away.
  //
  // Kept as a separate shape rather than folded into the one below, because the
  // row can only have one job on a touch screen. Where a hint is tapped open,
  // the plain heading *is* that button, and a fold control inside it would be
  // a button inside a button, which is neither valid nor reliably tappable. So
  // here the heading carries the fold, and the hint gives up the whole row for
  // a mark of its own at the end. Hover is untouched either way: it is the
  // group that opens it, and the group is still the row.
  if (onToggle) {
    return (
      <div className="group relative flex w-full items-center gap-2.5 text-left">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={!shut}
          className="flex shrink-0 items-center gap-1.5 text-2xs uppercase tracking-label text-dim transition-colors hover:text-text active:text-text touch:py-2"
        >
          {/* A fixed-width box, so the heading beside it does not step sideways
              as the group opens and closes. */}
          <span aria-hidden="true" className="inline-block w-2 text-center">
            {shut ? "+" : "−"}
          </span>
          {children}
        </button>
        <span className="h-px flex-1 bg-line" />
        {trailing && (
          <span className="shrink-0 text-2xs uppercase tracking-label text-dim">{trailing}</span>
        )}
        {hint && Tag === "button" && (
          <button
            {...props}
            aria-label="What this is"
            className="shrink-0 px-1 py-2 text-2xs uppercase tracking-label text-dim"
          >
            ?
          </button>
        )}
        <Hint open={open}>{hint}</Hint>
      </div>
    );
  }

  return (
    <Tag
      {...props}
      className={`group relative flex w-full items-center gap-2.5 text-left ${
        hint ? "cursor-help" : ""
      }`}
    >
      <span className="shrink-0 text-2xs uppercase tracking-label text-dim">{children}</span>
      <span className="h-px flex-1 bg-line" />
      {trailing && <span className="shrink-0 text-2xs uppercase tracking-label text-dim">{trailing}</span>}
      <Hint open={open}>{hint}</Hint>
    </Tag>
  );
}

/**
 * One figure and what it is.
 *
 * `quiet` drops the glow. It is the whole of the difference between the two
 * kinds of number in this panel: what the weather is doing is lit, and what the
 * instrument is doing while it watches is not. Same size, same column, same
 * type. A status figure that had been shrunk as well would read as unimportant
 * rather than as a different subject, and how well this is hearing is not
 * unimportant.
 */
function Readout({ label, value, unit, quiet, hint }) {
  const { open, tag: Tag, props } = useTapHint(hint);
  return (
    <Tag
      {...props}
      className={`group relative block w-full border-b border-line py-2.5 text-left last:border-b-0 ${
        hint ? "cursor-help" : ""
      }`}
    >
      <div className="flex items-baseline justify-between">
        <span className="text-2xs uppercase tracking-label text-dim">{label}</span>
        <span className={`text-base ${quiet ? "text-dim" : "text-text glow"}`}>
          {value}
          {unit && <span className="ml-1 text-2xs text-dim">{unit}</span>}
        </span>
      </div>
      <Hint open={open}>{hint}</Hint>
    </Tag>
  );
}

// Sixty seconds of arrival rate, drawn as a hairline tape. No axes: the shape
// is the reading, and the exact figure sits directly above it.
function RateTrace({ samples }) {
  const peak = Math.max(1, ...samples);
  const step = TRACE_W / Math.max(1, samples.length - 1);
  const points = samples.map((n, i) => [i * step, TRACE_H - (n / peak) * (TRACE_H - 2) - 1]);
  const line = points.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const area = points.length > 1 ? `${line} L${TRACE_W} ${TRACE_H} L0 ${TRACE_H} Z` : "";

  return (
    <svg
      viewBox={`0 0 ${TRACE_W} ${TRACE_H}`}
      preserveAspectRatio="none"
      className="h-[34px] w-full"
      role="img"
      aria-label="Strike arrival rate over the last 60 seconds"
    >
      {area && <path d={area} className="fill-line" />}
      {points.length > 1 && (
        <path
          d={line}
          className="stroke-text"
          fill="none"
          strokeWidth="1"
          vectorEffect="non-scaling-stroke"
        />
      )}
    </svg>
  );
}


// How long the session has been running, in the coarsest form that is still
// true: minutes until there is an hour, hours after that. A day trace labelled
// "1h 3m" invites a precision the curve underneath does not have.
function span(ms) {
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}

/**
 * The session's own day: arrivals per minute, for as long as this tab has been
 * open, up to a day.
 *
 * Drawn as wide as the reading is rather than as wide as a day, for the same
 * reason the rewind track is: a full-width axis with twenty minutes of curve in
 * the corner of it is a picture of what is missing. It starts a minute long and
 * grows, and the span beside the heading says how much of a day it has become.
 *
 * The one mark on it is midnight UTC, and only once there is a midnight inside
 * the window. The whole reason to watch a day of this is that the planet fires
 * on a schedule, Africa then the Americas then Asia, each in their own
 * afternoon, and a curve with three humps in it says nothing at all unless you
 * can see where the day begins.
 */
function DayTrace({ day }) {
  const series = day?.series ?? [];
  if (series.length < 2) return null;

  const peak = Math.max(1, day.peak.rate);
  const first = series[0].t;
  const width = Math.max(1, series[series.length - 1].t - first);
  const x = (t) => ((t - first) / width) * TRACE_W;
  const points = series.map((point) => [
    x(point.t),
    DAY_H - (point.rate / peak) * (DAY_H - 2) - 1,
  ]);
  const line = points.map(([px, py], i) => `${i ? "L" : "M"}${px.toFixed(1)} ${py.toFixed(1)}`).join(" ");

  const midnights = [];
  const DAY_MS = 86400000;
  for (let t = Math.ceil(first / DAY_MS) * DAY_MS; t <= series[series.length - 1].t; t += DAY_MS) {
    midnights.push(x(t));
  }

  return (
    <svg
      viewBox={`0 0 ${TRACE_W} ${DAY_H}`}
      preserveAspectRatio="none"
      className="h-[44px] w-full"
      role="img"
      aria-label={`Strike arrival rate over the last ${span(day.spanMs)}`}
    >
      {midnights.map((px) => (
        <line key={px} x1={px} y1="0" x2={px} y2={DAY_H} className="stroke-line" strokeWidth="1" vectorEffect="non-scaling-stroke" />
      ))}
      <path d={`${line} L${points[points.length - 1][0]} ${DAY_H} L${points[0][0]} ${DAY_H} Z`} className="fill-line" />
      <path d={line} className="stroke-text" fill="none" strokeWidth="1" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

// Height of the reach distributions. Shorter than the day trace: that one is a
// day of weather and this is two curves whose only job is to be compared with
// each other and with the two rules under them.
const REACH_H = 34;

/**
 * Where the shared axis ends, in kilometres.
 *
 * Everything in this group is drawn against this one number: both curves, both
 * bars, and the heading. That is the whole of what makes it one picture instead
 * of three, and it is why the extent is worked out here rather than inside any
 * of them.
 *
 * Not the furthest anything was heard, which is what the axis used to run to.
 * One freak path of fifteen thousand kilometres would set it, and the reading
 * would then be four fifths empty glass with everything that matters crushed
 * into the left-hand corner. The far half-percent is dropped instead, which
 * costs a tail nobody could resolve at this height and buys back the width the
 * comparison is made in.
 */
function reachExtent(reach) {
  const total = reach.day.n + reach.night.n;
  if (!total) return 0;
  let seen = 0;
  for (let bin = 0; bin < BINS; bin++) {
    seen += reach.day.counts[bin] + reach.night.counts[bin];
    if (seen >= total * 0.995) return (bin + 1) * STEP_KM;
  }
  return reach.span * STEP_KM;
}

/**
 * One half of the sky as a density: each bin's share of that half's strikes,
 * lightly smoothed.
 *
 * The smoothing is the difference between a reading and a sawtooth. A bin is
 * 200 km wide and a half that has just become ready holds a couple of hundred
 * strikes across twenty-odd of them, so a bin carries about ten and the noise
 * on a count of ten is three: a third of the bin, changing every time one
 * lands. The frame is held still now and that noise was the whole of what was
 * left moving, and it moves most in exactly the half that has least in it,
 * which is the half a reader is most likely to be misled by.
 *
 * A three-bin binomial kernel, [1 2 1], which is the smallest thing that is
 * still a smooth. It costs 200 km of resolution on a curve whose own caveats
 * are measured in thousands, and it cannot move the reading: the rules under
 * the curve are percentiles of the raw counts and are not smoothed at all, so
 * what is being smoothed is the picture of the distribution and never the
 * figures taken off it.
 *
 * The ends are renormalised over the neighbours that exist rather than treated
 * as zero, or the curve would be dragged down at both edges by bins that are
 * not there.
 */
function reachDensity(side, bins) {
  if (!side.n) return null;
  const raw = Array.from({ length: bins }, (unused, i) => side.counts[i] / side.n);
  return raw.map((value, i) => {
    const left = i > 0 ? raw[i - 1] : null;
    const right = i < bins - 1 ? raw[i + 1] : null;
    const weight = 2 + (left === null ? 0 : 1) + (right === null ? 0 : 1);
    return (value * 2 + (left ?? 0) + (right ?? 0)) / weight;
  });
}

/** The tallest bin across both halves, which is what puts them on one axis. */
function reachPeak(reach, bins) {
  const lit = reachDensity(reach.day, bins);
  const dark = reachDensity(reach.night, bins);
  if (!lit && !dark) return 0;
  return Math.max(...(lit ?? [0]), ...(dark ?? [0]));
}

/**
 * A meter needle with a peak hold on it: up at once, down slowly.
 *
 * Named `damp` rather than `hold`, which is what it does and which the panel
 * already uses for the feed being held under the pointer. Called `hold` here it
 * was shadowed by that prop inside the component and the call site invoked a
 * boolean.
 *
 * Both ends of the reach frame are derived from the strikes counted so far and
 * were recomputed from scratch on every read, twice a second. Neither moves
 * much and both move constantly, which is what made the curve jump: the axis
 * is quantised to a 200 km bin, so one strike crossing the cut-off rescaled the
 * whole picture sideways by a bin, and the tallest bin gains and loses strikes
 * all afternoon. The data was holding still and the frame was not.
 *
 * Asymmetric because the two directions are not the same event. A frame that
 * has become too small is clipping the reading and has to grow this instant; a
 * frame that has become too large is only wasting glass, and can take its time
 * about it. Which is also what a real needle does, and why it reads as one.
 */
function damp(current, target, fall = 0.04) {
  if (!current) return target;
  return target > current ? target : current + (target - current) * fall;
}

/**
 * The two distributions, over each other, on one scale.
 *
 * "One scale" is the whole correction here, and it is two scales at once. The
 * x is `reachExtent`, shared with the bars below, so a bar's end falls on the
 * point of the curve it is marking. The y is a share of each half's own
 * strikes rather than a count of them.
 *
 * That second one is the fix. These were drawn as raw counts, each scaled to
 * its own peak, which was a reasonable answer to a real problem: the two bins
 * fill at whatever rate the weather offers, so at an hour when the world's
 * lightning is all over the Americas the daylight half has ten times the
 * strikes in it, and drawn as counts against one axis the night curve is a
 * flat line along the floor. But scaling each to itself means they are never
 * on the same axis at all, which is the one arrangement that makes the
 * comparison impossible, and the comparison is the reading.
 *
 * A density has neither fault. Both curves integrate to the same thing, so
 * neither is punished for the weather being somewhere else, and the height at
 * a range now means "this share of strikes carried this far", which is
 * comparable between them by construction. A night curve sitting to the right
 * of the day curve is the ionosphere, drawn.
 *
 * Day is the filled shape and night is the line, the pairing the day trace
 * above already uses: the fill is context and the line is the thing being read.
 * Night gets the line because night is the interesting half.
 */
function ReachChart({ reach, extent, peak }) {
  const bins = Math.max(2, Math.round(extent / STEP_KM));
  const lit = reachDensity(reach.day, bins);
  const dark = reachDensity(reach.night, bins);
  if ((!lit && !dark) || !peak) return null;

  const step = TRACE_W / (bins - 1);
  const points = (density) =>
    density.map((value, i) => [i * step, REACH_H - (value / peak) * (REACH_H - 2) - 1]);
  const path = (pts) =>
    pts.map(([px, py], i) => `${i ? "L" : "M"}${px.toFixed(1)} ${py.toFixed(1)}`).join(" ");

  return (
    <svg
      viewBox={`0 0 ${TRACE_W} ${REACH_H}`}
      preserveAspectRatio="none"
      className="mt-2 h-[34px] w-full"
      role="img"
      aria-label={`How far strikes were heard, over paths in daylight against paths in darkness, out to ${Math.round(extent / 1000)} thousand kilometres`}
    >
      {lit && (
        <path
          d={`${path(points(lit))} L${TRACE_W} ${REACH_H} L0 ${REACH_H} Z`}
          className="fill-line"
        />
      )}
      {dark && (
        <path
          d={path(points(dark))}
          className="stroke-text"
          fill="none"
          strokeWidth="1"
          vectorEffect="non-scaling-stroke"
        />
      )}
    </svg>
  );
}

/**
 * The same two distributions as two rules, on the same axis as the curves.
 *
 * The curve above says what the shape is; this says where each half's far end
 * falls, which is the question. An eye is poor at judging which of two
 * overlapping areas has more mass to the right and very good at telling which
 * of two lengths from a common origin is longer, so the reading the section
 * exists for is drawn the second way and the shape is left to say the rest.
 *
 * The rule runs to the ninth strike in ten, because that is where the waveguide
 * shows: the median is mostly a fact about where the volunteers live, since
 * half the network is in Europe, and that sets how far a typical strike has to
 * carry before somebody hears it whatever the sky is doing. The median is kept
 * as a tick inside the rule, so the middle and the far end are both on screen
 * and it is visible when they move apart.
 *
 * The count rides on the end of each. A rule drawn from two hundred strikes and
 * one drawn from twenty thousand are the same rule, which is exactly the thing
 * a histogram wore on its face and a length cannot: a thin half looks as
 * confident as a full one unless it says how thin it is.
 */
function ReachBars({ reach, extent }) {
  const sides = [
    { key: "day", label: "Day", side: reach.day },
    { key: "night", label: "Night", side: reach.night },
  ];
  if (!extent) return null;

  return (
    <div className="mt-1.5 space-y-1">
      {sides.map(({ key, label, side }) => (
        <div key={key} className="flex items-center gap-2">
          <span className="w-9 shrink-0 text-2xs uppercase tracking-label text-dim">{label}</span>
          {/* A half that has not filled yet draws no rule at all. A short one
              would be a claim that the sferic did not get far, where the truth
              is that nothing has been counted yet. */}
          <span className="relative h-1.5 flex-1 bg-line">
            {side.tail !== null && (
              <>
                <span
                  className="absolute inset-y-0 left-0 bg-land"
                  style={{ width: `${Math.min(100, (side.tail / extent) * 100)}%` }}
                />
                <span
                  className="absolute inset-y-0 w-px bg-text"
                  style={{ left: `${Math.min(100, (side.median / extent) * 100)}%` }}
                />
              </>
            )}
          </span>
          {/* One figure, on one line. It carried its own strike count as well
              and the pair did not fit the column: at three digits and a unit it
              wrapped, and a reading on two lines is a reading you have to
              assemble. The count says how much is behind the claim rather than
              what the claim is, so it has gone to the verdict, which is the
              claim. */}
          <span className="w-20 shrink-0 whitespace-nowrap text-right text-xs tabular-nums text-text">
            {side.tail === null ? "\u2014" : `${Math.round(side.tail).toLocaleString("en-US")} km`}
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * The reading itself, in one line, where both halves are ready to give it.
 *
 * The rules say which is longer and this says by how much, which between them
 * is the whole of what this section exists to report. Withheld rather than
 * guessed at until both distributions have enough in them: they fill on the
 * weather's schedule and it is ordinary for one to be ready an hour before the
 * other.
 */
function ReachVerdict({ reach }) {
  const { day, night } = reach;
  if (day.tail === null || night.tail === null) {
    return (
      <p className="mt-2 text-xs text-dim">
        &gt; {day.tail === null && night.tail === null ? "listening" : "waiting on the other half of the sky"}
      </p>
    );
  }
  const change = (night.tail - day.tail) / day.tail;
  const percent = Math.abs(Math.round(change * 100));
  // Under a twentieth is not a reading. The two distributions are day against
  // night with the east-west asymmetry left in, and that is comparable in size
  // to the effect being drawn, so a couple of percent either way is noise
  // wearing a number.
  if (percent < 5) {
    return <p className="mt-2 text-xs text-dim">&gt; night and day reaching about the same</p>;
  }
  return (
    <p className="mt-2 text-xs text-dim">
      &gt; <span className="text-text glow">night {percent}% {change > 0 ? "further" : "shorter"}</span>
      {/* What the claim is made of. A twenty-one percent difference off five
          hundred strikes and off fifty thousand are the same sentence and not
          the same reading, and a length cannot say which it is. */}
      <span className="text-dim">
        {" \u00b7 "}
        {day.n.toLocaleString("en-US")}/{night.n.toLocaleString("en-US")}
      </span>
    </p>
  );
}

/**
 * Seconds until the thunder of a strike that has already been seen.
 *
 * Its own clock, for the same reason the footer's is: the watch pass runs every
 * two seconds, and a countdown that moved in two-second steps would be a worse
 * lie than no countdown at all. Ticks four times a second and rounds, so the
 * figure falls one second at a time.
 *
 * A band rather than a figure, where the network said enough about the fix to
 * draw one. Sound covers 343 metres a second and this network places a strike
 * to somewhere between a kilometre and ten, so the position error is worth more
 * seconds than the countdown has: a single number here would be precise to the
 * second and wrong by twenty. The ends are what the arithmetic actually
 * supports, and they close as the sound gets nearer.
 *
 * The middle figure is kept when the frame carried no gap, which means an
 * archive, mostly, where the strikes were saved before the fix was recorded.
 * Nothing is known about the spread there, and inventing one would be the same
 * fault the band exists to fix.
 */
const Thunder = memo(function Thunder({ thunder }) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!thunder) return;
    const id = setInterval(() => tick((n) => n + 1), 250);
    return () => clearInterval(id);
  }, [thunder]);

  if (!thunder) return null;
  const now = Date.now();
  const left = (thunder.at - now) / 1000;
  // It has arrived. Held for a beat rather than vanishing, so the count is seen
  // to finish rather than appearing to have been cancelled.
  if (left <= -2) return null;

  // The near end of the band can be behind us while the far end is still ahead:
  // the sound may already have passed, or may have another twenty seconds to
  // run, and that is genuinely the state of the knowledge. Said as a ceiling
  // rather than as a range starting in the past, which reads as a fault.
  const early = thunder.early === null ? null : (thunder.early - now) / 1000;
  const late = thunder.late === null ? null : (thunder.late - now) / 1000;
  const band =
    late === null || late <= 0
      ? null
      : early > 0
        ? `${Math.ceil(early)}-${Math.ceil(late)}`
        : `≤${Math.ceil(late)}`;

  return (
    <Readout
      label="Thunder"
      value={band ?? (left <= 0 ? "now" : Math.ceil(left))}
      unit={band === null && left <= 0 ? "" : `s · ${Math.round(thunder.km)}km`}
      hint="The sound of a strike already seen, still travelling, at 343 m/s. The range is the network's own uncertainty about where the strike fell, carried through at the speed of sound."
    />
  );
});

/**
 * One arrival. Memoised and given only stable props, so releasing a new strike
 * reconciles the row that arrived rather than the sixty already on screen.
 */
const Row = memo(function Row({ strike, onSelect, onFocus, onHold }) {
  return (
    <li className="row">
      <button
        type="button"
        onPointerEnter={() => onFocus(strike)}
        onFocus={() => {
          onFocus(strike);
          onHold?.(true); // tabbing through rows holds it too
        }}
        onBlur={() => {
          onFocus(null);
          onHold?.(false);
        }}
        onClick={() => onSelect(strike)}
        className="settle flex w-full items-baseline gap-2 py-[3px] text-left text-xs transition-colors hover:text-text active:text-text touch:py-2"
      >
        <span className="shrink-0 text-dim">&gt;</span>
        <span className="shrink-0 text-dim">{strike.time}</span>
        {/* A place name is a value, and values are not set in caps: the label
            idiom is 10px uppercase at 0.14em, and a proper noun wearing it is a
            result read twice. It also truncates sooner, which in a 340px column
            is the difference between reading "Papua New Guinea" and reading
            "PAPUA NEW GUIN…". The map has always drawn these as they are
            written, so this is also what makes the panel and the tube agree
            about how a place is spelled. */}
        <span className="truncate">{strike.place}</span>
        <span className="ml-auto shrink-0 text-dim">{strike.delay}</span>
      </button>
    </li>
  );
});

function Sidebar({
  stats,
  samples,
  feed,
  settings,
  onSetting,
  day,
  reach,
  regions,
  selection,
  watch,
  hold,
  onSelect,
  onFocus,
  onHold,
}) {
  const fmt = (n) => n.toLocaleString("en-US");
  // A finger has no hover: the pointer enters the feed and leaves it again in
  // the same tap, so the hold the pointer route gives is over before it can be
  // read. There it is a latch on the heading instead, and the pointer handlers
  // stand down so the two cannot fight over it.
  const coarse = useCoarse();
  // The frame the reach group is drawn in, carried between renders. A ref
  // rather than state: nothing re-renders because it moved, it moves because
  // something else already caused a render.
  const reachFrame = useRef({ extent: 0, peak: 0 });

  // Folding, for the groups tall enough that folding one is the difference
  // between reading this column and scrolling it. Absent means open, so a panel
  // nobody has touched is the panel that was always here.
  const shut = settings.shut ?? {};
  const fold = (id) => () => onSetting("shut", { ...shut, [id]: !shut[id] });
  // A picked storm cell carries a radius, and narrows the feed to what fell
  // inside it. Everything else is a named place, and narrows by the name.
  const rows = selection
    ? feed.filter((strike) =>
        selection.radius
          ? Math.hypot(strike.lon - selection.lon, strike.lat - selection.lat) <= selection.radius
          : strike.place === selection.place
      )
    : feed;
  const busiest = Math.max(1, ...regions.map((region) => region.count));
  // The reach group's frame: one axis and one peak, worked out here because
  // three things are drawn against them and none may disagree with the others
  // about how wide the sky is or how tall the tallest bin was. Held across
  // renders rather than re-derived, so the curve moves and the frame does not.
  // Cleared with the session, since an archive or a relink is a different sky.
  if (!reach) {
    reachFrame.current = { extent: 0, peak: 0 };
  }
  const extent = reach
    ? (reachFrame.current.extent = damp(reachFrame.current.extent, reachExtent(reach)))
    : 0;
  const reachTop = reach
    ? (reachFrame.current.peak = damp(
        reachFrame.current.peak,
        reachPeak(reach, Math.max(2, Math.round(extent / STEP_KM)))
      ))
    : 0;
  // The same rate the group at the top is showing, in the unit the figure it is
  // about to be compared against was published in.

  // The panel fills the column and lets the feed take up the slack, which works
  // while there is slack. Turned sideways a phone has none: the fixed readouts
  // above the feed come to more than the whole height, so there the column
  // scrolls as one and the feed stops trying to absorb a remainder that is
  // already negative.
  //
  // A desktop can run out of slack too, and used to do it silently. Side by
  // side the shell holds the row at the window's height and clips what leaves
  // it, so the groups above the feed growing past the window took the feed with
  // them, flexed to nothing rather than pushed out of sight, which is why it
  // did not look like something that had gone somewhere. The column scrolls
  // here as well now. It only ever has cause to when the readouts have already
  // filled the window, so a tall screen sees exactly what it saw before.
  return (
    <aside className="flex w-full shrink-0 flex-col border-line bg-panel wide:w-[340px] wide:overflow-y-auto wide:overscroll-y-contain wide:border-l short:w-[268px]">
      {/* Now. The unit rides on the heading rather than beside the figure, the
          way it already does on the ranking below, which leaves the reading
          itself alone on its line: one large number per group is what makes a
          panel scannable, and there is exactly one here worth being large. */}
      <section data-tour="rate" className="border-b border-line px-4 pb-1 pt-4">
        <Label
          trailing="strikes / min"
          hint="The last 60 seconds, sampled twice a second."
        >
          Rate
        </Label>
        {/* The figure. One per instrument, and this is it: the subject of the
            whole panel is how hard the world is firing, and at 13px it was the
            same size as the latency underneath it. */}
        <div className="mt-1 text-figure leading-none text-text glow-hot">{fmt(stats.rate)}</div>
        {settings.trace && (
          <div className="mt-1">
            <RateTrace samples={samples} />
          </div>
        )}
        {/* The count of cells, and how many of them are winding up. The second
            figure is only ever drawn when there is one: a surge is rare by
            construction, and a row reading zero all afternoon teaches the eye
            to skip the row on the afternoon it doesn't. */}
        <Readout
          label="Storm cells"
          value={fmt(stats.storms)}
          unit={stats.surging ? `↑${stats.surging}` : ""}
          hint="Clusters of 12 strikes or more in adjacent ~45 km bins. The arrow counts those whose flash rate is climbing sharply."
        />
        {/* The session total belongs with the rate rather than with the curve
            it used to sit under. Both are counts of what this tab has heard,
            one over a minute and one over the whole session, and the reader
            comparing them is doing the obvious thing. It moved out of Session
            because that group is a curve and this is not one, and because
            Session can be switched off entirely, which would have taken the
            session total with it. */}
        <Readout
          label="Detected"
          value={fmt(stats.total)}
          hint="Every strike this tab has heard since it opened, and only those. Not a figure about the world: the hour the session started from is on the map but is not counted here."
        />
      </section>

      {/* Since the tab was opened, as a shape. The curve is the whole of this
          group now: the session total used to sit under it and has gone up to
          the rate, which is the figure it is actually read against.

          Which leaves the group with exactly one thing to hold, so it goes when
          that thing is switched off. Left standing it was a bordered heading
          with a fold control that opened onto nothing, permanently, for anybody
          who had turned the curve off in configuration.

          The other empty case is kept: a session under two minutes old has no
          line yet, two points being the least a line can be drawn from. That
          one is a heading waiting for its curve rather than a heading over an
          absence, it resolves itself in a minute, and withholding the group
          until then would move everything below it while somebody was reading. */}
      {settings.day && (
      <section className="border-b border-line px-4 pb-1 pt-4">
        {/* Two figures where there are two: the hour the relay handed over on
            arrival, and what this tab has watched since. One span would say
            "1h 04m" four minutes into a visit, which is true about the curve
            and false about the session, and the whole point of the curve is
            that it is the session's own. */}
        <Label
          trailing={
            day?.series?.length > 1
              ? day.seededMs
                ? `${span(day.seededMs)} + ${span(day.watchedMs)}`
                : span(day.spanMs)
              : null
          }
          hint="Arrivals by the minute. The first figure is the hour the relay was holding when this tab opened, the second is what it has watched since. The hairline is midnight UTC, and Peak is the hardest minute in the window with the hour it fell in."
          shut={shut.session}
          onToggle={fold("session")}
        >
          Session
        </Label>
        {!shut.session && day?.series?.length > 1 && (
          <>
            <div className="mt-1">
              <DayTrace day={day} />
            </div>
            {/* The peak is the one figure the curve cannot be read off
                precisely, and the one worth knowing: how hard the world was
                firing at its hardest, and when. UTC, like the footer clock and
                for the same reason: the peak is somebody's afternoon, and
                whose it was is the reading. */}
            {/* The caption keeps the label idiom; the two figures do not. They
                were the only values in this panel drawn at label size, which
                after Rate took the figure scale left them two steps below every
                other reading in the column. */}
            <div className="mt-1 flex items-baseline justify-between text-2xs uppercase tracking-label text-dim">
              <span>Peak</span>
              <span className="normal-case tracking-normal">
                <span className="text-xs text-text">{fmt(day.peak.rate)}</span> / min at{" "}
                <span className="text-xs text-text">
                  {new Date(day.peak.t).toISOString().slice(11, 16)}
                </span>
                z
              </span>
            </div>
          </>
        )}
      </section>
      )}

      {/* The instrument, reporting on itself.
          These were sitting among the weather figures in one undifferentiated
          list, which is what made them look like readings about the storm.
          They are not: both are properties of the detection geometry and of
          the link, they move on the network's schedule rather than the
          weather's, and under their own heading they say so without a word of
          explanation. Unlit, for the same reason. */}
      <section data-tour="stats" className="border-b border-line px-4 pb-1 pt-4">
        <Label>Link</Label>
        <Readout
          quiet
          label="Latency"
          value={stats.delay ?? "—"}
          unit={stats.delay ? "s" : ""}
          hint="Median time from a strike happening to this browser hearing it."
        />
        <Readout
          quiet
          label="Stations"
          value={stats.stations ?? "—"}
          hint="Median detectors used to place the last strikes. The feed caps its list at 40, so 40 means forty or more."
        />
        {/* The fix gap was here, as a median in degrees. It is drawn instead:
            the sheaf around every strike on the map is the same fact, whole
            when it was heard from all sides and a fan when it was heard from
            one, and the picture is per strike where the number could only ever
            be the middle of the last few. */}
      </section>

      {/* How far the lightning is coming from, and why that changes between
          noon and midnight. */}
      {settings.reach && reach && (
        <section className="border-b border-line px-4 pb-4 pt-4">
          <Label
            trailing={extent ? `0-${Math.round(extent / 1000)}k km` : null}
            hint="How far each strike was heard, counted to the most distant station that helped place it. The curve is the shape, as a share of each half's own strikes; the rules under it are the ninth strike in ten, with the middle marked inside. Sunlight makes a lossy layer at 60 to 70 km that the sferic has to bounce off; after sunset it decays and the reflection moves up to 85 to 90 km, where less is lost at every hop, so night should be the longer rule. Both are floors: the most distant station that heard a strike is not as far as it went."
            shut={shut.reach}
            onToggle={fold("reach")}
          >
            Reach
          </Label>
          {!shut.reach && (
            <>
              <ReachChart reach={reach} extent={extent} peak={reachTop} />
              <ReachBars reach={reach} extent={extent} />
              <ReachVerdict reach={reach} />
            </>
          )}
        </section>
      )}

      {/* Only ever present once the reader has asked to be located. Nothing
          about it is stored, and it disappears with the session. */}
      {watch && (
        <section className="border-b border-line px-4 pb-1 pt-4">
          <Label>Here</Label>
          <Readout
            label="Nearest strike"
            value={watch.nearest === null ? "—" : fmt(Math.round(watch.nearest))}
            unit={watch.nearest === null ? "" : "km"}
            hint="The closest strike still inside the retained window, from where you said you are. A dash means nothing has fallen within 2,000 km of you in that time."
          />
          <Thunder thunder={watch.thunder} />
        </section>
      )}

      {settings.regions && (
        <section data-tour="active" className="border-b border-line px-4 pb-4 pt-4">
          <Label
            trailing="strikes"
            hint="Places holding the cells still burning now, not session totals."
            shut={shut.active}
            onToggle={fold("active")}
          >
            Most active
          </Label>
          {!shut.active && (
          <ul className="mt-2">
            {regions.length === 0 && (
              <li className="py-1 text-xs text-dim">&gt; nothing burning</li>
            )}
            {regions.map((region) => (
              <li key={region.place}>
                <button
                  type="button"
                  onPointerEnter={() => onFocus(region)}
                  onPointerLeave={() => onFocus(null)}
                  onFocus={() => onFocus(region)}
                  onBlur={() => onFocus(null)}
                  onClick={() => onSelect(region)}
                  aria-pressed={selection?.place === region.place}
                  className={`relative flex w-full items-baseline gap-2 py-[3px] text-left text-xs transition-colors hover:text-text active:text-text touch:py-2 ${
                    selection?.place === region.place ? "text-text glow" : ""
                  }`}
                >
                  {/* The bar is the comparison; the figure is the reading. Drawn
                      from the land token rather than the rule token: a rule is
                      meant to sit at the edge of visibility and a quantity is
                      not, and at line weight this came to 1.27:1 against the
                      panel, which is a comparison nobody can make. Mixed back
                      to 60% it reads at about 2:1 in both media, present
                      without competing with the figure beside it. */}
                  <span
                    className="absolute inset-y-0 left-0 bg-land/60"
                    style={{ width: `${(region.count / busiest) * 100}%` }}
                    aria-hidden="true"
                  />
                  {/* Positioned, so they paint over the bar behind them. */}
                  <span className="relative truncate">{region.place}</span>
                  <span className="relative ml-auto shrink-0 text-dim">{fmt(region.count)}</span>
                </button>
              </li>
            ))}
          </ul>
          )}
        </section>
      )}

      {/* The feed is the group that takes up the slack in the column, so folded
          it has to stop asking for the slack as well as stop drawing: left
          growing, it would fold to a heading with the whole remainder of the
          panel held empty underneath it.

          Open, it holds a floor. It used to carry `min-h-0` instead, which is
          the whole of why it could vanish: that is a licence for flex to settle
          a column which does not fit by taking the difference out of this one
          section, and the difference can be everything it has. Side by side the
          shell clips what leaves the window, so the feed did not go below the
          fold, it went to nothing, and a column whose parts have all agreed to
          shrink is a column that fits, with no reason to offer a scrollbar.
          A definite floor refuses that bargain, and the arithmetic has to fail
          upward instead: the panel overflows, and what overflows can be reached.
          Definite rather than the automatic minimum, which is the whole feed and
          would have this scrolling from the first strike. */}
      {settings.feed && (
      <section
        data-tour="feed"
        className={`flex flex-col px-4 pt-4 short:flex-none ${
          shut.feed ? "pb-4" : "min-h-48 flex-1"
        }`}
      >
        {/* The label carries the hold: a stopped feed must never look like a
            dead one. */}
        <Label
          trailing={
            coarse ? (
              <button
                type="button"
                aria-pressed={hold}
                aria-label={hold ? "Release the feed" : "Hold the feed still"}
                onClick={() => onHold(!hold)}
                className={`-my-2 py-2 pl-2 uppercase tracking-label transition-colors active:text-text ${
                  hold ? "text-text glow" : "text-dim"
                }`}
              >
                [ {hold ? "held" : "hold"} ]
              </button>
            ) : hold ? (
              "held"
            ) : (
              "delay"
            )
          }
          shut={shut.feed}
          onToggle={fold("feed")}
        >
          Recent · UTC
        </Label>
        {!shut.feed && (
          <>

        {/* The filter states itself and carries its own way out; there is no
            other clue that the feed is showing less than everything. */}
        {selection && (
          <button
            type="button"
            onClick={() => onSelect(selection)}
            className="mt-2 flex w-full items-center gap-2 text-2xs uppercase tracking-label text-text transition-colors hover:text-dim active:text-dim touch:py-2"
          >
            {/* The brackets and `clear` are the control and keep the control's
                idiom; the name between them is a value and does not. */}
            <span className="truncate normal-case tracking-normal">
              [ {selection.radius ? `cell · ${selection.place}` : selection.place} ]
            </span>
            <span className="shrink-0 text-dim">clear &#215;</span>
          </button>
        )}

        <ul
          className="feed-mask mt-2 min-h-0 flex-1 overflow-y-auto pb-4 short:max-h-52"
          onPointerEnter={coarse ? undefined : () => onHold(true)}
          onPointerLeave={
            coarse
              ? undefined
              : () => {
                  onHold(false);
                  onFocus(null);
                }
          }
        >
          {rows.length === 0 && (
            <li className="py-1 text-xs text-dim">
              &gt; {selection ? "no strikes here yet" : "awaiting first strike"}
            </li>
          )}
          {rows.map((strike) => (
            <Row
              key={strike.id}
              strike={strike}
              onSelect={onSelect}
              onFocus={onFocus}
              // A tap focuses the row it landed on, and the latch above must
              // not be released by reading one of the rows it is holding still.
              onHold={coarse ? undefined : onHold}
            />
          ))}
        </ul>
          </>
        )}
      </section>
      )}
    </aside>
  );
}

// Skips every render driven by the map alone: panning and hovering the tube
// change nothing here.
export default memo(Sidebar);
