import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { indexFeatures, findFeature, distanceKm } from "../../lib/geo.js";
import { readMedium } from "../../lib/theme.js";
import { motion, forecast } from "../../lib/storms.js";
import { PERSISTENCE } from "../../lib/settings.js";
import {
  LAT_LIMIT,
  MIN_K,
  clampView,
  fitProjection,
  viewForBounds,
  visibleBounds,
  zoomAbout,
  zoomed,
} from "../../lib/view.js";
import { terminator } from "../../lib/sun.js";
import capitals from "../../lib/capitals.js";
import { Ticks } from "./crt.jsx";
import GeoData from "../../lib/world.json";

const GRID_RADIUS_KM = 175; // dot spacing at world zoom
// How fast that spacing tightens as you close in. Dividing by k outright holds
// the gap at a constant 5px, which is right over an ocean and wrong once the
// whole tube is land — a continent fills in as a solid field. At k^0.75 the gap
// instead opens as k^0.25, roughly 5px to 13px across the zoom range, so the
// array coarsens as you approach and stays legible as an array.
const GRID_FALLOFF = 0.75;
const EARTH_RADIUS_KM = 6371;
const RING_MS = 720; // the detection ping thrown on arrival
const FLASH_MS = 180; // the initial overbright moment
const GRATICULE_STEP = 30; // degrees between scope reference lines
const BIN_SIZE = 1; // must match the binning in App.jsx
const MIN_BURN = 3; // strikes a cell needs before it leaves a mark
const SHAKE_MAX_PX = 3.2; // deflection ceiling; any more and the map smears
const SHAKE_COOLDOWN_MS = 1500; // rare enough that each knock still lands
const BOLT_MS = 260; // how long the descending bolt is drawn
const BOLT_H = 26; // bolt height in pixels
// Two tiers on the same signal: a bolt is the routine cue, a knock is the
// event. Keeping them apart is what stops the shake becoming wallpaper.
const BOLT_HITS = 3; // hits on one cell that earn a drawn bolt
const SHAKE_HITS = 9; // hits that earn a knock on the tube
const HIT_WINDOW = 2500; // window those hits have to land in
const MAX_PARTICLES = 700; // ceiling on the live loop during a severe storm
const ARROW_PX = 17; // storm bearing arrow; a fixed length, not a distance
// Rings below this are not drawn — and therefore not clickable. Both the
// renderer and the hit test read it, because a cell you cannot see is a cell
// you cannot have meant to pick.
const STORM_MIN_PX = 3;
// The trail holds a centroid every 20s for an hour — 180 points, far more than
// a track needs to read as a curve, and each one costs a projection every
// frame. Subsampled to this, a point every couple of minutes.
const TRAIL_POINTS = 36;
const TRAIL_TIERS = 3; // alpha steps along the trail; the taper is what says which end is now
// A cell doing 45 km/h covers 19 km in the whole 25-minute trail: under one
// pixel at world zoom, where there are also the most cells on screen. Below
// this the track is a smudge on top of its own ring, so it isn't drawn at all
// — which is also what keeps the cost off the zoomed-out view.
const TRAIL_MIN_PX = 8;
const FORECAST_S = 3600; // how far ahead the projected track runs (1 h)
// The terminator moves 15° an hour — a fraction of a pixel a minute at world
// zoom. Recomputing it per frame would be absurd; it rides the land layer,
// which this clock rebuilds.
const SUN_TICK_MS = 60000;
// How near a burning cell has to be before it names the capital it is near.
// A real distance rather than a span in degrees: four degrees of longitude is
// 445 km over Nairobi and 223 km over Oslo, so a degree box would let a storm
// place itself from twice as far away in the tropics as in Scandinavia for no
// reason anyone could defend.
const CAPITAL_NEAR_KM = 400;
const KM_PER_DEG = 111.32;
const CAPITAL_PAD = 3; // clear space demanded around a label before it is drawn
// #lon/lat/k — where the tube is pointed, so a view can be handed to someone.
const HASH_RE = /^#(-?\d+(?:\.\d+)?)\/(-?\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)$/;

const WHEEL_K = 0.0016; // wheel delta to zoom exponent
const SETTLE_MS = 160; // quiet time before the land matrix is rebuilt
const DRAG_SLOP = 4; // pixels of movement that turn a click into a drag
const HERE_SPAN = 20; // degrees framed around a located reader — regional, not a street

// The presets exist because a storm over the Alps is four pixels wide at world
// zoom. Bounds are the landmass, not its outlying islands: stretching europe
// north to Svalbard drags the fit down to k=3.4 and fills the tube with
// Greenland and ocean, which is how you end up looking at everything except
// Europe. The fit adds slack on the unconstrained axis anyway.
const REGIONS = [
  { label: "world", bounds: [-180, -LAT_LIMIT, 180, LAT_LIMIT] },
  { label: "europe", bounds: [-11, 35, 42, 61] },
  { label: "africa", bounds: [-20, -36, 52, 38] },
  { label: "asia", bounds: [40, -12, 150, 60] },
  { label: "n.america", bounds: [-170, 8, -52, 72] },
  { label: "s.america", bounds: [-84, -56, -33, 13] },
  { label: "oceania", bounds: [110, -48, 180, -5] },
];

// Indexed once for the whole session; the grid is rebuilt often, this is not.
let landIndex = null;

// Land is a dot matrix rather than filled coastline: it reads as a sensor
// array, and it leaves the strikes as the only solid marks on screen. Built
// for the visible extent only, at a spacing that follows the zoom — so the
// matrix stays the same density on screen however far in you go, and the cost
// stays bounded however far in that is.
function buildGrid([west, south, east, north], stepKm) {
  landIndex = landIndex || indexFeatures(GeoData.features);
  const degToRad = Math.PI / 180;
  const kmToDeg = (stepKm / (2 * Math.PI * EARTH_RADIUS_KM)) * 360;

  const land = [];
  for (let lat = south; lat <= north; lat += kmToDeg) {
    const cosLat = Math.abs(Math.cos(lat * degToRad));
    const step = cosLat > 1e-6 ? kmToDeg / cosLat : 360;
    for (let lon = west; lon <= east; lon += step) {
      // Ocean points were previously drawn black on black; only land is kept.
      if (findFeature(landIndex, lon, lat)) land.push([lon, lat]);
    }
  }
  return land;
}

// A jagged descent onto the strike point, tightening as it nears the ground.
// Held as offsets from the strike, so the bolt survives the map moving under it.
function makeBolt(scale = 1) {
  const points = [];
  const steps = 5;
  for (let i = 0; i <= steps; i++) {
    const f = i / steps;
    points.push([(1 - f) * (Math.random() - 0.5) * 13 * scale, -BOLT_H * scale * (1 - f)]);
  }
  return points;
}

// Cell keys run [-180, 180). Suva sits at 178°E and looks for burning cells a
// couple of degrees east of it, which are named -179 and -178 — without this
// the search falls off the end of the world and the label never lights.
const wrapLon = (lon) => ((((lon + 180) % 360) + 360) % 360) - 180;

/** 40.31°N rather than 40.31 — a bearing reads faster than a signed number. */
function coord(value, axis) {
  const hemisphere = axis === "lat" ? (value < 0 ? "S" : "N") : value < 0 ? "W" : "E";
  return `${Math.abs(value).toFixed(2)}°${hemisphere}`;
}

function useElementSize(ref) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize({ width: Math.round(width), height: Math.round(height) });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}

function scaleCanvas(canvas, width, height) {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.floor(width * dpr));
  canvas.height = Math.max(1, Math.floor(height * dpr));
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

/**
 * Two layers over a land grid:
 *   history — every cell that has ever fired, dim, cumulative (the burn-in)
 *   live    — strikes from the last few seconds, white, decaying (the beam)
 *
 * Both layers are rasterised against the *settled* view and then drawn through
 * the delta to the live one, so a drag moves a finished bitmap instead of
 * re-plotting twenty thousand points a frame. The live layer is projected per
 * frame — it is small, and it must be exact.
 *
 * `strikeQueue` is a ref the parent pushes into; the animation loop drains it.
 * Strikes therefore reach the map the instant they arrive, without a render.
 */
const WorldMap = ({
  bins,
  storms,
  strikeQueue,
  theme,
  settings,
  summary,
  locate,
  focus,
  selection,
  here,
  onHere,
  onSelect,
}) => {
  const containerRef = useRef(null);
  const screenRef = useRef(null);
  const lastKnock = useRef(0);
  const canvasRef = useRef(null);
  const landLayer = useRef(null);
  const historyLayer = useRef(null);
  const particles = useRef([]);
  const recentHits = useRef(new Map());
  const { width, height } = useElementSize(containerRef);

  // Re-resolved on theme change: the stylesheet owns the values.
  const { palette, composite } = useMemo(() => readMedium(theme), [theme]);
  const persistenceMs = PERSISTENCE[settings.persistence] ?? PERSISTENCE.normal;

  const base = useMemo(
    () => (width && height ? fitProjection(width, height) : null),
    [width, height]
  );

  // The live view, and the one the offscreen layers were last drawn for.
  const [view, setView] = useState({ k: 1, x: 0, y: 0 });
  const [settled, setSettled] = useState({ k: 1, x: 0, y: 0 });
  const viewRef = useRef(view);
  viewRef.current = view;

  const projection = useMemo(() => zoomed(base, view), [base, view]);
  const layerProjection = useMemo(() => zoomed(base, settled), [base, settled]);

  // The render loop reads these rather than closing over them. They change on
  // every frame of a drag, and restarting the loop each time would reallocate
  // the canvas backing store sixty times a second.
  const projectionRef = useRef(projection);
  const settledRef = useRef(settled);
  const stormsRef = useRef(storms);
  projectionRef.current = projection;
  settledRef.current = settled;
  stormsRef.current = storms;

  // A resize refits the world under the view, so the view has to be re-checked
  // against the new bounds or it can end up parked off the edge.
  useEffect(() => {
    if (!base) return;
    setView((prev) => clampView(prev, base, width, height));
  }, [base, width, height]);

  // ── Deep links ───────────────────────────────────────────────────────────
  // Read once, in render rather than an effect: the hash is written back as
  // soon as the view settles, so anything reading it later reads its own
  // output rather than what the reader arrived with.
  const link = useRef(undefined);
  if (link.current === undefined) {
    const match = window.location.hash.match(HASH_RE);
    link.current = match ? { lon: +match[1], lat: +match[2], k: +match[3] } : null;
  }

  const linked = useRef(false);
  useEffect(() => {
    if (!base || linked.current) return;
    linked.current = true;
    if (!link.current) return;
    const { lon, lat, k } = link.current;
    const centre = base([lon, lat]);
    if (!centre || !isFinite(centre[0]) || !isFinite(centre[1])) return;
    setView(
      clampView({ k, x: width / 2 - k * centre[0], y: height / 2 - k * centre[1] }, base, width, height)
    );
  }, [base, width, height]);

  // Written on settle rather than per frame: replaceState during a drag is
  // sixty history writes a second, and the browser is entitled to complain.
  useEffect(() => {
    if (!linked.current || !layerProjection?.invert || !width || !height) return;
    const centre = layerProjection.invert([width / 2, height / 2]);
    const world = settled.k <= MIN_K + 1e-3;
    const hash =
      world || !centre || !isFinite(centre[0]) || !isFinite(centre[1])
        ? ""
        : `#${centre[0].toFixed(2)}/${centre[1].toFixed(2)}/${settled.k.toFixed(2)}`;
    if (hash === window.location.hash) return;
    // The whole world is the default, and a default does not need saying.
    window.history.replaceState(null, "", hash || window.location.pathname + window.location.search);
  }, [layerProjection, settled, width, height]);

  // Rebuilding the land matrix costs tens of milliseconds, so it waits until
  // the view stops moving. Until then the previous matrix is stretched, which
  // is why it is built with margin.
  useEffect(() => {
    const id = setTimeout(() => {
      setSettled((prev) =>
        prev.k === view.k && prev.x === view.x && prev.y === view.y ? prev : view
      );
    }, SETTLE_MS);
    return () => clearTimeout(id);
  }, [view]);

  const grid = useMemo(() => {
    if (!layerProjection || !width || !height) return [];
    return buildGrid(
      visibleBounds(layerProjection, width, height),
      GRID_RADIUS_KM / Math.pow(settled.k, GRID_FALLOFF)
    );
  }, [layerProjection, settled.k, width, height]);

  // Its own slow clock, like the one the footer keeps: the sun moving is not a
  // reason to re-render anything but the layer it shades.
  const [sunAt, setSunAt] = useState(() => Date.now());
  useEffect(() => {
    if (!settings.daylight) return;
    const id = setInterval(() => setSunAt(Date.now()), SUN_TICK_MS);
    return () => clearInterval(id);
  }, [settings.daylight]);

  // Watched rather than read once at setup: read inside the render effect, a
  // reader turning motion off mid-session would keep the beam until something
  // unrelated — a resize, a theme change — happened to rebuild the loop.
  const [reduceMotion, setReduceMotion] = useState(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = (event) => setReduceMotion(event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  // Where the pointer is, in pixels and in degrees. Held in state rather than a
  // ref because the reticle and readout are DOM, not canvas: the render loop
  // above never sees it.
  const [cursor, setCursor] = useState(null);

  // The 1° cell under the pointer, as the key App bins by. Everything expensive
  // hangs off this string, so it is recomputed on cell changes, not on pixels.
  const cell = cursor ? `${Math.floor(cursor.lon)},${Math.floor(cursor.lat)}` : null;

  // Point-in-polygon over every country; far too costly to run per mousemove.
  const place = useMemo(() => {
    if (!cell || !locate) return null;
    const [lon, lat] = cell.split(",").map(Number);
    return locate(lon + BIN_SIZE / 2, lat + BIN_SIZE / 2);
  }, [cell, locate]);

  // Keyed the same way App bins, so the readout is a lookup rather than a scan
  // over every burning cell on the planet each time the pointer crosses one.
  const binIndex = useMemo(() => {
    const index = new Map();
    for (const bin of bins) index.set(`${bin.lon},${bin.lat}`, bin.count);
    return index;
  }, [bins]);

  const count = cell ? (binIndex.get(cell) ?? 0) : 0;

  // Feed rows and the current selection are marked in DOM too, for the same
  // reason: they change on interaction, not on every frame.
  const project = (point) => {
    if (!projection || !point) return null;
    const xy = projection([point.lon, point.lat]);
    return xy && isFinite(xy[0]) && isFinite(xy[1]) ? xy : null;
  };
  const focusXY = project(focus);
  const selectedXY = project(selection);

  const readPointer = (event) => {
    if (!projection || !projection.invert || !containerRef.current) return null;
    const rect = containerRef.current.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const point = projection.invert([x, y]);
    if (!point || !isFinite(point[0]) || !isFinite(point[1])) return null;
    // Mercator keeps inverting past the edges of the drawn world; those
    // coordinates are real numbers but not places on this map.
    if (Math.abs(point[0]) > 180 || Math.abs(point[1]) > LAT_LIMIT) return null;
    return { x, y, lon: point[0], lat: point[1] };
  };

  /**
   * The storm cell under a point, or null.
   *
   * Tested against the ring as drawn, in screen space, rather than against the
   * radius in degrees: the ring is a circle of pixels, and Mercator stretches
   * latitude, so a degree-space test drifts from the drawn shape the further
   * north you go. Cells too small to have been drawn are skipped on the same
   * threshold the renderer uses — otherwise clicking apparently empty ocean at
   * world zoom silently filters the feed to a cell with no ring to explain it.
   *
   * Smallest wins: a cell inside a larger one is the more specific answer.
   */
  const pickStorm = (point) => {
    if (!settings.storms || !projection) return null;
    let best = null;
    let smallest = Infinity;
    for (const storm of storms) {
      const centre = projection([storm.lon, storm.lat]);
      const edge = projection([storm.lon + storm.radius, storm.lat]);
      if (!centre || !edge || !isFinite(centre[0]) || !isFinite(centre[1]) || !isFinite(edge[0])) {
        continue;
      }
      const r = Math.abs(edge[0] - centre[0]);
      if (r < STORM_MIN_PX || r >= smallest) continue;
      if (Math.hypot(point.x - centre[0], point.y - centre[1]) <= r) {
        smallest = r;
        best = storm;
      }
    }
    if (!best) return null;
    return {
      lon: best.lon,
      lat: best.lat,
      place: locate(best.lon, best.lat),
      // Carried so the feed can narrow to the cell rather than to its country.
      radius: best.radius,
    };
  };

  // ── The view controls ────────────────────────────────────────────────────
  const pointers = useRef(new Map());
  const pinch = useRef(null);
  const dragged = useRef(0);
  const [panning, setPanning] = useState(false);

  /**
   * A high-refresh mouse delivers moves faster than the display draws them, and
   * a trackpad emits wheel events in bursts. Each one, taken directly, is a
   * React render of the largest component in the app. Everything the pointer
   * produces is therefore folded into a single update per frame — which is all
   * the screen can show anyway.
   */
  const geom = useRef({ base, width, height });
  geom.current = { base, width, height };
  const pendingFrame = useRef(0);
  const queued = useRef({ cursor: undefined, panX: 0, panY: 0, zoom: null });

  const flush = useCallback(() => {
    pendingFrame.current = 0;
    const q = queued.current;
    const { base: fitted, width: w, height: h } = geom.current;

    // Zoom before pan: a pinch is a spread about a point plus a drift, and
    // applying the drift first would move the point the spread is about.
    if (q.zoom) {
      const { x, y, factor } = q.zoom;
      q.zoom = null;
      setView((prev) => clampView(zoomAbout(prev, x, y, factor), fitted, w, h));
    }
    if (q.panX || q.panY) {
      const dx = q.panX;
      const dy = q.panY;
      q.panX = 0;
      q.panY = 0;
      setView((prev) => clampView({ k: prev.k, x: prev.x + dx, y: prev.y + dy }, fitted, w, h));
    }
    if (q.cursor !== undefined) {
      setCursor(q.cursor);
      q.cursor = undefined;
    }
  }, []);

  const schedule = useCallback(() => {
    if (!pendingFrame.current) pendingFrame.current = requestAnimationFrame(flush);
  }, [flush]);

  useEffect(() => () => cancelAnimationFrame(pendingFrame.current), []);

  // Zoom about a screen point, so whatever is under the pointer stays there.
  const zoomAt = (x, y, factor) => {
    const q = queued.current;
    // Bursts compound rather than replace: two notches of wheel in one frame
    // are two notches of zoom.
    q.zoom = q.zoom ? { x, y, factor: q.zoom.factor * factor } : { x, y, factor };
    schedule();
  };

  const focusRegion = (bounds) => {
    if (!base) return;
    setView(viewForBounds(base, width, height, bounds));
  };

  // Asked for, never volunteered: nothing here touches the geolocation API
  // until the control below is pressed, and the fix is held for the session
  // only — it is not written to storage and not sent anywhere. It lives in App
  // because the watch readouts are built from it; the framing stays here.
  const [locating, setLocating] = useState("idle");

  const findMe = () => {
    if (here) {
      focusRegion([here.lon - HERE_SPAN, here.lat - HERE_SPAN * 0.6, here.lon + HERE_SPAN, here.lat + HERE_SPAN * 0.6]);
      return;
    }
    if (!navigator.geolocation) {
      setLocating("unavailable");
      return;
    }
    setLocating("asking");
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const point = { lon: coords.longitude, lat: coords.latitude };
        onHere(point);
        setLocating("found");
        focusRegion([
          point.lon - HERE_SPAN,
          point.lat - HERE_SPAN * 0.6,
          point.lon + HERE_SPAN,
          point.lat + HERE_SPAN * 0.6,
        ]);
      },
      () => setLocating("denied"),
      { timeout: 10000, maximumAge: 300000 }
    );
  };

  const hereXY = project(here);
  const hereLabel =
    locating === "asking"
      ? "locating"
      : locating === "denied"
        ? "denied"
        : locating === "unavailable"
          ? "no fix"
          : "here";

  // Wheel is bound natively: React's listener is passive, and this one has to
  // preventDefault or the page scrolls out from under the map.
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !base) return;
    const onWheel = (event) => {
      event.preventDefault();
      const rect = el.getBoundingClientRect();
      zoomAt(
        event.clientX - rect.left,
        event.clientY - rect.top,
        Math.exp(-event.deltaY * WHEEL_K)
      );
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, width, height]);

  // Keys for the view, matching the panel shortcuts App owns. Zoom lands on the
  // middle of the tube, which is the only point the keyboard can mean.
  useEffect(() => {
    if (!base) return;
    const onKeyDown = (event) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      if (target.isContentEditable) return;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;
      if (event.key === "+" || event.key === "=") zoomAt(width / 2, height / 2, 1.4);
      else if (event.key === "-" || event.key === "_") zoomAt(width / 2, height / 2, 1 / 1.4);
      else if (event.key === "0") setView({ k: 1, x: 0, y: 0 });
      else return;
      event.preventDefault();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, width, height]);

  const onPointerDown = (event) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size === 1) {
      dragged.current = 0;
      setPanning(true);
    }
    pinch.current = null;
  };

  const onPointerMove = (event) => {
    queued.current.cursor = readPointer(event);
    schedule();
    const previous = pointers.current.get(event.pointerId);
    if (!previous) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

    // Two fingers: the gesture carries both a spread and a drift, and reads as
    // broken if only the spread is honoured.
    if (pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const last = pinch.current;
      pinch.current = { distance, mid };
      if (last && last.distance > 0) {
        const rect = containerRef.current.getBoundingClientRect();
        zoomAt(mid.x - rect.left, mid.y - rect.top, distance / last.distance);
        queued.current.panX += mid.x - last.mid.x;
        queued.current.panY += mid.y - last.mid.y;
        schedule();
      }
      dragged.current = DRAG_SLOP + 1;
      return;
    }

    const dx = event.clientX - previous.x;
    const dy = event.clientY - previous.y;
    dragged.current += Math.abs(dx) + Math.abs(dy);
    queued.current.panX += dx;
    queued.current.panY += dy;
    schedule();
  };

  const endPointer = (event) => {
    pointers.current.delete(event.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    if (pointers.current.size === 0) setPanning(false);
  };

  // ── Layers ───────────────────────────────────────────────────────────────

  // Land, daylight and graticule: fixed geometry for a given view and minute,
  // so it is painted once per settle and reused as a bitmap.
  useEffect(() => {
    if (!layerProjection || !width || !height) return;
    const canvas = document.createElement("canvas");
    const ctx = scaleCanvas(canvas, width, height);

    // Which side of the terminator gets shaded is a property of the medium,
    // not a colour choice. On a tube the lit hemisphere is lit: light is
    // added. On paper night is inked: ink is deposited, and an unmarked sheet
    // is daylight. Shading the same side in both would read as a fault in one.
    if (settings.daylight) {
      const { points, nightEdge } = terminator(new Date(sunAt), LAT_LIMIT);
      const lit = theme === "dark";
      const edge = lit ? -nightEdge : nightEdge;

      ctx.beginPath();
      let started = false;
      for (const point of points) {
        const xy = layerProjection(point);
        if (!xy || !isFinite(xy[0]) || !isFinite(xy[1])) continue;
        if (started) ctx.lineTo(xy[0], xy[1]);
        else {
          ctx.moveTo(xy[0], xy[1]);
          started = true;
        }
      }
      const close = [layerProjection([180, edge]), layerProjection([-180, edge])];
      if (started && close.every((xy) => xy && isFinite(xy[0]) && isFinite(xy[1]))) {
        ctx.lineTo(close[0][0], close[0][1]);
        ctx.lineTo(close[1][0], close[1][1]);
        ctx.closePath();
        ctx.fillStyle = lit ? palette.land : palette.text;
        ctx.globalAlpha = lit ? 0.13 : 0.07;
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }

    // Scope graticule: 30° meridians and parallels, under the land matrix.
    if (settings.graticule) {
      ctx.strokeStyle = palette.line;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let lon = -180; lon <= 180; lon += GRATICULE_STEP) {
        const top = layerProjection([lon, LAT_LIMIT]);
        const bottom = layerProjection([lon, -LAT_LIMIT]);
        if (!top || !bottom) continue;
        ctx.moveTo(Math.round(top[0]) + 0.5, top[1]);
        ctx.lineTo(Math.round(bottom[0]) + 0.5, bottom[1]);
      }
      for (let lat = -60; lat <= 60; lat += GRATICULE_STEP) {
        const left = layerProjection([-180, lat]);
        const right = layerProjection([180, lat]);
        if (!left || !right) continue;
        ctx.moveTo(left[0], Math.round(left[1]) + 0.5);
        ctx.lineTo(right[0], Math.round(right[1]) + 0.5);
      }
      ctx.stroke();
    }

    ctx.fillStyle = palette.land;
    for (const point of grid) {
      const xy = layerProjection(point);
      if (!xy || !isFinite(xy[0]) || !isFinite(xy[1])) continue;
      ctx.fillRect(xy[0] - 0.9, xy[1] - 0.9, 1.8, 1.8);
    }

    landLayer.current = canvas;
  }, [grid, layerProjection, palette, settings.graticule, settings.daylight, sunAt, theme, width, height]);

  // Cumulative density: redrawn twice a second, so the backing canvas is
  // allocated once per resize and cleared rather than reallocated.
  useEffect(() => {
    if (!layerProjection || !width || !height) return;
    let canvas = historyLayer.current;
    if (!canvas || canvas.dataset.w !== `${width}x${height}`) {
      canvas = document.createElement("canvas");
      canvas.dataset.w = `${width}x${height}`;
      scaleCanvas(canvas, width, height);
      historyLayer.current = canvas;
    }
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, width, height);
    ctx.lineWidth = 1;

    ctx.fillStyle = palette.text;
    ctx.strokeStyle = palette.text;

    for (const bin of bins) {
      // One strike is a flash, not a mark. A cell has to be worked before it
      // burns in, which is what keeps single strikes from littering the map.
      if (bin.count < MIN_BURN) continue;

      // Bins are named by their south-west corner, so the cell runs from
      // [lon, lat] to one BIN_SIZE north-east of it.
      const sw = layerProjection([bin.lon, bin.lat]);
      const ne = layerProjection([bin.lon + BIN_SIZE, bin.lat + BIN_SIZE]);
      if (!sw || !ne || !isFinite(sw[0]) || !isFinite(sw[1]) || !isFinite(ne[1])) continue;

      const w = ne[0] - sw[0];
      const h = sw[1] - ne[1];
      // Ease the fade so a cell holds its mark, then lets go near the end.
      const life = bin.fade * bin.fade;
      const heat = Math.min(1, Math.log10(bin.count) / 2);

      // History is a soft round smudge. A filled rectangle has hard edges and
      // reads as interface furniture rather than as accumulated density.
      ctx.globalAlpha = heat * 0.22 * life;
      ctx.beginPath();
      ctx.arc(sw[0] + w / 2, ne[1] + h / 2, Math.max(1.5, Math.min(w, h) * 0.55), 0, Math.PI * 2);
      ctx.fill();

      // Bounds mark a cell that is firing right now, so they clear a few
      // seconds after it goes quiet instead of littering the map.
      if (settings.bounds && bin.hot && w >= 3 && h >= 3) {
        ctx.globalAlpha = 0.14 + heat * 0.3;
        ctx.strokeRect(Math.round(sw[0]) + 0.5, Math.round(ne[1]) + 0.5, Math.round(w), Math.round(h));
      }
    }
    ctx.globalAlpha = 1;

    // Capitals, lit by the weather rather than drawn as furniture.
    //
    // A permanent label set competes with the strikes for the same eye, and
    // the map is not an atlas — the only moment a place name earns its space
    // is when something is happening there and you need to know where "there"
    // is. So a capital surfaces when a cell near it is burning and fades with
    // that burn, on the same four-minute decay as the smudge underneath it.
    // A quiet map carries no names at all, which is the point: pointing at it
    // already names whatever is under the cursor, in the corner, on demand.
    //
    // Placed in prominence order and collision-culled, so a squall over the
    // Low Countries lights Brussels or Amsterdam, not both on top of each
    // other. Anything overlapping a label already placed is simply dropped.
    if (settings.capitals && bins.length) {
      // Cell key → how much life its burn has left. Keyed exactly as App bins,
      // so lighting a label is a handful of lookups rather than a scan over
      // every burning cell on the planet for all 138 capitals.
      const burning = new Map();
      for (const bin of bins) {
        if (bin.count >= MIN_BURN) burning.set(`${bin.lon},${bin.lat}`, bin.fade);
      }

      ctx.font = '10px "IBM Plex Mono", ui-monospace, monospace';
      ctx.textBaseline = "middle";
      // Knocked out of the background before being drawn: a label over the
      // land matrix is text on a field of dots at nearly its own weight, and
      // no amount of contrast fixes that — the dots have to go first.
      ctx.strokeStyle = palette.void;
      ctx.fillStyle = palette.void;
      ctx.lineJoin = "round";
      ctx.miterLimit = 2;
      const placed = [];

      for (const capital of capitals) {
        const cellLon = Math.floor(capital.lon);
        const cellLat = Math.floor(capital.lat);
        // The box is only a prefilter, and it widens toward the poles so that
        // it always contains the circle it is standing in for.
        const spanLat = Math.ceil(CAPITAL_NEAR_KM / KM_PER_DEG);
        const spanLon = Math.ceil(
          CAPITAL_NEAR_KM / (KM_PER_DEG * Math.max(0.08, Math.cos((capital.lat * Math.PI) / 180)))
        );

        let life = 0;
        for (let dx = -spanLon; dx <= spanLon; dx++) {
          for (let dy = -spanLat; dy <= spanLat; dy++) {
            const fade = burning.get(`${wrapLon(cellLon + dx)},${cellLat + dy}`);
            // Nothing there, or nothing that could brighten this label — in
            // either case the distance is not worth computing.
            if (!(fade > life)) continue;
            // Cell centre stands for the cell. The bins are a degree across,
            // so the threshold is inherently fuzzy at that scale; measuring to
            // the corner would be false precision on a fuzzy quantity.
            const km = distanceKm(capital.lon, capital.lat, cellLon + dx + 0.5, cellLat + dy + 0.5);
            if (km <= CAPITAL_NEAR_KM) life = fade;
          }
        }
        if (life <= 0) continue;

        const xy = layerProjection([capital.lon, capital.lat]);
        if (!xy || !isFinite(xy[0]) || !isFinite(xy[1])) continue;
        const [x, y] = xy;
        // Off the tube: skip before measuring, which is the costly part.
        if (x < -60 || y < -20 || x > width + 60 || y > height + 20) continue;

        const text = ctx.measureText(capital.name).width;
        const box = [x - 2 - CAPITAL_PAD, y - 6 - CAPITAL_PAD, x + 7 + text + CAPITAL_PAD, y + 6 + CAPITAL_PAD];
        const clash = placed.some(
          (other) => box[0] < other[2] && box[2] > other[0] && box[1] < other[3] && box[3] > other[1]
        );
        if (clash) continue;
        placed.push(box);

        // Full while the cell is working, letting go only as the burn does.
        const alpha = Math.min(1, life * 1.8);

        // Halo first, then the mark and the name over it. The halo clears a
        // space rather than tinting one, so it tracks the label's own fade.
        ctx.globalAlpha = alpha;
        ctx.lineWidth = 3;
        ctx.strokeText(capital.name, x + 6, y);
        ctx.beginPath();
        ctx.arc(x, y, 2.6, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = palette.text;
        ctx.globalAlpha = alpha * 0.95;
        ctx.fillRect(x - 1.25, y - 1.25, 2.5, 2.5);
        ctx.globalAlpha = alpha * 0.88;
        ctx.fillText(capital.name, x + 6, y);
        ctx.fillStyle = palette.void;
      }
      ctx.globalAlpha = 1;
    }

    historyLayer.current = canvas;
  }, [bins, layerProjection, palette, settings.bounds, settings.capitals, width, height]);

  // Deliberately not keyed on the view: the loop reads that through a ref, so
  // panning never tears the canvas down and rebuilds it.
  useEffect(() => {
    if (!width || !height) return;
    const ctx = scaleCanvas(canvasRef.current, width, height);
    const shake = settings.shake;
    let frame = null;

    // Only the tube takes the hit — the panels around it stay put.
    const knock = (hits) => {
      const el = screenRef.current;
      if (!el || reduceMotion || !shake || !el.animate) return;
      const now = performance.now();
      if (now - lastKnock.current < SHAKE_COOLDOWN_MS) return;
      lastKnock.current = now;
      const a = Math.min(SHAKE_MAX_PX, 1.2 + Math.log10(hits) * 1.7);
      const r = a * 0.1;
      el.animate(
        [
          { transform: "translate3d(0,0,0) rotate(0deg)" },
          { transform: `translate3d(${a}px, ${-a * 0.7}px, 0) rotate(${r}deg)` },
          { transform: `translate3d(${-a * 0.8}px, ${a * 0.5}px, 0) rotate(${-r * 0.8}deg)` },
          { transform: `translate3d(${a * 0.5}px, ${-a * 0.3}px, 0) rotate(${r * 0.4}deg)` },
          { transform: `translate3d(${-a * 0.2}px, 0, 0) rotate(0deg)` },
          { transform: "translate3d(0,0,0) rotate(0deg)" },
        ],
        { duration: 340, easing: "cubic-bezier(0.16, 0.8, 0.3, 1)" }
      );
    };

    const drain = () => {
      const queue = strikeQueue.current;
      if (!queue.length) return;
      const now = performance.now();

      for (const strike of queue) {
        // Repeat hits on one cell are a hard strike: they earn a bolt and a
        // knock on the chassis. A scattered strike just pings.
        const key = `${Math.floor(strike.lon)},${Math.floor(strike.lat)}`;
        const seen = recentHits.current.get(key);
        const hits = seen && now - seen.t < HIT_WINDOW ? seen.n + 1 : 1;
        recentHits.current.set(key, { n: hits, t: now });

        const hard = hits >= SHAKE_HITS;
        const bolt = hits >= BOLT_HITS;
        // Kept in degrees, not pixels: the view can move underneath a strike
        // while it is still burning, and it has to stay where it landed.
        particles.current.push({
          lon: strike.lon,
          lat: strike.lat,
          t: now,
          hard,
          bolt: bolt ? makeBolt(hard ? 1.6 : 1) : null,
        });
        if (hard) knock(hits);
      }
      queue.length = 0;

      if (particles.current.length > MAX_PARTICLES) {
        particles.current = particles.current.slice(-MAX_PARTICLES);
      }

      // Cells that have gone quiet stop counting toward a hard strike.
      for (const [key, seen] of recentHits.current) {
        if (now - seen.t > HIT_WINDOW) recentHits.current.delete(key);
      }
    };

    // Both offscreen layers belong to the settled view; this is the transform
    // from that view to the live one. It is the identity whenever the map is
    // sitting still, which is nearly always.
    const drawLayers = () => {
      const live = viewRef.current;
      const layer = settledRef.current;
      const s = live.k / layer.k;
      const tx = live.x - s * layer.x;
      const ty = live.y - s * layer.y;
      const moved = s !== 1 || tx !== 0 || ty !== 0;
      if (moved) {
        ctx.save();
        ctx.transform(s, 0, 0, s, tx, ty);
      }
      if (landLayer.current) ctx.drawImage(landLayer.current, 0, 0, width, height);
      if (historyLayer.current) ctx.drawImage(historyLayer.current, 0, 0, width, height);
      if (moved) ctx.restore();
    };

    const render = () => {
      drain();
      const now = performance.now();
      const projection = projectionRef.current;
      if (!projection) {
        frame = requestAnimationFrame(render);
        return;
      }

      // Painted, not cleared: multiply blending needs opaque pixels beneath it.
      ctx.fillStyle = palette.void;
      ctx.fillRect(0, 0, width, height);
      drawLayers();

      // Storm cells: coherent clusters, ringed and labelled with how they are
      // moving. Few enough to draw per frame.
      ctx.strokeStyle = palette.text;
      ctx.fillStyle = palette.text;
      ctx.font = '10px "IBM Plex Mono", ui-monospace, monospace';
      ctx.textBaseline = "middle";
      for (const storm of settings.storms ? stormsRef.current : []) {
        const centre = projection([storm.lon, storm.lat]);
        const edge = projection([storm.lon + storm.radius, storm.lat]);
        if (!centre || !edge || !isFinite(centre[0]) || !isFinite(centre[1])) continue;
        const r = Math.abs(edge[0] - centre[0]);
        if (r < STORM_MIN_PX) continue;

        const weight = Math.min(1, Math.log10(storm.count) / 2.4);
        ctx.globalAlpha = 0.25 + weight * 0.35;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(centre[0], centre[1], r, 0, Math.PI * 2);
        ctx.stroke();

        // Null until the cell has been watched long enough to mean anything.
        const track = motion(storm);

        // Where it has been, and where that course takes it. Both are drawn to
        // scale, unlike the bearing arrow below — which is why both disappear
        // when the scale makes them meaningless rather than being faked up to
        // a visible length.
        if (track && settings.trails && storm.trail.length > 1) {
          const points = [];
          const stride = Math.max(1, Math.ceil(storm.trail.length / TRAIL_POINTS));
          for (let i = 0; i < storm.trail.length; i += stride) {
            const xy = projection([storm.trail[i].lon, storm.trail[i].lat]);
            if (xy && isFinite(xy[0]) && isFinite(xy[1])) points.push(xy);
          }
          // The trail records a centroid every 20s; this instant's is newer
          // than the last recorded one, and it is where the cell actually is.
          const head = projection([storm.tlon, storm.tlat]);
          if (head && isFinite(head[0]) && isFinite(head[1])) points.push(head);

          const tail = points[0];
          const span = points.length > 1 ? Math.hypot(head[0] - tail[0], head[1] - tail[1]) : 0;
          if (span >= TRAIL_MIN_PX) {
            // Stroked in tiers rather than per segment: a fade needs one alpha
            // per stroke, and thirty strokes a cell is thirty times the cost
            // for a gradient nobody is reading that closely.
            ctx.lineWidth = 1.5;
            const last = points.length - 1;
            for (let tier = 0; tier < TRAIL_TIERS; tier++) {
              const from = Math.floor((tier * last) / TRAIL_TIERS);
              const to = Math.floor(((tier + 1) * last) / TRAIL_TIERS);
              if (to <= from) continue;
              ctx.globalAlpha = (0.2 + 0.19 * tier) * (0.7 + weight * 0.3);
              ctx.beginPath();
              ctx.moveTo(points[from][0], points[from][1]);
              for (let i = from + 1; i <= to; i++) ctx.lineTo(points[i][0], points[i][1]);
              ctx.stroke();
            }

            // Dashed, because it has not happened. Solid past, broken future.
            const ahead = forecast(storm, FORECAST_S);
            const projected = ahead && projection(ahead);
            if (projected && isFinite(projected[0]) && isFinite(projected[1])) {
              ctx.setLineDash([3, 4]);
              ctx.globalAlpha = 0.4 + weight * 0.25;
              ctx.beginPath();
              ctx.moveTo(head[0], head[1]);
              ctx.lineTo(projected[0], projected[1]);
              ctx.stroke();
              ctx.setLineDash([]);
              ctx.lineWidth = 1;
            }
          }
        }

        if (track) {
          // Direction is to scale; length is not. Fifteen minutes of real
          // motion is a fraction of a pixel here, so the arrow is a bearing.
          const ux = track.ux;
          const uy = -track.uy; // canvas y grows downward
          const x0 = centre[0] + ux * r;
          const y0 = centre[1] + uy * r;
          const x1 = x0 + ux * ARROW_PX;
          const y1 = y0 + uy * ARROW_PX;
          ctx.globalAlpha = 0.5 + weight * 0.35;
          ctx.beginPath();
          ctx.moveTo(x0, y0);
          ctx.lineTo(x1, y1);
          ctx.moveTo(x1, y1);
          ctx.lineTo(x1 - ux * 5 - uy * 3, y1 - uy * 5 + ux * 3);
          ctx.moveTo(x1, y1);
          ctx.lineTo(x1 - ux * 5 + uy * 3, y1 - uy * 5 - ux * 3);
          ctx.stroke();
        }

        ctx.globalAlpha = 0.45 + weight * 0.4;
        const label = track ? `${storm.count} · ${Math.round(track.kmh)}km/h` : `${storm.count}`;
        ctx.fillText(label, centre[0] + r + 5, centre[1]);
      }
      ctx.globalAlpha = 1;

      // On the tube strikes accumulate light; on paper they accumulate ink.
      ctx.globalCompositeOperation = composite;
      ctx.fillStyle = palette.strike;
      ctx.strokeStyle = palette.strike;
      ctx.lineWidth = 1;

      const alive = [];
      for (const p of particles.current) {
        const age = now - p.t;
        const life = 1 - age / persistenceMs;
        if (life <= 0) continue;
        alive.push(p);

        const xy = projection([p.lon, p.lat]);
        if (!xy || !isFinite(xy[0]) || !isFinite(xy[1])) continue;
        const [x, y] = xy;

        // The ping: a ring that leaves fast and slows as it fades, so the eye
        // catches an arrival anywhere on the map without needing an accent hue.
        const ring = age / RING_MS;
        if (ring < 1) {
          const eased = 1 - Math.pow(1 - ring, 3);
          ctx.globalAlpha = (1 - ring) * (1 - ring) * 0.5;
          ctx.beginPath();
          ctx.arc(x, y, 1.5 + eased * 15, 0, Math.PI * 2);
          ctx.stroke();
        }

        // The bolt: only hard strikes draw one, so it stays an event.
        if (p.bolt) {
          const b = age / BOLT_MS;
          if (b < 1) {
            ctx.globalAlpha = (1 - b) * (p.hard ? 1 : 0.8);
            ctx.lineWidth = p.hard ? 2.2 : 1.3;
            ctx.beginPath();
            ctx.moveTo(x + p.bolt[0][0], y + p.bolt[0][1]);
            for (let i = 1; i < p.bolt.length; i++) {
              ctx.lineTo(x + p.bolt[i][0], y + p.bolt[i][1]);
            }
            ctx.stroke();
            ctx.lineWidth = 1;
          }
        }

        // Halation: a wide dim disc under the core. Additive compositing turns
        // it into a bloom without touching the (very expensive) shadow blur.
        const flash = Math.max(0, 1 - age / FLASH_MS);
        ctx.globalAlpha = life * 0.09 + flash * 0.12;
        ctx.beginPath();
        ctx.arc(x, y, 3.5 + life * 4.5 + flash * 5, 0, Math.PI * 2);
        ctx.fill();

        // The core: overbright for a beat, then settling into the slow decay.
        ctx.globalAlpha = Math.min(1, life * life + flash * 0.7);
        ctx.beginPath();
        ctx.arc(x, y, 1.1 + life * 2.2 + flash * 2, 0, Math.PI * 2);
        ctx.fill();
      }
      particles.current = alive;

      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = 1;
      frame = requestAnimationFrame(render);
    };

    if (reduceMotion) {
      // No beam, no decay: strikes are simply plotted as they arrive.
      const tick = () => {
        drain();
        const projection = projectionRef.current;
        if (!projection) return;
        ctx.fillStyle = palette.void;
        ctx.fillRect(0, 0, width, height);
        drawLayers();
        ctx.fillStyle = palette.strike;
        for (const p of particles.current.slice(-400)) {
          const xy = projection([p.lon, p.lat]);
          if (!xy || !isFinite(xy[0])) continue;
          ctx.beginPath();
          ctx.arc(xy[0], xy[1], 1.6, 0, Math.PI * 2);
          ctx.fill();
        }
        particles.current = particles.current.slice(-400);
      };
      const id = setInterval(tick, 500);
      return () => clearInterval(id);
    }

    frame = requestAnimationFrame(render);
    return () => cancelAnimationFrame(frame);
  }, [
    strikeQueue,
    palette,
    composite,
    persistenceMs,
    reduceMotion,
    settings.shake,
    settings.storms,
    settings.trails,
    width,
    height,
  ]);

  const zoomedIn = view.k > 1.02;

  return (
    <div
      ref={containerRef}
      className={`relative h-full w-full touch-none overflow-hidden rounded-[14px] ${
        panning ? "cursor-grabbing" : "cursor-crosshair"
      }`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endPointer}
      onPointerCancel={endPointer}
      onPointerLeave={() => setCursor(null)}
      onClick={(event) => {
        // A drag ends in a click too. Only a still pointer means to pick.
        if (dragged.current > DRAG_SLOP) return;
        // Resolved here rather than read off the hover state: a tap on a touch
        // screen never sends the pointermove that would have filled it in.
        const point = readPointer(event);
        if (!point || !locate) return;
        // A storm ring under the pointer is the more specific pick: it is a
        // thing on the map rather than the country it happens to be over.
        const hit = pickStorm(point);
        onSelect(
          hit ?? { lon: point.lon, lat: point.lat, place: locate(point.lon, point.lat) }
        );
      }}
    >
      <div ref={screenRef} className="absolute inset-0">
        <canvas
          ref={canvasRef}
          style={{ width, height }}
          className="block"
          role="img"
          aria-label={summary}
        />
      </div>

      {/* Where to look. The presets are the keyboard route to the view, since
          a drag is not something a keyboard can express. */}
      {/* Scrolls sideways on a narrow screen rather than being hidden: pinching
          to Europe is not a route to Europe, and this was the only one. The
          pointer handlers are stopped here, so dragging the strip cannot also
          drag the map underneath it. */}
      <div
        className="no-bar absolute inset-x-3 top-3 flex items-center gap-2 overflow-x-auto sm:inset-x-auto sm:left-3"
        style={{ touchAction: "pan-x" }}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
      >
        {REGIONS.map((region) => (
          <button
            key={region.label}
            type="button"
            onClick={() => focusRegion(region.bounds)}
            className="shrink-0 text-2xs uppercase tracking-label text-dim transition-colors hover:text-text"
          >
            {region.label}
          </button>
        ))}
        <span className="h-2.5 w-px shrink-0 bg-line" aria-hidden="true" />
        <button
          type="button"
          onClick={findMe}
          disabled={locating === "asking"}
          title="Ask this browser for your location and frame the map on it"
          className={`shrink-0 text-2xs uppercase tracking-label transition-colors ${
            here ? "text-text glow" : "text-dim hover:text-text"
          }`}
        >
          {hereLabel}
        </button>
        {zoomedIn && (
          <span className="shrink-0 text-2xs uppercase tracking-label text-text glow">
            &#215;{view.k.toFixed(1)}
          </span>
        )}
      </div>

      {/* A held mark on the filtered place, and a soft one on the feed row
          under the pointer. Both are DOM so the canvas loop stays untouched. */}
      {selectedXY && (
        <svg
          className="pointer-events-none absolute"
          style={{ left: selectedXY[0] - 14, top: selectedXY[1] - 14 }}
          width="28"
          height="28"
          viewBox="0 0 28 28"
          aria-hidden="true"
        >
          <path
            d="M4 10V4h6M18 4h6v6M24 18v6h-6M10 24H4v-6"
            className="stroke-text"
            fill="none"
            strokeWidth="1"
          />
        </svg>
      )}
      {focusXY && (
        <span
          className="seek pointer-events-none absolute h-3.5 w-3.5 rounded-full border border-strike"
          style={{ left: focusXY[0] - 7, top: focusXY[1] - 7 }}
          aria-hidden="true"
        />
      )}

      {/* Where the reader is. A fixed station mark, deliberately unlike the
          strike marks: this one is not weather. */}
      {hereXY && (
        <svg
          className="pointer-events-none absolute"
          style={{ left: hereXY[0] - 11, top: hereXY[1] - 11 }}
          width="22"
          height="22"
          viewBox="0 0 22 22"
          aria-hidden="true"
        >
          <circle cx="11" cy="11" r="7.5" className="stroke-text" fill="none" strokeWidth="1" opacity="0.5" />
          <circle cx="11" cy="11" r="2" className="fill-text" />
        </svg>
      )}

      {cursor && !panning && (
        <>
          <svg
            className="pointer-events-none absolute opacity-70"
            style={{ left: cursor.x - 15, top: cursor.y - 15 }}
            width="30"
            height="30"
            viewBox="0 0 30 30"
            aria-hidden="true"
          >
            <circle cx="15" cy="15" r="5.5" className="stroke-text" fill="none" strokeWidth="1" />
            <path
              d="M15 0v5.5M15 24.5V30M0 15h5.5M24.5 15H30"
              className="stroke-text"
              fill="none"
              strokeWidth="1"
            />
          </svg>
          {/* Fixed corner, not a floating tooltip: the reading should sit still
              while the eye moves, and never cover the cell being read. */}
          <div className="pointer-events-none absolute bottom-3 left-3 max-w-[60%] bg-void/80 px-2 py-1.5 text-2xs uppercase tracking-label unselectable">
            <div className="truncate text-text glow">[ {place ?? "—"} ]</div>
            <div className="mt-0.5 text-dim">
              {coord(cursor.lat, "lat")} {coord(cursor.lon, "lon")}
            </div>
            <div className="mt-0.5 text-dim">
              {count ? `${count.toLocaleString("en-US")} in cell` : "quiet cell"}
            </div>
          </div>
        </>
      )}
      {/* Tracking band drifting up the tube, then the curved glass falloff. */}
      <div className="crt-roll pointer-events-none absolute inset-x-0" />
      <div className="crt-bezel pointer-events-none absolute inset-0 rounded-[14px]" />
      <Ticks />
    </div>
  );
};

// The map is the most expensive thing to render and the least often
// changed: the feed alone would otherwise re-render it eight times a second.
export default memo(WorldMap);
