import { memo, useEffect, useState } from "react";
import { share, WORLD_RATE, WORLD_MARGIN, SCALE_MAX } from "../../lib/share.js";
import { STEP_KM } from "../../lib/reach.js";

const TRACE_W = 300;
const TRACE_H = 34;
// Taller than the 60s trace above it. That one is a heartbeat and is read as a
// level; this one is a shape, and a day of weather has more in it to resolve.
const DAY_H = 44;
// Short, because it is a scale rather than a curve: there is nothing to resolve
// vertically, and height here would only make it look like a reading over time.
const GAUGE_H = 11;
// Two distributions sharing an axis, so it needs the height the day trace needs
// and not the height the gauge needs.
const REACH_H = 40;

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
 * simply did not exist on a phone — the terse panel with no way to the gloss,
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
 * Returns the element the row should be — a real button when it has become one,
 * so it is reachable by tab and answers Enter without any of that being
 * reimplemented here — along with whether the hint is currently held open.
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
function Label({ children, trailing, hint }) {
  const { open, tag: Tag, props } = useTapHint(hint);
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
 * type — a status figure that had been shrunk as well would read as unimportant
 * rather than as a different subject, and the fix gap is not unimportant.
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

// One side of the reach reading, as a figure and a trailing gloss: the middle
// of the distribution, and the tenth of it that carried furthest. Absent as a
// dash rather than as a zero — a half that has not filled yet has no median,
// and a zero would be a claim that nothing was heard.
const far = (side) => (side.median === null ? "—" : Math.round(side.median).toLocaleString("en-US"));
const unit = (side) =>
  side.tail === null ? "" : `km · ${(Math.round(side.tail / 100) / 10).toFixed(1)}k far`;

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
 * on a schedule — Africa, then the Americas, then Asia, each in their own
 * afternoon — and a curve with three humps in it says nothing at all unless you
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
 * The live rate against the world's, on one scale.
 *
 * A dial was the obvious drawing and the wrong one: nothing else in this
 * instrument is round, and a needle sweeping an arc would be the only thing on
 * the screen pretending to be a physical object. This is the same comparison
 * laid flat — the bar is what is being heard, the tick is what the planet is
 * known to produce, and the distance between them is the whole reading.
 *
 * The satellite's ±5 is drawn as a band rather than dropped. It is the one
 * number on this panel that arrived with its own uncertainty attached, and
 * hiding that would make a measured figure look like a constant.
 */
function Gauge({ perSecond }) {
  const x = (rate) => Math.min(1, rate / SCALE_MAX) * TRACE_W;
  const live = x(perSecond);
  const lo = x(WORLD_RATE - WORLD_MARGIN);
  const hi = x(WORLD_RATE + WORLD_MARGIN);

  return (
    <svg
      viewBox={`0 0 ${TRACE_W} ${GAUGE_H}`}
      preserveAspectRatio="none"
      className="h-[11px] w-full"
      role="img"
      aria-label={`Detecting ${perSecond.toFixed(1)} strikes per second against a global mean of ${WORLD_RATE} flashes per second`}
    >
      {/* The scale it is all measured on, and the satellite's margin sitting on
          it: a band, not a line, because that is what the figure is. */}
      <rect x="0" y={GAUGE_H - 1} width={TRACE_W} height="1" className="fill-line" />
      <rect x={lo} y="0" width={hi - lo} height={GAUGE_H} className="fill-line" />
      {/* What is actually arriving. Solid to the left edge, because a share is
          read from zero and not from wherever the eye happens to land. */}
      <rect x="0" y="2" width={live} height={GAUGE_H - 3} className="fill-text" opacity="0.5" />
      {/* The mark. The brightest thing here: it is the fixed point, and every
          other mark on it is only interesting by comparison with this one. */}
      <line
        x1={x(WORLD_RATE)}
        y1="0"
        x2={x(WORLD_RATE)}
        y2={GAUGE_H}
        className="stroke-text"
        strokeWidth="1"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/**
 * The two reach distributions, drawn over each other.
 *
 * Over each other rather than side by side, because the reading is not either
 * shape: it is whether one of them is further right than the other, and two
 * charts with their own axes is the one arrangement that makes that comparison
 * hard. Each is scaled to its own peak for the same reason — the question is
 * where the mass sits, and the two bins fill at whatever rate the weather
 * offers, so the taller of them is only a fact about the hour.
 *
 * Day is the filled shape and night is the line, which is the pairing the day
 * trace above already uses: the fill is context and the line is the thing being
 * read. Night gets the line because night is the interesting half.
 */
function ReachTrace({ reach }) {
  // Drawn as far out as anything was actually heard, not as far as the bins go.
  // Almost all of a session sits inside the first few thousand kilometres, and
  // an axis running to half the planet would be mostly a picture of the empty
  // part of it.
  const { span } = reach;
  if (span < 3) return null;

  const shape = (counts, total) => {
    if (!total) return null;
    const peak = Math.max(...Array.from({ length: span }, (unused, i) => counts[i]));
    if (!peak) return null;
    const step = TRACE_W / (span - 1);
    return Array.from({ length: span }, (unused, i) => [
      i * step,
      REACH_H - (counts[i] / peak) * (REACH_H - 2) - 1,
    ]);
  };

  const path = (points) =>
    points.map(([px, py], i) => `${i ? "L" : "M"}${px.toFixed(1)} ${py.toFixed(1)}`).join(" ");

  const lit = shape(reach.day.counts, reach.day.n);
  const dark = shape(reach.night.counts, reach.night.n);

  return (
    <svg
      viewBox={`0 0 ${TRACE_W} ${REACH_H}`}
      preserveAspectRatio="none"
      className="h-[40px] w-full"
      role="img"
      aria-label={`How far strikes were heard, over paths in daylight against paths in darkness, out to ${Math.round((span * STEP_KM) / 1000)} thousand kilometres`}
    >
      {lit && <path d={`${path(lit)} L${TRACE_W} ${REACH_H} L0 ${REACH_H} Z`} className="fill-line" />}
      {dark && (
        <path
          d={path(dark)}
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
 * Seconds until the thunder of a strike that has already been seen.
 *
 * Its own clock, for the same reason the footer's is: the watch pass runs every
 * two seconds, and a countdown that moved in two-second steps would be a worse
 * lie than no countdown at all. Ticks four times a second and rounds, so the
 * figure falls one second at a time.
 */
const Thunder = memo(function Thunder({ thunder }) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!thunder) return;
    const id = setInterval(() => tick((n) => n + 1), 250);
    return () => clearInterval(id);
  }, [thunder]);

  if (!thunder) return null;
  const left = (thunder.at - Date.now()) / 1000;
  // It has arrived. Held for a beat rather than vanishing, so the count is seen
  // to finish rather than appearing to have been cancelled.
  if (left <= -2) return null;

  return (
    <Readout
      label="Thunder"
      value={left <= 0 ? "now" : Math.ceil(left)}
      unit={left <= 0 ? "" : `s · ${Math.round(thunder.km)}km`}
      hint="The sound of a strike already seen, still travelling, at 343 m/s."
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
        <span className="truncate uppercase">{strike.place}</span>
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
  const heard = share(stats.rate);

  // The panel fills the column and lets the feed take up the slack, which works
  // while there is slack. Turned sideways a phone has none: the fixed readouts
  // above the feed come to more than the whole height, so there the column
  // scrolls as one and the feed stops trying to absorb a remainder that is
  // already negative.
  return (
    <aside className="flex w-full shrink-0 flex-col border-line bg-panel wide:w-[340px] wide:border-l short:w-[268px] short:overflow-y-auto short:overscroll-y-contain">
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
        <div className="mt-2 text-base text-text glow-hot">{fmt(stats.rate)}</div>
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
      </section>

      {/* Since the tab was opened. The trace is absent rather than empty until
          there is a curve to draw — two minutes is the least it can be and
          still be a line — but the total is always here, so the group never
          disappears out from under a figure somebody was watching. */}
      <section className="border-b border-line px-4 pb-1 pt-4">
        <Label
          trailing={day?.series?.length > 1 ? span(day.spanMs) : null}
          hint="Arrivals by the minute, for as long as this tab has been open. The hairline is midnight UTC."
        >
          Session
        </Label>
        {settings.day && day?.series?.length > 1 && (
          <>
            <div className="mt-1">
              <DayTrace day={day} />
            </div>
            {/* The peak is the one figure the curve cannot be read off
                precisely, and the one worth knowing: how hard the world was
                firing at its hardest, and when. UTC, like the footer clock and
                for the same reason — the peak is somebody's afternoon, and
                whose it was is the reading. */}
            <div className="mt-1 flex items-baseline justify-between text-2xs uppercase tracking-label text-dim">
              <span>Peak</span>
              <span>
                <span className="text-text">{fmt(day.peak.rate)}</span> / min at{" "}
                <span className="text-text">
                  {new Date(day.peak.t).toISOString().slice(11, 16)}
                </span>
                z
              </span>
            </div>
          </>
        )}
        <Readout label="Detected" value={fmt(stats.total)} />
      </section>

      {/* The instrument, reporting on itself.
          These three were sitting among the weather figures in one
          undifferentiated list, which is what made the fix gap look like a
          reading about the storm. It is not: all three are properties of the
          detection geometry and of the link, they move on the network's
          schedule rather than the weather's, and under their own heading they
          say so without a word of explanation. Unlit, for the same reason. */}
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
        <Readout
          quiet
          label="Fix gap"
          value={stats.gap ?? "—"}
          unit={stats.gap === null ? "" : "°"}
          hint="The widest direction the last strikes were not heard from. Past 180° means they were heard from one side only, and placed the more loosely for it."
        />
      </section>

      {/* Still the instrument reporting on itself, and unlit for the same
          reason as the group above it — but a different question. That one is
          how well it is hearing what it hears; this is how much of what there
          is to hear it is getting at all, which is the question every reader
          arrives with and nothing on the screen used to answer. */}
      <section className="border-b border-line px-4 pb-1 pt-4">
        <Label
          trailing={`${WORLD_RATE} / s world`}
          hint="The live rate against 44 ± 5 flashes a second, the global mean the Optical Transient Detector measured from orbit over five years. The tick is that figure and the band around it is its uncertainty."
        >
          Coverage
        </Label>
        <div className="mt-2">
          <Gauge perSecond={heard.perSecond} />
        </div>
        <Readout
          quiet
          label="Heard"
          value={heard.perSecond.toFixed(1)}
          unit="/ s"
        />
        <Readout
          quiet
          label="Global share"
          value={heard.share === null ? "—" : Math.round(heard.share * 100)}
          unit={heard.share === null ? "" : "%"}
          hint="How much of the world's flash rate is reaching this browser. Not a detection efficiency: the satellite counted the flashes inside the cloud as well, which a VLF network barely hears, while what arrives here is strokes, three or four of which can be one flash."
        />
      </section>

      {/* The other half of the same subject. Above is how much of the world's
          lightning is arriving; this is how far it is coming from, and why that
          changes between noon and midnight. Absent until there is a shape
          rather than drawn empty: a session opens with nothing in either bin,
          and an empty pair of curves teaches the eye to stop looking. */}
      {settings.reach && reach && (
        <section className="border-b border-line px-4 pb-1 pt-4">
          <Label
            trailing={reach.span > 2 ? `0–${Math.round((reach.span * STEP_KM) / 1000)}k km` : null}
            hint="How far each strike was heard, counted to the most distant station that helped place it. Filled is paths under daylight, the line is paths under darkness."
          >
            Reach
          </Label>
          <div className="mt-1">
            <ReachTrace reach={reach} />
          </div>
          {/* The two figures the shapes are only the picture of: the middle of
              each distribution, and its far end.
              Both, rather than the median alone, because they are not the same
              reading and the second is the one this exists for. The middle is
              mostly a fact about where the volunteers live — half the network
              is in Europe, and that sets how far a typical strike has to carry
              before somebody hears it, day or night. The far end is where the
              waveguide shows: it is the ninth strike in ten rather than the
              farthest of all, because the farthest of all is one strike and one
              strike is not a propagation condition.
              Each half appears when it has enough in it. The two fill on the
              weather's schedule and not on the clock's — at an hour when the
              world's lightning is all over the Americas, the sunlit side is
              ready long before the dark one. */}
          <Readout quiet label="Day" value={far(reach.day)} unit={unit(reach.day)} />
          <Readout
            quiet
            label="Night"
            value={far(reach.night)}
            unit={unit(reach.night)}
            hint="Sunlight makes a lossy layer at 60–70 km that the sferic has to bounce off; after sunset it decays and the reflection moves up to 85–90 km, where less is lost at every hop. The far figure is where that shows, and it should be the longer one at night. Both are floors — the most distant station that heard a strike is not as far as it went."
          />
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
          />
          <Thunder thunder={watch.thunder} />
        </section>
      )}

      {settings.regions && (
        <section data-tour="active" className="border-b border-line px-4 pb-4 pt-4">
          <Label
            trailing="strikes"
            hint="Places holding the cells still burning now, not session totals."
          >
            Most active
          </Label>
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
                  <span className="relative truncate uppercase">{region.place}</span>
                  <span className="relative ml-auto shrink-0 text-dim">{fmt(region.count)}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {settings.feed && (
      <section data-tour="feed" className="flex min-h-0 flex-1 flex-col px-4 pt-4 short:flex-none">
        {/* The label carries the hold: a stopped feed must never look like a
            dead one. */}
        <Label trailing={hold ? "held" : "delay"}>Recent · UTC</Label>

        {/* The filter states itself and carries its own way out; there is no
            other clue that the feed is showing less than everything. */}
        {selection && (
          <button
            type="button"
            onClick={() => onSelect(selection)}
            className="mt-2 flex w-full items-center gap-2 text-2xs uppercase tracking-label text-text transition-colors hover:text-dim active:text-dim touch:py-2"
          >
            <span className="truncate">
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
      </section>
      )}
    </aside>
  );
}

// Skips every render driven by the map alone: panning and hovering the tube
// change nothing here.
export default memo(Sidebar);
