import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { indexFeatures, findFeature, distanceKm } from "../../lib/geo.js";
import { landAt, LAND_RES } from "../../lib/land.js";
import { readMedium } from "../../lib/theme.js";
import { motion, forecast, surge } from "../../lib/storms.js";
import { PERSISTENCE, DENSITY } from "../../lib/settings.js";
import {
  LAT_LIMIT,
  MAX_K,
  MIN_K,
  clampView,
  fitProjection,
  viewForBounds,
  visibleBounds,
  zoomAbout,
  zoomed,
} from "../../lib/view.js";
import { terminator, subsolar } from "../../lib/sun.js";
import { unfoldProjection, facing } from "../../lib/unfold.js";
import { globeProjection, globeRadius, pointed, rotationFor, turned } from "../../lib/globe.js";
import { paintStars, STAR_STEP } from "../../lib/stars.js";
import capitals from "../../lib/capitals.js";
import frontiers from "../../lib/frontiers.js";
import { fixQuality } from "../../lib/fix.js";
import { stations } from "../../lib/stations.js";
import { tick } from "../../lib/click.js";
import { FIELDS, momentAt, momentFor } from "../../lib/sources.js";
import {
  createFlash,
  REFRESH_MS as FLASH_REFRESH_MS,
  STEP_MS as FLASH_STEP_MS,
  LAG_MS as FLASH_LAG_MS,
} from "../../lib/flash.js";
import Transport from "./transport.jsx";
import { Ticks } from "./crt.jsx";
import GeoData from "../../lib/world.json";

// Dot spacing at world zoom, in pixels on the glass.
//
// This was a distance once — 175km — and a distance is the wrong unit for it.
// What it lands as on screen depends on how many pixels the world was fitted
// into, so one constant drew a 6px array on a desktop tube and a 1.5px one on a
// phone, where the world is a quarter as wide. At that spacing the marks sit
// closer together than they are across: the matrix stops reading as an array of
// sensors and becomes a grey fill with the coastlines guessed out of it.
//
// So it is stated as what it has to be true of, which is the glass, and the
// distance is derived from it per view. That is the direction the dependency
// runs anyway — the array is a property of the display, not of the earth.
const GRID_GAP_PX = 5.5;
// The gap above is right on a desktop tube and too open on a phone. Stating it
// on the glass fixed the marks at a readable size everywhere, but a phone still
// has a quarter of the width to spend them across, so the same spacing buys a
// much coarser outline: the array thins out until the coastline is being
// guessed from a handful of dots rather than drawn by them. Tightened toward
// this at narrow widths, and left alone once there is room for the stated gap.
const GRID_GAP_TIGHT_PX = 2.9;
const GRID_TIGHT_W = 420; // at or under this, the tight gap
// How much tighter the globe runs the matrix than the flat map does.
//
// The sphere is drawn about two and a half times larger than the flat world, so
// closing the gap all the way would mean this much again. It cannot be: the
// globe repaints the matrix on every frame of a turn where the flat map only
// stretches a bitmap to pan, and the repaint is what has to fit in the frame.
// Measured on a 1500×950 tube, that repaint costs 4.2ms at the map's own
// spacing, 7.4ms here, 13ms at twice, and 25ms — half a frame over budget, and
// visibly a drag that stutters — at the full two and a half.
//
// So this is the last value that leaves most of the frame for everything else
// in it, and it is worth about a third more dots along each axis than the map
// gets, which is the difference between a coastline drawn and one guessed at.
const GLOBE_GRID = 1.4;
const GRID_LOOSE_W = 900; // at or over this, the stated one

function gridGap(width) {
  const t = (width - GRID_TIGHT_W) / (GRID_LOOSE_W - GRID_TIGHT_W);
  const eased = Math.min(1, Math.max(0, t));
  return GRID_GAP_TIGHT_PX + (GRID_GAP_PX - GRID_GAP_TIGHT_PX) * eased;
}
// How fast that spacing tightens as you close in. Dividing by k outright holds
// the gap constant, which is right over an ocean and wrong once the whole tube
// is land: a continent fills in as a solid field. At k^0.75 the gap instead
// opens as k^0.25, roughly 5px to 14px across the zoom range, so the array
// coarsens as you approach and stays legible as an array.
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
// Rings below this are not drawn, and therefore not clickable. Both the
// renderer and the hit test read it, because a cell you cannot see is a cell
// you cannot have meant to pick.
const STORM_MIN_PX = 3;
// The second ring a surging cell wears. Far enough out to read as two rings at
// the smallest cell that gets drawn at all, close enough that it stays the
// same cell rather than becoming a halo around it.
const JUMP_GAP_PX = 3;
// Breathing room around a label when it is tested against its neighbours. Two
// readouts that merely fail to overlap still read as one run of digits, so the
// box is a little larger than the text in it.
const LABEL_PAD = 2;
// The trail holds a centroid every 20s for an hour: 180 points, far more than
// a track needs to read as a curve, and each one costs a projection every
// frame. Subsampled to this, a point every couple of minutes.
const TRAIL_POINTS = 36;
const TRAIL_TIERS = 3; // alpha steps along the trail; the taper is what says which end is now
// A cell doing 45 km/h covers 19 km in the whole 25-minute trail: under one
// pixel at world zoom, where there are also the most cells on screen. Below
// this the track is a smudge on top of its own ring, so it isn't drawn at
// all, which is also what keeps the cost off the zoomed-out view.
const TRAIL_MIN_PX = 8;
const FORECAST_S = 3600; // how far ahead the projected track runs (1 h)
// The terminator moves 15° an hour, a fraction of a pixel a minute at world
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
// #lon/lat/k: where the tube is pointed, so a view can be handed to someone.
const HASH_RE = /^#(-?\d+(?:\.\d+)?)\/(-?\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)$/;

const WHEEL_K = 0.0016; // wheel delta to zoom exponent

// ── Crossing between the two modes ─────────────────────────────────────────
//
// The map stops at the whole world and the globe has no zoom at all, so at
// either of those rails there is zoom the reader asked for and the view cannot
// give. That refused effort is what crosses the modes: push further out than
// the flat map goes and it rolls up into the planet, push further in than the
// globe has and it unrolls back into the map. The gesture that would have kept
// zooming is the one that means "the other shape", which is the only thing
// left for it to mean.
//
// Counted in log units. `zoomAbout` multiplies by a factor, so a wheel notch
// and a pinch ratio are the same currency once logged, and one threshold is
// honest for both.
const SWAP_PUSH = 0.8; // a little over one doubling of zoom that could not happen
// How small the planet may be pushed. Far enough back to see the whole of it
// with sky around it, and no further: past this the world is a marble in a
// black tube and the readings on it stop being readable.
const GLOBE_MIN_K = 0.55;
// Effort is spent, not stored. A rail leant on and let go should not fire the
// next time it is touched, half a minute later.
const SWAP_DECAY_MS = 320;

/**
 * Add refused zoom to `store`, and say whether that is enough to cross.
 *
 * Firing empties it: the swap that follows takes UNFOLD_MS, and a wheel still
 * turning through the end of it must not arrive with the threshold already met
 * and flip straight back.
 */
function spend(store, amount, now) {
  if (now - store.at > SWAP_DECAY_MS) store.amount = 0;
  store.at = now;
  store.amount += amount;
  if (store.amount < SWAP_PUSH) return false;
  store.amount = 0;
  return true;
}
// Frontiers are an orientation aid, not geography, and they are held to the
// band where they are one. Below, the map is a planet and a political overlay
// is noise on it. Above, the boundary data gives out: it runs 62 km between
// vertices at the median, a third of the tube at maximum zoom, and a river
// border drawn as straight chords is worse than no border at all.
const FRONTIER_FADE = [1.8, 3.2, 12, 18]; // k: appearing, full, holding, gone

// ── The unfold ─────────────────────────────────────────────────────────────
//
// The boot screen's planet is this map, drawn through a projection that has not
// finished becoming Mercator yet. See `lib/unfold.js` for why that is one
// object rather than two.

// Segments a 148° graticule line is cut into while it is still an arc.
const GRATICULE_ARC = 24;
// How long the world takes to come apart, and the tilt and turn it does it
// from. The turn is slow because a planet is: the whole of it is a little over
// a third of a revolution, most of which happens under the boot readout.
const UNFOLD_MS = 1150;
const GLOBE_TILT = 16;
const GLOBE_LON = 10;
const GLOBE_SWEEP = 110;
const GLOBE_SPIN_MS = 1520;
const GLOBE_DRIFT_PER_S = 14;
// How long the globe takes to stop drifting once the readout is done with the
// screen. Only the globe mode uses it: the flat map's planet does not stop, it
// unrolls, and the drift is carried into the unfold and lost there.
const GLOBE_STOP_MS = 900;

/**
 * Where the globe comes to rest, and therefore where it sets off from.
 *
 * The flat map's planet starts on Africa and Europe because that is the most
 * legible thing the matrix can draw and it is only ever seen in passing. A
 * globe you are left sitting on is a different question: it has to be pointed
 * at the part of the world worth watching, and that is the Atlantic. Centred
 * there, Europe and North America are both on the disk at once — between them
 * most of what this network hears — with the tropics and west Africa below.
 *
 * The start is derived from it rather than chosen. The throw is the same one
 * the unfold uses, so its length is already fixed, and the only free end is the
 * one it begins at: set it here and the planet arrives over the Pacific, sweeps
 * east across the Americas, and settles looking at the ocean between them.
 */
const GLOBE_HOME = [-40, 32];
// What the planet coasts through while the drift is being eased off, which is
// the average of the drift over the stop — the rate falls evenly to nothing.
const GLOBE_COAST = (GLOBE_DRIFT_PER_S * (GLOBE_STOP_MS / 1000)) / 2;
const GLOBE_FROM = GLOBE_HOME[0] - GLOBE_SWEEP - GLOBE_COAST;
// Where the globe stops shading night onto the dots, easing out so that the
// flat map's wash arrives onto an evenly lit world rather than trading places
// with a second treatment mid-frame.
const HANDOVER = 0.72;
// Where the far side has finished arriving. Earlier than the shading leaves, so
// the two are never moving at once.
const FACING = 0.55;
// The sky comes up after the world has finished flattening rather than with it.
// The cloud field is fetched, and on a cold cache its tiles land in whatever
// order the network returns them, so drawn at full strength the moment the map
// arrives it appears as a set of rectangles snapping in one by one. Faded up,
// the same arrivals read as weather resolving.
const SKY_FADE_MS = 900;

// Zero slope at both ends, so nothing starts or stops with a visible kick.
const glide = (t) => 0.5 - Math.cos(Math.PI * Math.max(0, Math.min(1, t))) / 2;
const ramp = (t, from, to) => glide((t - from) / (to - from));

// Degrees the globe has turned since the screen appeared. A throw rather than a
// loop: it leaves rest, and settles to a drift it never quite stops at, because
// a planet frozen under a line still reading "fetching..." looks like a hang.
const spun = (ms) =>
  ms >= GLOBE_SPIN_MS
    ? GLOBE_SWEEP + (GLOBE_DRIFT_PER_S * (ms - GLOBE_SPIN_MS)) / 1000
    : GLOBE_SWEEP * glide(ms / GLOBE_SPIN_MS);

/** Whether the sun is above the horizon at a point, for a given subsolar one. */
function daylit(lon, lat, sun) {
  const RAD = Math.PI / 180;
  return (
    Math.sin(sun.decl * RAD) * Math.sin(lat * RAD) +
      Math.cos(sun.decl * RAD) * Math.cos(lat * RAD) * Math.cos((lon - sun.lon) * RAD) >
    0
  );
}
const FRONTIER_STEP_PX = 5; // dot spacing along a border

function frontierFade(k) {
  const [appear, full, hold, gone] = FRONTIER_FADE;
  if (k <= appear || k >= gone) return 0;
  if (k < full) return (k - appear) / (full - appear);
  if (k <= hold) return 1;
  return (gone - k) / (gone - hold);
}

// The weakest fix still draws at this much of full strength. High on purpose:
// the difference should be felt across a storm rather than read off a single
// mark, and a strike is never so poorly located as to be worth hiding.
const FIX_FLOOR = 0.72;

// The lines a strike throws back to the detectors that fixed it. Brief, because
// they answer a question asked at the moment of arrival (which stations placed
// this, and from what side), and an answer left on screen becomes clutter.
const LINK_MS = 900;
const LINK_ALPHA = 0.16;

const SETTLE_MS = 160; // quiet time before the land matrix is rebuilt
// The same wait again, on top of the settle that produced the view: the land
// matrix costs this page some of its own milliseconds, the cloud field costs
// somebody else a request, so it wants one more beat of proof that the map has
// really stopped. It was more than twice this, which put two thirds of a second
// between the map coming to rest and the request even leaving.
const IR_SETTLE_MS = 160;

// `?tiles` in the address puts the field's own state on the glass: the tile
// grid, and what each tile is being drawn from. Read once, because it is a
// diagnostic rather than a setting and nothing should re-render for it.
//
// It is here because every failure this layer can have looks identical from the
// outside. A tile that never arrived, one covered by a coarse ancestor, one
// missing a satellite, and a sky that is genuinely clear all draw as dark
// ground, and no amount of looking at a screenshot separates them.
const TILE_DEBUG =
  typeof window !== "undefined" && new URLSearchParams(window.location.search).has("tiles");

const DRAG_SLOP = 4; // pixels of movement that turn a click into a drag
const HERE_SPAN = 20; // degrees framed around a located reader: regional, not a street

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
// for the visible extent only, at a spacing that follows the zoom, so the
// matrix stays the same density on screen however far in you go, and the cost
// stays bounded however far in that is.
// A handful of built matrices, kept by the view that produced them. Zooming out
// clamps to the same bounds every time, so the world view is asked for over and
// over across a session and is the one worth never building twice. Held by
// reference and never mutated; a few thousand pairs each.
const gridCache = new Map();
const GRID_CACHE_MAX = 4;

function buildGrid(bounds, stepKm) {
  // Rounded, because a settle lands on floating-point bounds that differ in the
  // last place from the identical view a minute ago, and a key that precise
  // would never hit.
  const key = `${bounds.map((n) => n.toFixed(3)).join(",")}@${stepKm.toFixed(3)}`;
  const hit = gridCache.get(key);
  if (hit) return hit;

  const land = buildMatrix(bounds, stepKm);
  // Oldest out first: Map iterates in insertion order.
  if (gridCache.size >= GRID_CACHE_MAX) gridCache.delete(gridCache.keys().next().value);
  gridCache.set(key, land);
  return land;
}

// Where the baked mask stops being the better answer.
//
// A mask cell is a quarter degree, 28 km at the equator. While the matrix is
// sampled more coarsely than that, every dot falls in its own cell and the
// table is simply the polygon answer with the work already done: measured over
// the views this map sits at, the two matrices differ by at most 0.10% of their
// dots. Sampled finer, several dots share a cell and the coastline quantises
// into 28 km blocks, which is a visible fault rather than a saving.
//
// That handover lands where it should. The grid is built for the visible extent
// only, so the far side of it — zoomed in past roughly k=10 — is the end where
// the polygons were never expensive: a city view asks 144 questions and takes
// 0.2ms, against 21,333 and 33ms for the world.
const MASK_MIN_DEG = LAND_RES;

function buildMatrix([west, south, east, north], stepKm) {
  const degToRad = Math.PI / 180;
  const kmToDeg = (stepKm / (2 * Math.PI * EARTH_RADIUS_KM)) * 360;

  // Latitude is the axis that steps at the stated gap; longitude only ever
  // opens out from it by 1/cos, so this is the finer of the two and the one
  // the handover has to be decided on.
  const masked = kmToDeg >= MASK_MIN_DEG;
  if (!masked) landIndex = landIndex || indexFeatures(GeoData.features);

  const land = [];
  for (let lat = south; lat <= north; lat += kmToDeg) {
    const cosLat = Math.abs(Math.cos(lat * degToRad));
    const step = cosLat > 1e-6 ? kmToDeg / cosLat : 360;
    for (let lon = west; lon <= east; lon += step) {
      // Ocean points were previously drawn black on black; only land is kept.
      const land_ = masked ? landAt(lon, lat) : findFeature(landIndex, lon, lat);
      if (land_) land.push([lon, lat]);
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
// couple of degrees east of it, which are named -179 and -178; without this
// the search falls off the end of the world and the label never lights.
const wrapLon = (lon) => ((((lon + 180) % 360) + 360) % 360) - 180;

/** 40.31°N rather than 40.31: a bearing reads faster than a signed number. */
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

// How many device pixels the tube is drawn at, per pixel of layout.
//
// The screen's own answer, up to a point. Past two the marks this map is made
// of stop gaining anything — a dot is 1.8px of glass and a hairline is one, and
// neither is carrying detail a third sample could resolve — while everything
// that costs area goes on getting more expensive as its square. A phone at
// three is drawing 2.25 times the pixels of the same tube at two, four times
// over per frame (the void, the sky, the matrix, the burn-in), for a picture
// that is a dot matrix on black.
//
// It is the globe that made this worth stating. The flat map pans by stretching
// a bitmap it already has, so its area is paid once per settle; a rotation has
// no such delta and repaints, so on the sphere the whole of that area is a
// per-frame cost and the density is the only term in it anyone can choose.
const MAX_DENSITY = 2;
const density = () => Math.min(MAX_DENSITY, window.devicePixelRatio || 1);

/**
 * A layer handed back, and its pixels with it.
 *
 * Dropping the reference is not enough on a phone. A tube's worth of backing
 * store is megabytes, it is held outside the JavaScript heap where nothing the
 * collector is measuring can see it, and a browser that has run past its own
 * canvas budget deals with it by dropping backing stores that are still being
 * drawn — which is a layer that goes blank rather than an error anybody can
 * catch. Sized to nothing first, the memory goes when this is called rather
 * than whenever the collector next feels like it.
 *
 * Takes either a canvas or a layer holding one, and always returns null, so the
 * call sites read as the assignment they are.
 */
function release(held) {
  const canvas = held?.canvas ?? held;
  if (canvas) {
    canvas.width = 0;
    canvas.height = 0;
  }
  return null;
}

function scaleCanvas(canvas, width, height) {
  const dpr = density();
  canvas.width = Math.max(1, Math.floor(width * dpr));
  canvas.height = Math.max(1, Math.floor(height * dpr));
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

/**
 * Two layers over a land grid:
 *   history: every cell that has ever fired, dim, cumulative (the burn-in)
 *   live:    strikes from the last few seconds, white, decaying (the beam)
 *
 * Both layers are rasterised against the *settled* view and then drawn through
 * the delta to the live one, so a drag moves a finished bitmap instead of
 * re-plotting twenty thousand points a frame. The live layer is projected per
 * frame: it is small, and it must be exact.
 *
 * `strikeQueue` is a ref the parent pushes into; the animation loop drains it.
 * Strikes therefore reach the map the instant they arrive, without a render.
 */
/**
 * One map setting, cycled in place.
 *
 * These live on the tube rather than in the configuration because they are the
 * ones actually used while watching: which field is behind the map, how much a
 * storm cell carries, how far the burn-in reaches. Everything left in the
 * panel is set once and forgotten.
 *
 * A cycle rather than a row of choices because it has to fit beside the region
 * presets on a phone. It shows what it is on, which is the only state worth
 * seeing, and the key panel says what the other stops are.
 */
function Cycle({ label, value, options, onChange, title }) {
  const at = Math.max(0, options.indexOf(value));
  return (
    <button
      type="button"
      title={title}
      onClick={() => onChange(options[(at + 1) % options.length])}
      className="shrink-0 text-2xs uppercase tracking-label text-dim transition-colors hover:text-text active:text-text touch:px-1.5 touch:py-2.5"
    >
      {label} <span className="text-text glow">{value}</span>
    </button>
  );
}

/**
 * Land, daylight and graticule — onto whatever context, through whatever
 * projection.
 *
 * Two callers. The settle paints it into an offscreen bitmap through the map's
 * own Mercator, once, and the tube reuses that bitmap until the view moves. The
 * unfold paints it straight onto the tube, every frame, through a projection
 * that is still half a globe. One painter rather than two, because the frame
 * where the second hands over to the first has to be the same picture twice,
 * and two painters drift apart in a week.
 *
 * `sphere` is everything the globe needs and the flat map has no use for: which
 * face of the planet a dot is on, and how much of the map's own treatment has
 * arrived yet. Absent, this is exactly the layer it has always been.
 */
function paintLand(
  ctx,
  { projection, grid, palette, graticule, daylight, borders, theme, sunAt, width, height, frontierK, sphere }
) {
  // Which side of the terminator gets shaded is a property of the medium,
  // not a colour choice. On a tube the lit hemisphere is lit: light is
  // added. On paper night is inked: ink is deposited, and an unmarked sheet
  // is daylight. Shading the same side in both would read as a fault in one.
  const lit = theme === "dark";

  // The night wash is a polygon closed against the left and right edges of the
  // map, and a flat map is the only thing it can be closed against. Anywhere
  // else those two edges are not one meridian: the outline crosses itself and
  // the fill lands on the far side of its own edge, washing night over day. It
  // is worth recording how little it takes, because it looks like a curvature
  // problem and is not — at t = 0.99, one degree of rotation short of home, the
  // wash is still fully inverted, and closing it against the meridian actually
  // at the edge only moves the failure around.
  //
  // So the globe does not attempt it. Night is carried by the dots for the
  // whole unfold and the wash begins at the flat map, where it has always
  // worked. What that costs is night over open water, which has no dots to
  // carry it: on the globe the terminator is a boundary in the brightness of
  // the land, and the sea keeps its own counsel until the map arrives.
  const wash = daylight && !sphere ? 1 : 0;
  const shade = sphere ? sphere.shade : 0;

  if (wash > 0) {
    const { points, nightEdge } = terminator(new Date(sunAt), LAT_LIMIT);
    const edge = lit ? -nightEdge : nightEdge;

    ctx.beginPath();
    let started = false;
    for (const point of points) {
      const xy = projection(point);
      if (!xy || !isFinite(xy[0]) || !isFinite(xy[1])) continue;
      if (started) ctx.lineTo(xy[0], xy[1]);
      else {
        ctx.moveTo(xy[0], xy[1]);
        started = true;
      }
    }
    const close = [projection([180, edge]), projection([-180, edge])];
    if (started && close.every((xy) => xy && isFinite(xy[0]) && isFinite(xy[1]))) {
      ctx.lineTo(close[0][0], close[0][1]);
      ctx.lineTo(close[1][0], close[1][1]);
      ctx.closePath();
      ctx.fillStyle = lit ? palette.land : palette.text;
      // The wash is a property of the terminator, not of the land token, so
      // the tube's alpha absorbs that token's lift and leaves daylight where
      // it already sat.
      ctx.globalAlpha = (lit ? 0.1 : 0.07) * wash;
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  // Scope graticule: 30° meridians and parallels, under the land matrix.
  if (graticule) {
    ctx.strokeStyle = palette.line;
    ctx.lineWidth = 1;
    ctx.beginPath();
    if (sphere) {
      // A meridian on a sphere is an arc, and two points cannot describe one:
      // drawn end to end it comes out as the chord, cutting straight through
      // the planet. Sampled along its length instead. On the flat map the same
      // sampling would draw the same straight line the pair of endpoints does,
      // so this stays on the globe's side of the branch and the map keeps the
      // snapped, two-point version it was tuned with.
      const arc = (from, to) => {
        let moved = false;
        for (let i = 0; i <= GRATICULE_ARC; i++) {
          const at = i / GRATICULE_ARC;
          const xy = projection([
            from[0] + (to[0] - from[0]) * at,
            from[1] + (to[1] - from[1]) * at,
          ]);
          if (!xy || !isFinite(xy[0]) || !isFinite(xy[1])) {
            moved = false;
            continue;
          }
          if (moved) ctx.lineTo(xy[0], xy[1]);
          else {
            ctx.moveTo(xy[0], xy[1]);
            moved = true;
          }
        }
      };
      for (let lon = -180; lon <= 180; lon += GRATICULE_STEP) {
        arc([lon, LAT_LIMIT], [lon, -LAT_LIMIT]);
      }
      for (let lat = -60; lat <= 60; lat += GRATICULE_STEP) arc([-180, lat], [180, lat]);
    } else {
      for (let lon = -180; lon <= 180; lon += GRATICULE_STEP) {
        const top = projection([lon, LAT_LIMIT]);
        const bottom = projection([lon, -LAT_LIMIT]);
        if (!top || !bottom) continue;
        ctx.moveTo(Math.round(top[0]) + 0.5, top[1]);
        ctx.lineTo(Math.round(bottom[0]) + 0.5, bottom[1]);
      }
      for (let lat = -60; lat <= 60; lat += GRATICULE_STEP) {
        const left = projection([-180, lat]);
        const right = projection([180, lat]);
        if (!left || !right) continue;
        ctx.moveTo(left[0], Math.round(left[1]) + 0.5);
        ctx.lineTo(right[0], Math.round(right[1]) + 0.5);
      }
    }
    ctx.stroke();
  }

  // A 1.8px mark at a fractional coordinate is antialiased across three
  // device pixels, and a dot spread that thin loses most of the contrast the
  // token was given. Snapped to the device grid instead, every dot lands at
  // full weight, worth more here than any further lift of the colour.
  const dpr = density();
  const dot = Math.max(2, Math.round(1.8 * dpr));
  const deviceW = width * dpr;
  const deviceH = height * dpr;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  const mark = (x, y) => {
    if (x < -dot || y < -dot || x > deviceW + dot || y > deviceH + dot) return;
    ctx.fillRect(Math.round(x - dot / 2), Math.round(y - dot / 2), dot, dot);
  };

  ctx.fillStyle = palette.land;
  if (!sphere) {
    for (const point of grid) {
      const xy = projection(point);
      if (!xy || !isFinite(xy[0]) || !isFinite(xy[1])) continue;
      mark(xy[0] * dpr, xy[1] * dpr);
    }
  } else {
    // Sorted into passes rather than shaded a dot at a time: an alpha written
    // per dot is four thousand state changes a frame, and the answer only ever
    // takes four values.
    const sun = subsolar(new Date(sunAt));
    // The globe at rest has no far side to draw — the projection refuses those
    // points and `back` is zero, so both of the far passes would be laid down
    // at no weight at all. Sorted out of the work rather than out of the
    // picture: half the planet is behind the planet, and asking whether each
    // of those dots is also in daylight is half the trigonometry in a turn.
    // The unfold is the caller that does want them, and it says so with a
    // `back` above zero.
    const hidden = sphere.back <= 0;
    // A dot on the near side has already been asked which side it is on, and
    // the globe's own projection asks again before it will answer — it is what
    // culls the far side. Where the answer is known, the cull can be skipped
    // and the sphere addressed directly.
    const put = hidden && projection.plain ? projection.plain : projection;
    const passes = [[], [], [], []]; // near/far × day/night
    for (const point of grid) {
      const near = facing(point[0], point[1], sphere.rotate) ? 0 : 2;
      if (near && hidden) continue;
      const night = daylit(point[0], point[1], sun) ? 0 : 1;
      passes[near + night].push(point);
    }
    // A dot can only be taken away from, never added to — it is already the
    // full weight of its token — so which half of the world gets faded is a
    // property of the medium, exactly as it is for the wash above and for the
    // same reason. On a tube, fading a dot darkens it: night is the half that
    // gives way. On paper, fading a dot lightens it toward the sheet, so
    // dimming night there would make night the brighter half; daylight is the
    // half that gives way instead, and an unmarked sheet goes on meaning day.
    const faded = 1 - 0.45 * shade;
    const gives = (pass) => (lit ? pass % 2 === 1 : pass % 2 === 0);
    for (let pass = 0; pass < 4; pass++) {
      if (!passes[pass].length) continue;
      ctx.globalAlpha = (pass < 2 ? 1 : sphere.back) * (gives(pass) ? faded : 1);
      for (const point of passes[pass]) {
        const xy = put(point);
        if (!xy || !isFinite(xy[0]) || !isFinite(xy[1])) continue;
        mark(xy[0] * dpr, xy[1] * dpr);
      }
    }
    ctx.globalAlpha = 1;
  }

  // Frontiers: the same matrix, run tighter and a step brighter, so a border
  // reads as a denser row of the dots already there rather than as a line
  // laid over them. Land is the field; this is a mark on it.
  const fade = borders ? frontierFade(frontierK) : 0;
  if (fade > 0) {
    ctx.fillStyle = palette.dim;
    ctx.globalAlpha = fade;
    const step = FRONTIER_STEP_PX * dpr;
    for (const path of frontiers()) {
      // Distance walked since the last dot, carried from one segment into the
      // next: spacing that restarts at every vertex drops a dot on every
      // vertex, and a border is mostly vertices.
      let carry = 0;
      let previous = null;
      for (const point of path) {
        const xy = projection(point);
        const next = xy && isFinite(xy[0]) && isFinite(xy[1]) ? [xy[0] * dpr, xy[1] * dpr] : null;
        if (!next) {
          previous = null;
          continue;
        }
        if (previous) {
          const dx = next[0] - previous[0];
          const dy = next[1] - previous[1];
          const span = Math.hypot(dx, dy);
          // A segment that leaps the whole tube is the projection wrapping at
          // the date line, not a border.
          if (span > deviceW) {
            previous = next;
            carry = 0;
            continue;
          }
          let walked = step - carry;
          if (walked > span) carry += span;
          else {
            for (; walked <= span; walked += step) {
              mark(previous[0] + (dx * walked) / span, previous[1] + (dy * walked) / span);
            }
            carry = span - (walked - step);
          }
        }
        previous = next;
      }
    }
    ctx.globalAlpha = 1;
  }

  ctx.restore();
}

// Which capitals the weather is currently lighting, and how brightly.
//
// A property of the burn-in alone: which cells are firing, and how near a
// capital they are. Neither term knows where the map is pointed, and the answer
// changes when App re-bins — twice a second — rather than when the view moves.
//
// It used to be worked out inside the paint, which was affordable while the
// paint happened on a settle: a hundred-odd cell lookups for each of 138
// capitals, once every time the map stopped. The globe paints per turn, and the
// same scan then runs on every frame of a drag for an answer that has not moved
// since the last bin. Held here instead, keyed on the array App hands over,
// which is the signature for the whole layer everywhere else on this map.
let litAt = null;
let litNames = [];

function litCapitals(bins) {
  if (bins === litAt) return litNames;
  litAt = bins;
  litNames = [];

  // Cell key → how much life its burn has left. Keyed exactly as App bins, so
  // lighting a label is a handful of lookups rather than a scan over every
  // burning cell on the planet for all 138 capitals.
  const burning = new Map();
  for (const bin of bins) {
    if (bin.count >= MIN_BURN) burning.set(`${bin.lon},${bin.lat}`, bin.fade);
  }
  if (!burning.size) return litNames;

  for (const capital of capitals) {
    const cellLon = Math.floor(capital.lon);
    const cellLat = Math.floor(capital.lat);
    // The box is only a prefilter, and it widens toward the poles so that it
    // always contains the circle it is standing in for.
    const spanLat = Math.ceil(CAPITAL_NEAR_KM / KM_PER_DEG);
    const spanLon = Math.ceil(
      CAPITAL_NEAR_KM / (KM_PER_DEG * Math.max(0.08, Math.cos((capital.lat * Math.PI) / 180)))
    );

    let life = 0;
    for (let dx = -spanLon; dx <= spanLon; dx++) {
      for (let dy = -spanLat; dy <= spanLat; dy++) {
        const fade = burning.get(`${wrapLon(cellLon + dx)},${cellLat + dy}`);
        // Nothing there, or nothing that could brighten this label; in either
        // case the distance is not worth computing.
        if (!(fade > life)) continue;
        // Cell centre stands for the cell. The bins are a degree across, so the
        // threshold is inherently fuzzy at that scale; measuring to the corner
        // would be false precision on a fuzzy quantity.
        const km = distanceKm(capital.lon, capital.lat, cellLon + dx + 0.5, cellLat + dy + 0.5);
        if (km <= CAPITAL_NEAR_KM) life = fade;
      }
    }
    if (life > 0) litNames.push({ capital, life });
  }
  return litNames;
}

/**
 * The burn-in and the names it lights, onto whatever context, through whatever
 * projection.
 *
 * Two callers, for the same reason `paintLand` has two. The flat map paints it
 * into a bitmap once per settle and stretches that until the view moves again;
 * the globe paints it per turn, because a rotation is not a transform a bitmap
 * can be stretched by. One painter, so the two cannot drift.
 *
 * Returns where the names ended up, in this context's own coordinates. The live
 * loop needs them: the storm readouts are drawn on a different canvas at a
 * different cadence, and without this they collide freely — which is what put a
 * cell's figures through the middle of "Washington".
 */
function paintHistory(
  ctx,
  { projection, bins, palette, burnFull, bounds, capitals: named, width, height }
) {
  ctx.lineWidth = 1;
  ctx.fillStyle = palette.text;
  ctx.strokeStyle = palette.text;

  for (const bin of bins) {
    // One strike is a flash, not a mark. A cell has to be worked before it
    // burns in, which is what keeps single strikes from littering the map.
    if (bin.count < MIN_BURN) continue;

    // Bins are named by their south-west corner, so the cell runs from
    // [lon, lat] to one BIN_SIZE north-east of it.
    const sw = projection([bin.lon, bin.lat]);
    const ne = projection([bin.lon + BIN_SIZE, bin.lat + BIN_SIZE]);
    if (!sw || !ne || !isFinite(sw[0]) || !isFinite(sw[1]) || !isFinite(ne[0]) || !isFinite(ne[1])) {
      continue;
    }

    const w = ne[0] - sw[0];
    const h = sw[1] - ne[1];
    // Ease the fade so a cell holds its mark, then lets go near the end.
    const life = bin.fade * bin.fade;
    const heat = Math.min(1, Math.log10(bin.count) / burnFull);

    // History is a soft round smudge. A filled rectangle has hard edges and
    // reads as interface furniture rather than as accumulated density.
    ctx.globalAlpha = heat * 0.22 * life;
    ctx.beginPath();
    ctx.arc(sw[0] + w / 2, ne[1] + h / 2, Math.max(1.5, Math.min(Math.abs(w), Math.abs(h)) * 0.55), 0, Math.PI * 2);
    ctx.fill();

    // Bounds mark a cell that is firing right now, so they clear a few
    // seconds after it goes quiet instead of littering the map.
    //
    // Corner ticks rather than a closed box: the same bezel the panels wear.
    // A rectangle ruled around a soft smudge reads as interface laid over the
    // weather, and four marks fix the same extent while leaving the cell
    // itself uncovered.
    if (bounds && bin.hot && w >= 6 && h >= 6) {
      ctx.globalAlpha = 0.18 + heat * 0.34;
      const x0 = Math.round(sw[0]) + 0.5;
      const y0 = Math.round(ne[1]) + 0.5;
      const x1 = x0 + Math.round(w);
      const y1 = y0 + Math.round(h);
      const arm = Math.max(2, Math.min(5, Math.round(Math.min(w, h) * 0.26)));
      ctx.beginPath();
      for (const [cx, sx] of [[x0, 1], [x1, -1]]) {
        for (const [cy, sy] of [[y0, 1], [y1, -1]]) {
          ctx.moveTo(cx + sx * arm, cy);
          ctx.lineTo(cx, cy);
          ctx.lineTo(cx, cy + sy * arm);
        }
      }
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;

  // Capitals, lit by the weather rather than drawn as furniture.
  //
  // A permanent label set competes with the strikes for the same eye, and
  // the map is not an atlas: the only moment a place name earns its space
  // is when something is happening there and you need to know where "there"
  // is. So a capital surfaces when a cell near it is burning and fades with
  // that burn, on the same four-minute decay as the smudge underneath it.
  // A quiet map carries no names at all, which is the point: pointing at it
  // already names whatever is under the cursor, in the corner, on demand.
  //
  // Placed in prominence order and collision-culled, so a squall over the
  // Low Countries lights Brussels or Amsterdam, not both on top of each
  // other. Anything overlapping a label already placed is simply dropped.
  const placed = [];
  if (!named || !bins.length) return placed;

  const lit = litCapitals(bins);
  if (!lit.length) return placed;

  ctx.font = '10px "IBM Plex Mono", ui-monospace, monospace';
  ctx.textBaseline = "middle";
  // Knocked out of the background before being drawn: a label over the
  // land matrix is text on a field of dots at nearly its own weight, and
  // no amount of contrast fixes that; the dots have to go first.
  ctx.strokeStyle = palette.void;
  ctx.fillStyle = palette.void;
  ctx.lineJoin = "round";
  ctx.miterLimit = 2;

  for (const { capital, life } of lit) {
    // Off the tube. On the globe it is also where the far side goes: a point
    // behind the planet comes back from the projection as no point at all.
    const xy = projection([capital.lon, capital.lat]);
    if (!xy || !isFinite(xy[0]) || !isFinite(xy[1])) continue;
    const [x, y] = xy;
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
  return placed;
}

const WorldMap = ({
  bins,
  storms,
  strikeQueue,
  tube,
  theme,
  settings,
  summary,
  lost,
  paletteKey,
  onConfig,
  replay,
  history,
  span,
  onSeek,
  locate,
  focus,
  selection,
  here,
  onHere,
  onSelect,
  onSetting,
  unfolding,
}) => {
  const containerRef = useRef(null);
  const screenRef = useRef(null);
  const lastKnock = useRef(0);
  const canvasRef = useRef(null);
  // The tube itself, handed back up so the frame can be saved as a picture. A
  // ref rather than a callback for the same reason `strikeQueue` is one: it is
  // the element, it does not change, and nothing about it should cost a render.
  useEffect(() => {
    if (tube) tube.current = canvasRef.current;
  }, [tube]);
  const landLayer = useRef(null);
  const historyLayer = useRef(null);
  const particles = useRef([]);
  const recentHits = useRef(new Map());
  const { width, height } = useElementSize(containerRef);

  // Re-resolved on theme change: the stylesheet owns the values. `paletteKey`
  // is in the dependencies because a customised palette changes those values
  // without changing anything React can see: the tokens moved in the DOM, and
  // this is the only signal that they did.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const { palette, composite } = useMemo(() => readMedium(theme), [theme, paletteKey]);
  const persistenceMs = PERSISTENCE[settings.persistence] ?? PERSISTENCE.normal;
  // Where the burn-in's heat scale tops out, as a power of ten of the strike
  // count in a cell. A hundred in four minutes is an extraordinary cell and the
  // scale is built around that; a hundred in an hour is an ordinary one, and
  // held at the same ceiling every cell worth looking at would clip to solid
  // white together and the layer would stop saying anything. So the ceiling
  // rides the window: fifteen times the span, fifteen times the count.
  const burnFull = Math.log10(100 * ((DENSITY[settings.density] ?? DENSITY["4m"]) / DENSITY["4m"]));

  const base = useMemo(
    () => (width && height ? fitProjection(width, height) : null),
    [width, height]
  );

  // The live view, and the one the offscreen layers were last drawn for.
  const [view, setView] = useState({ k: 1, x: 0, y: 0 });
  const [settled, setSettled] = useState({ k: 1, x: 0, y: 0 });
  const viewRef = useRef(view);
  viewRef.current = view;

  // ── The globe ────────────────────────────────────────────────────────────
  //
  // A mode rather than a view: there is no k and no pan, only where the planet
  // is pointed. Held apart from `view` for that reason — a rotation is not a
  // screen transform, and the moment the two share a state one of them is lying
  // about what it means. Switching modes leaves the other's state where it was,
  // so going out to the globe and back comes home to the same map.
  const spinning = settings.globe;
  // Opened on the globe, the planet starts back at the top of its throw; opened
  // on the map and sent here later, there is no throw and it is simply home.
  const [spin, setSpin] = useState(() =>
    settings.globe ? [GLOBE_FROM, GLOBE_HOME[1]] : [...GLOBE_HOME]
  );
  const spinRef = useRef(spin);
  spinRef.current = spin;
  // The wheel and the key bindings are bound once and never rebound, so they
  // cannot close over this: they have to ask.
  const spinningRef = useRef(spinning);
  spinningRef.current = spinning;
  // Asked for the same reason, from the same places: the frame coalescer below
  // is built once and outlives any particular render's props.
  const onSettingRef = useRef(onSetting);
  onSettingRef.current = onSetting;

  // How much of the tube the planet takes.
  //
  // One is as large as the glass will hold, which is the size the unfold hands
  // over at and the size the mode always opens at. Below it the reader has
  // pushed the world away to stand further off it — the one thing zoom can
  // still honestly mean here. There is deliberately nothing above one: the
  // globe is drawn from a matrix built for the whole flat world at k = 1, and
  // a planet drawn larger than that is a planet asking the matrix for detail
  // nobody put in it.
  const [globeK, setGlobeK] = useState(1);
  const globeKRef = useRef(globeK);
  globeKRef.current = globeK;

  const globe = useMemo(
    () => (spinning && width && height ? globeProjection(width, height, spin, globeK) : null),
    [spinning, width, height, spin, globeK]
  );

  // Everything downstream reads one projection and does not learn which it is.
  // The globe answers `invert`, and answers a point behind the planet the way
  // Mercator answers a pole — with something that is not a finite number, which
  // is the guard every caller here already makes.
  const projection = useMemo(() => globe ?? zoomed(base, view), [globe, base, view]);
  // The one thing the globe does not take over: what the offscreen bitmaps were
  // drawn for. It has none — it paints straight onto the tube, per turn — but
  // the land matrix and the tile pyramid are still built from the flat world at
  // k = 1, which is exactly the ground a globe covers.
  const layerProjection = useMemo(() => zoomed(base, settled), [base, settled]);

  // The render loop reads these rather than closing over them. They change on
  // every frame of a drag, and restarting the loop each time would reallocate
  // the canvas backing store sixty times a second.
  const projectionRef = useRef(projection);
  const stormsRef = useRef(storms);
  const replayRef = useRef(replay);
  projectionRef.current = projection;
  stormsRef.current = storms;
  replayRef.current = replay;

  // ── The unfold ───────────────────────────────────────────────────────────
  //
  // While this is running the tube is drawn straight, every frame, through a
  // projection that is still part globe. `at` is null until there is a size to
  // be a planet in, so the turn starts from the first frame that could show one
  // rather than from mount; `from` is set when the readout is finished with the
  // screen, and until then the world turns and stays whole.
  const unfoldRef = useRef({ at: null, from: null, done: false });
  // Whether the world has finished flattening. The view is held at the whole
  // earth until it has, and nothing may move it — not the reader, and not a
  // link. A globe is drawn at one scale, from a matrix built for one scale, and
  // there is no meaning to being zoomed into Oklahoma on a planet seen from
  // orbit: the matrix would hold dots for Oklahoma alone and the globe would
  // come up an empty wireframe, which is exactly what a shared link used to do.
  const [flat, setFlat] = useState(false);
  const heldStill = useRef(true);
  heldStill.current = !flat;

  // Watched rather than read once at setup: read inside the render effect, a
  // reader turning motion off mid-session would keep the beam until something
  // unrelated (a resize, a theme change) happened to rebuild the loop.
  const [reduceMotion, setReduceMotion] = useState(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = (event) => setReduceMotion(event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  // A resize refits the world under the view, so the view has to be re-checked
  // against the new bounds or it can end up parked off the edge.
  useEffect(() => {
    if (!base) return;
    setView((prev) => clampView(prev, base, width, height));
  }, [base, width, height]);

  // Going out to the globe takes the place you were looking at with you, and
  // puts the flat view back where it can be returned to. Both halves matter: a
  // globe that always opens on the Atlantic throws away the only thing the
  // reader had said about where they wanted to be, and the land matrix is built
  // from the flat view at whatever zoom it was left at — a globe drawn from a
  // matrix built for Oklahoma is an empty wireframe with Oklahoma on it.
  //
  // And it is a move, not a switch. The unfold already owns the one animation
  // that can carry it: the world coming apart into the map is a real projection
  // interpolated, and a projection interpolated runs in both directions. So
  // going out to the globe is that same move played backwards — the map rolls
  // up into the planet it was made from — and coming back is the boot's own
  // unfold, on demand. See `swapRef`.
  const wasSpinning = useRef(spinning);
  const swapRef = useRef(null);
  useEffect(() => {
    if (spinning === wasSpinning.current) return;
    wasSpinning.current = spinning;

    let target = spinRef.current;
    if (spinning && layerProjection?.invert && width && height) {
      const centre = layerProjection.invert([width / 2, height / 2]);
      if (centre && isFinite(centre[0]) && isFinite(centre[1])) {
        target = [centre[0], Math.max(-70, Math.min(70, centre[1]))];
        setSpin(target);
      }
    }
    // Both, together, and not just the live view. The matrix is built from the
    // *settled* one, and it normally catches up a settle later — which is fine
    // when the view is being dragged and fatal here: the swap starts on the next
    // frame and would spend its first third drawing a world whose dots are all
    // in whichever country the map happened to be zoomed into. Set here, the
    // matrix is rebuilt in the same render that arms the swap, so the world the
    // planet rolls up out of is a whole one.
    if (spinning) {
      setView({ k: MIN_K, x: 0, y: 0 });
      setSettled({ k: MIN_K, x: 0, y: 0 });
    }
    // Whichever way it is going, the swap is drawn from `unfoldProjection`,
    // whose sphere at t = 0 is the full-sized one. A planet left pushed away
    // from a previous visit would be that size on the last frame before the
    // move and the full size on its first, which is a jump on the one move
    // that exists to not have any. Crossing in past the stop already leaves it
    // here, so this is for the mode being turned on some other way.
    setGlobeK(1);
    if (reduceMotion || !width || !height) return;
    // `t` is the unfold's own number: 0 is the sphere, 1 is the map. Which way
    // it runs is the whole of the difference between the two directions.
    swapRef.current = { from: spinning ? 1 : 0, to: spinning ? 0 : 1, at: null, spin: target };
  }, [spinning, layerProjection, reduceMotion, width, height]);

  // Whether the globe was already on when the page opened, which is the one
  // case the throw below belongs to. Read once: toggling the mode later is a
  // swap, and a swap is not an arrival.
  const bootGlobe = useRef(spinning);

  /**
   * The planet arrives turning.
   *
   * The unfold is a throw with a beginning and an end — the world leaves rest,
   * is carried through most of a third of a turn, and comes apart under the
   * readout — and opening straight onto the globe should be the same arrival
   * minus the coming apart. So it is: the same sweep, the same easing, the same
   * constants, and at the end of it nothing to unroll into.
   *
   * What replaces the unroll is a stop. The drift exists so that a planet held
   * under a line still reading "fetching..." does not look like a hang, and the
   * moment the readout goes there is nothing left for it to do — a globe you
   * are meant to point at cannot be one that is quietly turning away from where
   * you pointed it. So the drift is eased to nothing, and where it stops is
   * where the world is from then on.
   */
  // When the throw began, and whether it has finished. Two facts rather than
  // one, because this effect is keyed on the tube's size and the tube gets its
  // size in more than one step on nearly every layout there is — a panel
  // settling, a font landing, an address bar going up. Each of those runs this
  // again, mid-throw, having just cancelled the frame the throw was waiting on.
  //
  // Refusing the second run is what this did, and it is the worse of the two
  // failures available: the planet stops where it was, `setFlat` is never
  // reached, and everything that waits on the world having arrived waits for
  // good — the whole control strip stays off the glass, and `heldStill` goes on
  // refusing every drag, which is also the last way a reader had of asking the
  // globe to repaint itself. A reload was the only way out, which is exactly
  // what it looked like from the outside.
  //
  // So it resumes instead. The start is kept, so the arithmetic below picks up
  // where it left off rather than throwing the planet a second time, and the
  // one thing that must happen once — arriving — is guarded by its own flag.
  const threwAt = useRef(null);
  const stopped = useRef(false);
  useEffect(() => {
    if (!bootGlobe.current || stopped.current || !width || !height) return;
    // The unfold has nothing to come apart into; it never runs.
    unfoldRef.current.done = true;
    if (reduceMotion) {
      stopped.current = true;
      setFlat(true);
      return;
    }
    if (threwAt.current === null) threwAt.current = performance.now();
    const at = threwAt.current;
    let raf = 0;
    const tick = (now) => {
      // The throw is allowed to finish before it is allowed to stop. The
      // readout can be done inside it, and a planet asked to slow while it is
      // still speeding up reads as a stutter rather than as mass.
      const asked = unfoldRef.current.from;
      const from = asked === null ? null : Math.max(asked, at + GLOBE_SPIN_MS);
      const turn =
        from !== null && now >= from
          ? // The rate falls evenly to nothing, so the turn is its integral.
            // Stopped on a frame instead, the planet halts rather than settles.
            spun(from - at) +
            GLOBE_DRIFT_PER_S *
              (GLOBE_STOP_MS / 1000) *
              (() => {
                const p = Math.min(1, (now - from) / GLOBE_STOP_MS);
                return p - (p * p) / 2;
              })()
          : spun(now - at);
      setSpin(([, lat]) => [wrapLon(GLOBE_FROM + turn), lat]);
      if (from !== null && now - from >= GLOBE_STOP_MS) {
        // At rest. Everything the instrument holds off the glass until the
        // world has arrived may arrive now, and this effect is finished for
        // the session however many more times the tube changes size.
        stopped.current = true;
        setFlat(true);
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [reduceMotion, width, height]);

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
    // Not until the world is flat. A link names a place on the map, and until
    // the unfold is done there is no map for it to name — applied early it
    // empties the land matrix under the globe and leaves the animation to run
    // over nothing.
    if (!base || linked.current || !flat) return;
    linked.current = true;
    if (!link.current) return;
    const { lon, lat, k } = link.current;
    const centre = base([lon, lat]);
    if (!centre || !isFinite(centre[0]) || !isFinite(centre[1])) return;
    setView(
      clampView({ k, x: width / 2 - k * centre[0], y: height / 2 - k * centre[1] }, base, width, height)
    );
  }, [base, width, height, flat]);

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

  // Chaining the frontiers is a one-off ~28ms, and left alone it is paid inside
  // the first settle that draws them, which is to say while the map is being
  // moved, the one moment a frame can be felt going missing. Paid up front
  // instead, while the boot sequence is still running and nothing is animating.
  useEffect(() => {
    if (window.requestIdleCallback) {
      const id = window.requestIdleCallback(() => frontiers());
      return () => window.cancelIdleCallback(id);
    }
    const id = setTimeout(frontiers, 400);
    return () => clearTimeout(id);
  }, []);

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
    if (!base || !layerProjection || !width || !height) return [];
    // The gap asked for on the glass, converted to the distance that draws it.
    // Mercator puts x = scale·λ with λ in radians, so a gap of one earth radius
    // is a gap of `scale` pixels and the conversion is that ratio. `base` is the
    // world at k = 1; the falloff below carries the zoom, exactly as it did when
    // this was a fixed distance.
    //
    // The globe is drawn at a larger scale than the flat map — half a planet
    // across the shorter side against a whole one across the tube, about two
    // and a half times — so the same array lands that much more open on the
    // sphere, and the coastline starts being guessed from too few marks.
    //
    // Not closed all the way, though, and this is the trade that decides it:
    // the flat map does not repaint to pan, it stretches the bitmap it already
    // has, while a rotation has no delta to be stretched through and the globe
    // repaints every frame of a drag. Dots are therefore worth roughly six
    // times more here than they are there, and matching the scale exactly costs
    // the turn its frame rate. See GLOBE_GRID.
    // The planet's own size is in here too. Pushed away it covers fewer pixels,
    // so the same spacing in kilometres lands closer together on the glass —
    // the array crowding into a smaller disk rather than staying the texture it
    // was. Carried here, the gap on the glass is what stays fixed, which is
    // what it is asked for in, and the marks that fall off the back of it are
    // marks nobody could have resolved anyway.
    const across = spinning ? GLOBE_GRID * globeK : 1;
    const stepKm = (gridGap(width) / (base.scale() * across)) * EARTH_RADIUS_KM;
    return buildGrid(
      visibleBounds(layerProjection, width, height),
      stepKm / Math.pow(settled.k, GRID_FALLOFF)
    );
  }, [base, layerProjection, settled.k, spinning, globeK, width, height]);

  // Its own slow clock, like the one the footer keeps: the sun moving is not a
  // reason to re-render anything but the layer it shades.
  const [sunAt, setSunAt] = useState(() => Date.now());
  // The sky reads it too, and for the same reason: the stars are turned under
  // the earth by sidereal time, so a clock stopped at the moment the instrument
  // was switched on is a globe whose night faces the wrong constellations by an
  // hour for every hour it has been open.
  useEffect(() => {
    if (!settings.daylight && !settings.globe) return;
    const id = setInterval(() => setSunAt(Date.now()), SUN_TICK_MS);
    return () => clearInterval(id);
  }, [settings.daylight, settings.globe]);

  // Read by the render loop the same way the live projection is, rather than
  // closed over: the loop must not be torn down and rebuilt to learn that the
  // sun moved a minute.
  const gridRef = useRef(grid);
  const sunRef = useRef(sunAt);
  const settingsRef = useRef(settings);
  const themeRef = useRef(theme);
  // The burn-in and its ceiling. Read this way only by the globe, which paints
  // them per turn rather than per settle and so is not the effect that has them
  // in scope. The identity of `bins` is the signature: App hands over a new
  // array each time the window moves, and the same array means the same picture.
  const binsRef = useRef(bins);
  const burnFullRef = useRef(burnFull);
  gridRef.current = grid;
  sunRef.current = sunAt;
  settingsRef.current = settings;
  themeRef.current = theme;
  binsRef.current = bins;
  burnFullRef.current = burnFull;

  useEffect(() => {
    const state = unfoldRef.current;
    // Recorded whether or not the unfold is going to run. On the globe it never
    // does, and this is still the moment the readout finished — which is what
    // the throw above is waiting for before it brings the planet to rest.
    if (unfolding && state.from === null) state.from = performance.now();
  }, [unfolding]);


  // Nothing to unfold from if the reader has asked for stillness. The map is
  // simply the map from the first frame, and the readout sits over it the way
  // it always did.
  useEffect(() => {
    if (reduceMotion) {
      unfoldRef.current.done = true;
      setFlat(true);
    }
  }, [reduceMotion]);

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
   * threshold the renderer uses; otherwise clicking apparently empty ocean at
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
   * Whether the world is refusing to be moved.
   *
   * Two occasions, and they are the same occasion: the world is between shapes
   * and the animation owns the projection. Before it has arrived that is the
   * boot's unfold, and `heldStill` has always said so. A swap is the same
   * animation on demand, and it has to say so too — a view moved under a
   * running swap is not the view the swap is drawing, and worse, `settled`
   * follows it and rebuilds the land matrix for wherever the reader zoomed to.
   * The planet then comes up holding dots for that one place: the empty
   * wireframe described above, arrived at from the other direction.
   *
   * Read live rather than derived in render. Arming a swap is a ref write on a
   * frame, not a state change, so nothing re-renders to recompute it.
   */
  const holding = useCallback(() => heldStill.current || swapRef.current !== null, []);

  // Zoom asked for at a rail and refused. See `spend`.
  const swapPush = useRef({ amount: 0, at: 0 });
  /**
   * Offer refused zoom towards a crossing, and cross if it is enough.
   *
   * Everything this reads it reads through a ref, which is what lets it be
   * built once: the frame coalescer below is also built once, and a version of
   * this captured from the first render would otherwise be asking that render's
   * questions for the rest of the session.
   *
   * Refused while a swap is already running — it owns the projection for its
   * whole length — and before the world has arrived, which is the gate every
   * other control here waits on.
   */
  const cross = useCallback((amount) => {
    if (amount <= 0 || holding()) return;
    if (spend(swapPush.current, amount, performance.now())) {
      onSettingRef.current("globe", !spinningRef.current);
    }
  }, [holding]);

  /**
   * Zoom on the globe: the planet pushed away, and the map above it.
   *
   * The same shape as the flat map's rail, read from the other end. Out, the
   * world shrinks until `GLOBE_MIN_K` and then stops, and there is nothing
   * past the stop for the effort to mean — a globe is already the whole of the
   * planet, so being further from it is not a view of anything more. In, it
   * grows back to the size the two shapes agree on, and the part of the
   * gesture that lands past *that* is the part that means the map, measured
   * the same way and spent on the same crossing.
   */
  const zoomGlobe = useCallback(
    (factor) => {
      if (holding()) return;
      const was = globeKRef.current;
      const asked = was * factor;
      const given = Math.min(1, Math.max(GLOBE_MIN_K, asked));
      if (factor > 1 && given < asked) cross(Math.log(asked / given));
      if (given !== was) setGlobeK(given);
    },
    [cross, holding]
  );

  /**
   * A high-refresh mouse delivers moves faster than the display draws them, and
   * a trackpad emits wheel events in bursts. Each one, taken directly, is a
   * React render of the largest component in the app. Everything the pointer
   * produces is therefore folded into a single update per frame, which is all
   * the screen can show anyway.
   */
  const geom = useRef({ base, width, height });
  geom.current = { base, width, height };
  const pendingFrame = useRef(0);
  const queued = useRef({ cursor: undefined, panX: 0, panY: 0, zoom: null, spinX: 0, spinY: 0 });

  const flush = useCallback(() => {
    pendingFrame.current = 0;
    const q = queued.current;
    const { base: fitted, width: w, height: h } = geom.current;

    // A gesture and the frame that applies it are one frame apart, which is
    // long enough for a swap to have been armed between them — the crossing
    // itself is armed exactly that way. What was queued belongs to a view the
    // animation is no longer drawing, so it is dropped rather than carried
    // across and applied on the other side.
    if (swapRef.current) {
      q.panX = 0;
      q.panY = 0;
      q.spinX = 0;
      q.spinY = 0;
      q.zoom = null;
    }

    // The turn. Taken in pixels and converted here rather than at the pointer,
    // so a gesture is one rotation whatever rate the device reports it at.
    if (q.spinX || q.spinY) {
      const dx = q.spinX;
      const dy = q.spinY;
      q.spinX = 0;
      q.spinY = 0;
      // The drawn radius, not the full one: a planet pushed away is a smaller
      // ball, and a drag that turns it at the rate of a larger one scrubs.
      setSpin((prev) => turned(prev, dx, dy, globeRadius(w, h) * globeKRef.current));
    }

    // Zoom before pan: a pinch is a spread about a point plus a drift, and
    // applying the drift first would move the point the spread is about.
    if (q.zoom) {
      const { x, y, factor } = q.zoom;
      q.zoom = null;
      // Zoom out the view could not absorb goes to the crossing.
      //
      // Not simply "already at the rail and pushed again": a gesture that
      // starts zoomed in and runs all the way out arrives at the rail and
      // through it in one movement, and the part that lands past the stop is
      // exactly the part that means the globe. Measured rather than counted,
      // so it does not matter whether that arrives as one long wheel or twenty
      // notches — what is spent is the difference between the zoom asked for
      // and the zoom the world has left to give.
      //
      // Read from the ref rather than from `prev` below, because the answer is
      // needed before deciding whether there is an update to make at all.
      const was = viewRef.current.k;
      const asked = was * factor;
      const given = Math.min(MAX_K, Math.max(MIN_K, asked));
      if (factor < 1 && given > asked) cross(Math.log(given / asked));
      // At the stop with nothing left to move, `clampView` would hand back a
      // view identical in all but identity, and every wheel notch against the
      // rail would still be a render of the largest component in the app.
      if (given !== was) {
        setView((prev) => clampView(zoomAbout(prev, x, y, factor), fitted, w, h));
      }
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
  }, [cross]);

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

  // On the flat map this frames a box. On the globe there is no framing to do —
  // one scale, and only a place to be pointed — so the same control turns the
  // planet until the middle of that box is under the eye. It is the same
  // request answered in the terms the mode has: show me this.
  const focusRegion = ([west, south, east, north]) => {
    if (spinning) {
      setSpin(pointed([(west + east) / 2, (south + north) / 2], 0, 0));
      return;
    }
    if (!base) return;
    setView(viewForBounds(base, width, height, [west, south, east, north]));
  };

  // Asked for, never volunteered: nothing here touches the geolocation API
  // until the control below is pressed, and the fix is held for the session
  // only: it is not written to storage and not sent anywhere. It lives in App
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
  // Bracketed, because it is the only thing in this strip that is not a place
  // to go. The names beside it move the view and cost nothing; this one asks
  // the browser a question about the reader, and it read as the eighth region
  // in a row of seven. Brackets are what the rest of the instrument puts around
  // a control, so it borrows that rather than inventing a new mark.
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
      if (holding()) return;
      // On the globe the wheel pushes the planet away and pulls it back, and
      // wound in past the size the map hands over at it is the crossing. The
      // page must still not scroll out from under the tube either way, which
      // is why this answers after preventing rather than by never being bound.
      if (spinningRef.current) {
        zoomGlobe(Math.exp(-event.deltaY * WHEEL_K));
        return;
      }
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
      if (holding()) return;
      const target = event.target;
      if (target.isContentEditable) return;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;
      // On the globe the same three keys turn it instead: a quarter of the
      // planet a press, which is the keyboard's version of the drag. There is
      // no zoom for them to have meant.
      if (spinningRef.current) {
        if (event.key === "+" || event.key === "=") setSpin((at) => pointed(at, 30, 0));
        else if (event.key === "-" || event.key === "_") setSpin((at) => pointed(at, -30, 0));
        else if (event.key === "0") setSpin([...GLOBE_HOME]);
        else return;
        event.preventDefault();
        return;
      }
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
    if (holding()) return;
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
    if (holding()) return;
    queued.current.cursor = readPointer(event);
    schedule();
    const previous = pointers.current.get(event.pointerId);
    if (!previous) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

    // Two fingers: the gesture carries both a spread and a drift, and reads as
    // broken if only the spread is honoured.
    //
    // On the globe the spread pushes the planet away and pulls it back, and
    // pulled in past the size the map hands over at it is the crossing; the
    // drift goes on turning the world as it did. The two do not collide:
    // fingers moving together hold their distance and change nothing, and
    // turning the globe is a one-finger drag anyway. Drift is taken from the
    // midpoint rather than from each finger, or two fingers would turn the
    // world twice as fast as one.
    if (pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const last = pinch.current;
      pinch.current = { distance, mid };
      if (spinning) {
        if (last) {
          queued.current.spinX += mid.x - last.mid.x;
          queued.current.spinY += mid.y - last.mid.y;
          schedule();
          if (last.distance > 0) zoomGlobe(distance / last.distance);
        }
        dragged.current = DRAG_SLOP + 1;
        return;
      }
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
    if (spinning) {
      queued.current.spinX += dx;
      queued.current.spinY += dy;
    } else {
      queued.current.panX += dx;
      queued.current.panY += dy;
    }
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
  //
  // Two canvases, taken in turn. One is on the glass and one is being painted
  // into, which is what keeps the promise below — a matrix is published whole
  // or not at all — without asking the browser for a new one every settle. A
  // tube's worth of backing store is the largest thing this component holds,
  // and a phone at three device pixels to one makes it twelve megabytes; a
  // fresh one per settle is that much garbage thrown at a collector that is
  // already being asked to keep out of a sixty-hertz loop's way. Safari on a
  // phone answers a canvas budget it has run past by quietly dropping backing
  // stores, and a dropped backing store is a layer that goes blank.
  const landSpare = useRef(null);
  useEffect(() => {
    // Nothing on the globe reads these — it paints its own, through the sphere
    // — so they are handed back rather than kept warm for a mode that is not on.
    // Held, the flat map's two layers and the globe's two are four tubes of
    // backing store for a screen that is drawing two of them.
    if (spinning) {
      landLayer.current = release(landLayer.current);
      landSpare.current = release(landSpare.current);
      return;
    }
    if (!layerProjection || !width || !height) return;
    const canvas = landSpare.current ?? document.createElement("canvas");
    // Sizing a canvas is also how it is cleared, so the spare arrives blank
    // whether or not the tube has changed shape since it was last used.
    const ctx = scaleCanvas(canvas, width, height);

    paintLand(ctx, {
      projection: layerProjection,
      grid,
      palette,
      graticule: settings.graticule,
      daylight: settings.daylight,
      borders: settings.frontiers,
      theme,
      sunAt,
      width,
      height,
      frontierK: settled.k,
      sphere: null,
    });

    // Stamped with the view it was drawn for, and published only now that it is
    // finished: until this line the previous bitmap is still the one on screen,
    // and it still knows where it belongs. The one it replaces becomes the
    // spare, to be painted into next time.
    landSpare.current = landLayer.current?.canvas ?? null;
    landLayer.current = { canvas, view: settled };
  }, [
    grid,
    layerProjection,
    palette,
    settings.graticule,
    settings.daylight,
    settings.frontiers,
    settled,
    spinning,
    sunAt,
    theme,
    width,
    height,
  ]);

  // ── The cloud field ──────────────────────────────────────────────────────
  //
  // The only layer on this map that is not drawn from something the page was
  // given. It is fetched, from five satellites belonging to two agencies, and
  // that makes it the one layer that can be late, wrong, or absent, so it is
  // built to fail quietly: a tile that does not answer is a tile the level
  // above it covers for, and a sky that never answers at all reads as clear.
  //
  // Almost nothing of it lives here. The pyramid holds its own tiles, its own
  // queue and its own crossfade, because all three change on the network's
  // schedule rather than the render's: a component that re-rendered every time
  // a tile landed would re-render the whole map thirty times to fill one
  // screen. This end only says which moment is wanted, where the map is
  // looking, and what colour the sky is.
  const kind = FIELDS[settings.field] ? settings.field : null;
  const sky = useRef(null);
  const held = useRef(null);
  // The outgoing pyramid is dropped whole rather than cleared: nothing in it
  // answers for the source coming in, and a store nobody holds a reference to
  // takes its tiles with it.
  if (held.current !== kind) {
    sky.current = kind ? FIELDS[kind].make() : null;
    held.current = kind;
  }
  const cadence = FIELDS[kind] ?? FIELDS.cloud;

  // Each ten-minute step is a moment the pyramid can hold, so scrubbing back
  // over an hour already seen costs nothing. `momentFor` says how it is picked,
  // and the footer reads the same function so the two never disagree.
  //
  // The live end is a named moment rather than "whatever is newest" because the
  // whole screen has to be one frame — a sky assembled out of several is a sky
  // whose clouds jump when the pyramid changes level. The interval below exists
  // to re-render when the moment it names has moved on.
  const [irTick, setIrTick] = useState(0);
  useEffect(() => {
    if (!kind) return;
    const id = setInterval(() => setIrTick((n) => n + 1), cadence.refresh);
    return () => clearInterval(id);
  }, [kind, cadence.refresh]);

  // A tab nobody is looking at is asked for again the moment it is. The fetch
  // below stands down while the page is hidden — see there for why — so this
  // is what starts it back up, rather than leaving the sky an hour stale until
  // the next tick of the interval above.
  useEffect(() => {
    const onVisible = () => {
      if (!document.hidden) setIrTick((n) => n + 1);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  const irAt = momentFor(kind, replay ? replay.at : null, Date.now());

  // Which projection the pyramid is asked about. The globe's, when there is one,
  // and pointed at [0, 0] rather than where the reader has it: which tiles are
  // wanted is the whole world either way, so a rotation would re-queue the same
  // request sixty times a second for an answer that cannot change.
  //
  // The zoom is a different matter and has to be carried. It is the one term in
  // the globe's scale, so it is the one term in the level the pyramid picks —
  // and `drawWarp` measures its own level off the live projection, which has it.
  // Left at k = 1 here the two disagreed below about k = 0.63, where the drawn
  // level is one shallower than the fetched one: `want` seeds the detail level,
  // a floor three below it, and level 0, so the level actually being drawn was
  // the one gap in that set and `drawTile` only walks up. It fell past the floor
  // to level 0 — one tile for the planet — which is the smudge the comment in
  // the effect below warns about, arrived at by the other road.
  const skyProjection = useMemo(
    () =>
      spinning && width && height
        ? globeProjection(width, height, [0, 0], globeK)
        : layerProjection,
    [spinning, width, height, globeK, layerProjection]
  );

  // The tokens the field is painted in. A palette change repaints the tiles
  // that are on screen from bytes already in hand; it does not go back to the
  // satellites for a picture that has not changed.
  useEffect(() => {
    sky.current?.palette(palette.land, palette.text);
  }, [palette.land, palette.text, kind]);

  useEffect(() => {
    if (!kind || !skyProjection || !width || !height) return;
    // A hidden tab is not a reader. The clock keeps moving behind a background
    // page — the ten-minute tick still fires — so without this the map would
    // spend a night fetching thirty megabytes of weather nobody can see, from
    // somebody else's servers, and hold it in a pyramid the render loop is no
    // longer running to sweep. Picked up again on visibilitychange above.
    if (document.hidden) return;
    // Held back past the map's own settle. What the wait is for has changed:
    // it used to stop a pan from throwing away five full-screen requests it had
    // just paid for, and a settle now mostly asks for tiles already in hand and
    // keeps the ones it does not whatever happens next. It stays because a drag
    // still has no reason to queue the ground it is only passing over.
    //
    // Asked of the globe when there is one, and not of the flat map underneath
    // it. The pyramid picks its level from the projection's scale, and the two
    // do not agree: a sphere puts the whole world across the disk's diameter
    // where the map puts it across the tube. Left on the flat projection the
    // globe would be drawing a level nothing had fetched, and `drawTile` only
    // walks up — so it would fall back to the one tile that covers the planet
    // and the sky would be a smudge.
    const id = setTimeout(() => {
      sky.current.want(skyProjection, width, height, irAt);
    }, IR_SETTLE_MS);
    return () => clearTimeout(id);
  }, [kind, skyProjection, width, height, irAt, irTick]);

  // ── The coverage layer ───────────────────────────────────────────────────
  //
  // A second pyramid, on the same machinery and the same settle, holding what
  // MTG's Lightning Imager saw. It is not a third field and does not take a turn
  // with the other two: it is a second opinion on the dots, so it has to be able
  // to be on at the same time as the weather they are firing in. See `flash.js`
  // for what that opinion is worth and where it disagrees.
  //
  // Everything below is the sky's arrangement above, on this source's own
  // numbers. It is deliberately not shared with it: the two run on different
  // steps and different lags, they are switched by different settings, and the
  // one thing that must not be common between them is the moment — a coverage
  // layer quantised to the cloud's ten minutes would sit up to five minutes off
  // its own publication and answer 502 for the privilege.
  const covering = settings.coverage;
  const flash = useRef(null);
  const flashHeld = useRef(false);
  if (flashHeld.current !== covering) {
    // Dropped whole rather than cleared, exactly as the field is: nothing in a
    // pyramid nobody holds a reference to survives, tiles included.
    flash.current = covering ? createFlash() : null;
    flashHeld.current = covering;
  }

  const [flashTick, setFlashTick] = useState(0);
  useEffect(() => {
    if (!covering) return;
    const id = setInterval(() => setFlashTick((n) => n + 1), FLASH_REFRESH_MS);
    return () => clearInterval(id);
  }, [covering]);

  const flashAt = momentAt(FLASH_STEP_MS, FLASH_LAG_MS, replay ? replay.at : null, Date.now());

  useEffect(() => {
    // A register brighter than the weather, and deliberately. The cloud field is
    // painted in the land token and the text token — terrain, and a reading laid
    // on terrain. This is not terrain at all: it is an observation of the same
    // thing the dots are, so it is drawn in the two tokens the instrument uses
    // for what it has measured. Left in the land token it was legible over an
    // empty map and indistinguishable from cloud over a cloudy one, which is the
    // one view where a reader is actually comparing the two.
    flash.current?.palette(palette.text, palette.strike);
  }, [palette.text, palette.strike, covering]);

  useEffect(() => {
    if (!covering || !skyProjection || !width || !height) return;
    if (document.hidden) return;
    const id = setTimeout(() => {
      flash.current.want(skyProjection, width, height, flashAt);
    }, IR_SETTLE_MS);
    return () => clearTimeout(id);
    // `irTick` as well as this layer's own: it is what the visibility handler
    // above bumps, and a tab coming back to the front wants both layers asked
    // for again rather than only the weather.
  }, [covering, skyProjection, width, height, flashAt, flashTick, irTick]);

  // Cumulative density: redrawn twice a second, so the backing canvas is
  // allocated once per resize and cleared rather than reallocated.
  useEffect(() => {
    // Handed back on the globe, for the reason the land layer is: the sphere
    // paints its own burn-in, and this one is a tube of backing store standing
    // by for a mode that is not on.
    if (spinning) {
      historyLayer.current = release(historyLayer.current);
      return;
    }
    if (!layerProjection || !width || !height) return;
    let canvas = historyLayer.current?.canvas;
    if (!canvas || canvas.dataset.w !== `${width}x${height}`) {
      canvas = document.createElement("canvas");
      canvas.dataset.w = `${width}x${height}`;
      scaleCanvas(canvas, width, height);
    }
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, width, height);

    const namePlaced = paintHistory(ctx, {
      projection: layerProjection,
      bins,
      palette,
      burnFull,
      bounds: settings.bounds,
      capitals: settings.capitals,
      width,
      height,
    });

    historyLayer.current = { canvas, view: settled, labels: namePlaced };
  }, [
    burnFull,
    bins,
    layerProjection,
    palette,
    settled,
    settings.bounds,
    settings.capitals,
    spinning,
    width,
    height,
  ]);


  // Deliberately not keyed on the view: the loop reads that through a ref, so
  // panning never tears the canvas down and rebuilds it.
  useEffect(() => {
    if (!width || !height) return;
    const ctx = scaleCanvas(canvasRef.current, width, height);
    const shake = settings.shake;
    let frame = null;

    // Only the tube takes the hit; the panels around it stay put.
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
      // Live arrivals keep being taken in while the map is rewound: the queue
      // has to be drained either way, and returning to live should find the
      // present already there rather than empty. What is suppressed is the
      // announcing: a strike that is not on screen must not knock the chassis
      // or click the counter, or the instrument reacts to something the reader
      // is not being shown.
      const quiet = replayRef.current !== null;

      for (const strike of queue) {
        // Repeat hits on one cell are a hard strike: they earn a bolt and a
        // knock on the chassis. A scattered strike just pings.
        const key = `${Math.floor(strike.lon)},${Math.floor(strike.lat)}`;
        const seen = recentHits.current.get(key);
        const hits = seen && now - seen.t < HIT_WINDOW ? seen.n + 1 : 1;
        recentHits.current.set(key, { n: hits, t: now });

        const hard = hits >= SHAKE_HITS;
        const bolt = hits >= BOLT_HITS;
        // Heard as it is drawn, and weighted the same way the knock is: a
        // worked cell lands heavier than a scattered strike.
        if (settings.clicks && !quiet) tick(hard ? 1 : bolt ? 0.5 : 0);
        // Kept in degrees, not pixels: the view can move underneath a strike
        // while it is still burning, and it has to stay where it landed.
        particles.current.push({
          lon: strike.lon,
          lat: strike.lat,
          t: now,
          hard,
          bolt: bolt ? makeBolt(hard ? 1.6 : 1) : null,
          // A dot drawn at full weight is a claim about where something was,
          // and a one-sided fix has less of a claim to make. Weighted gently
          // (the floor is high) because this is a caveat on the reading, not a
          // verdict on it, and a strike the network is less sure of is still a
          // strike. Nothing reported draws at full weight: no figure is not the
          // same as a bad one.
          weight: FIX_FLOOR + (1 - FIX_FLOOR) * (fixQuality(strike.gap) ?? 1),
          // Which detectors solved it, so the strike can show its own geometry
          // for a moment. Ids, not positions: the registry holds those, and a
          // particle outlives the frame it was made from.
          used: strike.used,
        });
        if (hard && !quiet) knock(hits);
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

    // A layer is stretched from the view it was drawn for to the live one. That
    // view travels with the bitmap rather than being read from a ref, because
    // the two change at different moments: `settled` is assigned during render,
    // while the bitmap it describes is not replaced until the effect that draws
    // it has run, an effect that waits for paint and then takes 10-30ms. Read
    // from a shared ref, the frames in between transform the outgoing bitmap by
    // the incoming view (identity, at the end of a drag) and the map jumps a
    // pan's worth sideways for a frame before snapping back. Asking the bitmap
    // where it belongs is always answerable; asking the component is not.
    const drawLayer = (layer) => {
      if (!layer) return;
      const live = viewRef.current;
      const s = live.k / layer.view.k;
      const tx = live.x - s * layer.view.x;
      const ty = live.y - s * layer.view.y;
      const moved = s !== 1 || tx !== 0 || ty !== 0;
      if (moved) {
        ctx.save();
        ctx.transform(s, 0, 0, s, tx, ty);
      }
      ctx.drawImage(layer.canvas, 0, 0, width, height);
      if (moved) ctx.restore();
    };

    // Cloud under the land matrix rather than over it. Physically it is the
    // wrong way round and on the glass it is the only way round: the dot matrix
    // is how you know where you are looking, and a wash laid over it takes the
    // coastline away exactly where the weather is. Underneath, the same wash
    // reads as something lit behind the world, which is what a tube does best
    // and costs the map nothing it was using.
    // `now` is the render loop's own clock, handed down rather than re-read: the
    // sky's fades are timed against it and a second reading here would put them
    // a fraction of a frame away from everything else that is decaying.
    /**
     * The sky behind the planet, on any of the three paths that draw a sphere.
     *
     * Under everything, including the weather: it is the only thing on this
     * tube that is further away than the ground. `alpha` is how much of a
     * sphere there is to be behind — one on the globe, and falling to nothing
     * as the world flattens, since a map has no outside for a star to be in.
     *
     * Both media, in the ink each one has for something that is behind the map
     * but is not furniture. On the tube that is `text`, the brightest thing
     * short of a strike — a star is a light source and the only one on the
     * glass that is not weather, and drawing it in the same ink as a readout is
     * what makes it read as light rather than as dust. On paper it is `dim`,
     * one rung down, because ink on a page darkens where light on a tube
     * brightens and the star that glows on the void would blot on the sheet.
     *
     * Printed at all, which it was not: a sky on paper used to be refused as a
     * hundred specks of dirt. What settles it is that these are real stars now
     * — a printed chart of the sky is a thing that exists, and it is drawn
     * exactly this way, in dark ink on a light page.
     */
    const drawSky = (sphere, alpha, now) => {
      if (alpha <= 0) return;
      paintStars(ctx, sphere, {
        colour: themeRef.current === "dark" ? palette.text : palette.dim,
        alpha,
        dpr: density(),
        width,
        height,
        // Stepped, so that a globe nobody is turning still holds most of its
        // frames — see `STAR_STEP` — and stopped outright for a reader who
        // asked for stillness, who gets the field and not the breathing.
        now: reduceMotion ? 0 : Math.floor(now / STAR_STEP) * STAR_STEP,
        // The sun's clock, not the loop's: the stars are turned under the earth
        // by sidereal time, and the sky and the terminator have to be pictures
        // of the same moment or the night side faces the wrong constellations.
        at: sunRef.current,
      });
    };

    // The sphere the two unfolds are drawn from: always full-sized, always
    // centred, because `unfoldProjection` at t = 0 is that planet and neither
    // move carries a zoom.
    const morphSphere = (rotate) => ({
      x: width / 2,
      y: height / 2,
      r: globeRadius(width, height),
      // A rotation is applied as its own negative, so where it is pointed is
      // the negative of what the projection was given.
      lon: -rotate[0],
      lat: -rotate[1],
    });

    /**
     * The globe, and the world coming apart into the map.
     *
     * Returns whether it took the frame. While it does, nothing else on the
     * tube draws: every other layer here is either a bitmap rasterised for a
     * flat view or a mark placed by the flat projection, and on a sphere they
     * would all be in the wrong place at once. There is nothing to miss —
     * the readout is over the screen for the whole of it, and the strikes it
     * would have shown have not arrived yet.
     */
    const drawUnfold = (now) => {
      const state = unfoldRef.current;
      if (state.done || reduceMotion) return false;
      // Anything that got the view off world zoom anyway — a focus, a located
      // reader — ends this rather than fighting it. The globe is drawn at one
      // scale from a matrix built for that scale, and there is nothing to
      // unfold into a view it no longer matches.
      if (viewRef.current.k > MIN_K + 1e-3) {
        state.done = true;
        state.doneAt = now;
        setFlat(true);
        return false;
      }
      if (state.at === null) state.at = now;

      const t = state.from === null ? 0 : glide((now - state.from) / UNFOLD_MS);
      // Stopped one frame short of flat, and the land layer draws the last one.
      // At t = 1 the two are the same picture — `unfoldProjection` is
      // `fitProjection` to the pixel there — so this is where the handover is
      // free, and taking it a frame early costs a fraction of a degree of turn
      // nobody can see and saves matching two painters' rounding.
      if (t >= 1) {
        state.done = true;
        state.doneAt = now;
        setFlat(true);
        return false;
      }

      const rotate = [-(GLOBE_LON + spun(now - state.at)), -GLOBE_TILT];
      // Gone by the time the limb stops being a circle, which is what it is cut
      // against: the far side arriving is the world ceasing to have an outside.
      drawSky(morphSphere(rotate), 1 - ramp(t, 0, FACING), now);
      paintLand(ctx, {
        projection: unfoldProjection(t, width, height, rotate),
        grid: gridRef.current,
        palette,
        graticule: settingsRef.current.graticule,
        daylight: settingsRef.current.daylight,
        borders: settingsRef.current.frontiers,
        theme: themeRef.current,
        sunAt: sunRef.current,
        width,
        height,
        // The world is at k = 1 throughout, where borders have not appeared yet.
        frontierK: 1,
        sphere: {
          rotate: [rotate[0] * (1 - t), rotate[1] * (1 - t)],
          back: ramp(t, 0, FACING),
          // Eased off before the end rather than cut at it. Nothing replaces it
          // — the flat map's wash starts a frame later — so the last of the
          // unfold is a world with the light coming even across it, and the
          // wash arrives onto that rather than swapping with something.
          shade: 1 - ramp(t, HANDOVER, 1),
        },
      });
      return true;
    };

    /**
     * The land and the burn-in, on the globe, as bitmaps that survive as long
     * as the world has not turned.
     *
     * The flat map holds these still for a settle and stretches them through
     * the delta to the live view in between, which is what makes a pan cost a
     * `drawImage` rather than twenty thousand projections. A rotation has no
     * delta to be stretched through — it is not a screen transform, and there
     * is no affine that turns a picture of one hemisphere into a picture of
     * another — so this is the honest version of the same trade: repaint when
     * it changed, reuse when it did not. Turning the planet costs what the
     * unfold costs, which is a price this map already pays sixty times a second
     * on the way in; holding it still costs a `drawImage`.
     */
    const globeLayers = { land: null, history: null };
    // Compared part by part rather than joined into a string: one of the parts
    // is the burn-in itself, and the only cheap thing to say about an array of
    // several hundred cells is which array it is. App hands over a new one each
    // time the window moves, so identity is exactly the question being asked.
    const same = (a, b) => a && a.length === b.length && a.every((part, i) => part === b[i]);
    /**
     * `ready` is whether what was painted is a picture at all.
     *
     * The bitmap is kept until its signature changes, and on a planet nobody
     * is turning that is never — which is the right trade for a picture and a
     * trap for a frame that arrived before the thing it draws. A matrix that is
     * not built yet paints a graticule over an empty world, and that empty
     * world is then held as the answer for as long as the globe sits still.
     * Said not to have been an answer, it is drawn again next frame, and the
     * first frame that has a matrix in hand is the one that sticks.
     */
    const globeBitmap = (which, signature, paint, ready = true) => {
      let held = globeLayers[which];
      if (!held || held.canvas.dataset.w !== `${width}x${height}`) {
        const canvas = document.createElement("canvas");
        canvas.dataset.w = `${width}x${height}`;
        scaleCanvas(canvas, width, height);
        held = { canvas, signature: null, labels: [] };
        globeLayers[which] = held;
      }
      if (!same(held.signature, signature)) {
        const context = held.canvas.getContext("2d");
        context.setTransform(1, 0, 0, 1, 0, 0);
        context.clearRect(0, 0, held.canvas.width, held.canvas.height);
        const dpr = density();
        context.setTransform(dpr, 0, 0, dpr, 0, 0);
        held.labels = paint(context) ?? [];
        held.signature = ready ? signature : null;
      }
      ctx.drawImage(held.canvas, 0, 0, width, height);
      return held;
    };

    /** Everything under the strikes, on the sphere. */
    const drawGlobeLayers = (now, live) => {
      const sphere = live.sphere;
      const config = settingsRef.current;
      // Where the planet is pointed. Every part of a signature below is
      // something that changes what the bitmap holds; the rotation is the one
      // that changes on every frame of a drag and on none at rest.
      const { lon, lat } = sphere;

      drawSky(sphere, 1, now);

      if (sky.current) {
        // No clip: the warp draws the world in patches and a patch behind the
        // planet is not drawn, so nothing can land off the disk. The flat map's
        // clip is there to keep tile rounding off the margin around the world,
        // and a sphere has no margin to protect.
        sky.current.drawWarp(
          ctx,
          live,
          { rotate: sphere.rotate, back: 0, at: sphere.lon },
          width,
          height,
          now
        );
      }

      // Over the weather and under the matrix, which is where it belongs on all
      // three paths: it is a reading about the strikes rather than a backdrop for
      // them, so it goes on top of the wash — and still under the land, because
      // a coverage layer that hid the coastline would be answering a question
      // about where by taking away the where.
      if (flash.current) {
        flash.current.drawWarp(
          ctx,
          live,
          { rotate: sphere.rotate, back: 0, at: sphere.lon },
          width,
          height,
          now
        );
      }

      globeBitmap(
        "land",
        // The matrix itself is the first term, and by identity, exactly as the
        // burn-in is below: it is the thing being drawn, and it is rebuilt on a
        // settle of its own — a resize, a change of mode — which the rotation
        // has nothing to say about. Left out, a planet nobody happens to be
        // turning goes on showing a picture of a matrix that has been replaced.
        [
          gridRef.current,
          lon,
          lat,
          sunRef.current,
          themeRef.current,
          palette,
          config.graticule,
          config.daylight,
        ],
        (context) =>
          paintLand(context, {
            projection: live,
            grid: gridRef.current,
            palette,
            graticule: config.graticule,
            daylight: config.daylight,
            // Frontiers are held to a band of zoom the globe is below, exactly
            // as the flat map at k = 1 is. Said here rather than left implied.
            borders: false,
            theme: themeRef.current,
            sunAt: sunRef.current,
            width,
            height,
            frontierK: MIN_K,
            // The far side is already gone — the projection refuses it — so
            // there is nothing to fade it to. `shade` is full: on the globe the
            // terminator is a boundary in the brightness of the land, and it is
            // the only thing carrying it, since the night wash needs a flat map
            // to be closed against.
            sphere: { rotate: sphere.rotate, back: 0, shade: 1 },
          }),
        // An empty matrix is not a world with no land on it, it is a world that
        // has not been built yet — unlike the burn-in below, where nothing to
        // draw is a true answer about a quiet planet and worth keeping.
        gridRef.current.length > 0
      );

      return globeBitmap(
        "history",
        [lon, lat, binsRef.current, palette, config.bounds, config.capitals, burnFullRef.current],
        (context) =>
          paintHistory(context, {
            projection: live,
            bins: binsRef.current,
            palette,
            burnFull: burnFullRef.current,
            bounds: config.bounds,
            capitals: config.capitals,
            width,
            height,
          })
      ).labels;
    };

    /**
     * The map rolling up into the globe, and the globe coming apart into the
     * map: the unfold, on demand, in whichever direction was asked for.
     *
     * Not a second animation that resembles the first. It is the first, driven
     * from a different pair of endpoints — one projection interpolated, so the
     * dots arrive where they belong rather than being tweened into place and
     * hoping, and so the frame it hands over on is the same picture twice at
     * both ends. `t = 1` is `fitProjection` to the pixel, and `t = 0` is the
     * sphere `globeProjection` draws, at the same radius, in the same place.
     *
     * Returns whether it took the frame, for the same reason the boot unfold
     * does: while a world is between the two shapes, every layer that is a
     * bitmap rasterised for one of them is in the wrong place.
     */
    const drawSwap = (now) => {
      const swap = swapRef.current;
      if (!swap) return false;
      if (swap.at === null) swap.at = now;
      const p = (now - swap.at) / UNFOLD_MS;
      if (p >= 1) {
        swapRef.current = null;
        // And nothing is done to the sky here. It was faded up after the boot,
        // where the field is arriving from a cold cache and a tile landing is a
        // rectangle snapping in; there is no such thing to hide at the end of a
        // swap, because the same field has been on the same ground for the
        // whole of it. Restarting that fade — which this did — is the sky going
        // out and coming back on a move that was meant to be continuous.
        return false;
      }
      const t = swap.from + (swap.to - swap.from) * glide(p);
      const rotate = rotationFor(swap.spin);
      const morph = unfoldProjection(t, width, height, rotate);
      // How much of the far side has arrived. One number, read by the land and
      // by the sky, so the weather cannot come round the limb ahead of the
      // ground it is over.
      const back = ramp(t, 0, FACING);

      // The stars go under all of it, and leave on the same number the far side
      // arrives on, in whichever direction the move is running.
      drawSky(morphSphere(rotate), 1 - back, now);

      // The sky goes down first, under the matrix, exactly as it does on either
      // side of the move — and it goes down through the same projection the
      // land is about to be drawn through, so it stays on the ground the whole
      // way rather than being taken off at one end and put back at the other.
      //
      // Unlike the boot unfold, which still lifts its sky in afterwards: there
      // the tiles are arriving from a cold cache in whatever order the network
      // returns them, and a sky drawn as it lands reads as rectangles snapping
      // in one by one. Here the field is already in hand.
      const warpAt = {
        rotate: [rotate[0] * (1 - t), rotate[1] * (1 - t)],
        back,
        // The meridian under the eye, which is where the field's resolution is
        // taken from. A rotation is applied as its own negative, so the centre
        // is the negative of what the projection was given.
        at: -rotate[0] * (1 - t),
      };
      if (sky.current) {
        sky.current.drawWarp(ctx, morph, warpAt, width, height, now);
      }
      if (flash.current) {
        flash.current.drawWarp(ctx, morph, warpAt, width, height, now);
      }

      paintLand(ctx, {
        projection: morph,
        grid: gridRef.current,
        palette,
        graticule: settingsRef.current.graticule,
        daylight: settingsRef.current.daylight,
        borders: settingsRef.current.frontiers,
        theme: themeRef.current,
        sunAt: sunRef.current,
        width,
        height,
        frontierK: MIN_K,
        sphere: {
          rotate: [rotate[0] * (1 - t), rotate[1] * (1 - t)],
          // Both read the same way whichever direction `t` is running: the far
          // side arrives as the world flattens and leaves as it closes up.
          back,
          // Held at full for the whole move, where the boot unfold eases it out
          // near the end. The boot can: it is going somewhere, and easing off
          // means the flat map's night wash arrives onto an evenly lit world
          // instead of trading places with a second treatment mid-frame. The
          // cost is a stretch with no terminator on it at all, which nobody
          // sees under a readout on the way in and everybody sees when the same
          // move is a control they just pressed. So night is carried by the
          // dots the whole way here, and the wash arrives over it.
          shade: 1,
        },
      });
      return true;
    };

    const drawLayers = (now = performance.now()) => {
      const live = projectionRef.current;
      // The globe paints its own, through the sphere, and shares none of the
      // machinery below: every layer there is a bitmap rasterised for a flat
      // view and stretched by a delta that a rotation does not have.
      if (live?.sphere) return drawGlobeLayers(now, live);

      // Flat, and the sphere's two are handed back — the other half of what the
      // layer effects do on the way out to the globe. Nothing here reads them,
      // and two tubes of backing store held against a mode that is off is how a
      // phone arrives at a canvas budget it cannot pay.
      if (globeLayers.land || globeLayers.history) {
        globeLayers.land = release(globeLayers.land);
        globeLayers.history = release(globeLayers.history);
      }

      // Kept inside the world. The land and history layers are drawn from
      // coordinates and simply have nothing to say off the ends of the earth;
      // the pyramid's tiles are clamped to the grid and so cannot stray either,
      // but a tile at the very edge is placed by rounding and can put a pixel
      // over the line. Clipped, so the margin the fit leaves around the world
      // at k = 1 stays void.
      // Nothing to fade from if the unfold never ran — a reader who asked for
      // stillness gets the sky at full strength from the first frame, which is
      // what the map did before any of this existed.
      const settledAt = unfoldRef.current.doneAt;
      const skyFade = settledAt == null ? 1 : glide((now - settledAt) / SKY_FADE_MS);

      // One clip and one fade for both pyramids. They are the same kind of thing
      // to this end of the code — a rectangle of the world, placed by asking the
      // live projection where it is now — and the coverage layer arrives out of
      // the same cold cache on the same unfold, so it has the same reason to be
      // faded up rather than snapped on.
      if ((sky.current || flash.current) && live && skyFade > 0) {
        const [west] = live([-180, 0]);
        const [east] = live([180, 0]);
        const [, top] = live([0, LAT_LIMIT]);
        const [, bottom] = live([0, -LAT_LIMIT]);
        ctx.save();
        ctx.beginPath();
        ctx.rect(west, top, east - west, bottom - top);
        ctx.clip();
        // Drawn against the *live* projection, not the settled one. Every other
        // layer here is a bitmap rasterised for a past view and stretched
        // through the delta to this one, because re-plotting twenty thousand
        // points a frame is not affordable. The sky has no view to be stretched
        // from: a tile is a rectangle of the world, and asking the projection
        // where that rectangle is now is four multiplications. So it tracks a
        // drag exactly, at its own resolution, instead of sliding and softening
        // with everything else and snapping back on the settle.
        if (skyFade < 1) ctx.globalAlpha = skyFade;
        sky.current?.draw(ctx, live, width, height, now, TILE_DEBUG);
        flash.current?.draw(ctx, live, width, height, now, TILE_DEBUG);
        ctx.globalAlpha = 1;
        ctx.restore();
      }

      drawLayer(landLayer.current);
      drawLayer(historyLayer.current);
    };

    // ── Whether the frame is worth painting ─────────────────────────────────
    //
    // The loop repaints the whole tube sixty times a second whatever is on it:
    // a full-screen fill, two full-screen `drawImage`s, and the sky over the
    // top, for a picture that is often identical to the one already on the
    // glass.
    //
    // It is worth writing down what that is and is not worth, because the shape
    // of the code oversells it. Measured in the browser at DPR 2 on a 1400x900
    // tube, those full-screen operations cost 0.26ms of a 16.7ms frame — they
    // are blits, not fills, and the GPU does them almost for free. Holding a
    // frame is not what makes this map fast.
    //
    // What it is for is the state this instrument has a name for: silence. The
    // feed goes quiet, or goes down, and the map is then a still picture that
    // was being redrawn sixty times a second to stay still. Measured with the
    // socket stopped, this takes it from every frame to 5% of them. On a live
    // feed it almost never fires — there is always a strike decaying somewhere
    // on earth — and that is the honest scope of it.
    //
    // The mechanism is the trick this file already uses for the
    // globe's bitmaps and `field.js` uses for its world picture: say what the
    // frame is a function of, and compare. The terms split in two.
    //
    // Some things run on their own clock, and no signature can stand for time
    // passing — a decaying strike, a replay, the unfold, a tile coming up. Those
    // do not get a signature; they simply mean paint.
    //
    // The rest is state, and it is compared part by part. Most of it is
    // identity rather than value: `bins`, the storm list and the two layer
    // bitmaps are handed over as new objects exactly when their contents change,
    // which is the same signature the layers themselves are keyed on.
    //
    // Everything in this effect's dependency array is absent on purpose. A
    // change to any of it tears the loop down and builds a new one, and the new
    // one starts with nothing painted, so it repaints on its first frame.
    let painted = null;

    // `projection` is handed in rather than read from the ref a second time:
    // the component has one of its own in scope under the same name, and a
    // closure that quietly picked that one up would be comparing the frame
    // against a projection from whenever this loop was built.
    const settledFrame = (now, projection) => {
      if (particles.current.length) return null;
      if (replayRef.current) return null;
      if (swapRef.current) return null;
      if (!unfoldRef.current.done) return null;
      // The sky comes up over the better part of a second once the world has
      // finished flattening, and a ramp is time, not state.
      const settledAt = unfoldRef.current.doneAt;
      if (settledAt != null && now - settledAt < SKY_FADE_MS) return null;
      // Tiles land on the network's schedule and fade in on their own; the
      // pyramid is the only thing that knows, so it is asked.
      if (sky.current?.restless(now)) return null;
      if (flash.current?.restless(now)) return null;

      const view = viewRef.current;
      const config = settingsRef.current;
      // Where the planet is pointed and how big it is drawn, when there is one.
      // The flat map's own movement is the view above; neither a rotation nor a
      // change of size is in it. The radius has to be here as much as the
      // centre does: pushed away, the world is the same world pointed the same
      // way, so without it the frame reads as settled and the glass keeps the
      // picture it already has — the planet only catching up on the next turn,
      // which is a drag repainting it rather than the zoom.
      const sphere = projection.sphere;
      return [
        view.k,
        view.x,
        view.y,
        sphere ? sphere.lon : null,
        sphere ? sphere.lat : null,
        sphere ? sphere.r : null,
        // The one term here that is time rather than state, and it is only in
        // the signature at all so that it can be a coarse one: the sky breathes
        // in steps, and a globe at rest repaints on the steps instead of on
        // every frame. Null off the globe and null under stillness, where there
        // is no field or no breathing and the hold stays exactly as it was.
        // Not conditioned on the medium: there is a sky on paper now too.
        sphere && !reduceMotion ? Math.floor(now / STAR_STEP) : null,
        gridRef.current,
        binsRef.current,
        burnFullRef.current,
        stormsRef.current,
        landLayer.current,
        historyLayer.current,
        sunRef.current,
        themeRef.current,
        config.graticule,
        config.daylight,
        config.frontiers,
        config.bounds,
        config.capitals,
        config.field,
        // Switched off, the pyramid is dropped and the last frame it painted is
        // still on the glass. Nothing else here would notice: no tile is
        // arriving, so `restless` says the layer is at rest, and it would be —
        // it would just also still be visible.
        config.coverage,
      ];
    };

    const render = () => {
      drain();
      const now = performance.now();
      const projection = projectionRef.current;
      if (!projection) {
        frame = requestAnimationFrame(render);
        return;
      }

      // Nothing has moved and nothing is moving: the glass already holds this
      // picture. The loop stays running — it is what notices that something has
      // changed — but the tube is left alone.
      const resting = settledFrame(now, projection);
      if (resting && painted && same(painted, resting)) {
        frame = requestAnimationFrame(render);
        return;
      }
      painted = resting;

      // Painted, not cleared: multiply blending needs opaque pixels beneath it.
      ctx.fillStyle = palette.void;
      ctx.fillRect(0, 0, width, height);

      if (drawSwap(now) || drawUnfold(now)) {
        frame = requestAnimationFrame(render);
        return;
      }

      // On the globe the names come back from here: they were placed this
      // frame, in these coordinates, and there is no view delta to bring them
      // through. On the flat map they are read off the bitmap below instead.
      const placedNames = drawLayers(now);

      // Storm cells: coherent clusters, ringed and labelled with how they are
      // moving. Few enough to draw per frame.
      ctx.strokeStyle = palette.text;
      ctx.fillStyle = palette.text;
      ctx.font = '10px "IBM Plex Mono", ui-monospace, monospace';
      ctx.textBaseline = "middle";
      const labels = [];
      for (const storm of settings.storms ? stormsRef.current : []) {
        const centre = projection([storm.lon, storm.lat]);
        const edge = projection([storm.lon + storm.radius, storm.lat]);
        // The edge is tested as well as the centre. On the globe a cell can sit
        // with its middle in front of the limb and its edge behind it, and an
        // unmeasurable radius is not a small one: it makes every figure below
        // this line a NaN, and a ring drawn at a NaN radius is not drawn at all
        // while everything hung off it goes on being computed.
        if (!centre || !edge || !isFinite(centre[0]) || !isFinite(centre[1]) || !isFinite(edge[0])) {
          continue;
        }
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
        const rate = surge(storm);

        // A cell whose flash rate is climbing gets a second ring, and gets it
        // at every level of detail: the rest of what a cell carries is context
        // you can turn down, and this is the one thing on the map that is
        // about to happen rather than happening. Concentric rather than
        // brighter, because weight already means how much is firing and would
        // then mean two things at once.
        if (rate?.jump) {
          ctx.globalAlpha = 0.55 + weight * 0.45;
          ctx.beginPath();
          ctx.arc(centre[0], centre[1], r + JUMP_GAP_PX, 0, Math.PI * 2);
          ctx.stroke();
        }

        // Where it has been, and where that course takes it. Both are drawn to
        // scale, unlike the bearing arrow below, which is why both disappear
        // when the scale makes them meaningless rather than being faked up to
        // a visible length.
        // How much the cell is asked to carry. Everything below the chosen
        // level is simply not drawn, rather than drawn fainter: a cue you have
        // turned down is still a cue competing for the same eye.
        const detail = settings.cells ?? "full";
        const showTrack = detail !== "ring";
        const showAhead = detail === "full";

        if (track && showTrack && storm.trail.length > 1) {
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
            const ahead = showAhead && forecast(storm, FORECAST_S);
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

        if (track && showTrack) {
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

        // The speed is the one reading that needs a unit to be read at all, so
        // it goes with the level that has room for it. Below that the label is
        // the count alone, which needs nothing.
        //
        // A jump adds a figure at that level too, and is allowed to make the
        // label long because it is rare: almost every cell is not doing this.
        // It adds no arrow. There was one, and it read as a digit at 10px —
        // "↑47/min" is "747/min" at a glance — while saying nothing the second
        // ring had not already said more clearly.
        const parts = [`${storm.count}`];
        if (track && showAhead) parts.push(`${Math.round(track.kmh)}km/h`);
        if (rate?.jump && showAhead) parts.push(`${Math.round(rate.rate)}/min`);
        labels.push({
          text: parts.join(" · "),
          x: centre[0] + r + 5,
          y: centre[1],
          alpha: 0.45 + weight * 0.4,
          // Who wins the pixels. A cell winding up is the most urgent thing on
          // the map and keeps its readout; after that the busiest cell does.
          rank: (rate?.jump ? 1e9 : 0) + storm.count,
        });
      }

      // ── The labels ────────────────────────────────────────────────────────
      //
      // Placed after every ring, in one pass of their own, because placement
      // order is collision priority and the order cells happen to arrive in is
      // not a priority. Anything that would land on text already placed is
      // dropped rather than drawn over: two readouts on top of each other are
      // not two readings, they are none, and the ring underneath still says
      // there is a cell there.
      //
      // The capitals are already on the glass, on the history layer, drawn at
      // that layer's own view. They are seeded into the occupied list through
      // the same delta the bitmap itself is drawn through, so a pan cannot slide
      // a name under a readout. Names win: a place name is orientation and
      // cannot be moved, while a cell's figures can go and lose nothing the ring
      // was not already saying.
      const taken = [];
      const names = placedNames ? null : historyLayer.current;
      if (placedNames) taken.push(...placedNames);
      if (names?.labels?.length) {
        const live = viewRef.current;
        const k = live.k / names.view.k;
        const dx = live.x - k * names.view.x;
        const dy = live.y - k * names.view.y;
        for (const box of names.labels) {
          taken.push([box[0] * k + dx, box[1] * k + dy, box[2] * k + dx, box[3] * k + dy]);
        }
      }

      labels.sort((a, b) => b.rank - a.rank);
      for (const label of labels) {
        const w = ctx.measureText(label.text).width;
        const box = [
          label.x - LABEL_PAD,
          label.y - 6 - LABEL_PAD,
          label.x + w + LABEL_PAD,
          label.y + 6 + LABEL_PAD,
        ];
        const clash = taken.some(
          (other) => box[0] < other[2] && box[2] > other[0] && box[1] < other[3] && box[3] > other[1]
        );
        if (clash) continue;
        taken.push(box);
        ctx.globalAlpha = label.alpha;
        ctx.fillText(label.text, label.x, label.y);
      }
      ctx.globalAlpha = 1;

      // The fix, drawn: a thread from each contributing detector to the strike
      // it helped place, thrown at arrival and gone within the second. It is
      // where the fix quality is now said at all: a strike heard from all
      // sides is caught in a full sheaf, one heard from the east wears a fan,
      // except that here you read it without being told.
      //
      // Under the strike pass and over everything else, at a weight where a
      // single thread is barely there and the sheaf is what you see.
      if (settings.stations) {
        const network = stations();
        // Half the world in screen pixels: a thread wider than this is a
        // detector on the far side of the date line, and the line to it would
        // cross the whole map rather than the sea between them.
        //
        // A globe has no date line to cross. The two edges of the flat map are
        // one meridian on it, and a detector too far round to draw a thread to
        // is one the projection has already refused. So the test is stood down
        // rather than asked of a projection that would answer it in NaNs.
        const wrap = projection.sphere
          ? Infinity
          : Math.abs(projection([180, 0])[0] - projection([-180, 0])[0]) / 2;
        ctx.strokeStyle = palette.dim;
        ctx.lineWidth = 1;
        for (const p of particles.current) {
          const age = now - p.t;
          if (age > LINK_MS || !p.used?.length) continue;
          const xy = projection([p.lon, p.lat]);
          if (!xy || !isFinite(xy[0]) || !isFinite(xy[1])) continue;
          const fade = 1 - age / LINK_MS;
          ctx.globalAlpha = fade * fade * LINK_ALPHA;
          ctx.beginPath();
          let drawn = false;
          for (const id of p.used) {
            const station = network.get(id);
            if (!station) continue;
            const at = projection([station.lon, station.lat]);
            if (!at || !isFinite(at[0]) || !isFinite(at[1])) continue;
            if (Math.abs(at[0] - xy[0]) > wrap) continue;
            ctx.moveTo(xy[0], xy[1]);
            ctx.lineTo(at[0], at[1]);
            drawn = true;
          }
          if (drawn) ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }

      // On the tube strikes accumulate light; on paper they accumulate ink.
      ctx.globalCompositeOperation = composite;
      ctx.fillStyle = palette.strike;
      ctx.strokeStyle = palette.strike;
      ctx.lineWidth = 1;

      // A strike, at an age. The same arithmetic serves live and replay: what
      // separates them is only which clock the age was measured against.
      const drawMark = (x, y, age, life, weight) => {
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

        // Halation: a wide dim disc under the core. Additive compositing turns
        // it into a bloom without touching the (very expensive) shadow blur.
        //
        // The weight of the fix rides on the two marks that assert a position,
        // and not on the ping or the bolt: those announce that something
        // arrived, which is certain however poorly the network placed it.
        const flash = Math.max(0, 1 - age / FLASH_MS);
        ctx.globalAlpha = (life * 0.09 + flash * 0.12) * weight;
        ctx.beginPath();
        ctx.arc(x, y, 3.5 + life * 4.5 + flash * 5, 0, Math.PI * 2);
        ctx.fill();

        // The core: overbright for a beat, then settling into the slow decay.
        ctx.globalAlpha = Math.min(1, life * life + flash * 0.7) * weight;
        ctx.beginPath();
        ctx.arc(x, y, 1.1 + life * 2.2 + flash * 2, 0, Math.PI * 2);
        ctx.fill();
      };

      // Rewound. Re-derived from the retained window rather than remembered:
      // the marks are the same, aged against the instant being replayed. Bolts
      // and the knock they carry are not replayed: those are events, and an
      // event does not happen a second time.
      const rewound = replayRef.current;
      if (rewound) {
        // Interpolated, not held. Ages taken straight from the replay instant
        // freeze for six frames and then jump a tenth of a second, which is
        // most of the animation on a mark: the overbright flash lasts 180ms and
        // would be sampled twice, the ping 720ms and sampled seven times. Run
        // forward from the stamp instead and the decay is drawn at frame rate,
        // with the state tick only deciding which strikes exist.
        const at = rewound.at + (now - rewound.stamp);
        const retained = history?.current ?? [];
        // Strikes are appended in arrival order, so the lit window is a
        // contiguous slice and can be found rather than scanned: a persistence
        // window is a few dozen strikes out of the twenty-five thousand held.
        let lo = 0;
        let hi = retained.length;
        const from = at - persistenceMs;
        while (lo < hi) {
          const mid = (lo + hi) >> 1;
          if (retained[mid].t < from) lo = mid + 1;
          else hi = mid;
        }
        for (let i = lo; i < retained.length; i++) {
          const strike = retained[i];
          const age = at - strike.t;
          // The rest of the slice has not happened yet at this instant.
          if (age < 0) break;
          const life = 1 - age / persistenceMs;
          if (life <= 0) continue;
          const xy = projection([strike.lon, strike.lat]);
          if (!xy || !isFinite(xy[0]) || !isFinite(xy[1])) continue;
          drawMark(xy[0], xy[1], age, life, 1);
        }
        ctx.globalCompositeOperation = "source-over";
        ctx.globalAlpha = 1;
        frame = requestAnimationFrame(render);
        return;
      }

      const alive = [];
      for (const p of particles.current) {
        const age = now - p.t;
        const life = 1 - age / persistenceMs;
        if (life <= 0) continue;
        alive.push(p);

        const xy = projection([p.lon, p.lat]);
        if (!xy || !isFinite(xy[0]) || !isFinite(xy[1])) continue;
        const [x, y] = xy;

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

        drawMark(x, y, age, life, p.weight ?? 1);
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
    settings.clicks,
    settings.shake,
    settings.stations,
    settings.storms,
    settings.cells,
    history,
    width,
    height,
  ]);

  // Not on the globe: there is one scale there, and a figure reporting the zoom
  // the mode is refusing to let you change is furniture that says nothing.
  const zoomedIn = !spinning && view.k > 1.02;

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
      {/* Held off the glass until the world is one. None of it means anything
          over a globe — the presets frame a rectangle of a flat map, the zoom
          figure is the zoom this is refusing to let you change, and the rewind
          track offers a past for a map that is not finished arriving. They fade
          in with the sky rather than appearing, so the instrument assembles
          itself in one move instead of switching on in parts. Kept mounted
          throughout: the guide points at this strip, and a tour target that
          does not exist yet is a tour that opens pointing at nothing. */}
      <div
        data-tour="regions"
        className={`no-bar absolute inset-x-3 top-2 flex items-center gap-2 overflow-x-auto transition-opacity duration-500 sm:inset-x-auto sm:left-3 sm:top-3 ${
          flat ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
        aria-hidden={!flat}
        style={{ touchAction: "pan-x" }}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
      >
        {REGIONS.map((region) => (
          <button
            key={region.label}
            type="button"
            onClick={() => focusRegion(region.bounds)}
            className="shrink-0 text-2xs uppercase tracking-label text-dim transition-colors hover:text-text active:text-text touch:px-1.5 touch:py-2.5"
          >
            {region.label}
          </button>
        ))}
        <span className="h-2.5 w-px shrink-0 bg-line" aria-hidden="true" />
        <button
          type="button"
          onClick={findMe}
          disabled={locating === "asking"}
          aria-label={
            here
              ? "Frame the map on your location again"
              : "Ask this browser for your location and frame the map on it"
          }
          title={
            locating === "denied"
              ? "This browser is refusing the page a position. It has to be allowed again in the browser's own site settings."
              : "Ask this browser for your location and frame the map on it. Session only: not stored, not sent anywhere"
          }
          className={`shrink-0 text-2xs uppercase tracking-label transition-colors touch:px-1.5 touch:py-2.5 ${
            here ? "text-text glow" : "text-dim hover:text-text active:text-text"
          }`}
        >
          [ {hereLabel} ]
        </button>
        {zoomedIn && (
          <span className="shrink-0 text-2xs uppercase tracking-label text-text glow">
            &#215;{view.k.toFixed(1)}
          </span>
        )}

        <span className="h-2.5 w-px shrink-0 bg-line" aria-hidden="true" />
        {/* Which world. First of the dials, because it is the one the others
            are read against: everything to the right of it is a layer on a map,
            and this says which map. */}
        <Cycle
          label="view"
          title="Flat is the whole planet at once, which is what this instrument is mostly for. Globe is the same data on a sphere — half a world at a time, at one scale, turned by dragging it."
          value={settings.globe ? "globe" : "flat"}
          options={["flat", "globe"]}
          onChange={(v) => onSetting("globe", v === "globe")}
        />
        <Cycle
          label="field"
          title="What sits behind the map. Cloud is thermal infrared from the geostationary satellites, and its bright tops are the cold ones, which is where the lightning is about to be. Rain is a ground-radar composite: it covers only the ground somebody built a radar network on, but it is the only layer here that sees what is actually falling. One at a time, because they land on the same storms from opposite ends."
          value={settings.field ?? "cloud"}
          options={["off", "cloud", "rain"]}
          onChange={(v) => onSetting("field", v)}
        />
        {/* Off is a stop on the same dial rather than a switch of its own: a
            cell carrying nothing and no cell at all are the two ends of one
            question, and two controls for it is one more than the strip has
            room for. */}
        <Cycle
          label="cells"
          title="How much a storm cell carries. Ring is the cell and its count, track adds where it has been, full adds where it is going."
          value={settings.storms ? settings.cells ?? "full" : "off"}
          options={["off", "ring", "track", "full"]}
          onChange={(v) => {
            onSetting("storms", v !== "off");
            if (v !== "off") onSetting("cells", v);
          }}
        />
        <Cycle
          label="burn"
          title="How far back the burn-in reaches. Four minutes is where it is raining lightning now; an hour is where it has been this session."
          value={settings.density ?? "4m"}
          options={["4m", "20m", "1h"]}
          onChange={(v) => onSetting("density", v)}
        />
        {/* Only present when the header that usually carries it is not. */}
        {onConfig && (
          <>
            <span className="h-2.5 w-px shrink-0 bg-line" aria-hidden="true" />
            <button
              type="button"
              onClick={onConfig}
              className="shrink-0 text-2xs uppercase tracking-label text-dim transition-colors hover:text-text active:text-text touch:px-1.5 touch:py-2.5"
            >
              cfg
            </button>
          </>
        )}
      </div>

      <div
        className={`transition-opacity duration-500 ${
          flat ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
        aria-hidden={!flat}
      >
        <Transport span={span} behind={replay ? Date.now() - replay.at : 0} onSeek={onSeek} />
      </div>

      {/* Nothing is arriving. Said on the glass, because everything else the
          tube can do in this state (an empty map, a burn-in fading out on
          schedule) is indistinguishable from a quiet planet, and the planet is
          never quiet. What is still drawn is the last of what was received,
          which is why the mark decays rather than freezing. */}
      {lost && (
        <div
          className="pointer-events-none absolute right-3 top-3 flex items-center gap-2 text-2xs uppercase tracking-label unselectable"
          role="status"
        >
          <span className="lost-pulse h-1.5 w-1.5 rounded-full bg-text" aria-hidden="true" />
          <span className="text-text glow">no signal</span>
        </div>
      )}

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
