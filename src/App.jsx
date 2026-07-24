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
//libs and utils
import { indexFeatures, findFeature, distanceKm } from "./lib/geo.js";
import { useTheme } from "./lib/theme.js";
import { useSettings } from "./lib/settings.js";
import { detectStorms, trackStorms } from "./lib/storms.js";
import geoData from "./lib/world.json";

const FEED_LENGTH = 60; // strikes listed in the recent feed
const BIN_SIZE = 1; // degrees per map cell
const FLUSH_MS = 500; // how often buffered strikes reach React state
const SAMPLES = 120; // 120 half-second samples = a 60s rate window
const RELEASE_MS = 130; // cadence at which queued strikes enter the feed
const QUEUE_LENGTH = 40; // backlog cap; a storm outruns any readable feed
const BURN_MS = 4 * 60 * 1000; // how long a cell keeps its burn-in
const ACTIVE_MS = 6000; // how long a cell counts as still firing
const STORM_WINDOW_MS = 12 * 60 * 1000; // strike history a cell is built from
const STORM_EVERY_MS = 2000; // clustering cadence; storms don't move fast
const MAX_HISTORY = 25000; // ceiling on retained strikes (~8 min at peak rate)
const REGION_COUNT = 5; // places listed in the activity ranking
const REGION_MIN = 3; // strikes a cell needs before it is worth geocoding
// Ceiling on strikes waiting to be drawn. The map drains this every animation
// frame, so it is normally a handful — but a hidden tab gets no frames at all
// while the socket keeps delivering, and the backlog would otherwise grow for
// as long as the tab is left alone and then land in one frame on return.
const MAX_QUEUE = 800;
// Past this there is no news in a nearest-strike figure, and skipping it early
// keeps the scan off the ~99% of the planet that isn't near you.
const WATCH_MAX_KM = 2000;
const WATCH_MAX_DEG = WATCH_MAX_KM / 111.32;

// The feed reports whatever the network gives it; a malformed delay reads "—"
// rather than throwing inside a render.
const seconds = (value) => (Number.isFinite(Number(value)) ? Number(value).toFixed(1) : null);

// The last strike of a batch, taken alone, swings by whole seconds from one
// flush to the next — it is one measurement of a network, not a reading. The
// median of the batch holds still enough to be watched.
function medianDelay(batch) {
  const values = batch
    .map((data) => Number(data.delay))
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  return values.length ? seconds(values[values.length >> 1]) : null;
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
  const [stats, setStats] = useState({ rate: 0, total: 0, storms: 0, delay: null });
  const [status, setStatus] = useState({ phase: "idle", message: "idle", host: null });
  const [booted, setBooted] = useState(false);
  const finishBoot = useCallback(() => setBooted(true), []);
  const { theme, setTheme } = useTheme();
  const { settings, set, reset } = useSettings();
  const [configOpen, setConfigOpen] = useState(false);
  const [keyOpen, setKeyOpen] = useState(false);
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
  const closeKey = useCallback(() => setKeyOpen(false), []);

  const worldIndex = useMemo(() => indexFeatures(geoData.features), []);

  // The country outlines are needed for the first frame — the land matrix is
  // built from them — but the two detail sets are not. Nothing can be named
  // before a strike has arrived, and no strike arrives before the socket
  // opens, so they are fetched alongside the boot sequence rather than ahead
  // of it. Together they are more than a third of the bundle, and holding
  // first paint behind them buys nothing.
  //
  // Until they land, `locate` answers at the resolution it has: "USA" rather
  // than "Texas", "open water" rather than "Coral Sea".
  const [detail, setDetail] = useState({ us: null, water: null });

  useEffect(() => {
    let live = true;
    Promise.all([import("./lib/us.json"), import("./lib/water.geo.json")])
      .then(([us, water]) => {
        if (!live) return;
        setDetail({
          us: indexFeatures(us.default.features),
          // Pre-sorted smallest-first, so the first hit is the most specific
          // name: the Adriatic before the Mediterranean, the Mediterranean
          // before the Atlantic.
          water: indexFeatures(water.default.features),
        });
      })
      .catch(() => {
        // A failed fetch is not a broken map. The coarse answers stand.
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
  const rates = useRef(Array(SAMPLES).fill(0));
  const feedQueue = useRef([]);
  // Cell key → place name. Cells never move, so this is filled once each, and
  // never evicted — it doesn't need to be. There are only 360×180 one-degree
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
    pending.current.push(data);
    strikeQueue.current.push(data);
    // Trimmed with slack rather than on every message: a copy per strike would
    // cost more than the backlog it is guarding against.
    if (strikeQueue.current.length > MAX_QUEUE * 2) {
      strikeQueue.current = strikeQueue.current.slice(-MAX_QUEUE);
    }
    // Push only. Trimming here would re-copy the whole array on every
    // message; the clustering pass below enforces both bounds instead.
    history.current.push({ lon: data.lon, lat: data.lat, t: Date.now() });
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
      setStats({
        rate: next.reduce((sum, n) => sum + n, 0),
        total: total.current,
        storms: tracked.current.length,
        delay: batch.length ? medianDelay(batch) : null,
      });

      // Burn-in releases: cells untouched for BURN_MS are dropped, and the
      // rest carry how much life they have left. Runs even in a lull, so the
      // map empties itself when the storms move on.
      const now = Date.now();
      const active = [];
      const places = new Map();
      for (const [key, cell] of binCounts.current) {
        const fade = 1 - (now - cell.last) / BURN_MS;
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
          // country — the centroid of Brazil is not where the storm is.
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
  }, [locate]);

  // Clustering is the expensive pass, so it runs on its own slow cadence
  // rather than with the twice-a-second flush.
  useEffect(() => {
    const id = setInterval(() => {
      const now = Date.now();
      const cutoff = now - STORM_WINDOW_MS;
      const stale = history.current.length && history.current[0].t < cutoff;
      const over = history.current.length > MAX_HISTORY;
      if (stale || over) {
        // Strikes are appended in time order, so the window is a suffix.
        const kept = stale ? history.current.filter((s) => s.t >= cutoff) : history.current;
        history.current = kept.length > MAX_HISTORY ? kept.slice(-MAX_HISTORY) : kept;
      }
      const found = detectStorms(history.current, now, STORM_WINDOW_MS);
      tracked.current = trackStorms(tracked.current, found, now);
      setStorms(tracked.current);

      // Distance to the closest strike still in the window. Only ever computed
      // for a reader who asked to be located, and computed here rather than on
      // the flush because it reads the same history the clustering walks.
      if (!here) return;
      let nearest = Infinity;
      for (const strike of history.current) {
        // A degree box first: the trigonometry is the expensive part, and
        // almost every strike on earth is nowhere near the reader.
        if (Math.abs(strike.lat - here.lat) > WATCH_MAX_DEG) continue;
        const spread = Math.abs(strike.lon - here.lon);
        if (Math.min(spread, 360 - spread) > WATCH_MAX_DEG / Math.max(0.05, Math.cos((here.lat * Math.PI) / 180))) continue;
        const km = distanceKm(here.lon, here.lat, strike.lon, strike.lat);
        if (km < nearest) nearest = km;
      }
      setWatch({ nearest: nearest <= WATCH_MAX_KM ? nearest : null });
    }, STORM_EVERY_MS);
    return () => clearInterval(id);
  }, [here]);

  // A storm can deliver dozens of strikes per flush. Releasing them on a steady
  // beat keeps the feed readable and lets each row animate in on its own.
  useEffect(() => {
    // Held: the queue keeps filling and the list stays where it was. Nothing
    // is lost that would not have been lost anyway — the queue is capped.
    if (hold) return;
    const id = setInterval(() => {
      if (!feedQueue.current.length) return;
      const next = feedQueue.current.shift();
      setFeed((prev) => [next, ...prev].slice(0, FEED_LENGTH));
    }, RELEASE_MS);
    return () => clearInterval(id);
  }, [hold]);

  // The hold is released by the pointer leaving the feed, which cannot happen
  // if the feed is switched off underneath it. Without this it stays frozen.
  useEffect(() => {
    if (!settings.feed) setHold(false);
  }, [settings.feed]);

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
      } else if (key === "t") {
        setTheme(theme === "dark" ? "light" : "dark");
      } else {
        return;
      }
      event.preventDefault();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [booted, configOpen, keyOpen, theme, setTheme]);

  return (
    <div className="flex h-full flex-col bg-void">
      {!booted && <Boot onDone={finishBoot} />}
      {keyOpen && <Legend onClose={closeKey} />}
      {configOpen && (
        <Settings settings={settings} set={set} reset={reset} onClose={closeConfig} />
      )}
      <Crt scanlines={settings.scanlines} sweep={settings.sweep} />
      <Seeker onDataReceived={handleDataReceived} onStatus={setStatus} />
      <Navbar
        phase={status.phase}
        host={status.host}
        pulse={stats.total}
        theme={theme}
        onTheme={setTheme}
        onConfig={openConfig}
        onKey={openKey}
      />

      <main className="flex min-h-0 flex-1 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
        <div className="min-h-[45vh] flex-1 lg:min-h-0">
          <WorldMap
            bins={bins}
            storms={storms}
            strikeQueue={strikeQueue}
            theme={theme}
            settings={settings}
            summary={`World lightning map. ${stats.rate} strikes per minute, ${stats.storms} storm cells tracked, ${stats.total} detected this session.`}
            locate={locate}
            focus={focus}
            selection={selection}
            here={here}
            onHere={setHere}
            onSelect={select}
          />
        </div>
        <Sidebar
          stats={stats}
          samples={samples}
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
      </main>

      <footer className="flex h-7 shrink-0 items-center justify-between border-t border-line px-4 text-2xs text-dim unselectable">
        <Clock />
        <span className="truncate pl-4" role="status" aria-live="polite">
          &gt; {status.message}
        </span>
        <a
          className="hidden shrink-0 transition-colors hover:text-text sm:inline"
          target="_blank"
          rel="noreferrer"
          href="https://www.blitzortung.org/"
        >
          blitzortung.org network
        </a>
      </footer>
    </div>
  );
}

export default App;
