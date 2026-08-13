import { memo, useEffect, useState } from "react";

const TRACE_W = 300;
const TRACE_H = 34;

/** Caps label trailed by a rule to the panel edge: a terminal section break. */
function Label({ children, trailing }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="shrink-0 text-2xs uppercase tracking-label text-dim">{children}</span>
      <span className="h-px flex-1 bg-line" />
      {trailing && <span className="shrink-0 text-2xs uppercase tracking-label text-dim">{trailing}</span>}
    </div>
  );
}

function Readout({ label, value, unit }) {
  return (
    <div className="flex items-baseline justify-between border-b border-line py-2.5 last:border-b-0">
      <span className="text-2xs uppercase tracking-label text-dim">{label}</span>
      <span className="text-base text-text glow">
        {value}
        {unit && <span className="ml-1 text-2xs text-dim">{unit}</span>}
      </span>
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
        className="settle flex w-full items-baseline gap-2 py-[3px] text-left text-xs transition-colors hover:text-text"
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
      <section data-tour="rate" className="border-b border-line px-4 pb-4 pt-4">
        <Label>Rate</Label>
        <div className="mt-2 flex items-baseline justify-between">
          <span className="text-base text-text glow-hot">{fmt(stats.rate)}</span>
          <span className="text-2xs uppercase tracking-label text-dim">strikes / min</span>
        </div>
        {settings.trace && (
          <div className="mt-1">
            <RateTrace samples={samples} />
          </div>
        )}
      </section>

      <section data-tour="stats" className="border-b border-line px-4 py-1">
        <Readout label="Detected" value={fmt(stats.total)} />
        <Readout label="Latency" value={stats.delay ?? "—"} unit={stats.delay ? "s" : ""} />
        <Readout label="Stations" value={stats.stations ?? "—"} />
        <Readout
          label="Fix gap"
          value={stats.gap ?? "—"}
          unit={stats.gap === null ? "" : "°"}
        />
        <Readout label="Storm cells" value={fmt(stats.storms)} />
      </section>

      {/* Only ever present once the reader has asked to be located. Nothing
          about it is stored, and it disappears with the session. */}
      {watch && (
        <section className="border-b border-line px-4 py-1">
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
          <Label trailing="strikes">Most active</Label>
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
                  className={`relative flex w-full items-baseline gap-2 py-[3px] text-left text-xs transition-colors hover:text-text ${
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
            className="mt-2 flex items-center gap-2 text-2xs uppercase tracking-label text-text transition-colors hover:text-dim"
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
