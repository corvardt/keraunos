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

const track = (
  <svg viewBox="0 0 24 16" className="h-4 w-6">
    <path d="M2 12c3 .5 5-1 7-3" className="stroke-text" fill="none" strokeWidth="1" opacity="0.25" />
    <path d="M9 9c2-2 3-2.5 5-3" className="stroke-text" fill="none" strokeWidth="1" opacity="0.55" />
    <path d="M14 6h7" className="stroke-text" fill="none" strokeWidth="1" strokeDasharray="3 3" opacity="0.5" />
  </svg>
);

const land = (
  <svg viewBox="0 0 24 16" className="h-4 w-6">
    {[5, 9, 13, 17].map((x) =>
      [5, 9, 12].map((y) => <rect key={`${x}-${y}`} x={x} y={y} width="1.8" height="1.8" className="fill-land" />)
    )}
  </svg>
);

const frontier = (
  <svg viewBox="0 0 24 16" className="h-4 w-6">
    {[3, 7, 11, 15, 19].map((x) => (
      <rect key={x} x={x} y={11} width="1.8" height="1.8" className="fill-land" />
    ))}
    {[2, 5, 8, 11, 14, 17, 20].map((x, i) => (
      <rect key={x} x={x} y={2 + Math.abs(3 - i) * 0.9} width="1.8" height="1.8" className="fill-dim" />
    ))}
  </svg>
);

const bounds = (
  <svg viewBox="0 0 24 16" className="h-4 w-6">
    <circle cx="12" cy="8" r="3.4" className="fill-text" opacity="0.2" />
    {[[6, 3, 1, 1], [18, 3, -1, 1], [6, 13, 1, -1], [18, 13, -1, -1]].map(([x, y, sx, sy]) => (
      <path
        key={`${x}-${y}`}
        d={`M${x + sx * 3} ${y}H${x}V${y + sy * 3}`}
        className="stroke-text"
        fill="none"
        strokeWidth="1"
        opacity="0.5"
      />
    ))}
  </svg>
);

// Cloud, and the harder core of it: the two passes the layer is drawn in.
const cloudMark = (
  <svg viewBox="0 0 24 16" className="h-4 w-6">
    <path
      d="M3 11c1-3 4-4 6-2 1-3 5-4 7-1 2-1 4 0 4 3H3Z"
      className="fill-land"
      opacity="0.55"
    />
    <ellipse cx="13" cy="8.5" rx="3.6" ry="2.4" className="fill-text" opacity="0.75" />
  </svg>
);

const station = (
  <svg viewBox="0 0 24 16" className="h-4 w-6">
    {[[3, 3], [2, 9], [6, 14], [21, 5], [22, 11]].map(([x, y]) => (
      <line key={`${x}-${y}`} x1={x} y1={y} x2="13" y2="8" className="stroke-dim" strokeWidth="0.5" opacity="0.6" />
    ))}
    <circle cx="13" cy="8" r="1.4" className="fill-strike" />
  </svg>
);

const capital = (
  <svg viewBox="0 0 24 16" className="h-4 w-6">
    <rect x="4" y="7" width="2" height="2" className="fill-text" opacity="0.9" />
    <rect x="8.5" y="6" width="11" height="4" className="fill-text" opacity="0.18" />
  </svg>
);

const daylight = (
  <svg viewBox="0 0 24 16" className="h-4 w-6">
    <path d="M3 1c4 2 6 5 6 7s-2 5-6 7Z" className="fill-text" opacity="0.16" />
    <path d="M3 1c4 2 6 5 6 7s-2 5-6 7" className="stroke-text" fill="none" strokeWidth="1" opacity="0.4" />
  </svg>
);

export default function Legend({ onClose }) {
  return (
    <Panel title="Key" width={420} onClose={onClose}>
      <Group title="On the map">
        <Entry mark={dot} term="Strike">
          A detected strike, at full brightness on arrival and fading over the persistence set in
          configuration. Position is where the network located the discharge, and the mark is drawn
          a little softer where it located it from one side only, which the Fix gap below explains.
          The ping and the bolt are never softened: how well a strike was placed says nothing about
          whether it happened.
        </Entry>
        <Entry mark={ring} term="Ping">
          The arrival marker: a ring thrown outward as a strike lands, so an arrival anywhere on
          the map catches the eye without needing a colour.
        </Entry>
        <Entry mark={bolt} term="Bolt">
          Drawn when one 1° cell takes 3 or more strikes within 2.5 seconds. Heavier and twice the
          size at 9 or more, which is also what shakes the screen.
        </Entry>
        <Entry mark={bounds} term="Cell bounds">
          Off by default. Corner ticks around a one-degree cell that is firing right now, clearing a
          few seconds after it goes quiet. Ticks rather than a closed box, so the extent is marked
          without a rectangle being ruled over the weather inside it.
        </Entry>
        <Entry mark={smudge} term="Density">
          Where strikes have accumulated. A cell needs 3 strikes before it marks at all, and the
          mark fades over the density window set in configuration, so the map empties as storms
          move on.
          <br />
          <br />
          At <span className="text-text">4m</span> that is weather: where it is raining lightning
          now. Opened out to <span className="text-text">20m</span> or{" "}
          <span className="text-text">1h</span>, the same layer becomes where the lightning has
          been, and an hour of it draws the band the planet actually fires in. It is this
          session&rsquo;s own hour and nothing else: nothing is fetched to fill it in, and it goes
          when the tab does, so a window longer than you have been watching is simply shorter than
          it says.
        </Entry>
        <Entry mark={storm} term="Storm cell">
          A cluster of strikes grouped by proximity, labelled with its strike count and, once
          tracked long enough, its ground speed. The arrow gives the bearing of travel: the
          direction is to scale, the length is not.
        </Entry>
        <Entry mark={track} term="Cell track">
          Up to an hour of where a storm cell has been, brightening toward the present, with its
          next hour dashed on ahead. Both are drawn to scale: an ordinary cell covers only tens of
          kilometres in that time, so the track appears once you are close enough for that to be
          more than a pixel, and not before. The speed beside it is fitted to the recent end of the
          track alone: cells turn, and an hour of a turning one averages out to a heading it no
          longer has.
          <br />
          <br />
          How much of this a cell carries is Cell detail in configuration.{" "}
          <span className="text-text">Ring</span> is the cell and its strike count and nothing else;{" "}
          <span className="text-text">track</span> adds where it has been and which way it is
          heading; <span className="text-text">full</span> adds the forecast and the speed. Turned
          down, a cue is not drawn rather than drawn faintly; a cue you have dimmed is still a cue
          competing for the same eye.
        </Entry>
        <Entry mark={capital} term="Capital">
          Named only while a cell within 400 km of it is burning, and fading as that burn does. The
          map is an instrument rather than an atlas, and a place name earns its space at exactly one
          moment: when something is happening there. A quiet map carries none; point at it instead,
          and it names whatever is under the cursor.
        </Entry>
        <Entry mark={cloudMark} term="Cloud field">
          Thermal infrared, at 10.8&micro;m, from the five geostationary satellites that between them
          hold the whole ring: two of NASA&rsquo;s over the Pacific and the Americas, two of
          EUMETSAT&rsquo;s over Africa and the Indian Ocean, and Himawari over Asia. That wavelength
          reads the temperature of the highest thing in the column, so what is drawn is not cloud
          exactly but cloud height: the faint wash is the body of it, and the bright cores are the
          tops cold enough to have been driven up near the tropopause. Those are the ones that
          matter. A column climbing that hard is the thing that separates charge, which is to say
          the second pass is very nearly a map of where this map is about to have something to
          show. Between twenty and forty minutes old depending on the satellite, and never a
          forecast: every pixel was measured. It is also the only layer here that is fetched rather
          than derived, so it can be absent, and when it is the sky simply reads as clear.
        </Entry>
        <Entry mark={daylight} term="Daylight">
          The terminator, and the hemisphere it divides: light added on the tube, ink laid down on
          paper, so the lit side is the pale one in both. It is here because lightning is a daily
          rhythm before it is anything else: the strike band is afternoon convection, and it walks
          around the planet a step behind this line.
        </Entry>
        <Entry mark={frontier} term="Frontier">
          Borders between countries, dotted a step brighter than the land they cross. Only the
          borders: coastlines are left to the matrix, which is the whole reason the map has none.
          They appear as the view becomes a region rather than a planet, and go again at the far end
          of the zoom, where the boundary data is coarser than what you are looking at and a border
          would be drawn straighter than it runs.
        </Entry>
        <Entry mark={station} term="Detector threads">
          Off by default. As each strike lands it throws a thread back to every detector that helped
          place it, for under a second, and then the map is bare again. Nobody publishes where the
          detectors are, so their positions are assembled from the strikes themselves: every strike
          names the stations that heard it. Nothing is drawn between times, because a detector that
          is not hearing anything has nothing to say and the threads are the whole of the point.
          <br />
          <br />
          This is the Fix gap below, drawn rather than counted. A strike caught in a full sheaf was
          pinned from every side; one wearing a fan was heard from a single direction, and placed the
          more loosely for it. Watch a storm for a minute and you can see which way the network is
          listening from.
        </Entry>
        <Entry mark={land} term="Land">
          A dot matrix, not a coastline, so that lit strikes stay the only solid marks on screen.
          It is rebuilt for whatever is on screen as you zoom, opening out a little as you close
          in; held at world spacing, a continent seen from inside reads as a solid field.
        </Entry>
      </Group>

      <Group title="Readouts">
        <Entry term="Rate">Strikes detected worldwide in the last 60 seconds. The trace below it is that same minute, sampled twice a second.</Entry>
        <Entry term="Detected">Total strikes received since the page was opened.</Entry>
        <Entry term="Latency">
          How long the network took to locate the most recent strike: a property of the detection
          system, not of the weather.
        </Entry>
        <Entry term="Stations">
          How many detectors were used to solve the last few strikes, as a median. Not how many
          heard them: the network reports both, and the ones that merely received the signal did not
          decide where it came from.
        </Entry>
        <Entry term="Fix gap">
          The widest direction the last few strikes were <span className="text-text">not</span> heard
          from: the largest angular gap between the stations that fixed them, in degrees. A strike
          ringed by detectors is pinned from every side and reads low; one heard only from the east
          reads above 180°, and is placed far less precisely however many stations heard it. This is
          the network describing its own geometry, and most of what it sees, it sees from one side.
        </Entry>
        <Entry term="Storm cells">
          Clusters currently being tracked. Not grid squares: a cluster needs at least 12 strikes
          across adjacent ~45 km bins to count.
        </Entry>
        <Entry term="Nearest strike">
          Appears only once you have pressed <span className="text-text">here</span>: how far away
          the closest strike of the last few minutes fell. A dash means nothing has landed within
          2,000 km, at which point the figure has stopped being about your weather.
        </Entry>
        <Entry term="Most active">
          The places holding the most strikes across the cells still burning on the map, roughly
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
          Clicking the map (or a feed row, or a ranked place) narrows the feed to that place.
          Clicking a storm cell picks the cell instead, and narrows to what fell inside it rather
          than to the country underneath. Click it again, or press escape, to let it go.
        </Entry>
        <Entry term="Latency">
          The median of the last half-second of arrivals, not the last one. A single measurement of
          a detection network swings by whole seconds and says nothing you can watch.
        </Entry>
        <Entry term="Linking">
          Zoom in and the address carries the view: longitude, latitude, magnification. Hand it to
          someone and the tube opens where you left it. The whole world writes nothing, being where
          it starts.
        </Entry>
        <Entry term="Moving">
          Drag to pan, wheel or pinch to zoom, up to about a 200 km span. The named regions across
          the top of the tube jump straight there. At world zoom a storm over the Alps is four
          pixels across, which is the whole reason for it.
        </Entry>
        <Entry term="Here">
          The one control that asks the browser where you are, and only when pressed; nothing
          requests a position on load. The fix frames the map on your region and marks it with a
          station ring. It is held for the session only: not stored, not sent anywhere.
        </Entry>
        <Entry term="Holding">
          The feed stops advancing while the pointer rests on it, so a row can be read to the end.
          Arrivals queue behind it and release when you leave.
        </Entry>
        <Entry term="Guide">
          A walk through the instrument, pointing at each control on the running
          map rather than describing it here: press <span className="text-text">g</span>, or{" "}
          <span className="text-text">guide</span> in the header. It runs once on a first visit and
          then leaves you alone. This panel is the catalogue it hands off to.
        </Entry>
        <Entry term="Keys">
          <span className="text-text">k</span> or <span className="text-text">?</span> this panel
          &middot; <span className="text-text">c</span> configuration &middot;{" "}
          <span className="text-text">g</span> guide &middot; <span className="text-text">t</span>{" "}
          tube / paper &middot; <span className="text-text">+</span>{" "}
          <span className="text-text">&minus;</span> zoom &middot;{" "}
          <span className="text-text">0</span> whole world &middot;{" "}
          <span className="text-text">esc</span> close or clear.
          <br />
          <br />
          The rewind track takes <span className="text-text">&larr;</span>{" "}
          <span className="text-text">&rarr;</span> once focused, in steps of a hundredth of the
          track and a tenth with <span className="text-text">shift</span>, and{" "}
          <span className="text-text">home</span> and <span className="text-text">end</span> for the
          two ends of it. A fraction rather than a fixed count of seconds, because the track is as
          long as the window behind you, which grows as the session runs.
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
          next few minutes, not where the next strike will land, and nothing about cells that have
          yet to form.
        </p>
      </Group>
    </Panel>
  );
}
