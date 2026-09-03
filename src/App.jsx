import "./App.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
//components
import Navbar from "./assets/components/navbar.jsx";
import Sidebar from "./assets/components/sidebar.jsx";
import WorldMap from "./assets/components/worldmap.jsx";
import Seeker from "./assets/components/Seeker.jsx";
import Crt from "./assets/components/crt.jsx";
import Boot from "./assets/components/boot.jsx";
import Settings from "./assets/components/settings.jsx";
import Legend from "./assets/components/legend.jsx";
import Data from "./assets/components/data.jsx";
import Clock from "./assets/components/clock.jsx";
import FieldAge from "./assets/components/fieldage.jsx";
import Tour from "./assets/components/tour.jsx";
//libs and utils
import { indexFeatures, findFeature, distanceKm } from "./lib/geo.js";
import { useTheme } from "./lib/theme.js";
import { usePalette } from "./lib/palette.js";
import { useSettings, DENSITY } from "./lib/settings.js";
import { useTour } from "./lib/tour.js";
import { detectStorms, trackStorms, measureMotion, surge } from "./lib/storms.js";
import { binStrikes } from "./lib/burn.js";
import { createDay } from "./lib/day.js";
import { createRate } from "./lib/rate.js";
import { createReach } from "./lib/reach.js";
import { saveStrikes, saveFrame } from "./lib/save.js";
import { parseArchive, createPlayer, MAX_BYTES as ARCHIVE_MAX_BYTES } from "./lib/archive.js";
import { roll, hush, MAX_KM as THUNDER_MAX_KM, SPEED_KMS } from "./lib/thunder.js";
import { fixSpreadKm } from "./lib/fix.js";
import { clock } from "./lib/lag.js";
import geoData from "./lib/world.json";

// How far the fold between map and panel may be dragged on a narrow screen, as
// a share of the viewport. Both stops are the honest ones: less map than a
// quarter is not a map, and past this there is no panel left above the fold to
// take hold of and drag back. Where it starts is `mapVh` in the defaults.
const MAP_VH_MIN = 25;
const MAP_VH_MAX = 85;

const FEED_LENGTH = 60; // strikes listed in the recent feed
const BIN_SIZE = 1; // degrees per map cell
const FLUSH_MS = 500; // how often buffered strikes reach React state
const RELEASE_MS = 130; // cadence at which queued strikes enter the feed
const QUEUE_LENGTH = 40; // backlog cap; a storm outruns any readable feed
const ACTIVE_MS = 6000; // how long a cell counts as still firing
// Clustering only. A storm cell is a thing that exists for tens of minutes and
// is tracked between passes; built over an hour it would be the union of
// everywhere the storm has been, which is not a cell and not where it is.
// This is why the retained history and the clustering window are two numbers:
// they used to be one, and lengthening the first would have silently wrecked
// the second.
const STORM_WINDOW_MS = 12 * 60 * 1000;
// The cadence the backfill is walked forward at when a session starts from the
// relay's hour. It is the same twenty seconds `storms.js` records a
// centroid on, so a cell arrives with the trail it would have grown here.
const SEED_STEP_MS = 20000;
// The run-up a rewound instant is walked from before its cells are drawn. It is
// the window `storms.js` regresses a heading over, which is the longest thing a
// cell has to have been watched for before it can say anything beyond being
// there.
const WARM_MS = 25 * 60 * 1000;
// How long one slice of the seeding walk is allowed to hold the main thread.
// Short enough to fit inside a frame with the render, so the map keeps drawing
// while the hour behind it is being caught up on.
const SEED_BUDGET_MS = 8;
// Idle time if the browser offers it, the next turn of the loop if not. Either
// way the point is the same: leave the frame that is being drawn alone.
const idle = (fn) =>
  typeof requestIdleCallback === "function" ? requestIdleCallback(fn) : setTimeout(fn, 0);
// How long a scrub has to stop moving before the cells at that instant are
// walked out. Long enough that a drag across the window pays for one instant
// rather than for every twentieth of a second it passed through, short enough
// that letting go and having the rings appear reads as the same gesture.
const SETTLE_MS = 200;
// How many bars the transport's window is drawn as. Fixed rather than one per
// minute: a session that starts with less than the full hour would otherwise
// draw narrower bars than one that has it all, which would be reporting the
// retention rather than the weather. Seventy-two over the retained hour is a bar for
// every fifty seconds, which is about as fine as a bar can be and still be a
// bar at the width the strip is drawn.
const SHAPE_BARS = 72;
const STORM_EVERY_MS = 2000; // clustering cadence; storms don't move fast
// How much is kept to rewind through and to burn from. An hour, rather than the
// twelve minutes the clustering wants, because the two are answering different
// questions and only this one is about how far back you can look.
const HISTORY_MS = 60 * 60 * 1000;
// Memory ceiling, and the honest limit on the hour above. A retained strike is
// four numbers in an object, which V8 keeps in about 64 bytes, so this is
// roughly 8 MB. The world runs near 300 strikes a minute at the quiet end,
// where an hour costs 18,000 and this is never reached; at the peak it binds
// first and the window is shorter than an hour. Nothing pretends otherwise:
// `span` below is measured from the oldest strike actually held, so the rewind
// track shows the window there is rather than the window that was asked for.
const MAX_HISTORY = 120000;
const REGION_COUNT = 5; // places listed in the activity ranking
const REGION_MIN = 3; // strikes a cell needs before it is worth geocoding
// Ceiling on strikes waiting to be drawn. The map drains this every animation
// frame, so it is normally a handful, but a hidden tab gets no frames at all
// while the socket keeps delivering, and the backlog would otherwise grow for
// as long as the tab is left alone and then land in one frame on return.
const MAX_QUEUE = 800;
// Replay runs at life size on a tenth-second beat: fine enough that a strike
// fades smoothly, coarse enough that re-deriving the window ten times a second
// is the cheapest thing on the frame. Within this of the present there is
// nothing left to replay, so the clock is handed back to the live feed.
const REPLAY_TICK_MS = 100;
const REPLAY_LEAD_MS = 1500;

// Past this there is no news in a nearest-strike figure, and skipping it early
// keeps the scan off the ~99% of the planet that isn't near you.
const WATCH_MAX_KM = 2000;
const WATCH_MAX_DEG = WATCH_MAX_KM / 111.32;

// Stable, so that hiding the storm rings during a replay does not hand the map
// a new array on every frame and defeat its memoisation.
const EMPTY = [];

// What the panel reads before anything has arrived. Hoisted out of the state
// declaration because a session can now start twice: loading an archive, and
// leaving one, both put the instrument back to exactly this.
const NO_STATS = {
  rate: 0,
  total: 0,
  storms: 0,
  surging: 0,
  delay: null,
  stations: null,
  trip: null,
  repeats: 0,
};

// Strikes are appended in arrival order, so any window over them is a
// contiguous run and its start can be found rather than scanned for.
//
// This matters now in a way it did not when the whole history was twelve
// minutes long. Every consumer here wants minutes of an hour: the clustering
// wants twelve, a burn wants four. Left as a filter over the whole array, each
// of them would walk five to fifteen times the strikes it uses, twice a second,
// and lengthening the history would have quietly made every pass slower rather
// than only making it deeper. The render loop already worked this way.
function since(list, from) {
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid].t < from) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

// The feed reports whatever the network gives it; a malformed delay reads "—"
// rather than throwing inside a render.
const seconds = (value) => (Number.isFinite(Number(value)) ? Number(value).toFixed(1) : null);

// Any one strike of a batch, taken alone, swings from one flush to the next:
// it is one measurement of a network, not a reading. The median of the batch
// holds still enough to be watched.
function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  return sorted.length ? sorted[sorted.length >> 1] : null;
}

function medianDelay(batch) {
  const value = median(batch.map((data) => Number(data.delay)));
  return value === null ? null : seconds(value);
}

// What makes two picks the same pick: the named place, at the same 1° cell.
// A feed row clicked twice is byte-identical here; a ranked place is its
// busiest cell, which is stable for as long as it stays the busiest.
const pickKey = (pick) =>
  pick && `${pick.place}@${Math.floor(pick.lon / BIN_SIZE)},${Math.floor(pick.lat / BIN_SIZE)}`;

function App() {
  const [feed, setFeed] = useState([]);
  const [regions, setRegions] = useState([]);
  const [bins, setBins] = useState([]);
  const [storms, setStorms] = useState([]);
  // Empty rather than a run of zeros: the trace is the shape of the window,
  // and a session that has not heard anything yet has no window to draw. Zeros
  // would draw a flat line along the floor, which is a claim that a minute was
  // watched and was quiet.
  const [samples, setSamples] = useState(() => []);
  const [day24, setDay] = useState(null);
  // How far the network is hearing, split by whether the path lay under a
  // sunlit ionosphere or a dark one. Two hundred counts, held for the session.
  const [reach, setReach] = useState(null);
  const [stats, setStats] = useState(NO_STATS);
  // What the line says before the socket has reported anything. "idle" was a
  // state rather than a commentary: this line is the only thing on the page
  // that says what the instrument is doing when the tube is quiet, and a page
  // doing nothing and a page waiting for the sky look identical without it.
  const [status, setStatus] = useState({
    phase: "idle",
    message: "waiting for the relay",
    host: null,
  });
  // How much of each tiled layer actually arrived, reported up by the map on a
  // slow timer and only when it changes. The footer is the only reader.
  const [fieldHealth, setFieldHealth] = useState(null);
  const [booted, setBooted] = useState(false);
  const finishBoot = useCallback(() => setBooted(true), []);
  // Raised when the readout starts to fade rather than when it has finished, so
  // the map can begin unrolling underneath it.
  const [unfolding, setUnfolding] = useState(false);
  const startUnfold = useCallback(() => setUnfolding(true), []);
  const { theme, setTheme } = useTheme();
  const { settings, set, reset } = useSettings();

  /**
   * The fold between map and panel, on a screen too narrow to put them side by
   * side. Dragged by the grabber on the panel's top edge.
   *
   * Written to the DOM as a custom property during the drag and to the settings
   * only when the finger lifts. A resize re-lays the map, which re-sizes its
   * canvas and rebuilds every layer on it, so a render of the whole instrument
   * on top of that, sixty times a second, with a write to local storage behind
   * each one, is the difference between a drag that follows the finger and one
   * that catches up afterwards.
   */
  const mainRef = useRef(null);
  const fold = useRef(null);
  const foldTo = (vh) => {
    // Rounded: this is written to storage and read back next session, and a
    // fold is not a measurement worth carrying fifteen decimal places of.
    const at = Math.round(Math.max(MAP_VH_MIN, Math.min(MAP_VH_MAX, vh)) * 10) / 10;
    mainRef.current?.style.setProperty("--map-h", `${at}vh`);
    return at;
  };
  const grabber = {
    onPointerDown: (event) => {
      fold.current = { y: event.clientY, from: settings.mapVh, at: settings.mapVh };
      event.currentTarget.setPointerCapture?.(event.pointerId);
    },
    onPointerMove: (event) => {
      if (!fold.current) return;
      const moved = ((event.clientY - fold.current.y) / window.innerHeight) * 100;
      fold.current.at = foldTo(fold.current.from + moved);
    },
    onPointerUp: () => {
      if (fold.current) set("mapVh", fold.current.at);
      fold.current = null;
    },
    onKeyDown: (event) => {
      const step = event.shiftKey ? 10 : 2;
      if (event.key === "ArrowUp") set("mapVh", foldTo(settings.mapVh - step));
      else if (event.key === "ArrowDown") set("mapVh", foldTo(settings.mapVh + step));
      else return;
      event.preventDefault();
    },
  };
  // How far back the burn-in reaches. Four minutes is the live reading; opened
  // out, the same layer becomes where the lightning has been this session.
  const burnMs = DENSITY[settings.density] ?? DENSITY["4m"];
  // Derives the palette from what index.css declares and writes it back to the
  // same tokens, so the canvas picks it up by reading computed style as it
  // always has. The key is the only part React can see; the map watches it.
  const paletteKey = usePalette(theme, settings.phosphor, settings.contrast, settings.bloom);
  const [configOpen, setConfigOpen] = useState(false);
  const [keyOpen, setKeyOpen] = useState(false);
  // The figures, on their own page. Mounted only while it is open, which is
  // what lets it walk the retained window on every render.
  const [dataOpen, setDataOpen] = useState(false);
  // The walk through the instrument. First visit only, and not until the boot
  // readout has cleared: it points at controls, and there are none before then.
  const { open: tourOpen, start: startTour, close: closeTour } = useTour(booted);
  // The feed row under the pointer, marked on the map.
  const [focus, setFocus] = useState(null);
  // A place picked off the map (or the feed); the feed narrows to it.
  const [selection, setSelection] = useState(null);
  // While the pointer rests on the feed it stops advancing, so a row can be
  // read to the end. Arrivals keep queueing behind it.
  const [hold, setHold] = useState(false);
  // The reader's own position, if they asked for it. Session only.
  const [here, setHere] = useState(null);
  const [watch, setWatch] = useState(null);
  // An instant in the retained window, or null for live. Everything the map
  // shows is derived from this; nothing about the live pipeline stops, so the
  // window keeps filling behind you while you are looking at the past.
  const [replayAt, setReplayAt] = useState(null);
  // When that instant was set, on the clock the render loop runs on. Captured
  // beside the instant rather than when the map happens to render, so the pair
  // is exact and the loop's interpolation carries no render latency.
  const replayStamp = useRef(performance.now());
  // How fast the clock runs once it has been set down. Life size is the reading
  // and the default; the other two are for a window that is now an hour long
  // on arrival, which at life size is an hour of watching. Kept
  // across a return to live, because somebody who wanted the sped-up view once
  // wants it again the next time they pull on the strip.
  const [pace, setPace] = useState(1);

  // Picking the same thing twice is how you let go of it. Identity is the
  // place *and* the cell, not the place alone: two storms over Brazil are both
  // "Brazil", and comparing on the name alone means the second one clears the
  // filter instead of moving to it.
  const select = useCallback((next) => {
    setSelection((prev) => (prev && next && pickKey(prev) === pickKey(next) ? null : next));
  }, []);

  // Stable, so the memoised children below actually skip: an arrow written
  // inline in the JSX is a new prop on every render and defeats the lot.
  const openConfig = useCallback(() => setConfigOpen(true), []);
  const closeConfig = useCallback(() => setConfigOpen(false), []);
  const openKey = useCallback(() => setKeyOpen(true), []);
  // Configuration hands over to the catalogue. One panel at a time, so the two
  // do not stack up and leave Escape with a queue to work through.
  const configToKey = useCallback(() => {
    setConfigOpen(false);
    setKeyOpen(true);
  }, []);
  const closeKey = useCallback(() => setKeyOpen(false), []);
  const openData = useCallback(() => {
    setConfigOpen(false);
    setKeyOpen(false);
    setDataOpen(true);
  }, []);
  const closeData = useCallback(() => setDataOpen(false), []);

  // The guide's last step lights the header and leaves it clickable, so `key`
  // and `cfg` can be pressed straight out of it. A panel opening over the guide
  // would leave two things wanting Escape, and the guide has done its job by
  // then anyway: reaching the catalogue is where it was pointing.
  useEffect(() => {
    if (configOpen || keyOpen || dataOpen) closeTour();
  }, [configOpen, keyOpen, dataOpen, closeTour]);

  const worldIndex = useMemo(() => indexFeatures(geoData.features), []);

  // The country outlines are needed for the first frame (the land matrix is
  // built from them) but the two detail sets are not. Nothing can be named
  // before a strike has arrived, and no strike arrives before the socket
  // opens, so they are fetched alongside the boot sequence rather than ahead
  // of it. Together they are more than a third of the bundle, and holding
  // first paint behind them buys nothing.
  //
  // Until they land, `locate` answers at the resolution it has: "USA" rather
  // than "Texas", "open water" rather than "Coral Sea".
  const [detail, setDetail] = useState({ us: null, water: null });
  // The state shapes themselves, kept beside the index built from them: the
  // index answers where a point is and has thrown the outlines away, and the
  // map draws the frontiers between them.
  const [states, setStates] = useState(null);
  // How many shapes each of those two brought, or zeroes if they never
  // arrived. Held apart from the indexes themselves because it is not a map
  // concern: the boot readout reports it, and by the time the indexes exist
  // they are bucketed and no longer count anything.
  const [named, setNamed] = useState(null);

  useEffect(() => {
    let live = true;
    Promise.all([import("./lib/us.json"), import("./lib/water.geo.json")])
      .then(([us, water]) => {
        if (!live) return;
        setNamed({ us: us.default.features.length, water: water.default.features.length });
        setStates(us.default.features);
        setDetail({
          us: indexFeatures(us.default.features),
          // Pre-sorted smallest-first, so the first hit is the most specific
          // name: the Adriatic before the Mediterranean, the Mediterranean
          // before the Atlantic.
          water: indexFeatures(water.default.features),
        });
      })
      .catch(() => {
        // A failed fetch is not a broken map. The coarse answers stand, and the
        // readout says so rather than waiting for something that isn't coming.
        if (live) setNamed({ us: 0, water: 0 });
      });
    return () => {
      live = false;
    };
  }, []);

  // Strikes buffer here and drain on a timer. Writing state per message would
  // re-render the whole tree several times a second.
  const pending = useRef([]);
  const binCounts = useRef(new Map());
  const total = useRef(0);
  const nextId = useRef(0);
  // Sixty seconds of arrivals, keyed by when each flush landed rather than by
  // how many flushes ago it was. See `rate.js` for why that distinction is the
  // whole reading.
  const rates = useRef(createRate());
  // The same arrivals, counted by the minute and kept for a day. Costs 1,440
  // integers, holds no strikes, and is the only window here longer than an
  // hour.
  const day = useRef(createDay());
  // The same arrivals again, banked by how far they carried rather than by
  // when they landed. Two hundred integers; the strikes themselves are not
  // kept for it any more than they are kept for the day above.
  const reachRef = useRef(createReach());
  const feedQueue = useRef([]);
  // Cell key → place name. Cells never move, so this is filled once each, and
  // never evicted; it doesn't need to be. There are only 360×180 one-degree
  // cells on earth, so this is bounded by the grid itself rather than by the
  // length of the session.
  const placeCache = useRef(new Map());
  // Anything named before the detail sets arrived was named coarsely, and the
  // cache is what makes that permanent: a cell answered as "open water" in the
  // first second would stay "open water" for the session, and the activity
  // ranking is built from these names. Emptying it costs one re-geocode of the
  // burning cells on the next flush, half a second later.
  useEffect(() => {
    if (detail.us || detail.water) placeCache.current.clear();
  }, [detail]);
  const history = useRef([]);
  const tracked = useRef([]);
  // The map's canvas, so the frame can be saved as it is drawn rather than
  // rebuilt from anything.
  const tube = useRef(null);
  const saveHistory = useCallback(() => saveStrikes(history.current), []);
  const saveTube = useCallback(() => saveFrame(tube.current), []);
  // The map drains this itself on every animation frame, so strikes light up
  // the instant they land rather than waiting for the next flush.
  const strikeQueue = useRef([]);
  // Held for the session, because it is a running measurement of the trip a
  // frame makes to get here and one strike says nothing about that.
  const struckAt = useRef(clock());
  // Strikes the repeat filter turned away, counted where the flush can read
  // them. Written by the socket, which is upstream of everything else here, so
  // this is the one figure the instrument holds about work it did before
  // anything downstream was told anything.
  const repeats = useRef(0);
  // True while the backfill's tracker walk is still being carried across idle
  // frames. The clustering pass below stands down for as long as it is: both
  // write the tracked cells, and a pass landing mid-walk would replace a
  // half-built set of trails with a set that has none.
  const seeding = useRef(false);
  // Whether the clock is set down, where the passes that run on a timer can see
  // it: they close over the interval they were started with and cannot read the
  // state itself.
  const rewound = useRef(false);

  // What the thunder needs to know, held where the socket callback can reach
  // it. That callback is deliberately stable, because it is what holds the
  // socket open across a render, so it cannot close over the setting or the
  // position, and both of them change.
  const audible = useRef({ on: false, at: null, replaying: false });
  useEffect(() => {
    audible.current = { on: settings.thunder, at: here, replaying: replayAt !== null };
    // Anything already scheduled belonged to the arrangement that has just been
    // replaced, and a strike at the far edge of the radius is over a minute of
    // travel: without this, switching the sound off leaves it thundering for
    // another minute, and moving the reader leaves it thundering from where
    // they used to be.
    return hush;
  }, [settings.thunder, here, replayAt !== null]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * The shape a point falls in, at the finest resolution loaded: a state
   * inside the United States, a named sea at the coarser resolution the water
   * set gives, a country everywhere else. Null over water nobody has named.
   *
   * The naming below is this lookup with the name read off it. The map wants
   * the shape itself, to draw the outline of what has been picked, and a
   * second walk of the polygons to find what has already been found once
   * would be the same work twice.
   */
  const shapeAt = useCallback(
    (lon, lat) => {
      const country = findFeature(worldIndex, lon, lat);
      if (country) {
        if (country.properties.name === "USA" && detail.us) {
          return findFeature(detail.us, lon, lat) ?? country;
        }
        return country;
      }
      // Most strikes fall at sea, and "open water" is the same answer for the
      // Coral Sea as for the mid-Atlantic. Name the body where we can.
      return detail.water ? findFeature(detail.water, lon, lat) : null;
    },
    [worldIndex, detail]
  );

  const locate = useCallback(
    (lon, lat) => shapeAt(lon, lat)?.properties.name ?? "open water",
    [shapeAt]
  );

  const handleDataReceived = useCallback((data) => {
    pending.current.push(data);
    strikeQueue.current.push(data);
    // Trimmed with slack rather than on every message: a copy per strike would
    // cost more than the backlog it is guarding against.
    if (strikeQueue.current.length > MAX_QUEUE * 2) {
      strikeQueue.current = strikeQueue.current.slice(-MAX_QUEUE);
    }
    // Push only. Trimming here would re-copy the whole array on every
    // message; the clustering pass below enforces both bounds instead.
    // `t` is when we heard about it; `at` is when it happened. The network runs
    // several seconds behind, and for anything counted in seconds (thunder,
    // above all) the difference is the whole measurement. Read off the strike's
    // own timestamp rather than off `delay`, which stops counting before the
    // frame leaves the network and so hides the trip here: see `lag.js`.
    const arrived = Date.now();
    const flash = struckAt.current(Number(data.time), arrived) ?? arrived - (Number(data.delay) || 0) * 1000;
    // `gap` rides along because the countdown needs it: it is the only thing in
    // the frame that says how far out the position may be, and therefore how
    // wide the band on the arrival has to be.
    history.current.push({ lon: data.lon, lat: data.lat, t: arrived, at: flash, gap: data.gap });
    // How far this one was heard, filed under what the sky was doing over the
    // path. Taken here because the station list is only ever a list of ids by
    // this point and the registry is already holding the positions; nothing is
    // retained but the count.
    reachRef.current.record(data.lon, data.lat, data.used, arrived);

    // Thunder, where the reader is near enough to hear it. Scheduled from here
    // rather than from the watch pass because that pass runs every two seconds
    // and only ever reports the soonest arrival: a panel wants the next bang
    // and an ear wants all of them, each at its own moment.
    const { on, at: here, replaying } = audible.current;
    // A latitude box first: almost every strike on earth is nowhere near
    // anybody, and the trigonometry is the expensive part.
    if (on && here && !replaying && Math.abs(data.lat - here.lat) <= THUNDER_MAX_KM / 111.32) {
      const km = distanceKm(here.lon, here.lat, data.lon, data.lat);
      // Timed from the flash rather than from now. The network runs about five
      // seconds behind and the sound has been travelling for all of them, so
      // played from arrival every bang would land a mile and a half late.
      if (km <= THUNDER_MAX_KM) {
        roll(km, km / SPEED_KMS - (arrived - flash) / 1000);
      }
    }
    const lon = Math.floor(data.lon / BIN_SIZE) * BIN_SIZE;
    const lat = Math.floor(data.lat / BIN_SIZE) * BIN_SIZE;
    const key = `${lon},${lat}`;
    const cell = binCounts.current.get(key);
    if (cell) {
      cell.count++;
      cell.last = Date.now();
    } else {
      binCounts.current.set(key, { lon, lat, count: 1, last: Date.now() });
    }
  }, []);

  /**
   * The tracker, run across a stretch of the retained window.
   *
   * A storm cell is not a thing an instant contains. `detectStorms` finds the
   * clusters in a window, but where a cell is going, how fast, and whether it
   * is winding up are all read off a trail that `trackStorms` grows one
   * centroid at a time, so a cell found in a single pass has a ring and nothing
   * else. Walking the same window forward at the cadence the trail is sampled
   * on gives the tracker the observations it would have made had somebody been
   * watching, which is what both callers here need: the session that starts
   * from the relay's hour, and the rewind, which has to show the cells as
   * they stood at a moment nobody was looking at them.
   */
  const walk = useCallback((from, to, seed = []) => {
    let tracked = seed;
    for (let at = from; at <= to; at += SEED_STEP_MS) {
      const list = history.current;
      // Bounded rather than sliced: the window is most of the retained hour and
      // this loop walks it seventy-five times on a cold scrub.
      const lo = since(list, at - STORM_WINDOW_MS);
      const hi = since(list, at);
      tracked = trackStorms(tracked, detectStorms(list, at, STORM_WINDOW_MS, lo, hi), at);
      // Only where the walk stops. The heading is measured from the strike
      // record rather than accumulated from the trail, so it does not need to
      // be taken at every step of the way to be right at the end of it, and
      // taking it at every step is what a cold scrub cannot afford.
      if (at + SEED_STEP_MS > to) measureMotion(tracked, list, at);
    }
    return tracked;
  }, []);

  /**
   * The hour the relay was holding, absorbed on arrival.
   *
   * Not put through `handleDataReceived`, and that is the whole design of it.
   * That door stamps a strike with the moment it arrived, queues it to be
   * flashed on the map and counts it into the rate: fourteen thousand strikes
   * through it would be one white frame, a rate reading of thirty thousand a
   * minute, and every one of them dated to the same second. What is wanted
   * instead is the state those strikes would have left behind, so they are
   * filed where they would have ended up, at the times they actually happened.
   *
   * Three things are deliberately not seeded. The rate and the session count
   * are measurements of arrivals rather than of weather, and describe a feed
   * nobody was listening to; the count in particular has to start at nothing,
   * because "detected" is what this session has watched arrive and a session
   * that opens claiming twenty thousand is reporting the sky rather than
   * itself. The reach histogram is built from station lists, and the backfill
   * does not carry them.
   *
   * The daily curve is seeded, and used not to be, which was the wrong side of
   * that line. It is filed under arrivals like the other two and it is not one:
   * how hard the world was firing at twenty past two is true whether or not
   * anybody had this tab open, and the reading it exists for is the planet's
   * own daily cycle. Unseeded, that reading needed eight hours of an open tab
   * to appear at all and the group was a heading over a wiggle. An hour is
   * still not a day, but it is an hour of real weather on arrival, and the
   * curve says how much of a day it has become.
   */
  const absorb = useCallback((caught) => {
    if (!caught.length) return;
    // A reconnect brings the window again. Only what is newer than the last
    // thing held is taken: everything downstream reads this history as a run in
    // arrival order, and filling a hole in the middle of it would break the
    // window every one of those passes is a binary search for.
    const from = history.current.length ? history.current[history.current.length - 1].t : -Infinity;
    const strikes = caught.filter((strike) => strike.at > from);
    if (!strikes.length) return;

    for (const strike of strikes) {
      // `t` and `at` are the same instant here. The relay knows when it heard
      // about a strike and could have carried both, but its clock is not this
      // one, and the flash's own time is the honest column to fill.
      history.current.push({ lon: strike.lon, lat: strike.lat, t: strike.at, at: strike.at, gap: null });
      // Filed under the minute it actually happened in, which is what makes
      // this weather rather than arrivals: the ring `day.js` keeps is addressed
      // by absolute minute, so an hour of the past drops into the slots it
      // belongs in with nothing special done to it.
      day.current.record(1, strike.at);
      const lon = Math.floor(strike.lon / BIN_SIZE) * BIN_SIZE;
      const lat = Math.floor(strike.lat / BIN_SIZE) * BIN_SIZE;
      const key = `${lon},${lat}`;
      const cell = binCounts.current.get(key);
      // Aged by when the strike fell, so a cell that stopped twenty minutes ago
      // is drawn as far through its burn as it would have been had the tab been
      // open all along, and the flush pass releases it on time.
      if (cell) {
        cell.count++;
        if (strike.at > cell.last) cell.last = strike.at;
      } else {
        binCounts.current.set(key, { lon, lat, count: 1, last: strike.at });
      }
    }

    // Storm cells, walked forward rather than detected once, which is the
    // difference between rings and rings that know where they are going.
    //
    // Sliced, because it is the one expensive thing here and it lands at the
    // worst possible moment. Measured on an hour of an ordinary sky: seeding
    // the strikes above costs six milliseconds, and walking the tracker across
    // them costs a hundred and thirty, which the browser reports as a hundred
    // and fifty millisecond task, in the second the map is first being looked
    // at. Nothing is faster about doing it in pieces; what changes is that no
    // single piece is long enough to drop a frame.
    //
    // The cells are handed over after each slice rather than at the end, so
    // what a reader sees is the map filling in over a few frames rather than
    // arriving whole after a stall.
    const to = Date.now();
    let at = strikes[0].at + STORM_WINDOW_MS;
    seeding.current = true;
    const slice = () => {
      const until = performance.now() + SEED_BUDGET_MS;
      // At least one step, whatever the budget says: a slice that walks nothing
      // is a loop that never ends.
      do {
        tracked.current = walk(at, at, tracked.current);
        at += SEED_STEP_MS;
      } while (at <= to && performance.now() < until);
      setStorms(tracked.current);
      if (at <= to) idle(slice);
      else seeding.current = false;
    };
    idle(slice);
  }, [walk]);

  useEffect(() => {
    const id = setInterval(() => {
      const batch = pending.current;
      pending.current = [];
      total.current += batch.length;

      // One clock for the whole flush. The rate window is measured in time
      // rather than counted in flushes, so every accumulator here has to be
      // filed under the same instant or they disagree about which minute they
      // are describing.
      const now = Date.now();

      // Sixty seconds of arrivals, held by when they landed. Not a fixed count
      // of samples: a throttled tab flushes a tenth as often, and 120 of those
      // is ten minutes read as one. See `rate.js`.
      rates.current.record(batch.length, now);
      const heard = rates.current.read(now);
      setSamples(heard.samples);
      // The same batch, banked by the minute. `read` hands back the identical
      // object until the minute rolls over, so this is a no-op re-render 119
      // times out of 120 and the panel is not asked to redraw a curve that has
      // not moved.
      day.current.record(batch.length, now);
      setDay(day.current.read(now));
      // Same arrangement: identical object back until something has actually
      // landed in one of the two distributions.
      setReach(reachRef.current.read());
      setStats({
        rate: heard.perMinute,
        total: total.current,
        storms: tracked.current.length,
        // How many of those are winding up. Read off the same tracked cells the
        // map is drawing rings around, so the figure and the rings can never
        // disagree about how many there are.
        surging: tracked.current.filter((storm) => surge(storm)?.jump).length,
        delay: batch.length ? medianDelay(batch) : null,
        // How well the network is currently placing what it hears. A property
        // of the detection geometry rather than of the weather, which is why
        // it sits beside latency and not beside the rate.
        stations: batch.length ? median(batch.map((data) => data.stations)) : null,
        // The correction the session clock is applying, and the repeats that
        // never reached any of the figures above it. Neither is weather; both
        // are the instrument describing itself, and the data page is the only
        // reader of either.
        trip: Number.isFinite(struckAt.current.floor) ? struckAt.current.floor : null,
        repeats: repeats.current,
      });

      // Burn-in releases: cells untouched for the burn window are dropped, and
      // the rest carry how much life they have left. Runs even in a lull, so
      // the map empties itself when the storms move on.
      const active = [];
      const places = new Map();
      for (const [key, cell] of binCounts.current) {
        const fade = 1 - (now - cell.last) / burnMs;
        if (fade <= 0) {
          binCounts.current.delete(key);
          continue;
        }
        // Snapshotted, not passed by reference: these cells keep mutating.
        active.push({
          lon: cell.lon,
          lat: cell.lat,
          count: cell.count,
          fade,
          hot: now - cell.last < ACTIVE_MS,
        });

        // The ranking is built from the same burning cells the map draws, so
        // the list and the picture can never disagree. Geocoding is the
        // expensive part, so it is cached and skipped for one-off cells.
        if (cell.count < REGION_MIN) continue;
        let place = placeCache.current.get(key);
        if (place === undefined) {
          place = locate(cell.lon + BIN_SIZE / 2, cell.lat + BIN_SIZE / 2);
          placeCache.current.set(key, place);
        }
        const seen = places.get(place);
        if (!seen) {
          places.set(place, {
            place,
            count: cell.count,
            peak: cell.count,
            lon: cell.lon + BIN_SIZE / 2,
            lat: cell.lat + BIN_SIZE / 2,
          });
        } else {
          seen.count += cell.count;
          // The marker points at the busiest cell, not the average of a
          // country: the centroid of Brazil is not where the storm is.
          if (cell.count > seen.peak) {
            seen.peak = cell.count;
            seen.lon = cell.lon + BIN_SIZE / 2;
            seen.lat = cell.lat + BIN_SIZE / 2;
          }
        }
      }
      setBins(active);
      setRegions(
        [...places.values()].sort((a, b) => b.count - a.count).slice(0, REGION_COUNT)
      );

      if (!batch.length) return;

      // Only the newest strikes are ever listed, so only those are geocoded.
      // Kept oldest-first: the release loop prepends them one at a time, so
      // the newest ends up on top.
      const located = batch.slice(-QUEUE_LENGTH).map((data) => ({
        id: nextId.current++,
        time: data.formattedTime,
        place: locate(data.lon, data.lat),
        delay: seconds(data.delay) ? `${seconds(data.delay)}s` : "—",
        // Carried so a row can point back at its own spot on the map.
        lon: data.lon,
        lat: data.lat,
      }));
      feedQueue.current = [...feedQueue.current, ...located].slice(-QUEUE_LENGTH);
    }, FLUSH_MS);
    return () => clearInterval(id);
    // Changing the burn window restarts the flush, which is what should happen:
    // the cells it releases are the ones outside the window, and the window has
    // just moved. Nothing is lost by it, since the accumulation lives in a ref.
  }, [locate, burnMs]);

  // Clustering is the expensive pass, so it runs on its own slow cadence
  // rather than with the twice-a-second flush.
  useEffect(() => {
    const id = setInterval(() => {
      if (seeding.current) return;
      const now = Date.now();
      const cutoff = now - HISTORY_MS;
      // Not while the clock is set down.
      //
      // The window slides forward whether or not anybody is watching the front
      // of it, so a reader parked at the far end of the roll was having the
      // strikes taken out from under the mark they were looking at: at life
      // size the replayed clock keeps pace with the present, the gap holds, and
      // the oldest end of the window is exactly where they are standing. What
      // they saw was strikes vanishing off a map that was not moving.
      //
      // The count is still capped, because that is a memory ceiling rather than
      // a window, and it drops the oldest, which is the same end. A rewind long
      // enough to reach it is a rewind that has been held past an hour, and by
      // then what it is standing on has aged out of the roll anyway.
      const stale = rewound.current ? false : history.current.length && history.current[0].t < cutoff;
      const over = history.current.length > MAX_HISTORY;
      if (stale || over) {
        // Strikes are appended in time order, so the window is a suffix, and
        // where it starts is a binary search rather than a predicate over the
        // whole hour. The filter this replaces was the same answer arrived at
        // by asking every strike in turn, and it ran on every pass rather than
        // rarely: past the first hour the oldest strike is always older than
        // the cutoff, so the branch is taken twice a second for the life of the
        // session. Measured at the retention cap, 3.2ms a pass against 0.3.
        const kept = stale ? history.current.slice(since(history.current, cutoff)) : history.current;
        history.current = kept.length > MAX_HISTORY ? kept.slice(-MAX_HISTORY) : kept;
      }
      // Only the clustering window, not the retained hour.
      const found = detectStorms(
        history.current,
        now,
        STORM_WINDOW_MS,
        since(history.current, now - STORM_WINDOW_MS)
      );
      tracked.current = trackStorms(tracked.current, found, now);
      // Reads further back than the clustering window: the two fields it lines
      // up are fifteen minutes apart.
      measureMotion(tracked.current, history.current, now);
      setStorms(tracked.current);

      // Distance to the closest strike still in the window. Only ever computed
      // for a reader who asked to be located, and computed here rather than on
      // the flush because it reads the same history the clustering walks.
      if (!here) return;
      let nearest = Infinity;
      // The closest strike near enough, and recent enough, for its thunder to
      // still be on its way. Tracked alongside the nearest-ever figure because
      // they answer different questions: one is how the storm sits, the other
      // is whether you are about to hear something.
      let pending = null;
      for (const strike of history.current) {
        // A degree box first: the trigonometry is the expensive part, and
        // almost every strike on earth is nowhere near the reader.
        if (Math.abs(strike.lat - here.lat) > WATCH_MAX_DEG) continue;
        const spread = Math.abs(strike.lon - here.lon);
        if (Math.min(spread, 360 - spread) > WATCH_MAX_DEG / Math.max(0.05, Math.cos((here.lat * Math.PI) / 180))) continue;
        const km = distanceKm(here.lon, here.lat, strike.lon, strike.lat);
        if (km < nearest) nearest = km;

        // Sound leaves the channel at the moment of the flash and arrives when
        // it arrives; the only thing that matters is whether that moment is
        // still ahead of us. Beyond THUNDER_MAX_KM there is nothing to hear.
        if (km > THUNDER_MAX_KM) continue;
        const flash = strike.at ?? strike.t;
        const heardAt = flash + (km / SPEED_KMS) * 1000;
        if (heardAt <= now) continue;
        if (!pending || heardAt < pending.at) {
          // The same arrival worked from each end of where the strike might
          // actually have been. Ordered on the middle figure rather than on
          // either edge, so which strike is "next" does not change with how
          // well it happened to be fixed.
          const spread = fixSpreadKm(strike.gap);
          pending = {
            at: heardAt,
            km,
            early: spread === null ? null : flash + (Math.max(0, km - spread) / SPEED_KMS) * 1000,
            late: spread === null ? null : flash + ((km + spread) / SPEED_KMS) * 1000,
          };
        }
      }
      setWatch({ nearest: nearest <= WATCH_MAX_KM ? nearest : null, thunder: pending });
    }, STORM_EVERY_MS);
    return () => clearInterval(id);
  }, [here]);

  // ── Replay ───────────────────────────────────────────────────────────────
  //
  // Rewinding runs the clock forward again from wherever it was set down, at
  // life size, until it catches up with the present and hands back over. A
  // frozen frame would have been easier and worth less: what you want from a
  // map of a storm is to watch the storm move.
  useEffect(() => {
    if (replayAt === null) return;
    let last = Date.now();
    const id = setInterval(() => {
      const now = Date.now();
      const elapsed = (now - last) * pace;
      last = now;
      replayStamp.current = performance.now();
      setReplayAt((at) => {
        if (at === null) return null;
        // Caught up. Live is a state, not a position at the end of the track,
        // so it is handed back rather than pinned there.
        return at + elapsed >= now - REPLAY_LEAD_MS ? null : at + elapsed;
      });
    }, REPLAY_TICK_MS);
    return () => clearInterval(id);
  }, [replayAt !== null, pace]); // eslint-disable-line react-hooks/exhaustive-deps

  // What the map was showing at that instant, derived on two clocks for the
  // same reason the live map runs on two: the marks decay visibly and want the
  // fast one, the burn-in is a slow accumulation and does not. Both are
  // quantised, so a tick landing inside the same slice reuses the last
  // derivation rather than walking the window again.
  // The instant itself is passed exactly. It used to be rounded to the playback
  // tick, which was harmless while the map drew straight from it and is not now
  // that the loop runs forward from it between ticks: rounding error changes at
  // every tick, so the interpolated clock would hop backward and forward by up
  // to a tick, and a mark part-way through its flash would brighten again.
  // Only the burn-in is quantised, and coarsely, because it is rebuilt at the
  // same twice-a-second cadence it has when live.
  const replayInstant = replayAt;
  const replayBurn = replayAt === null ? null : Math.round(replayAt / FLUSH_MS) * FLUSH_MS;

  const replayBins = useMemo(() => {
    if (replayBurn === null) return EMPTY;
    // Only the burn window that ends at this instant.
    const window = history.current.slice(
      since(history.current, replayBurn - burnMs),
      since(history.current, replayBurn) + 1
    );
    return binStrikes(window, replayBurn, {
      size: BIN_SIZE,
      burnMs,
      activeMs: ACTIVE_MS,
    });
  }, [replayBurn, burnMs]);

  // Only the instant and the burn-in. Which strikes are lit at that instant is
  // left to the render loop, which asks the question sixty times a second
  // against a clock it carries itself: deciding it here would quantise every
  // arrival to the playback tick, and an arrival is the one thing on this map
  // that has to land exactly when it lands.
  // Storm cells as they stood at the moment being replayed.
  //
  // Rebuilt rather than remembered. Keeping a snapshot of the tracked cells at
  // every step of the window would be the obvious way and the expensive one:
  // each cell carries a trail, there are hundreds of cells over a busy planet,
  // and an hour of snapshots is tens of megabytes held against the chance that
  // somebody scrubs. Walking the tracker instead costs nothing until they do.
  //
  // Quantised to the trail's own cadence, so a replay running forward is one
  // step of work per twenty seconds of window rather than a rebuild per frame.
  // A jump is the expensive case and is the one a scrub makes ninety of, so it
  // waits for the drag to settle and shows nothing in the meantime: rings from
  // where the drag started, drawn over the sky where it is now, would be the
  // stale reading this used to refuse to make.
  const replayTrack = useRef({ at: 0, storms: EMPTY });
  const [replayStorms, setReplayStorms] = useState(EMPTY);
  const replayStep = replayAt === null ? null : Math.round(replayAt / SEED_STEP_MS) * SEED_STEP_MS;
  useEffect(() => {
    if (replayStep === null) {
      replayTrack.current = { at: 0, storms: EMPTY };
      setReplayStorms(EMPTY);
      return undefined;
    }
    const prior = replayTrack.current;
    // Carried forward from the last derivation, where the clock has only moved
    // on by a step or two: the tracker is already warm and this is the same
    // work the live pass does twice a second.
    if (prior.storms.length && replayStep > prior.at && replayStep - prior.at <= WARM_MS) {
      const storms = walk(prior.at + SEED_STEP_MS, replayStep, prior.storms);
      replayTrack.current = { at: replayStep, storms };
      setReplayStorms(storms);
      return undefined;
    }
    setReplayStorms(EMPTY);
    const id = setTimeout(() => {
      // Cold: the whole run-up, which is what a heading needs and what costs
      // forty milliseconds.
      const storms = walk(replayStep - WARM_MS, replayStep, []);
      replayTrack.current = { at: replayStep, storms };
      setReplayStorms(storms);
    }, SETTLE_MS);
    return () => clearTimeout(id);
  }, [replayStep, walk]);

  const replay = useMemo(
    () => (replayInstant === null ? null : { at: replayInstant, stamp: replayStamp.current, pace, bins: replayBins }),
    [replayInstant, replayBins, pace]
  );

  // The far end of what is held: the oldest strike still retained, as an
  // instant rather than as a duration. A session opens on whatever the relay
  // was holding and the window grows from there to the hour. Passed as the
  // moment it is, so the transport can measure the window against the same
  // clock tick it measures the replay against; handing it a duration measured
  // two seconds ago is what made the mark lurch.
  const [from, setFrom] = useState(0);
  // The same window as a curve: how hard the world was firing, minute by
  // minute, so the strip under the map is something to read rather than a bare
  // line to drag along. Counted here because this is where the strikes are, and
  // on the same slow beat as the span for the same reason: it is a shape, and a
  // shape that moved twice a second would be a distraction rather than a
  // reading.
  const [shape, setShape] = useState(EMPTY);
  useEffect(() => {
    const id = setInterval(() => {
      const oldest = history.current[0]?.t;
      const now = Date.now();
      const held = oldest ? Math.min(HISTORY_MS, now - oldest) : 0;
      setFrom(held ? now - held : 0);
      if (held <= 0) return setShape(EMPTY);
      // Bucketed over the full retention rather than over what is held, so a
      // bar is always the same number of seconds wide and sits at the same
      // place on the roll from one recount to the next. The part of the hour
      // nothing has been kept for reads as zero, which is the truth about it.
      const bars = new Array(SHAPE_BARS).fill(0);
      const edge = now - HISTORY_MS;
      for (const strike of history.current) {
        const bar = Math.floor(((strike.t - edge) / HISTORY_MS) * SHAPE_BARS);
        if (bar >= 0 && bar < SHAPE_BARS) bars[bar]++;
      }
      // Against its own peak: this is where the hour was busy, not how busy it
      // was against any other hour. The rate readout is the one
      // that carries a number.
      const peak = Math.max(...bars);
      setShape(peak ? bars.map((count) => count / peak) : EMPTY);
    }, 2000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    rewound.current = replayAt !== null;
  }, [replayAt]);

  const seek = useCallback((behindMs) => {
    replayStamp.current = performance.now();
    setReplayAt(behindMs <= REPLAY_LEAD_MS ? null : Date.now() - behindMs);
  }, []);

  // ── Archive ──────────────────────────────────────────────────────────────
  //
  // A session that came out of a file rather than off the wire.
  //
  // The strikes go in at the front of the same pipe the relay feeds, so nothing
  // below this line knows about it: the feed, the cells, the rate, the burn-in
  // and the track behind you are all built exactly as they are live, because
  // they are being built from the same arrivals in the same order at the same
  // speed. What the instrument does have to know is that it is not looking at
  // now, and that is the whole of what is here.
  const [archive, setArchive] = useState(null);
  const [archiveError, setArchiveError] = useState(null);
  const player = useRef(null);
  // Read on the flush, which is not a render: what it needs to know is whether
  // silence is a fault, and that question is asked twice a second.
  const archiving = useRef(false);
  // The field is fetched for the present, and an archive is not the present, so
  // an hour from last Tuesday would be drawn under today's clouds, a cell
  // firing into a clear sky that was overcast at the time, which is the one
  // kind of quiet lie this map is otherwise careful about. Held rather than
  // dropped, and put back on the way out.
  const fieldBefore = useRef(null);

  // Everything a session accumulates, emptied. Two sessions' strikes in one
  // history is not a longer session: the times overlap, the burn-in draws both
  // at once and the rate describes neither, so entering an archive and leaving
  // one both start from nothing.
  //
  // The place cache is the exception and stays. It is a 1° cell against the
  // name of what is under it, and neither of those moves between sessions.
  const resetSession = useCallback(() => {
    pending.current = [];
    history.current = [];
    tracked.current = [];
    seeding.current = false;
    feedQueue.current = [];
    strikeQueue.current = [];
    binCounts.current.clear();
    total.current = 0;
    rates.current = createRate();
    day.current = createDay();
    reachRef.current = createReach();
    setFeed([]);
    setRegions([]);
    setBins([]);
    setStorms([]);
    setSamples([]);
    setDay(null);
    setReach(null);
    setStats(NO_STATS);
    setFrom(0);
    setShape(EMPTY);
    setReplayAt(null);
    setSelection(null);
    setFocus(null);
    setWatch(null);
  }, []);

  const loadArchive = useCallback(
    async (file) => {
      if (!file) return;
      setArchiveError(null);
      let read;
      try {
        // Checked before it is read rather than after: `text()` on a file
        // somebody picked by accident is the expensive way to find out it was
        // not this.
        if (file.size > ARCHIVE_MAX_BYTES) {
          throw new Error("that file is too large to be an hour of strikes");
        }
        read = parseArchive(await file.text());
      } catch (err) {
        setArchiveError(err.message);
        return;
      }

      player.current?.stop();
      resetSession();
      archiving.current = true;
      const play = createPlayer(read.strikes, {
        onStrike: handleDataReceived,
        onEnd: () =>
          setStatus({
            phase: "ended",
            message: `${file.name} has run out, and the map empties from here`,
            host: null,
          }),
      });
      player.current = play;
      setArchive({
        name: file.name,
        from: read.from,
        to: read.to,
        count: read.strikes.length,
        dropped: read.dropped,
        trimmed: read.trimmed,
        // What the clock has to have taken off it to read as the archive's own
        // time again. See `createPlayer`.
        shift: play.shift,
      });
      setStatus({ phase: "archive", message: `playing ${file.name}`, host: null });
      if (settings.field !== "off") {
        fieldBefore.current = settings.field;
        set("field", "off");
      }
      play.start();
    },
    [handleDataReceived, resetSession, set, settings.field]
  );

  const leaveArchive = useCallback(() => {
    player.current?.stop();
    player.current = null;
    archiving.current = false;
    resetSession();
    setArchive(null);
    setArchiveError(null);
    // The socket comes back with the component and reports for itself a moment
    // later; this is only what the footer says in between.
    setStatus({ phase: "connecting", message: "relinking...", host: null });
    if (fieldBefore.current !== null) {
      set("field", fieldBefore.current);
      fieldBefore.current = null;
    }
  }, [resetSession, set]);

  // A timer outliving the page it was feeding.
  useEffect(() => () => player.current?.stop(), []);

  // What the header shows in place of the node name. The day is worth carrying:
  // two hours on a clock say nothing about which afternoon this was, and that
  // is the whole difference between this and the live map.
  const archiveRange = useMemo(() => {
    if (!archive) return null;
    const clock = (ms) => new Date(ms).toISOString().slice(11, 16);
    return `${new Date(archive.from).toISOString().slice(0, 10)} ${clock(archive.from)}\u2013${clock(archive.to)} UTC`;
  }, [archive]);

  // A storm can deliver dozens of strikes per flush. Releasing them on a steady
  // beat keeps the feed readable and lets each row animate in on its own.
  useEffect(() => {
    // Held: the queue keeps filling and the list stays where it was. Nothing
    // is lost that would not have been lost anyway; the queue is capped.
    if (hold) return;
    const id = setInterval(() => {
      if (!feedQueue.current.length) return;
      const next = feedQueue.current.shift();
      setFeed((prev) => [next, ...prev].slice(0, FEED_LENGTH));
    }, RELEASE_MS);
    return () => clearInterval(id);
  }, [hold]);

  // The hold is released by the pointer leaving the feed, which cannot happen
  // if the feed is switched off underneath it, or the whole side panel is.
  // Without this it stays frozen with nothing on screen to unfreeze it.
  useEffect(() => {
    if (!settings.feed || !settings.sidebar) setHold(false);
  }, [settings.feed, settings.sidebar]);

  // Single keys, no modifiers: the whole interface is reachable without ever
  // going for the mouse.
  useEffect(() => {
    if (!booted) return;
    const onKeyDown = (event) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      if (target.isContentEditable) return;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;

      const key = event.key.toLowerCase();
      if (key === "escape") {
        // Panels close themselves; with none open, Escape drops the filter.
        if (configOpen || keyOpen || dataOpen) return;
        setSelection(null);
      } else if (key === "k" || event.key === "?") {
        setConfigOpen(false);
        setDataOpen(false);
        setKeyOpen((open) => !open);
      } else if (key === "c") {
        setKeyOpen(false);
        setDataOpen(false);
        setConfigOpen((open) => !open);
      } else if (key === "d") {
        setKeyOpen(false);
        setConfigOpen(false);
        setDataOpen((open) => !open);
      } else if (key === "g") {
        startTour();
      } else if (key === "t") {
        setTheme(theme === "dark" ? "light" : "dark");
      } else {
        return;
      }
      event.preventDefault();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [booted, configOpen, keyOpen, dataOpen, theme, setTheme, startTour]);

  return (
    <div className="flex h-full flex-col bg-void">
      {!booted && (
        <Boot
          onDone={finishBoot}
          onLeave={startUnfold}
          outlines={geoData.features.length}
          names={named}
          status={status}
        />
      )}
      {/* Under the glass, like the panels: the guide is drawn on the tube
          rather than over it, and the scanlines cross it too. */}
      {tourOpen && <Tour onClose={closeTour} />}
      {keyOpen && <Legend onClose={closeKey} />}
      {dataOpen && (
        <Data
          stats={stats}
          day24={day24}
          reach={reach}
          regions={regions}
          storms={replayAt === null ? storms : replayStorms}
          status={status}
          fieldHealth={fieldHealth}
          history={history}
          replaying={replayAt !== null}
          archiveRange={archiveRange}
          onClose={closeData}
        />
      )}
      {configOpen && (
        <Settings
          settings={settings}
          set={set}
          reset={reset}
          theme={theme}
          onClose={closeConfig}
          onKey={configToKey}
          onSaveStrikes={saveHistory}
          onSaveFrame={saveTube}
          archive={archive}
          archiveRange={archiveRange}
          archiveError={archiveError}
          onLoadArchive={loadArchive}
          onLeaveArchive={leaveArchive}
        />
      )}
      <Crt scanlines={settings.scanlines} sweep={settings.sweep} drift={settings.drift} />
      {/* Unmounted rather than ignored while an archive is playing. Holding a
          socket open to drop everything that comes down it would take a share
          of the relay's one upstream link for a map that is not showing it. */}
      {!archive && (
        <Seeker
          onDataReceived={handleDataReceived}
          onBackfill={absorb}
          onStatus={setStatus}
          repeats={repeats}
        />
      )}
      {settings.chrome && (
        <Navbar
          archive={archiveRange}
          onLive={leaveArchive}
          theme={theme}
          onTheme={setTheme}
          onConfig={openConfig}
          onKey={openKey}
          onData={openData}
          onGuide={startTour}
        />
      )}

      <main
        ref={mainRef}
        style={{ "--map-h": `${settings.mapVh}vh` }}
        className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-y-contain wide:flex-row wide:overflow-hidden"
      >
        <div data-tour="map" className="min-h-[var(--map-h)] flex-1 wide:min-h-0">
          <WorldMap
            // The map draws the boot screen's planet itself, and unrolls it
            // into the world as the readout leaves. So it has to be told when
            // that starts.
            unfolding={unfolding}
            // Rewound, the map is drawn from the window rather than from the
            // live accumulation, cells included. They used to be the one thing
            // left out: a track cannot be read off an instant, and stale rings
            // over a past sky would have been worse than none. What changed is
            // that the window now arrives with the session, so the tracker can
            // be walked across it and asked what it would have seen.
            bins={replay ? replay.bins : bins}
            storms={replay ? replayStorms : storms}
            replay={replay}
            // The retained window itself, so the loop can pick the lit strikes
            // per frame. A ref rather than state, like the strike queue: its
            // contents change several times a second and none of those changes
            // is a reason to render anything.
            history={history}
            from={from}
            roll={HISTORY_MS}
            shape={shape}
            pace={pace}
            onSeek={seek}
            onPace={setPace}
            strikeQueue={strikeQueue}
            tube={tube}
            theme={theme}
            settings={settings}
            summary={`World lightning map. ${stats.rate} strikes per minute, ${stats.storms} storm cells tracked, ${stats.total} detected this session.`}
            paletteKey={paletteKey}
            // With the header hidden the map carries the way back to it, so
            // turning the chrome off is never a door that locks behind you.
            onConfig={settings.chrome ? null : openConfig}
            locate={locate}
            shapeAt={shapeAt}
            states={states}
            focus={focus}
            selection={selection}
            here={here}
            onHere={setHere}
            onSelect={select}
            onSetting={set}
            onFieldHealth={setFieldHealth}
          />
        </div>
        {settings.sidebar && (
          // Only where the two are stacked. Side by side the panel is a fixed
          // column against the window's height and there is no fold to move.
          <div
            role="separator"
            aria-orientation="horizontal"
            aria-label="Drag to resize the map"
            tabIndex={0}
            className="flex h-6 shrink-0 cursor-ns-resize touch-none items-center justify-center border-t border-line bg-panel wide:hidden"
            {...grabber}
            onPointerCancel={grabber.onPointerUp}
          >
            <span aria-hidden="true" className="h-px w-8 bg-dim" />
          </div>
        )}
        {settings.sidebar && (
        <Sidebar
          stats={stats}
          samples={samples}
          day={day24}
          reach={reach}
          feed={feed}
          settings={settings}
          onSetting={set}
          regions={regions}
          selection={selection}
          watch={watch}
          hold={hold}
          onSelect={select}
          onFocus={setFocus}
          onHold={setHold}
        />
        )}
      </main>

      {settings.chrome && (
      <footer className="flex h-7 shrink-0 items-center justify-between border-t border-line px-4 text-2xs text-dim unselectable">
        <Clock offset={archive ? archive.shift : 0} />
        {/* A link that is not there was being reported in the quietest text on
            the screen, which is the one message on this line that has to be
            read. The hue is the instrument's only one and says exactly this. */}
        <span
          className={`truncate pl-4 ${
            status.phase === "down" || status.phase === "error" ? "text-fail" : ""
          }`}
          role="status"
          aria-live="polite"
        >
          &gt; {status.message}
        </span>
        <span className="flex shrink-0 items-center gap-4">
          <FieldAge kind={settings.field} replayAt={replayAt} health={fieldHealth?.cloud} />
          <a
            className="hidden shrink-0 transition-colors hover:text-text sm:inline"
            target="_blank"
            rel="noreferrer"
            href="https://www.blitzortung.org/"
          >
            blitzortung.org network
          </a>
        </span>
      </footer>
      )}
    </div>
  );
}

export default App;
