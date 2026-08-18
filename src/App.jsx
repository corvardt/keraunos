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
import Clock from "./assets/components/clock.jsx";
import FieldAge from "./assets/components/fieldage.jsx";
import Tour from "./assets/components/tour.jsx";
//libs and utils
import { indexFeatures, findFeature, distanceKm } from "./lib/geo.js";
import { useTheme } from "./lib/theme.js";
import { usePalette } from "./lib/palette.js";
import { useSettings, DENSITY } from "./lib/settings.js";
import { useTour } from "./lib/tour.js";
import { detectStorms, trackStorms, surge } from "./lib/storms.js";
import { binStrikes } from "./lib/burn.js";
import { createDay } from "./lib/day.js";
import { saveStrikes, saveFrame } from "./lib/save.js";
import geoData from "./lib/world.json";

const FEED_LENGTH = 60; // strikes listed in the recent feed
const BIN_SIZE = 1; // degrees per map cell
const FLUSH_MS = 500; // how often buffered strikes reach React state
const SAMPLES = 120; // 120 half-second samples = a 60s rate window
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
// Somewhere on earth is always having weather: the feed runs at several strikes
// a second at its quietest. Silence this long is therefore a fault and not a
// lull, and it has to be said out loud, because a map that has stopped being
// fed looks exactly like a map of calm weather, right down to the burn-in
// draining away on schedule.
const SILENCE_MS = 25000;

// Thunder. Sound covers about a third of a kilometre a second, which is the one
// piece of physics a lightning map can hand back to the person reading it: the
// flash is already here, the sound is still coming, and the gap is a distance
// you can check against your own window. Past 25km it is rarely audible at all,
// so the count is not offered.
const SPEED_OF_SOUND_KMS = 0.343;
const THUNDER_MAX_KM = 25;

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
  const [samples, setSamples] = useState(() => Array(SAMPLES).fill(0));
  const [day24, setDay] = useState(null);
  const [stats, setStats] = useState({
    rate: 0,
    total: 0,
    storms: 0,
    surging: 0,
    delay: null,
    stations: null,
    gap: null,
  });
  const [status, setStatus] = useState({ phase: "idle", message: "idle", host: null });
  // Nothing has arrived for a while, whatever the socket believes about itself.
  const [silent, setSilent] = useState(false);
  const [booted, setBooted] = useState(false);
  const finishBoot = useCallback(() => setBooted(true), []);
  const { theme, setTheme } = useTheme();
  const { settings, set, reset } = useSettings();
  // How far back the burn-in reaches. Four minutes is the live reading; opened
  // out, the same layer becomes where the lightning has been this session.
  const burnMs = DENSITY[settings.density] ?? DENSITY["4m"];
  // Derives the palette from what index.css declares and writes it back to the
  // same tokens, so the canvas picks it up by reading computed style as it
  // always has. The key is the only part React can see; the map watches it.
  const paletteKey = usePalette(theme, settings.phosphor, settings.contrast, settings.bloom);
  const [configOpen, setConfigOpen] = useState(false);
  const [keyOpen, setKeyOpen] = useState(false);
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

  // The guide's last step lights the header and leaves it clickable, so `key`
  // and `cfg` can be pressed straight out of it. A panel opening over the guide
  // would leave two things wanting Escape, and the guide has done its job by
  // then anyway: reaching the catalogue is where it was pointing.
  useEffect(() => {
    if (configOpen || keyOpen) closeTour();
  }, [configOpen, keyOpen, closeTour]);

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
  // Seeded at mount rather than at zero, so the first seconds of a session are
  // read as connecting rather than as a network that has fallen over.
  const lastArrival = useRef(Date.now());
  const binCounts = useRef(new Map());
  const total = useRef(0);
  const nextId = useRef(0);
  const rates = useRef(Array(SAMPLES).fill(0));
  // The same arrivals, counted by the minute and kept for a day. Costs 1,440
  // integers, holds no strikes, and is the only window here longer than an
  // hour.
  const day = useRef(createDay());
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

  const locate = useCallback(
    (lon, lat) => {
      const country = findFeature(worldIndex, lon, lat);
      if (country) {
        if (country.properties.name === "USA" && detail.us) {
          const state = findFeature(detail.us, lon, lat);
          if (state) return state.properties.name;
        }
        return country.properties.name;
      }
      // Most strikes fall at sea, and "open water" is the same answer for the
      // Coral Sea as for the mid-Atlantic. Name the body where we can.
      if (!detail.water) return "open water";
      const water = findFeature(detail.water, lon, lat);
      return water ? water.properties.name : "open water";
    },
    [worldIndex, detail]
  );

  const handleDataReceived = useCallback((data) => {
    lastArrival.current = Date.now();
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
    // about five seconds behind, and for anything counted in seconds (thunder,
    // above all) the difference is the whole measurement.
    const arrived = Date.now();
    const flash = arrived - (Number(data.delay) || 0) * 1000;
    history.current.push({ lon: data.lon, lat: data.lat, t: arrived, at: flash });
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

  useEffect(() => {
    const id = setInterval(() => {
      const batch = pending.current;
      pending.current = [];
      total.current += batch.length;

      // Every sample covers 500ms, so 120 of them sum to strikes per minute.
      const next = [...rates.current.slice(1), batch.length];
      rates.current = next;
      setSamples(next);
      // The same batch, banked by the minute. `read` hands back the identical
      // object until the minute rolls over, so this is a no-op re-render 119
      // times out of 120 and the panel is not asked to redraw a curve that has
      // not moved.
      day.current.record(batch.length, Date.now());
      setDay(day.current.read(Date.now()));
      setStats({
        rate: next.reduce((sum, n) => sum + n, 0),
        total: total.current,
        storms: tracked.current.length,
        // How many of those are winding up. Read off the same tracked cells the
        // map is drawing rings around, so the figure and the rings can never
        // disagree about how many there are.
        surging: tracked.current.filter((storm) => surge(storm)?.jump).length,
        delay: batch.length ? medianDelay(batch) : null,
        // How well the network is currently placing what it hears. Both are
        // properties of the detection geometry rather than of the weather,
        // which is why they sit beside latency and not beside the rate.
        stations: batch.length ? median(batch.map((data) => data.stations)) : null,
        gap: batch.length ? median(batch.map((data) => data.gap)) : null,
      });

      // Burn-in releases: cells untouched for the burn window are dropped, and
      // the rest carry how much life they have left. Runs even in a lull, so
      // the map empties itself when the storms move on.
      const now = Date.now();
      setSilent(now - lastArrival.current > SILENCE_MS);
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
      const now = Date.now();
      const cutoff = now - HISTORY_MS;
      const stale = history.current.length && history.current[0].t < cutoff;
      const over = history.current.length > MAX_HISTORY;
      if (stale || over) {
        // Strikes are appended in time order, so the window is a suffix.
        const kept = stale ? history.current.filter((s) => s.t >= cutoff) : history.current;
        history.current = kept.length > MAX_HISTORY ? kept.slice(-MAX_HISTORY) : kept;
      }
      // Only the clustering window, not the retained hour.
      const recent = history.current.slice(since(history.current, now - STORM_WINDOW_MS));
      const found = detectStorms(recent, now, STORM_WINDOW_MS);
      tracked.current = trackStorms(tracked.current, found, now);
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
        const heardAt = (strike.at ?? strike.t) + (km / SPEED_OF_SOUND_KMS) * 1000;
        if (heardAt <= now) continue;
        if (!pending || heardAt < pending.at) pending = { at: heardAt, km };
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
      const elapsed = now - last;
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
  }, [replayAt !== null]); // eslint-disable-line react-hooks/exhaustive-deps

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
  const replay = useMemo(
    () => (replayInstant === null ? null : { at: replayInstant, stamp: replayStamp.current, bins: replayBins }),
    [replayInstant, replayBins]
  );

  // How far back there is anything to see. The window fills as the session runs,
  // so the track grows for the first twelve minutes and then holds.
  const [span, setSpan] = useState(0);
  useEffect(() => {
    const id = setInterval(() => {
      const oldest = history.current[0]?.t;
      setSpan(oldest ? Math.min(HISTORY_MS, Date.now() - oldest) : 0);
    }, 2000);
    return () => clearInterval(id);
  }, []);

  const seek = useCallback((behindMs) => {
    replayStamp.current = performance.now();
    setReplayAt(behindMs <= REPLAY_LEAD_MS ? null : Date.now() - behindMs);
  }, []);

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
        if (configOpen || keyOpen) return;
        setSelection(null);
      } else if (key === "k" || event.key === "?") {
        setConfigOpen(false);
        setKeyOpen((open) => !open);
      } else if (key === "c") {
        setKeyOpen(false);
        setConfigOpen((open) => !open);
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
  }, [booted, configOpen, keyOpen, theme, setTheme, startTour]);

  return (
    <div className="flex h-full flex-col bg-void">
      {!booted && (
        <Boot
          onDone={finishBoot}
          outlines={geoData.features.length}
          names={named}
          status={status}
        />
      )}
      {/* Under the glass, like the panels: the guide is drawn on the tube
          rather than over it, and the scanlines cross it too. */}
      {tourOpen && <Tour onClose={closeTour} />}
      {keyOpen && <Legend onClose={closeKey} />}
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
        />
      )}
      <Crt scanlines={settings.scanlines} sweep={settings.sweep} />
      <Seeker onDataReceived={handleDataReceived} onStatus={setStatus} />
      {settings.chrome && (
        <Navbar
          phase={status.phase}
          host={status.host}
          pulse={stats.total}
          theme={theme}
          onTheme={setTheme}
          onConfig={openConfig}
          onKey={openKey}
          onGuide={startTour}
        />
      )}

      <main className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-y-contain wide:flex-row wide:overflow-hidden">
        <div data-tour="map" className="min-h-[45vh] flex-1 wide:min-h-0">
          <WorldMap
            // Rewound, the map is drawn from the window rather than from the
            // live accumulation. Storm cells are the one thing not replayed:
            // they are tracked forward, strike by strike, and a track cannot be
            // reconstructed from an instant, so rather than show stale rings
            // over a past sky, it shows none.
            bins={replay ? replay.bins : bins}
            storms={replay ? EMPTY : storms}
            replay={replay}
            // The retained window itself, so the loop can pick the lit strikes
            // per frame. A ref rather than state, like the strike queue: its
            // contents change several times a second and none of those changes
            // is a reason to render anything.
            history={history}
            span={span}
            onSeek={seek}
            strikeQueue={strikeQueue}
            tube={tube}
            theme={theme}
            settings={settings}
            summary={`World lightning map. ${stats.rate} strikes per minute, ${stats.storms} storm cells tracked, ${stats.total} detected this session.`}
            // The tube says so itself, rather than leaving it to a status line
            // in the footer that nobody watching the weather is reading.
            lost={silent || status.phase === "down"}
            paletteKey={paletteKey}
            // With the header hidden the map carries the way back to it, so
            // turning the chrome off is never a door that locks behind you.
            onConfig={settings.chrome ? null : openConfig}
            locate={locate}
            focus={focus}
            selection={selection}
            here={here}
            onHere={setHere}
            onSelect={select}
            onSetting={set}
          />
        </div>
        {settings.sidebar && (
        <Sidebar
          stats={stats}
          samples={samples}
          day={day24}
          feed={feed}
          settings={settings}
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
        <Clock />
        <span className="truncate pl-4" role="status" aria-live="polite">
          &gt; {status.message}
        </span>
        <span className="flex shrink-0 items-center gap-4">
          <FieldAge kind={settings.field} replayAt={replayAt} />
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
