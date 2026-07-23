import Panel, { Group } from "./panel.jsx";

/** Draws the mark itself, so the key shows the thing rather than describing it. */
function Mark({ children }) {
  return (
    <span className="flex h-4 w-8 shrink-0 items-center justify-center" aria-hidden="true">
      {children}
    </span>
  );
}

function Entry({ mark, term, children }) {
  return (
    <div className="flex gap-3 py-1.5">
      <Mark>{mark}</Mark>
      <div className="min-w-0">
        <div className="text-2xs uppercase tracking-label text-text">{term}</div>
        <p className="mt-0.5 text-xs leading-relaxed text-dim">{children}</p>
      </div>
    </div>
  );
}

const dot = (
  <svg viewBox="0 0 24 16" className="h-4 w-6">
    <circle cx="12" cy="8" r="2.4" className="fill-strike" />
    <circle cx="12" cy="8" r="5.5" className="fill-strike" opacity="0.16" />
  </svg>
);

const ring = (
  <svg viewBox="0 0 24 16" className="h-4 w-6">
    <circle cx="12" cy="8" r="1.6" className="fill-strike" />
    <circle cx="12" cy="8" r="6" className="stroke-strike" fill="none" strokeWidth="1" opacity="0.5" />
  </svg>
);

const bolt = (
  <svg viewBox="0 0 24 16" className="h-4 w-6">
    <path d="M13 1 8.5 8H11l-1 7 4.5-7H12l1-7Z" className="fill-strike" />
  </svg>
);

const smudge = (
  <svg viewBox="0 0 24 16" className="h-4 w-6">
    <circle cx="12" cy="8" r="5" className="fill-text" opacity="0.22" />
  </svg>
);

const storm = (
  <svg viewBox="0 0 24 16" className="h-4 w-6">
    <circle cx="10" cy="8" r="5.5" className="stroke-text" fill="none" strokeWidth="1" opacity="0.6" />
    <path d="M16 8h5M18.5 5.5 21 8l-2.5 2.5" className="stroke-text" fill="none" strokeWidth="1" opacity="0.8" />
  </svg>
);

const land = (
  <svg viewBox="0 0 24 16" className="h-4 w-6">
    {[5, 9, 13, 17].map((x) =>
      [5, 9, 12].map((y) => <rect key={`${x}-${y}`} x={x} y={y} width="1.8" height="1.8" className="fill-land" />)
    )}
  </svg>
);

export default function Legend({ onClose }) {
  return (
    <Panel title="Key" width={420} onClose={onClose}>
      <Group title="On the map">
        <Entry mark={dot} term="Strike">
          A detected strike, at full brightness on arrival and fading over the persistence set in
          configuration. Position is where the network located the discharge.
        </Entry>
        <Entry mark={ring} term="Ping">
          The arrival marker — a ring thrown outward as a strike lands, so an arrival anywhere on
          the map catches the eye without needing a colour.
        </Entry>
        <Entry mark={bolt} term="Bolt">
          Drawn when one 1° cell takes 3 or more strikes within 2.5 seconds. Heavier and twice the
          size at 9 or more, which is also what shakes the screen.
        </Entry>
        <Entry mark={smudge} term="Density">
          Where strikes have accumulated. A cell needs 3 strikes before it marks at all, and the
          mark fades over 4 minutes, so the map empties as storms move on.
        </Entry>
        <Entry mark={storm} term="Storm cell">
          A cluster of strikes grouped by proximity, labelled with its strike count and — once
          tracked long enough — its ground speed. The arrow gives the bearing of travel: the
          direction is to scale, the length is not.
        </Entry>
        <Entry mark={land} term="Land">
          A dot matrix, not a coastline, so that lit strikes stay the only solid marks on screen.
          It is rebuilt for whatever is on screen as you zoom, opening out a little as you close
          in — held at world spacing, a continent seen from inside reads as a solid field.
        </Entry>
      </Group>

      <Group title="Readouts">
        <Entry term="Rate">Strikes detected worldwide in the last 60 seconds. The trace below it is that same minute, sampled twice a second.</Entry>
        <Entry term="Detected">Total strikes received since the page was opened.</Entry>
        <Entry term="Latency">
          How long the network took to locate the most recent strike — a property of the detection
          system, not of the weather.
        </Entry>
        <Entry term="Storm cells">
          Clusters currently being tracked. Not grid squares: a cluster needs at least 12 strikes
          across adjacent ~45 km bins to count.
        </Entry>
        <Entry term="Most active">
          The places holding the most strikes across the cells still burning on the map — roughly
          the last few minutes, not the whole session. Counted from cells of 3 strikes or more, so
          scattered single strikes never enter the ranking.
        </Entry>
      </Group>

      <Group title="Working it">
        <Entry term="Pointing">
          The map reads out whatever is under the pointer: the place, its coordinates, and how many
          strikes that 1° cell is holding. Pointing at a feed row or a ranked place marks it on the
          map instead.
        </Entry>
        <Entry term="Picking">
          Clicking the map — or a feed row, or a ranked place — narrows the feed to that place.
          Click it again, or press escape, to let it go.
        </Entry>
        <Entry term="Moving">
          Drag to pan, wheel or pinch to zoom, up to about a 200 km span. The named regions across
          the top of the tube jump straight there. At world zoom a storm over the Alps is four
          pixels across, which is the whole reason for it.
        </Entry>
        <Entry term="Here">
          The one control that asks the browser where you are, and only when pressed — nothing
          requests a position on load. The fix frames the map on your region and marks it with a
          station ring. It is held for the session only: not stored, not sent anywhere.
        </Entry>
        <Entry term="Holding">
          The feed stops advancing while the pointer rests on it, so a row can be read to the end.
          Arrivals queue behind it and release when you leave.
        </Entry>
        <Entry term="Keys">
          <span className="text-text">k</span> this panel &middot;{" "}
          <span className="text-text">c</span> configuration &middot;{" "}
          <span className="text-text">t</span> tube / paper &middot;{" "}
          <span className="text-text">+</span> <span className="text-text">&minus;</span> zoom
          &middot; <span className="text-text">0</span> whole world &middot;{" "}
          <span className="text-text">esc</span> close or clear
        </Entry>
      </Group>

      <Group title="Reading the tracks">
        <p className="py-1 text-xs leading-relaxed text-dim">
          A speed appears only after a cell has been watched for 10 minutes. That wait is set by
          geometry: a 45 km/h cell moves 3.75 km in five minutes while being roughly 100 km across,
          which is too small a shift to measure against its own size. Speeds outside 8–140 km/h are
          withheld as tracking errors rather than shown.
        </p>
        <p className="py-1 text-xs leading-relaxed text-dim">
          Tracks extrapolate observed motion. They say where an existing cell is heading over the
          next few minutes — not where the next strike will land, and nothing about cells that have
          yet to form.
        </p>
      </Group>
    </Panel>
  );
}
