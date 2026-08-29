import Panel, { Group } from "./panel.jsx";

/**
 * Draws the mark itself, so the key shows the thing rather than describing it.
 *
 * Given room. It used to be a 16px stamp beside a paragraph, which is the wrong
 * way round for a key: the picture is the entry and the words are the caption.
 * At this size a sheaf reads as a sheaf and a track reads as a track, which is
 * the whole of what somebody scanning this panel is doing.
 */
function Mark({ children }) {
  return (
    <span className="flex h-6 w-11 shrink-0 items-center justify-center" aria-hidden="true">
      {children}
    </span>
  );
}

/**
 * One term, what it is, and the long answer where there is one.
 *
 * This panel is the catalogue and has to hold the long answer, but it is read
 * in one of two ways and they want opposite things. Somebody scanning for what
 * a white mark is wants a list they can run an eye down; somebody who has found
 * the entry wants all of it.
 *
 * So `children` is the whole entry wherever the whole entry is short, and
 * `more` exists only where it is not. A fold over three lines of text costs a
 * click to save nothing and leaves the reader unable to see, from the closed
 * panel, which entries actually have depth behind them. The rule is the length,
 * not the tidiness: a single short paragraph is written out, and anything that
 * runs to several is folded.
 *
 * A native <details>, so the state, the keyboard and the screen reader's
 * announcement are the browser's. What is styled is only the marker, replaced
 * with the instrument's own bracketed control.
 */
function Entry({ mark, term, more, children }) {
  return (
    <div className="flex gap-3 py-2">
      <Mark>{mark}</Mark>
      <div className="min-w-0 flex-1">
        <div className="text-2xs uppercase tracking-label text-text">{term}</div>
        <p className="mt-1 text-xs leading-relaxed text-dim">{children}</p>
        {more && (
          <details className="group mt-1">
            <summary className="no-marker inline-block cursor-pointer text-2xs uppercase tracking-label text-dim transition-colors hover:text-text active:text-text touch:py-2">
              [ <span className="group-open:hidden">more</span>
              <span className="hidden group-open:inline">less</span> ]
            </summary>
            <div className="mt-1.5 space-y-2 text-xs leading-relaxed text-dim">{more}</div>
          </details>
        )}
      </div>
    </div>
  );
}

const dot = (
  <svg viewBox="0 0 24 16" className="h-6 w-9">
    <circle cx="12" cy="8" r="2.4" className="fill-strike" />
    <circle cx="12" cy="8" r="5.5" className="fill-strike" opacity="0.16" />
  </svg>
);

const ring = (
  <svg viewBox="0 0 24 16" className="h-6 w-9">
    <circle cx="12" cy="8" r="1.6" className="fill-strike" />
    <circle cx="12" cy="8" r="6" className="stroke-strike" fill="none" strokeWidth="1" opacity="0.5" />
  </svg>
);

const bolt = (
  <svg viewBox="0 0 24 16" className="h-6 w-9">
    <path d="M13 1 8.5 8H11l-1 7 4.5-7H12l1-7Z" className="fill-strike" />
  </svg>
);

const smudge = (
  <svg viewBox="0 0 24 16" className="h-6 w-9">
    <rect x="7" y="3" width="5" height="5" className="fill-dim" opacity="0.2" />
    <rect x="12" y="3" width="5" height="5" className="fill-text" opacity="0.34" />
    <rect x="7" y="8" width="5" height="5" className="fill-strike" opacity="0.42" />
    <rect x="12" y="8" width="5" height="5" className="fill-dim" opacity="0.24" />
  </svg>
);

const storm = (
  <svg viewBox="0 0 24 16" className="h-6 w-9">
    <circle cx="10" cy="8" r="5.5" className="stroke-text" fill="none" strokeWidth="1" opacity="0.6" />
    <path d="M16 8h5M18.5 5.5 21 8l-2.5 2.5" className="stroke-text" fill="none" strokeWidth="1" opacity="0.8" />
  </svg>
);

const jump = (
  <svg viewBox="0 0 24 16" className="h-6 w-9">
    <circle cx="10" cy="8" r="4.5" className="stroke-text" fill="none" strokeWidth="1" opacity="0.45" />
    <circle cx="10" cy="8" r="7" className="stroke-text" fill="none" strokeWidth="1" opacity="0.9" />
    <path d="M20 11V5M17.8 7.2 20 5l2.2 2.2" className="stroke-text" fill="none" strokeWidth="1" opacity="0.9" />
  </svg>
);

const track = (
  <svg viewBox="0 0 24 16" className="h-6 w-9">
    <path d="M2 12c3 .5 5-1 7-3" className="stroke-text" fill="none" strokeWidth="1" opacity="0.25" />
    <path d="M9 9c2-2 3-2.5 5-3" className="stroke-text" fill="none" strokeWidth="1" opacity="0.55" />
    <path d="M14 6h7" className="stroke-text" fill="none" strokeWidth="1" strokeDasharray="3 3" opacity="0.5" />
  </svg>
);

// A coastline, at the weight it is actually drawn. Not dots: nothing on this
// map is a dot except a strike.
const land = (
  <svg viewBox="0 0 24 16" className="h-6 w-9">
    <path d="M1 11c3 0 4-3 7-3s3 2 6 1 4-4 9-3" className="stroke-land" fill="none" strokeWidth="1" />
  </svg>
);

// The same coast, with a border running inland from it a step under.
const frontier = (
  <svg viewBox="0 0 24 16" className="h-6 w-9">
    <path d="M1 12c3 0 4-3 7-3s3 2 6 1 4-4 9-3" className="stroke-land" fill="none" strokeWidth="1" />
    <path d="M9 9.2 10 5l3-2" className="stroke-land" fill="none" strokeWidth="1" opacity="0.6" />
  </svg>
);

const bounds = (
  <svg viewBox="0 0 24 16" className="h-6 w-9">
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

// Rain: patchy where the cloud is continuous, with a core inside a band.
const rainMark = (
  <svg viewBox="0 0 24 16" className="h-6 w-9">
    <path d="M2 9h4v2H2zM7 6h5v2H7zM14 10h6v2h-6zM9 11h3v2H9z" className="fill-land" opacity="0.75" />
    <rect x="15" y="6" width="4" height="3" className="fill-text" opacity="0.85" />
  </svg>
);

// Cloud, and the harder core of it: the two passes the layer is drawn in.
const cloudMark = (
  <svg viewBox="0 0 24 16" className="h-6 w-9">
    <path d="M3 11c1-3 4-4 6-2 1-3 5-4 7-1 2-1 4 0 4 3H3Z" className="fill-land" opacity="0.55" />
    <ellipse cx="13" cy="8.5" rx="3.6" ry="2.4" className="fill-text" opacity="0.75" />
  </svg>
);

const station = (
  <svg viewBox="0 0 24 16" className="h-6 w-9">
    {[[3, 3], [2, 9], [6, 14], [21, 5], [22, 11]].map(([x, y]) => (
      <line key={`${x}-${y}`} x1={x} y1={y} x2="13" y2="8" className="stroke-dim" strokeWidth="0.5" opacity="0.6" />
    ))}
    <circle cx="13" cy="8" r="1.4" className="fill-strike" />
  </svg>
);

const capital = (
  <svg viewBox="0 0 24 16" className="h-6 w-9">
    <rect x="4" y="7" width="2" height="2" className="fill-text" opacity="0.9" />
    <rect x="8.5" y="6" width="11" height="4" className="fill-text" opacity="0.18" />
  </svg>
);

const daylight = (
  <svg viewBox="0 0 24 16" className="h-6 w-9">
    <path d="M3 1c4 2 6 5 6 7s-2 5-6 7Z" className="fill-text" opacity="0.16" />
    <path d="M3 1c4 2 6 5 6 7s-2 5-6 7" className="stroke-text" fill="none" strokeWidth="1" opacity="0.4" />
  </svg>
);

export default function Legend({ onClose }) {
  return (
    <Panel title="Key" width={420} onClose={onClose}>
      {/* Ordered by what a reader is looking at, not by what is most
          interesting to write about. The first four are what is on the glass
          with the instrument as it ships and nobody having touched anything;
          then what a cell carries, then the ground it is all drawn on, then the
          two fetched layers, and last the two that are off until asked for. */}
      <Group title="On the map">
        <Entry
          mark={dot}
          term="Strike"
          more={
            <>
              <p>
                Position is where the network located the discharge, and the mark is drawn a little
                softer where it located it from one side only, which Detector threads below
                explains. The ping and the bolt are never softened: how well a strike was placed
                says nothing about whether it happened.
              </p>
              <p>How long it stays lit is Persistence, under Map in configuration.</p>
            </>
          }
        >
          One detected discharge, white as it arrives and fading from there.
        </Entry>
        <Entry
          mark={ring}
          term="Ping"
          more={
            <p>
              Zoomed in far enough for it to mean something, it stops being a flourish and becomes
              the sound: the ring leaves at 343 metres a second and keeps going for as long as
              thunder carries, twenty-five kilometres and a minute and a quarter, fading as the air
              takes it apart. It outlives the flash that threw it, which is the whole of what it has
              to say.
            </p>
          }
        >
          A ring thrown outward as a strike lands, so an arrival anywhere catches the eye.
        </Entry>
        <Entry
          mark={smudge}
          term="Density"
          more={
            <>
              <p>
                A cell needs 3 strikes before it marks at all, and more than that the further out
                the view is: a degree is two pixels at world zoom, where a page of marginal cells
                is gravel rather than a field. The window is the burn dial, across the top of the
                tube from the region presets.
              </p>
              <p>
                The cell is drawn as the cell, not as a disc inside it, so neighbours tile into one
                field instead of beading, and it steps back when a cloud or rain field is behind it:
                both layers answer the same question, and the field is the wider answer.
              </p>
              <p>
                Brighter is busier. The weight is the logarithm of the count, so the first few
                strikes in a quiet cell move the mark as much as the next fifty do in a working one,
                which is what keeps the whole layer from being three storms and a black planet. The
                top of the scale rides the window rather than sitting still: a hundred strikes in
                four minutes is an extraordinary cell, a hundred in an hour is an ordinary one, and
                held at one ceiling every cell worth looking at would clip to solid together.
              </p>
              <p>
                At <span className="text-text">4m</span> this is weather: where it is raining
                lightning now. Opened out to <span className="text-text">20m</span> or{" "}
                <span className="text-text">1h</span>, the same layer becomes where the lightning
                has been, and an hour of it draws the band the planet actually fires in.
              </p>
              <p>
                It is this session&rsquo;s own hour and nothing else: nothing is fetched to fill it
                in, and it goes when the tab does, so a window longer than you have been watching is
                simply shorter than it says.
              </p>
            </>
          }
        >
          Where strikes have piled up, fading as the storms move on.
        </Entry>
        <Entry
          mark={storm}
          term="Storm cell"
          more={
            <>
              <p>
                The ten busiest cells on screen are ringed and the five busiest of those say their
                count; everything else holds a tick at its centre. Both are limits on what is drawn
                at once, not on what is tracked: a cell winding up, or the one you picked, is ringed
                and read out wherever it comes in the order.
              </p>
              <p>
                The ground speed goes with the cell you pick rather than being offered on every
                ring. A count is one figure and reads at a glance; a count with a speed on it is a
                phrase, and thirty phrases scattered over the weather is not thirty readings.
              </p>
            </>
          }
        >
          A ring around a group of strikes big enough to be one storm, grouped by proximity and
          labelled with its count. The arrow gives the bearing of travel: the direction is to scale,
          the length is not.
        </Entry>
        <Entry mark={bolt} term="Bolt">
          Drawn when one 1&deg; cell takes 3 or more strikes within 2.5 seconds. Heavier and twice
          the size at 9 or more, which is also what shakes the screen.
        </Entry>
        <Entry
          mark={jump}
          term="Lightning jump"
          more={
            <>
              <p>
                A flash rate climbing sharply leads severe weather at the ground by ten to twenty
                minutes, because the updraught fast enough to separate charge at that rate is the
                same updraught carrying the hail. Every other reading on a cell says what it is
                doing; this one says what it is about to do.
              </p>
              <p>
                The test is against the cell&rsquo;s own recent past, not against other cells: the
                last three minutes are compared with the three before them, and the ring appears
                when the excess passes two standard deviations of the count. Flashes are counted, so
                the noise on a count is the square root of it, which keeps a quiet cell of four
                flashes from reading as a doubling every time it fires a fifth. A second gate asks
                for at least 10 flashes a minute, because flashes within a storm arrive in bursts
                rather than independently and the sigma alone runs optimistic.
              </p>
              <p>
                It is drawn at every cell detail, unlike everything else a cell carries. The rest is
                context you can turn down; this is the one mark on the map about something that has
                not happened yet.
              </p>
            </>
          }
        >
          A second ring: this cell&rsquo;s flash rate is climbing sharply.
        </Entry>
        <Entry
          mark={track}
          term="Cell track"
          more={
            <>
              <p>
                Up to an hour behind, brightening toward the present, with the next hour dashed on
                ahead. Both are drawn to scale: an ordinary cell covers only tens of kilometres in
                that time, so the track appears once you are close enough for that to be more than a
                pixel, and not before. The speed beside it is fitted to the recent end alone: cells
                turn, and an hour of a turning one averages out to a heading it no longer has.
              </p>
              <p>
                How much a cell carries is the cells dial.{" "}
                <span className="text-text">Ring</span> is the cell and its count and nothing else;{" "}
                <span className="text-text">track</span> adds where it has been;{" "}
                <span className="text-text">full</span> adds the forecast and the speed. Turned
                down, a cue is not drawn rather than drawn faintly; a cue you have dimmed is still a
                cue competing for the same eye.
              </p>
            </>
          }
        >
          Where a cell has been, and where its course takes it.
        </Entry>
        <Entry mark={land} term="Land">
          The coastline, at hairline weight: the faintest continuous thing on the glass, on purpose.
          A strike is the only solid mark this instrument draws, and the world is what it is drawn
          against.
        </Entry>
        <Entry
          mark={frontier}
          term="Frontier"
          more={
            <p>
              Only the borders, and each of them once: a coast is never stroked twice. They appear
              as the view becomes a region rather than a planet, because every interior border on
              earth at world zoom is a mesh over the one scale this map is meant to be read as
              coastline and weather.
            </p>
          }
        >
          Borders between countries, a step under the coastline.
        </Entry>
        <Entry mark={capital} term="Capital">
          Named only while a cell within 400 km of it is burning. The map is an instrument rather
          than an atlas, and a place name earns its space at exactly one moment: when something is
          happening there. A quiet map carries none; point at it instead.
        </Entry>
        <Entry
          mark={daylight}
          term="Daylight"
          more={
            <>
              <p>
                In dark mode light is added to the glass, in light mode ink is laid down on the
                sheet, so the lit side is the pale one in both.
              </p>
              <p>
                It is here because lightning is a daily rhythm before it is anything else: the
                strike band is afternoon convection, and it walks around the planet a step behind
                this line.
              </p>
            </>
          }
        >
          The terminator, and the hemisphere it divides.
        </Entry>
        <Entry
          mark={cloudMark}
          term="Cloud field"
          more={
            <>
              <p>
                At 10.8&micro;m the reading is the temperature of the highest thing in the column,
                so what is drawn is not cloud exactly but cloud height: the faint wash is the body of
                it, and the bright cores are the tops driven up near the tropopause. Those are the
                ones that matter. A column climbing that hard is the thing that separates charge,
                which is to say the second pass is very nearly a map of where this map is about to
                have something to show.
              </p>
              <p>
                From the five geostationary satellites that between them hold the whole ring: two of
                NASA&rsquo;s over the Pacific and the Americas, two of EUMETSAT&rsquo;s over Africa
                and the Indian Ocean, and Himawari over Asia. Twenty to forty minutes old depending
                on the satellite, and never a forecast: every pixel was measured. It is the only
                layer here that is fetched rather than derived, so it can be absent, and when it is
                the sky simply reads as clear. From RealEarth (UW&ndash;Madison SSEC) and EUMETSAT;
                nothing else here leaves the page.
              </p>
              <p>
                One field at a time, this or the rain below: they look at opposite ends of the same
                column, so where they overlap they draw the same storm twice.
              </p>
            </>
          }
        >
          Thermal infrared: how high the cloud tops have been driven.
        </Entry>
        <Entry
          mark={rainMark}
          term="Rain field"
          more={
            <>
              <p>
                The body is the rain and the harder cores are the convective centres, the same thing
                the cloud field&rsquo;s bright tops are looking for, seen from underneath instead of
                from orbit. Where the two disagree is interesting: an anvil with nothing under it is
                a storm that has finished.
              </p>
              <p>
                Its footprint is not the planet. Radar is built and maintained by national services,
                so this covers the ground somebody put a network on and stops sharply, often at a
                coastline. Empty here means unwatched, not dry, which is the opposite of what empty
                means on every other layer of this map. Most of the ocean is unwatched.
              </p>
              <p>
                The tiles arrive rendered rather than raw, so the reading is taken back out of the
                picture: the service publishes its colour scheme as a table of one colour per dBZ,
                and the map inverts it. That is exact rather than approximate, and it is checked
                against live tiles by <span className="text-text">npm run check:rain</span>, since a
                palette read wrongly would draw a plausible field that is quantitatively false,
                which is the one failure worth testing for. From RainViewer, in ten-minute frames.
              </p>
            </>
          }
        >
          Ground radar: what is actually falling.
        </Entry>
        <Entry mark={bounds} term="Cell bounds">
          Off by default. Corner ticks around a 1&deg; cell that is firing right now, clearing a few
          seconds after it goes quiet. Ticks rather than a closed box, so the extent is marked
          without a rectangle ruled over the weather inside it.
        </Entry>
        <Entry
          mark={station}
          term="Detector threads"
          more={
            <>
              <p>
                Nobody publishes where the detectors are, so their positions are assembled from the
                strikes themselves: every strike names the stations that heard it. Nothing is drawn
                between times, because a detector that is not hearing anything has nothing to say
                and the threads are the whole of the point.
              </p>
              <p>
                This is how well each strike was placed, drawn rather than counted. A strike caught
                in a full sheaf was pinned from every side; one wearing a fan was heard from a
                single direction, and placed the more loosely for it. The widest angle it was{" "}
                <span className="text-text">not</span> heard from is the whole of the reading, and
                most of what this network sees, it sees from one side. Watch a storm for a minute
                and you can see which way it is listening from.
              </p>
            </>
          }
        >
          Off by default. A thread back to each detector that placed a strike, for under a second.
        </Entry>
      </Group>

      <Group title="Readouts">
        <Entry term="Rate">
          Strikes detected worldwide in the last 60 seconds. The trace below it is that same minute,
          sampled twice a second.
        </Entry>
        <Entry term="Storm cells">
          Clusters currently being tracked. Not grid squares: a cluster needs at least 12 strikes
          across adjacent ~45 km bins to count. A trailing{" "}
          <span className="text-text">&uarr;n</span> is how many of them are in a lightning jump.
        </Entry>
        <Entry
          term="Session"
          more={
            <>
              <p>
                Every other window here is measured in minutes; this is the one that can show what
                lightning mostly does, which is run on a schedule. The planet fires hardest over
                land in the afternoon, so the global rate rises and falls roughly three times a day
                as Africa, then the Americas, then Asia come around into the sun. The hairline is
                midnight UTC, drawn once there is one inside the window, because three humps say
                nothing unless you can see where the day begins.
              </p>
              <p>
                It is as wide as the session is long, and grows: no strikes are kept to fill it in,
                so the curve starts when you did. What is stored is one count per minute and nothing
                else, which is why it can say how hard the world was firing at four this morning and
                nothing at all about where.
              </p>
            </>
          }
        >
          The same rate, banked by the minute and kept for a day.
        </Entry>
        <Entry term="Detected">Strikes received since this tab was opened, and only those.</Entry>
        <Entry
          term="Latency"
          more={
            <p>
              The median of the last half-second of arrivals, not the last one: a single measurement
              of a detection network swings by whole seconds and says nothing you can watch. It is a
              property of the detection system rather than of the weather, which is why it sits
              under Link and is not lit.
            </p>
          }
        >
          How long the network took to place the strikes just heard.
        </Entry>
        <Entry term="Stations">
          How many detectors solved the last strikes, as a median. Not how many heard them: the ones
          that merely received the signal did not decide where it came from. The feed caps its list
          at 40, so 40 means forty or more.
        </Entry>
        <Entry
          term="Reach"
          more={
            <>
              <p>
                Counted to the most distant station that helped place each strike, and split by
                whether the middle of that path lay under a sunlit ionosphere or a dark one.
              </p>
              <p>
                The curve is the shape of it: filled is daylight, the line is darkness, and the
                height at a range is the share of that half&rsquo;s strikes that carried
                that far. A share rather than a count, so that a half the weather has left quiet
                is not drawn short for it — the two fill at whatever rate the sky offers, and how
                many landed in each says nothing about how far they went. Both curves therefore sit
                on one axis, which is the only arrangement the comparison can be made in.
              </p>
              <p>
                The two rules under it are the same two distributions read as a length, because an
                eye is poor at judging which of two overlapping shapes has more mass to the right
                and very good at telling which of two lines is longer. Each runs to the ninth strike
                in ten rather than the farthest of all, since the farthest of all is one strike and
                one strike is not a propagation condition. The tick inside a rule is the middle of
                the distribution, mostly a fact about where the volunteers live: half the network is
                in Europe, and that sets how far a typical strike has to carry before somebody hears
                it whatever the sky is doing. The count on the end is how much is behind the rule,
                since a rule drawn from two hundred strikes looks exactly as certain as one drawn
                from twenty thousand.
              </p>
              <p>
                Neither half is drawn until it has 200 strikes in it. They fill on the
                weather&rsquo;s schedule rather than the clock&rsquo;s, so at an hour when the
                world&rsquo;s lightning is all over the Americas the sunlit half is ready long
                before the dark one. The axis stops where all but the last half-percent was heard:
                one freak path of fifteen thousand kilometres would otherwise set it and crush
                everything worth reading into the left-hand corner.
              </p>
              <p>
                Sunlight makes a lossy layer at 60 to 70 km that the sferic has to bounce off; after
                sunset it decays and the reflection moves up to 85 to 90 km, where less is lost at
                every hop. The far figure is where that shows, and it should be the longer one at
                night. Both are floors: the most distant station that heard a strike is not as far
                as it went.
              </p>
            </>
          }
        >
          How far each strike was heard, by day and by night. Night should be the longer bar.
        </Entry>
        <Entry term="Nearest strike">
          How far away the closest strike of the last few minutes fell, once you have pressed{" "}
          <span className="text-text">here</span>. A dash means nothing has landed within 2,000 km,
          at which point the figure has stopped being about your weather.
        </Entry>
        <Entry
          term="Thunder"
          more={
            <p>
              Sound covers 343 metres a second, and this network places a strike to somewhere
              between one kilometre and ten, so the range is the network&rsquo;s own uncertainty
              about where the strike fell, carried through at the speed of sound. A single figure
              would be precise to the second and wrong by twenty.
            </p>
          }
        >
          Seconds until you hear a strike that has already been seen.
        </Entry>
        <Entry term="Most active">
          The places holding the most strikes across the cells still burning on the map, roughly the
          last few minutes and not the whole session. Counted from cells of 3 strikes or more, so
          scattered single strikes never enter the ranking.
        </Entry>
      </Group>

      <Group title="Working it">
        <Entry term="Pointing">
          The map names whatever is under the pointer, in the corner of the tube: the place, its
          coordinates, and how many strikes that 1&deg; cell is holding. Pointing at a feed row or a
          ranked place marks it on the map instead.
        </Entry>
        <Entry term="Picking">
          Clicking the map, a feed row or a ranked place narrows the feed to it. Clicking a storm
          cell picks the cell rather than the country underneath. Click it again, or press{" "}
          <span className="text-text">esc</span>, to let it go.
        </Entry>
        <Entry term="Moving">
          Drag to pan, wheel or pinch to zoom, up to about a 200 km span. The named regions across
          the top of the tube jump straight there. At world zoom a storm over the Alps is four
          pixels across, which is the whole reason for it.
        </Entry>
        <Entry term="Here">
          The one control that asks the browser where you are, and only when pressed: nothing
          requests a position on load. The fix frames the map on your region and marks it with a
          station ring, held for the session only. Not stored, not sent anywhere.
        </Entry>
        <Entry term="Holding">
          The feed stops advancing while the pointer rests on it, so a row can be read to the end.
          Arrivals queue behind it and release when you leave.
        </Entry>
        <Entry
          term="Linking"
          more={
            <p>
              Longitude, latitude, magnification. The whole world writes nothing, being where it
              starts. It carries the view and not the moment: the strikes belong to this session and
              cannot travel with a link, so a shared address opens on the right coordinates and
              whatever weather is there when it is opened.
            </p>
          }
        >
          Zoom in and the address carries the view.
        </Entry>
        <Entry
          term="Saving"
          more={
            <p>
              The strikes still retained go out as CSV, holding where each one was, when it
              happened, and when this browser heard about it, the gap between the last two being the
              network&rsquo;s own delay. The tube goes out as a PNG of the frame as drawn, rewound
              or live, which is the only way an actual moment can be handed to somebody. The CSV
              reads back in from the same group.
            </p>
          }
        >
          Two things can leave, both under Session in configuration.
        </Entry>
        <Entry term="Guide">
          A walk through the instrument: press <span className="text-text">g</span>, or{" "}
          <span className="text-text">guide</span> in the header. It points at each control on the
          running map rather than describing it here, runs once on a first visit, and then leaves
          you alone. This panel is the catalogue it hands off to.
        </Entry>
        <Entry
          term="Keys"
          more={
            <p>
              The rewind track takes <span className="text-text">&larr;</span>{" "}
              <span className="text-text">&rarr;</span> once focused, in steps of a hundredth of the
              track and a tenth with <span className="text-text">shift</span>, and{" "}
              <span className="text-text">home</span> and <span className="text-text">end</span> for
              the two ends of it. A fraction of the track rather than a fixed count of seconds, the
              track being a fixed hour.
            </p>
          }
        >
          <span className="text-text">k</span> or <span className="text-text">?</span> this panel
          &middot;{" "}
          <span className="text-text">c</span> configuration &middot;{" "}
          <span className="text-text">g</span> guide &middot; <span className="text-text">t</span>{" "}
          dark / light &middot; <span className="text-text">+</span>{" "}
          <span className="text-text">&minus;</span> <span className="text-text">0</span> zoom
          &middot; <span className="text-text">esc</span> close or clear.
        </Entry>
      </Group>

      <Group title="Reading the tracks">
        <Entry
          term="What a track will not tell you"
          more={
            <>
              <p>
                A speed appears only after a cell has been watched for 10 minutes. That wait is set
                by geometry: a 45 km/h cell moves 3.75 km in five minutes while being roughly 100 km
                across, which is too small a shift to measure against its own size. Speeds outside 8
                to 140 km/h are withheld as tracking errors rather than shown.
              </p>
              <p>
                A jump needs six minutes of a cell before it can be read at all, and the cell&rsquo;s
                first three are spent filling the window the rate is measured over, so a storm that
                is violent from birth is caught late rather than early. Two cells merging adds one
                cell&rsquo;s flashes to the other&rsquo;s count and can read as a surge in the
                survivor; that is a real event drawn for a slightly wrong reason. And a jump says a
                cell is intensifying, which is not the same as saying anything reached the ground.
              </p>
            </>
          }
        >
          Tracks say where an existing cell is heading over the next few minutes. Not where the next
          strike will land, and nothing about cells that have yet to form.
        </Entry>
      </Group>

      {/* Last, and the only group here that is not about reading the map.
          Nothing in it is folded: it exists because two of the readings above,
          the distance to the nearest strike and the countdown to its thunder,
          are the ones most easily mistaken for something to act on, and a
          disclaimer behind a fold is a disclaimer nobody read. */}
      <Group title="What this is not">
        <p className="py-1 text-xs leading-relaxed text-dim">
          An instrument for watching the weather, not for deciding what to do about it.
          Blitzortung is a volunteer network, and its data is for private and entertainment
          purposes: not for storm warning, not for checking overvoltage claims, not for risk
          analysis, and not for the protection of life or property. Neither is this.
        </p>
        <p className="py-1 text-xs leading-relaxed text-dim">
          The nearest-strike distance and the thunder countdown are arithmetic on a feed that is
          incomplete by construction. This network hears the stroke that reaches the ground far
          better than the discharge that stays inside the cloud, and where nobody has built a
          detector it hears nothing at all. A quiet map is not a safe sky. For a decision, use your
          national meteorological service.
        </p>
      </Group>
    </Panel>
  );
}
