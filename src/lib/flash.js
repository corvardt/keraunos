/**
 * The coverage layer: what a satellite saw, over what the network heard.
 *
 * Every other layer here answers a question the strikes cannot. This one asks a
 * question *about* them. Blitzortung is a VLF network on the ground, and what it
 * can hear is a function of where somebody built a detector: it is superb over
 * Europe and thin over the middle of an ocean, and it is biased toward the
 * cloud-to-ground return stroke because that is the discharge with a radio
 * signature worth travelling. MTG-I's Lightning Imager is the opposite
 * instrument in every respect. It sits at 0° and photographs the 777.4nm oxygen
 * line at a thousand frames a second, so it sees the optical flash — including
 * the intracloud discharge that never reaches the ground and that the network
 * largely does not hear — and it sees it at the same detection efficiency over
 * the Congo, the Atlantic and Berlin, because a satellite does not care whether
 * anyone lives underneath it.
 *
 * So the two disagree, and the disagreement is the reading. Where the dots and
 * this layer land together, two independent instruments on two different
 * physical effects agree that a storm is there. Where this layer is lit and no
 * dots arrive, the network is not hearing something that is definitely
 * happening — which over the South Atlantic is most of the time. That is a fact
 * about the instrument the rest of this page is built out of, and it belongs on
 * the page for the same reason the detector threads do.
 *
 * Off by default, and for the same reason `stations` is: most of the time you
 * are here for the weather, and a second opinion is only interesting once you
 * have started wondering about the first.
 *
 * ── What is actually being drawn ────────────────────────────────────────────
 *
 * Accumulated Flash Area: the ground each flash's optical emission covered,
 * accumulated onto the FCI grid over five minutes and published as a count per
 * pixel. Not a strike list — the individual flashes exist, as LFL in the Data
 * Store, but they arrive as netCDF-4 inside a zip behind an OAuth key, and this
 * page has neither a server to unpack that on nor a key it could keep. This is
 * the same measurement already rendered, on a service that answers anonymously.
 *
 * Which means it is not live and cannot be: see LAG_MS. The dots on top of it
 * are seconds old and this is a quarter of an hour behind them, so a cell that
 * has just fired has nothing here yet. The footer says so — `sources.js` carries
 * this layer's own cadence for exactly that reason — and a reader comparing the
 * two layers has to be told, because the whole use of the thing is comparison
 * and the naive reading of a mismatch is "the network missed it".
 *
 * ── Why the colours are the data ────────────────────────────────────────────
 *
 * The same bind the rain field is in, and it is worth reading that file's note
 * on it: the service publishes a picture rather than a grid. There is no
 * colormap in the style to invert — the SLD carries a bare RasterSymbolizer, so
 * the ramp is baked into the raster before GeoServer ever sees it — and the only
 * published statement of what a colour means is the legend graphic. So the ramp
 * below *is* that legend, sampled along the bar, and a pixel is read by finding
 * the nearest entry.
 *
 * Nearest rather than exact, unlike the rain, and this is the one soft edge in
 * here. A GetMap resamples the native grid to whatever raster was asked for, and
 * an interpolated pixel on the boundary between a red core and clear sky is a
 * blend of two ramp entries that are far apart — which lands off the curve
 * rather than between two neighbours on it. Those pixels are the outline of a
 * cell and they read as a middling count. On a wash three levels coarser than
 * the sensor, drawn to say "something was here", that is an acceptable lie; it
 * would not be on a layer anyone measured off.
 */

import {
  clamp,
  lonAt,
  latAt,
  createField,
  fillThrough,
  tileFrame,
  tilesFor,
  levelFor as baseLevelFor,
  ancestorPatch as basePatch,
  loadPicture,
} from "./field.js";

// The same origin the Meteosat dishes are reached through, and for the same
// reason: EUMETSAT's GeoServer sends no `access-control-allow-origin`, and every
// pixel of this layer is read back to be turned into a count. `functions/msg.js`
// carries it in production and `vite.config.js` in development, so this file
// knows only the path. The layer name is on that proxy's allowlist; adding one
// here without adding it there is a 400 and an empty map.
const SERVICE = "/msg";
const LAYER = "mtg_fd:li_afa";

// How far the published grid reaches, in degrees, north-south and east-west.
//
// Narrower than the horizon of a dish at 0°, which is nearer 81°: this is the
// extent EUMETSAT states for the product, and past it there is no raster to ask
// for. It matters because Mercator hands the polar rows an enormous share of
// the tile grid, and a request for ground the product does not cover is a
// transparent PNG paid for at full price.
const REACH = 70;

// ── The grid ────────────────────────────────────────────────────────────────

// Sixty-four across, matched to the block the map quantises to, exactly as both
// other fields are. Nothing drawn here resolves finer than that block.
export const SAMPLES = 64;
const TILE_PX = 300;

/**
 * How large the tile is *asked* for, which is not how large it is kept.
 *
 * The cloud field asks at SAMPLES and stores what comes back, because a cloud
 * is a continuous thing and a coarser picture of it is a slightly softer cloud.
 * This data is not continuous. A flash covers a few pixels of a 4.5km grid, so
 * at level 2 one stored sample is most of a country and the flash is a
 * thousandth of it — and a server resampling that box down to one value will
 * almost always land somewhere else and hand back nothing at all. The first
 * version of this asked at SAMPLES and drew four lit samples over the whole of
 * Africa on an afternoon the ITCZ was firing across it.
 *
 * So it is asked four times finer and reduced here, by taking the strongest
 * sample in each block rather than the mean — the same answer `rain.js` gives to
 * the same problem, for the same reason. A flash is small and a mean is exactly
 * the operation that dissolves it into the clear sky around it.
 *
 * Four times, and not more, is where it stops paying: past this the request
 * costs real bytes to recover flashes that would land at the very bottom of the
 * scale anyway. It is also inside the size the proxy will carry.
 */
const FETCH_PX = SAMPLES * 4;

/**
 * Where the pyramid stops, because it is where the instrument does.
 *
 * A level lower than the other two fields. The Lightning Imager's footprint is
 * about 4.5km at nadir and coarser toward the limb, and a level-6 tile is about
 * 4.8km per sample — so level 7 would be asking GeoServer to interpolate a
 * measurement it does not have, at four times the bytes, to draw a detail that
 * is not in the data. Past here the field is stretched, which is the honest
 * thing to do with a picture that has run out.
 */
export const MAX_LEVEL = 6;

export const levelFor = (projection) => baseLevelFor(projection, TILE_PX, MAX_LEVEL);
export const ancestorPatch = (z, x, y, level) => basePatch(z, x, y, level, SAMPLES);
export { tileFrame, tilesFor };

// The product accumulates over five minutes and is published on that step, so
// this is the cadence of the thing itself rather than a choice.
export const REFRESH_MS = 5 * 60 * 1000;
export const STEP_MS = 5 * 60 * 1000;

/**
 * How far behind the clock the live moment is asked for.
 *
 * Measured rather than assumed, from the layer's own GetCapabilities: the newest
 * time it advertises runs about ten to fourteen minutes behind the wall clock,
 * being five minutes of accumulation and then the processing and publication of
 * it. Fifteen clears that.
 *
 * It has to clear it rather than merely usually clear it, because this service
 * does not answer a moment it does not have by handing back the newest one it
 * does — it answers 502, the same way it does for the Meteosat dishes. An
 * optimistic lag here is not a slightly stale layer; it is no layer at all,
 * failing quietly, on an instrument where nothing drawn is indistinguishable
 * from nothing seen.
 */
export const LAG_MS = 15 * 60 * 1000;

// ── Calibration ─────────────────────────────────────────────────────────────

/**
 * The published legend, sampled along its bar: 64 stops from the pale yellow of
 * one flash to the dark red of twenty or more.
 *
 * Taken off the GetLegendGraphic image rather than out of a style document,
 * because there is no style document to take it out of — see the header. The
 * ends are the bar's own first and last interior pixels; its outermost column
 * blends into the legend's black border and is not a colour this ramp ever
 * produces.
 */
const RAMP =
  "ffffc9fffbc1fff9bdfff6b6fff4b2fff1adffefa6ffeda2ffea9bffe897ffe692fee38b" +
  "fee187fedf83fedc7dfeda79fed471fed16dfecc68fec662fec35efebd57feb953feb54f" +
  "feae4afeab48fea847fda144fd9e43fd9941fd943ffd913dfd893afd8339fd7d37fd7234" +
  "fc6c33fc6330fc5c2efc572cfb4c29f84628f64227f23824f03423ed3021e8261fe6221d" +
  "e1191cde171dda141dd40f1fd00d20ca0922c60623c30324bc0025b70026b00026a70026" +
  "a100269700269100268b0026";

// Exported for `scripts/check-flash.cjs`, which is the only thing that can tell
// whether this table is still the scale EUMETSAT is publishing. Nothing in the
// map reads it directly.
export const STOPS = (() => {
  const out = [];
  for (let i = 0; i * 6 < RAMP.length; i++) {
    const hex = RAMP.slice(i * 6, i * 6 + 6);
    out.push([
      parseInt(hex.slice(0, 2), 16),
      parseInt(hex.slice(2, 4), 16),
      parseInt(hex.slice(4, 6), 16),
    ]);
  }
  return out;
})();

/**
 * Where on the ramp a pixel sits, from 0 at its pale end to 1 at its dark one.
 *
 * Squared distance in plain RGB, which is not a perceptual metric and does not
 * need to be: this is not asking which colour looks closest, it is asking which
 * point of a known one-dimensional curve a sample was drawn from, and the curve
 * is far longer than the error being resolved along it.
 */
export function positionFor(r, g, b) {
  let best = 0;
  let near = Infinity;
  for (let i = 0; i < STOPS.length; i++) {
    const [sr, sg, sb] = STOPS[i];
    const d = (r - sr) * (r - sr) + (g - sg) * (g - sg) + (b - sb) * (b - sb);
    if (d < near) {
      near = d;
      best = i;
    }
  }
  return best / (STOPS.length - 1);
}

/**
 * The three points on the ramp that are actually published, and nothing between
 * them is claimed.
 *
 * The legend carries ticks at one flash, ten, and twenty-or-more, and the ten
 * does not sit where either a linear or a logarithmic scale would put it. So the
 * shape of the ramp between the marks is unknown, and this interpolates through
 * the marks and says so, rather than fitting a curve nobody published to two
 * intervals of a scale that was never stated. It is the same move `ir.js` makes
 * with the two greyscales, for the same reason: three honest anchors beat one
 * confident formula.
 */
const MID = 0.529; // where the legend's own "10" tick stands
const MID_COUNT = 10;
const TOP_COUNT = 20; // ...and where the bar ends, at twenty or more

/** Flashes in the five minutes, from a position on the ramp. */
export function countFor(position) {
  const t = clamp(position, 0, 1);
  if (t <= MID) return 1 + ((MID_COUNT - 1) * t) / MID;
  return MID_COUNT + ((TOP_COUNT - MID_COUNT) * (t - MID)) / (1 - MID);
}

// Where the second pass starts. The legend's middle tick, which makes the split
// between "the satellite saw lightning here" and "the satellite saw a great deal
// of it" a published number rather than a taste.
const BUSY = MID;

// ── Fetching ────────────────────────────────────────────────────────────────

/**
 * One tile's address.
 *
 * The same WMS call `ir.js` makes of the same server, in the same projection,
 * because the tile is the same box: a Mercator rectangle named at a moment. The
 * two differences are TIME, which steps at five minutes here rather than ten,
 * and the size, which is FETCH_PX rather than what is stored — see there.
 */
export function url(frame, at) {
  const params = new URLSearchParams({
    SERVICE: "WMS",
    VERSION: "1.3.0",
    REQUEST: "GetMap",
    LAYERS: LAYER,
    STYLES: "",
    CRS: "EPSG:3857",
    BBOX: [frame.minX, frame.minY, frame.maxX, frame.maxY].join(","),
    WIDTH: String(FETCH_PX),
    HEIGHT: String(FETCH_PX),
    FORMAT: "image/png",
    TRANSPARENT: "TRUE",
    TIME: new Date(at).toISOString().replace(/\.\d+Z$/, "Z"),
  });
  return `${SERVICE}?${params}`;
}

/** Whether any part of this tile is ground the product covers. */
export function withinReach(frame) {
  if (lonAt(frame.minX) > REACH || lonAt(frame.maxX) < -REACH) return false;
  return latAt(frame.maxY) > -REACH && latAt(frame.minY) < REACH;
}

// The tile arrives at FETCH_PX and is stored at SAMPLES, so each stored sample
// is a square of this many pixels.
const REDUCE = FETCH_PX / SAMPLES;

// Said once rather than once per tile. There is one source here, so a failure is
// not a seam in the picture the way it is on the ring: it is the whole layer,
// and an empty coverage layer looks exactly like a satellite that saw no
// lightning. That is the one misreading this layer must not produce silently —
// and the footer says so now as well, which is where a reader will see it.
const load = (src) =>
  loadPicture(src, "lightning imager", "coverage will draw as though it saw nothing.");

/**
 * One tile, as a field of bytes.
 *
 * Transparent is the reading that matters most here and the one easiest to lose:
 * it means the imager looked and saw no flash, which is a real answer and a
 * different fact from ground it cannot see at all. The first is drawn as
 * nothing; the second is refused above, before a request is made for it.
 */
async function fetchTile(z, x, y, at) {
  const frame = tileFrame(z, x, y);
  // Answered, and the answer is that there is no product over this ground.
  // Returned as an empty tile rather than as a failure: a failure would be asked
  // for again on every settle, forever, and the answer would not change.
  if (!withinReach(frame)) return { field: new Uint8Array(SAMPLES * SAMPLES), any: false };

  const { image } = await load(url(frame, at));
  if (!image) return null;

  const sheet = document.createElement("canvas");
  sheet.width = FETCH_PX;
  sheet.height = FETCH_PX;
  const ctx = sheet.getContext("2d", { willReadFrequently: true });
  // One to one, and unsmoothed even so. The ramp is being read back out of the
  // picture, and a resample here would invent colours on top of the ones
  // GeoServer has already interpolated.
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(image, 0, 0, FETCH_PX, FETCH_PX);
  const { data } = ctx.getImageData(0, 0, FETCH_PX, FETCH_PX);

  // Reduced by keeping the busiest pixel of each block. Not the mean: a block
  // is up to a few hundred kilometres across at the shallow levels and a flash
  // is four of them, so a mean would report every storm on the map as a tenth of
  // a flash and draw nothing at all.
  const field = new Uint8Array(SAMPLES * SAMPLES);
  let any = false;
  for (let row = 0; row < SAMPLES; row++) {
    for (let col = 0; col < SAMPLES; col++) {
      let peak = 0;
      for (let dy = 0; dy < REDUCE; dy++) {
        for (let dx = 0; dx < REDUCE; dx++) {
          const j = ((row * REDUCE + dy) * FETCH_PX + col * REDUCE + dx) * 4;
          // No flash here, or nothing to say. Either way there is nothing to
          // draw, and the two are not worth telling apart on a layer this
          // coarse.
          if (data[j + 3] < 128) continue;
          const v = Math.round(positionFor(data[j], data[j + 1], data[j + 2]) * 255);
          // The floor is one, never zero: a single faint flash at the very
          // bottom of the ramp is the reading this layer exists to carry, and
          // rounding it away would erase exactly the ground the network is
          // deaf over.
          if (v > peak) peak = Math.max(1, v);
        }
      }
      if (!peak) continue;
      field[row * SAMPLES + col] = peak;
      any = true;
    }
  }

  // A tile with no flash in it is still a tile: it is the answer "the imager saw
  // nothing here", which on this layer is a reading rather than an absence, and
  // holding it stops the pyramid asking again on the next pan.
  return { field, any };
}

// ── Painting ────────────────────────────────────────────────────────────────

/**
 * A tile, as something to look at.
 *
 * Two passes on the same split the legend already makes. The body is every
 * pixel the imager saw a flash in — the point of a coverage layer is that a
 * single flash somewhere the network is deaf must be visible at all, so its
 * floor is a floor rather than a fade to nothing. Over it, the pixels past the
 * legend's own middle tick, harder.
 *
 * The tokens come from the map, and which two it hands over matters more here
 * than anywhere else on this page: see the palette call in `worldmap.jsx`. Drawn
 * in the terrain tokens this layer is indistinguishable from the cloud field it
 * is usually on top of, which is precisely the view in which somebody is
 * comparing them.
 *
 * Both passes stay under the land matrix and well under the strikes. This is a
 * layer to notice while looking at something else, which is the one thing it has
 * in common with the fields it is drawn over.
 */
function paintTile({ field }, body, tops) {
  const size = SAMPLES * SAMPLES;
  const seen = new Uint8ClampedArray(size * 4);
  const busy = new Uint8ClampedArray(size * 4);
  let anyBusy = false;

  for (let p = 0; p < size; p++) {
    const v = field[p];
    if (!v) continue;
    const t = v / 255;
    // Not squared, unlike the cloud wash. That layer covers the whole planet and
    // has to fall away fast to stay a backdrop; this one is lit over a fraction
    // of a per cent of the map and is not competing for the same screen.
    seen[p * 4 + 3] = 32 + t * 44;
    if (t > BUSY) {
      busy[p * 4 + 3] = Math.sqrt((t - BUSY) / (1 - BUSY)) * 120;
      anyBusy = true;
    }
  }

  const canvas = document.createElement("canvas");
  canvas.width = SAMPLES;
  canvas.height = SAMPLES;
  const ctx = canvas.getContext("2d");

  fillThrough(ctx, seen, body, SAMPLES);
  if (anyBusy) fillThrough(ctx, busy, tops, SAMPLES);
  return canvas;
}

// ── The store ───────────────────────────────────────────────────────────────

/**
 * The pyramid, driven by the map.
 *
 * The same shared store both weather fields use, which is what makes this layer
 * cheap enough to be worth having: everything about tiles, queues, ancestors and
 * the handover between two moments is in `field.js` already. What is particular
 * to this one is above — one satellite instead of five, a legend read back out of
 * a picture, and a floor that keeps a single flash visible.
 */
export function createFlash() {
  return createField({
    samples: SAMPLES,
    tilePx: TILE_PX,
    maxLevel: MAX_LEVEL,
    fetch: fetchTile,
    paint: paintTile,
  });
}
