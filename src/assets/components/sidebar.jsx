import { memo, useEffect, useState } from "react";

const TRACE_W = 300;
const TRACE_H = 34;
// Taller than the 60s trace above it. That one is a heartbeat and is read as a
// level; this one is a shape, and a day of weather has more in it to resolve.
const DAY_H = 44;

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
 */
function Hint({ children }) {
  if (!children) return null;
  return (
    <p className="pointer-events-none absolute left-0 right-0 top-full z-10 hidden -translate-y-px border border-line bg-panel px-3 py-2 text-xs leading-snug text-dim group-hover:block">
      {children}
    </p>
  );
}

/** Caps label trailed by a rule to the panel edge: a terminal section break. */
function Label({ children, trailing, hint }) {
  return (
    <div className={`group relative flex items-center gap-2.5 ${hint ? "cursor-help" : ""}`}>
      <span className="shrink-0 text-2xs uppercase tracking-label text-dim">{children}</span>
      <span className="h-px flex-1 bg-line" />
      {trailing && <span className="shrink-0 text-2xs uppercase tracking-label text-dim">{trailing}</span>}
      <Hint>{hint}</Hint>
    </div>
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
  return (
    <div
      className={`group relative border-b border-line py-2.5 last:border-b-0 ${
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
      <Hint>{hint}</Hint>
    </div>
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

  return (
    <aside className="flex w-full shrink-0 flex-col border-line bg-panel lg:w-[340px] lg:border-l">
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
      <section data-tour="feed" className="flex min-h-0 flex-1 flex-col px-4 pt-4">
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
          className="feed-mask mt-2 min-h-0 flex-1 overflow-y-auto pb-4"
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
