import { memo, useEffect, useState } from "react";

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

/**
 * The two reach readings, as two bars on one scale.
 *
 * This was a pair of histograms drawn over each other, and it was the hardest
 * thing in the panel to read. The shapes were honest and almost nobody could
 * get an answer out of them: two overlapping curves at 40px, one filled and one
 * stroked, each scaled to its own peak, asking the eye to judge which had more
 * mass further right. That is a comparison of areas, and an eye is bad at
 * areas.
 *
 * The question is only ever "does the sferic get further at night", and the eye
 * is very good indeed at comparing two lengths that start at the same place. So
 * the distributions are gone and what is left is the figure each of them was
 * being read for.
 *
 * The bar runs to the ninetieth percentile, because that is where the waveguide
 * shows: the median is mostly a fact about where the volunteers live, since
 * half the network is in Europe, and that sets how far a typical strike has to
 * carry before somebody hears it whatever the sky is doing. The median is kept
 * as a tick inside the bar rather than dropped, so the middle and the far end
 * are still both on screen and it is visible when they move apart.
 *
 * Both bars share one scale, which is the whole point: scaled to themselves
 * they would always be the same length and the reading would be gone.
 */
function ReachBars({ reach }) {
  const sides = [
    { key: "day", label: "Day", side: reach.day },
    { key: "night", label: "Night", side: reach.night },
  ];
  // The furthest either half got, so the two are drawn against each other.
  const full = Math.max(reach.day.tail ?? 0, reach.night.tail ?? 0);
  if (!full) return null;

  return (
    <div className="mt-2 space-y-1.5">
      {sides.map(({ key, label, side }) => (
        <div key={key} className="flex items-center gap-2">
          <span className="w-10 shrink-0 text-2xs uppercase tracking-label text-dim">{label}</span>
          {/* A half that has not filled yet draws no bar at all. A short one
              would be a claim that the sferic did not get far, where the truth
              is that nothing has been counted. */}
          <span className="relative h-2 flex-1 bg-line">
            {side.tail !== null && (
              <>
                <span
                  className="absolute inset-y-0 left-0 bg-land"
                  style={{ width: `${(side.tail / full) * 100}%` }}
                />
                {/* The middle of the distribution, held inside its own bar. */}
                <span
                  className="absolute inset-y-0 w-px bg-text"
                  style={{ left: `${(side.median / full) * 100}%` }}
                />
              </>
            )}
          </span>
          <span className="w-16 shrink-0 text-right text-xs tabular-nums text-text">
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
 * The bars say which is longer and this says by how much, which between them is
 * the whole of what this section exists to report. Withheld rather than guessed
 * at until both distributions have enough in them: they fill on the weather's
 * schedule and it is ordinary for one to be ready an hour before the other.
 */
function ReachVerdict({ reach }) {
  const { day, night } = reach;
  if (day.tail === null || night.tail === null) {
    return (
      <p className="mt-1.5 text-xs text-dim">
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
    return <p className="mt-1.5 text-xs text-dim">&gt; night and day reaching about the same</p>;
  }
  return (
    <p className="mt-1.5 text-xs text-dim">
      &gt; <span className="text-text glow">night {percent}% {change > 0 ? "further" : "shorter"}</span>
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
          onHold(true); // tabbing through rows holds it too
        }}
        onBlur={() => {
          onFocus(null);
          onHold(false);
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
        <Label
          trailing={day?.series?.length > 1 ? span(day.spanMs) : null}
          hint="Arrivals by the minute, for as long as this tab has been open. The hairline is midnight UTC, and Peak is the hardest minute in the window with the hour it fell in."
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
            trailing="90th"
            hint="How far each strike was heard, counted to the most distant station that helped place it. The bar is the ninth strike in ten, which is where the waveguide shows; the tick inside it is the middle of the distribution. Sunlight makes a lossy layer at 60 to 70 km that the sferic has to bounce off; after sunset it decays and the reflection moves up to 85 to 90 km, where less is lost at every hop, so night should be the longer bar. Both are floors: the most distant station that heard a strike is not as far as it went."
            shut={shut.reach}
            onToggle={fold("reach")}
          >
            Reach
          </Label>
          {!shut.reach && (
            <>
              <ReachBars reach={reach} />
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
          trailing={hold ? "held" : "delay"}
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
          onPointerEnter={() => onHold(true)}
          onPointerLeave={() => {
            onHold(false);
            onFocus(null);
          }}
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
              onHold={onHold}
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
