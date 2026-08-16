/**
 * The cloud field: thermal infrared from the geostationary ring.
 *
 * A lightning map raises a question it cannot answer on its own. Two hundred
 * strikes in a cell is a number; whether that cell is one tower or the leading
 * edge of a squall line six hundred kilometres long is the thing you actually
 * wanted to know, and the strikes alone never say. Infrared says it. The 10.8µm
 * window reads the temperature of the highest thing in the column, so a cloud
 * top that has been driven up into the tropopause comes back cold, and cold is
 * exactly where the lightning is. This layer and the strikes on top of it are
 * two instruments pointed at the same storm.
 *
 * Five satellites, because one planet does not fit in one dish. The
 * geostationary ring is held by different agencies who publish on different
 * services in different styles, and the seams between them are real and visible
 * and honest: that is where one satellite's horizon ends and the next begins.
 *
 * Nothing here is a forecast. Every pixel was measured, between five and
 * thirty-five minutes ago depending on whose satellite it came from.
 *
 * ── Why this is a pyramid ───────────────────────────────────────────────────
 *
 * The field is cut into tiles on the standard Mercator grid, and the tile is
 * the unit of everything: fetched once, calibrated once, painted once, and then
 * valid for every view that ever contains it.
 *
 * The first version of this layer was keyed to the viewport instead. It asked
 * each dish for one image the size and shape of the canvas, which sounds
 * cheaper — five requests instead of thirty — and is the reason the layer felt
 * like a photograph laid over the map rather than part of it. A rectangle of
 * screen is not a thing that can be cached: pan by one pixel and the key is
 * different, so every settle threw away a finished composite and asked five
 * servers for the same weather over an almost identical box. Between the settle
 * and the reply the old raster was stretched to cover the new view, so a zoom
 * softened the whole sky and then snapped. And there was nothing to show while
 * waiting but the wrong-sized picture or none.
 *
 * Tiles fix all three at once, and they fix them by being in world coordinates,
 * which is where this data always lived. A pan reuses everything it has already
 * seen. A zoom draws the level above it, stretched, and refines tile by tile as
 * the finer ones land — the map is never empty and never wrong, only
 * temporarily coarse, which is the honest state to be in while the picture is
 * still arriving. And the calibration, the territory seams and the latitude
 * weighting below all stop being functions of the view, which they never should
 * have been: a tile carries the same numbers wherever it is drawn.
 */

import { mercatorFrame } from "./view.js";

// The map wants three things from this file: `createSky`, and the two cadences.
// Everything else exported below is the pure half — the grid, the territory and
// the two calibrations — which is exported because `scripts/check-ir.cjs` is the
// only thing that can tell whether any of it is right. None of it can be checked
// by looking: a tile grid that is subtly misaligned, a territory with a gap at
// the antimeridian, and a calibration that disagrees with itself across a seam
// all produce a plausible wash over a plausible map.

// The ring, west to east by sub-satellite longitude. NASA publishes the three
// on the Pacific and American side, EUMETSAT the two on the African and Indian
// side, and between them there is no gap. Nothing else in this file names a
// satellite: the territories below are derived from these longitudes, so a dish
// being moved, replaced or added is a change to this list and nothing more.
const GIBS = "https://gibs.earthdata.nasa.gov/wms/epsg3857/best/wms.cgi";
const EUMETVIEW = "https://view.eumetsat.int/geoserver/wms";

export const DISCS = [
  { id: "goes-west", lon: -137.0, service: GIBS, layer: "GOES-West_ABI_Band13_Clean_Infrared" },
  { id: "goes-east", lon: -75.2, service: GIBS, layer: "GOES-East_ABI_Band13_Clean_Infrared" },
  { id: "msg-0deg", lon: 0.0, service: EUMETVIEW, layer: "msg_fes:ir108" },
  { id: "msg-iodc", lon: 45.5, service: EUMETVIEW, layer: "msg_iodc:ir108" },
  { id: "himawari", lon: 140.7, service: GIBS, layer: "Himawari_AHI_Band13_Clean_Infrared" },
];

// How often the ring is asked for a new picture. The satellites themselves run
// at ten (NASA) and fifteen (EUMETSAT) minute cadences, so asking faster than
// this only re-fetches the same frame.
export const REFRESH_MS = 10 * 60 * 1000;

// Replay quantises to this before it asks for anything, so scrubbing across an
// hour costs six steps rather than one per tick — and each of those six is a
// moment the pyramid can hold, so scrubbing back over ground already covered
// costs nothing at all.
export const STEP_MS = 10 * 60 * 1000;

const EARTH_HALF = 20037508.342789244; // half the equator, in metres

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

/** EPSG:3857 metres back to the sphere. Only this direction is needed: tiles
 *  are laid out in metres by definition, so everything that asks a question
 *  about where a sample is asks it of a coordinate that is already in metres. */
const lonAt = (x) => (x * 180) / EARTH_HALF;
const latAt = (y) => (Math.atan(Math.sinh((y * Math.PI) / EARTH_HALF)) * 180) / Math.PI;

// ── The grid ────────────────────────────────────────────────────────────────

/**
 * How many samples across a tile is fetched and stored.
 *
 * The field is a soft, coarse thing and is meant to be: geostationary infrared
 * resolves 2-3km at nadir and much less at the limb, and it is being drawn as a
 * wash behind a map rather than as an image. Held at a little under half the
 * screen size it will be drawn at, a tile costs a quarter of the pixels of a
 * sharp one and loses nothing that was ever there. It is also the whole cost of
 * the calibrating pass below, which runs on the main thread.
 */
export const SAMPLES = 128;

/**
 * How large a tile is meant to land on the glass, which is what picks the level.
 *
 * Bigger than SAMPLES on purpose: the ratio between them is the stretch, and at
 * about two and a half times it is invisible on a wash while cutting the tile
 * count for a viewport to something like a dozen.
 */
const TILE_PX = 300;

/**
 * Where the pyramid stops, because it is where the satellites stop.
 *
 * A level-7 tile is 2.4km per sample, which is geostationary infrared's own
 * resolution directly beneath the dish and better than it gets anywhere else.
 * Asking for level 8 would return the same measurement interpolated by somebody
 * else's server, at four times the bytes. Past here the field is stretched, and
 * that is the truthful thing to do: there is no more picture to have.
 *
 * It falls out that this lands almost exactly on the map's own MAX_K, so the
 * deepest zoom the tube offers is the last one with anything new in it.
 */
export const MAX_LEVEL = 7;

/** The pyramid level whose tiles land closest to TILE_PX at this projection. */
export function levelFor(projection) {
  // d3's Mercator puts the whole world across 2πk pixels.
  const worldPx = 2 * Math.PI * projection.scale();
  return clamp(Math.round(Math.log2(worldPx / TILE_PX)), 0, MAX_LEVEL);
}

/** The EPSG:3857 box of one tile. */
export function tileFrame(z, x, y) {
  const span = (2 * EARTH_HALF) / 2 ** z;
  const minX = -EARTH_HALF + x * span;
  const maxY = EARTH_HALF - y * span;
  return { minX, maxX: minX + span, minY: maxY - span, maxY };
}

/**
 * The tiles of one level that the screen rectangle touches.
 *
 * Clamped to the world rather than wrapped, in both axes. The map does not
 * repeat: pan to the edge and what is past it is void, not another Pacific, so
 * a tile index outside the grid is not a tile to fetch at some other turn of
 * the globe but ground that is simply not there.
 *
 * `ordered` sorts them nearest the middle of the screen first, which is the
 * order they should be *fetched* in and has nothing to say about the order they
 * are drawn in. Only the queue asks for it: the frame loop walks the same list
 * sixty times a second and would be paying for a sort whose result it throws
 * away.
 */
export function tilesFor(frame, z, ordered = false) {
  const n = 2 ** z;
  const span = (2 * EARTH_HALF) / n;
  const at = (v) => clamp(Math.floor(v / span), 0, n - 1);
  const x0 = at(frame.minX + EARTH_HALF);
  const x1 = at(frame.maxX + EARTH_HALF);
  const y0 = at(EARTH_HALF - frame.maxY);
  const y1 = at(EARTH_HALF - frame.minY);

  const out = [];
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) out.push({ z, x, y });
  }
  if (!ordered) return out;

  // Where the reader is actually looking, in fractional tiles — not the middle
  // of the block of tiles, which is a different point and sometimes a long way
  // off it. Tile indices are floored and then clamped to the world, so the
  // block runs to the tile boundary outside the screen on each side and stops
  // dead at the edge of the grid: a view held against the antimeridian, or one
  // where the centre falls near the edge of a tile, ranks its corners as though
  // the eye were somewhere it is not. Measuring from the frame's own centre
  // costs the same and is the thing that was meant.
  //
  // Distance in tiles is distance on the glass here, whatever the level:
  // Mercator is uniform in scale, so a tile is a square of constant size on
  // screen and no aspect correction is wanted.
  const cx = (frame.minX + frame.maxX) / 2 / span + n / 2;
  const cy = n / 2 - (frame.minY + frame.maxY) / 2 / span;
  const rank = (t) => (t.x + 0.5 - cx) ** 2 + (t.y + 0.5 - cy) ** 2;
  return out.sort((a, b) => rank(a) - rank(b));
}

/**
 * Which tile of `level` contains tile (z, x, y), and which patch of it that is.
 *
 * The whole of the lazy load rests on this. A tile that has not arrived is not
 * a hole: its parent covers four times the ground at half the detail and was
 * almost certainly fetched on the way in, so the quadrant of the parent that
 * belongs here is drawn instead. Two levels up it is a sixteenth, three a
 * sixty-fourth, and at worst it is level 0 — one tile for the planet, the
 * cheapest thing in the pyramid and the reason a cold start still shows a sky.
 *
 * `x >> shift` is the ancestor's index and the bits shifted out are the way
 * back down: they say which quadrant was taken at each step, which is exactly
 * the offset into the ancestor's pixels.
 */
export function ancestorPatch(z, x, y, level) {
  const shift = z - level;
  const step = SAMPLES / 2 ** shift;
  const mask = (1 << shift) - 1;
  return { x: x >> shift, y: y >> shift, sx: (x & mask) * step, sy: (y & mask) * step, step };
}

// ── Territory ───────────────────────────────────────────────────────────────

// How wide the handover between two neighbouring dishes is, in degrees.
//
// Narrow, and deliberately so. Every pixel is meant to come from exactly one
// satellite, because the alternative is worse than it sounds: neighbouring
// dishes are imaged up to fifteen minutes apart, so a cloud is in two slightly
// different places in two overlapping pictures, and averaging them does not
// produce a cloud in between. It produces two half-weight ghosts, and the peak
// value that made it a storm is gone. This layer's whole second pass keys off
// that peak.
//
// So the ring is divided into territories at the midpoints between dishes, and
// the blend exists only to keep the boundary from being a visible line.
const SEAM = 4;

// Each dish owns the longitudes it is nearest to. Computed once, from the ring
// itself, so moving or adding a satellite needs nothing else changed.
//
// No territory here reaches further than about 48° off its own nadir, because
// that is simply how far apart the dishes are, so every pixel comes from the
// better middle of some disc rather than from the mean of two limbs.
const TERRITORY = (() => {
  const ring = [...DISCS].sort((a, b) => a.lon - b.lon);
  const mid = (a, b) => (a + b) / 2;
  return new Map(
    ring.map((disc, i) => {
      const before = i === 0 ? ring[ring.length - 1].lon - 360 : ring[i - 1].lon;
      const after = i === ring.length - 1 ? ring[0].lon + 360 : ring[i + 1].lon;
      return [disc.id, { from: mid(before, disc.lon), to: mid(disc.lon, after) }];
    })
  );
})();

// The same cut in latitude, where it is not about which dish is nearest but
// about two separate things that both go wrong toward the poles.
//
// A geostationary satellite sits over the equator, so it sees high latitudes at
// the same grazing angle it sees its east and west limbs, and they smear the
// same way. And infrared cannot tell a cold cloud from cold ground: ice, snow
// and a polar winter all come back at cloud-top temperatures, so above about
// 60° the layer starts drawing the ground as though it were weather.
//
// Both stop mattering exactly where the subject does. Lightning needs a deep
// warm column to build in and essentially does not happen up here: the band
// this fades out is the band with nothing in it to miss.
const LAT_CORE = 60;
const LAT_LIMB = 74;

/** A ramp that is 0 at `out`, 1 at `in`, and smooth between. */
const ramp = (v, out, into) => clamp((v - out) / (into - out), 0, 1);

/**
 * How far a dish is to be believed at one longitude.
 *
 * Full weight across its own territory, handed over across SEAM at each edge,
 * nothing beyond. Every turn of the globe is tried because a territory can run
 * off the end of the coordinate system when the dish it belongs to sits near
 * the antimeridian: Himawari owns ground out to 181.85°, which is to say the
 * strip just west of the dateline, and the same territory at turn −360 is what
 * covers the strip just east of it.
 */
export function longitudeWeight(disc, lon) {
  const { from, to } = TERRITORY.get(disc.id);
  let best = 0;
  for (const turn of [-360, 0, 360]) {
    const w = Math.min(
      ramp(lon, from + turn - SEAM, from + turn + SEAM),
      ramp(lon, to + turn + SEAM, to + turn - SEAM)
    );
    if (w > best) best = w;
  }
  return best;
}

/** And the fade toward the poles, which no neighbour can improve on. */
const latitudeWeight = (lat) => ramp(Math.abs(lat), LAT_LIMB, LAT_CORE);

/** The dishes with any claim at all on a tile. */
function discsFor(frame) {
  const west = lonAt(frame.minX);
  const east = lonAt(frame.maxX);
  return DISCS.filter(
    (disc) => longitudeWeight(disc, west) > 0 || longitudeWeight(disc, east) > 0
  );
}

// ── Calibration ─────────────────────────────────────────────────────────────

/**
 * One pixel to one number: 0 is warm ground, 1 is the coldest cloud top there
 * is. This is the scale the whole layer is drawn from, and getting the two
 * agencies onto it is the only genuinely hard thing in this file.
 *
 * They do not publish the same picture. EUMETSAT ships plain greyscale, black
 * at about +40°C and white at about -80°C. NASA ships the standard enhanced
 * infrared: greyscale over the warm end, and then, colder than about -30°C, a
 * colour ramp over the tops. Same measurement, two stretches.
 *
 * Which means brightness cannot be compared across the seam. A cloud at -30°C
 * is mid-grey to EUMETSAT and the very top of NASA's greyscale, about to turn
 * cyan. Read off brightness alone, the same cloud changes temperature as it
 * drifts across the boundary, and worse: EUMETSAT's white would never reach
 * whatever threshold NASA's colours start at, so half the planet would never
 * show a cold top at all. That was the bug this exists to prevent.
 *
 * So each source is warped onto a common scale by the one landmark they share,
 * which is that -30°C where NASA's enhancement begins. Below it both are read
 * off brightness, each stretched to put -30°C at BREAK. Above it NASA is read
 * off hue instead, because that is where its brightness stops meaning anything,
 * while EUMETSAT keeps going on brightness to its own white point.
 *
 * Hue runs backwards through the enhancement: cyan where the colour first
 * appears, then green and yellow to red at the coldest tops. Sampling a live
 * tile puts effectively all of it between 0° and 200°.
 *
 * None of this is radiometry. Nobody is publishing brightness temperature here,
 * only a picture of it, and the numbers below were read off those pictures. It
 * is calibrated well enough that the same storm reads the same on both sides of
 * a seam, which is all the layer asks of it.
 */
export const BREAK = 0.72; // where -30°C sits on the common scale
const GREY_BREAK = 0.58; // ...and where it sits in EUMETSAT's own greyscale
const HUE_COLDEST = 200;

export function greyScalar(l) {
  const t = l / 255;
  return t <= GREY_BREAK
    ? (t / GREY_BREAK) * BREAK
    : BREAK + ((t - GREY_BREAK) / (1 - GREY_BREAK)) * (0.97 - BREAK);
}

export function enhancedScalar(r, g, b) {
  const max = r > g ? (r > b ? r : b) : g > b ? g : b;
  const min = r < g ? (r < b ? r : b) : g < b ? g : b;
  const spread = max - min;
  // Grey: still on NASA's own greyscale, which ends exactly at the break.
  if (spread <= 10) return (max / 255) * BREAK;

  let hue;
  if (max === r) hue = ((g - b) / spread) % 6;
  else if (max === g) hue = (b - r) / spread + 2;
  else hue = (r - g) / spread + 4;
  hue *= 60;
  if (hue < 0) hue += 360;
  // Past the red end the ramp wraps into magenta, which is colder still, not
  // warmer; folded back rather than allowed to read as cyan. The bound has to
  // include 300 itself: that is pure magenta, the coldest value the enhancement
  // has, and left outside the fold it clamps to the warm end of the ramp and
  // draws the deepest core on the map as though it were the shallowest.
  const cold = hue >= 300 ? 1 : 1 - clamp(hue, 0, HUE_COLDEST) / HUE_COLDEST;
  return BREAK + (1 - BREAK) * cold;
}

/**
 * Warm ground and warm sea are most of the planet and are not weather. Painted,
 * they would fog the whole map to no purpose, so the scale is cut here and only
 * what is colder than this is drawn at all.
 */
const FLOOR = 0.47;

// Where the cold tops start, on the 0-255 a tile is stored at. Set just above
// the -30°C break the two sources were calibrated on, so this is the same cloud
// on both sides of a seam: not weather in general any more, but the specific
// thing this instrument is about, a column driven high enough and fast enough
// to separate charge.
const TOPS = Math.round(((0.8 - FLOOR) / (1 - FLOOR)) * 255);

/**
 * How much a cold top at this latitude is allowed to mean thunderstorm.
 *
 * The second pass is the one that says "convection here", and it says it by an
 * absolute temperature, which is only a fair test in the tropics. The
 * tropopause is high and cold over the equator and much lower toward the poles,
 * so ordinary frontal cloud in the Southern Ocean tops out below the same
 * -30°C that takes a towering cumulonimbus to reach over the Congo. Judged on
 * temperature alone the whole southern storm track lights up as deep
 * convection, which it is not, and in August it lights up as a solid white belt
 * across the bottom of the map, which is how this was found.
 *
 * Rather than pretend to know the tropopause, this weights the claim by the
 * thing that actually goes with lightning: a deep warm column, which is a
 * property of the tropics and of summer continents and runs out with latitude.
 * The cloud itself is untouched and stays honest everywhere; only the assertion
 * that it is a storm is discounted where that assertion is weak.
 */
const convective = (lat) => ramp(Math.abs(lat), 62, 35);

// ── Fetching ────────────────────────────────────────────────────────────────

/** A WMS GetMap for one disc over one tile. `at` is null for the latest frame. */
function url(disc, frame, at) {
  const params = new URLSearchParams({
    SERVICE: "WMS",
    VERSION: "1.3.0",
    REQUEST: "GetMap",
    LAYERS: disc.layer,
    STYLES: "",
    CRS: "EPSG:3857",
    BBOX: [frame.minX, frame.minY, frame.maxX, frame.maxY].join(","),
    WIDTH: String(SAMPLES),
    HEIGHT: String(SAMPLES),
    FORMAT: "image/png",
    TRANSPARENT: "TRUE",
  });
  // Omitted entirely when live: both services read a missing TIME as "the most
  // recent frame you have", which is a better answer than any timestamp this
  // page could compute for itself.
  if (at !== null) params.set("TIME", new Date(at).toISOString().replace(/\.\d+Z$/, "Z"));
  return `${disc.service}?${params}`;
}

function load(src) {
  return new Promise((resolve) => {
    const img = new Image();
    // The pixels are read back below, so the canvas they land on must not be
    // tainted. Both services answer with `access-control-allow-origin: *`.
    img.crossOrigin = "anonymous";
    // A disc that fails is a disc that is missing from the tile, not an error:
    // the ring is five independent services and the map is still a map with
    // four of them.
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/**
 * One tile, from however many dishes can see it, as a field of bytes.
 *
 * Usually one dish, which is the case worth being fast at: a tile is at most
 * 90° wide at the shallowest level anyone will see and a good deal narrower
 * everywhere else, so most of them fall wholly inside one territory and cost a
 * single request. Two only near a seam.
 *
 * Returns null when nothing answered, which is the same thing as the layer
 * being off. There is no error state to draw: a cloud layer that failed and a
 * sky with no cloud in it should not look different from each other on an
 * instrument whose subject is the lightning.
 */
async function fetchTile(z, x, y, at) {
  const frame = tileFrame(z, x, y);
  const discs = discsFor(frame);
  if (!discs.length) return null;

  const images = await Promise.all(discs.map((disc) => load(url(disc, frame, at))));
  if (!images.some(Boolean)) return null;

  // Each disc is decoded on its own sheet rather than after they are stacked.
  // It has to be: which of the two stretches above a pixel was drawn with is
  // knowable here and nowhere later, and a composite of two calibrations is a
  // picture no single scale can read.
  const sheet = document.createElement("canvas");
  sheet.width = SAMPLES;
  sheet.height = SAMPLES;
  const ctx = sheet.getContext("2d", { willReadFrequently: true });

  // The mask is separable and the tile is a Mercator box, so both cuts are one
  // number per column and one per row rather than a pass over every pixel.
  const cols = new Float32Array(SAMPLES);
  const rows = new Float32Array(SAMPLES);
  const lat = new Float32Array(SAMPLES);
  for (let i = 0; i < SAMPLES; i++) {
    const yM = frame.maxY - ((i + 0.5) / SAMPLES) * (frame.maxY - frame.minY);
    lat[i] = latAt(yM);
    rows[i] = latitudeWeight(lat[i]);
  }

  // A weighted mean, kept as a running sum and a running weight rather than
  // blended in place. Blending in place looks equivalent and is not: a pixel
  // that only one disc can see, and that one only faintly, would come out
  // scaled by that faint weight instead of simply being what the one disc that
  // can see it says.
  const sum = new Float32Array(SAMPLES * SAMPLES);
  const total = new Float32Array(SAMPLES * SAMPLES);

  discs.forEach((disc, i) => {
    const image = images[i];
    if (!image) return;
    for (let col = 0; col < SAMPLES; col++) {
      const xM = frame.minX + ((col + 0.5) / SAMPLES) * (frame.maxX - frame.minX);
      cols[col] = longitudeWeight(disc, lonAt(xM));
    }
    // Nothing of this dish reaches this tile after all — the corners said it
    // might, the columns say otherwise.
    if (!cols.some((w) => w > 0)) return;

    ctx.clearRect(0, 0, SAMPLES, SAMPLES);
    ctx.drawImage(image, 0, 0, SAMPLES, SAMPLES);
    const { data } = ctx.getImageData(0, 0, SAMPLES, SAMPLES);
    const enhanced = disc.service === GIBS;

    for (let row = 0; row < SAMPLES; row++) {
      const wRow = rows[row];
      if (!wRow) continue;
      for (let col = 0; col < SAMPLES; col++) {
        const weight = cols[col] * wRow;
        if (!weight) continue;
        const p = row * SAMPLES + col;
        const j = p * 4;
        if (!data[j + 3]) continue; // outside this disc's horizon
        const t = enhanced
          ? enhancedScalar(data[j], data[j + 1], data[j + 2])
          : greyScalar(data[j]);
        sum[p] += t * weight;
        total[p] += weight;
      }
    }
  });

  const field = new Uint8Array(SAMPLES * SAMPLES);
  let any = false;
  for (let p = 0; p < field.length; p++) {
    if (!total[p]) continue; // no dish can see it
    const t = sum[p] / total[p];
    if (t > FLOOR) {
      field[p] = Math.round(((t - FLOOR) / (1 - FLOOR)) * 255);
      any = true;
    }
  }
  // A clear tile is still a tile: it is the answer "no cloud here", and holding
  // it stops the pyramid asking the same question again on the next pan.
  return { field, lat, any };
}

// ── Painting ────────────────────────────────────────────────────────────────

/**
 * A tile, as something to look at.
 *
 * Two passes, because cloud and storm are not the same reading and should not
 * be the same mark. The body of the cloud is laid down in the land token at low
 * alpha: it is terrain, the same class of thing as the dot matrix, and it is
 * there to be seen past. Over it, only the coldest tops, in the reading token
 * and much harder. What that second pass draws is very nearly a map of where
 * this map is about to have something to show, which is why it is allowed to be
 * bright enough to find with the eye.
 *
 * Both passes are built as an alpha channel and then filled through: the tokens
 * are CSS colours and stay CSS colours, so whatever the stylesheet and the
 * phosphor between them decided a token is, is what gets drawn.
 */
function paintTile({ field, lat }, body, tops) {
  const size = SAMPLES * SAMPLES;
  const warm = new Uint8ClampedArray(size * 4);
  const cold = new Uint8ClampedArray(size * 4);
  let anyCold = false;

  for (let row = 0; row < SAMPLES; row++) {
    const lift = convective(lat[row]);
    for (let col = 0; col < SAMPLES; col++) {
      const p = row * SAMPLES + col;
      const v = field[p];
      if (!v) continue;
      const t = v / 255;
      // Squared, so the field falls away fast below its own top end. A cloud
      // layer that renders every cloud honestly is a photograph of the planet,
      // and this is not a photograph: it is a backdrop with one job, which is
      // to be dark everywhere the weather is not.
      warm[p * 4 + 3] = t * t * 38;
      if (v > TOPS && lift > 0) {
        cold[p * 4 + 3] = Math.sqrt((v - TOPS) / (255 - TOPS)) * 135 * lift;
        anyCold = true;
      }
    }
  }

  const canvas = document.createElement("canvas");
  canvas.width = SAMPLES;
  canvas.height = SAMPLES;
  const ctx = canvas.getContext("2d");
  const through = (alpha, colour) => {
    const scratch = document.createElement("canvas");
    scratch.width = SAMPLES;
    scratch.height = SAMPLES;
    const sctx = scratch.getContext("2d");
    const image = sctx.createImageData(SAMPLES, SAMPLES);
    image.data.set(alpha, 0);
    sctx.putImageData(image, 0, 0);
    sctx.globalCompositeOperation = "source-in";
    sctx.fillStyle = colour;
    sctx.fillRect(0, 0, SAMPLES, SAMPLES);
    ctx.drawImage(scratch, 0, 0);
  };

  through(warm, body);
  if (anyCold) through(cold, tops);
  return canvas;
}

// ── The store ───────────────────────────────────────────────────────────────

// How many tile builds are allowed to be in the air at once. Each is one to
// three requests to somebody else's server, and the queue is ordered from the
// middle of the screen outward, so a low ceiling is not slower in any way the
// reader can see: it only means the corners arrive after the centre.
const IN_FLIGHT = 4;

// How many painted tiles are kept. A tile is SAMPLES² of scalar and the same
// again as a canvas, so this is a few tens of megabytes at the very worst and
// far less in practice — and it is what makes panning back over ground you have
// already looked at cost nothing.
const KEEP = 320;

// How long a tile takes to come up. Short: there is almost always an ancestor
// underneath showing the same weather more coarsely, so this is a sharpening
// rather than an arrival, and anything longer reads as a lag.
const TILE_FADE_MS = 240;

// And how long a whole new frame off the satellites takes to replace the one
// before it. Long enough to read as weather moving rather than as a panel being
// swapped, short enough that the two are never both legible for long.
const MOMENT_FADE_MS = 550;

const keyOf = (moment, z, x, y) => `${moment}/${z}/${x}/${y}`;

/**
 * The pyramid, and everything that is stateful about this layer.
 *
 * Held by the map in a ref and driven from two places: `want` on every settle,
 * which says which tiles matter now, and `draw` on every frame, which puts up
 * whatever has arrived. Nothing here goes through React. The field changes on
 * the network's schedule rather than the render's, and a component that
 * re-rendered every time a tile landed would be re-rendering the whole map
 * thirty times to fill one screen.
 */
export function createSky() {
  const tiles = new Map(); // key -> { field, lat, canvas, tinted, born, used }
  const inFlight = new Set();
  let queue = [];
  let running = 0;
  let clock = 0;

  let body = "#fff";
  let tops = "#fff";
  let tint = "";

  // Which frame off the satellites is on the glass, which one is coming up
  // behind it, and when the handover started. `shown` is null until the very
  // first tile lands, which is the one case that is not a crossfade: there is
  // nothing to fade from, so the sky simply fills in.
  let shown = null;
  let incoming = null;
  let incomingAt = null;
  let fadeFrom = 0;

  const pump = () => {
    while (running < IN_FLIGHT && queue.length) {
      const job = queue.shift();
      if (tiles.has(job.key) || inFlight.has(job.key)) continue;
      inFlight.add(job.key);
      running++;
      fetchTile(job.z, job.x, job.y, job.at)
        .then((tile) => {
          if (tile) tiles.set(job.key, { ...tile, born: performance.now(), used: clock });
        })
        .catch(() => {
          // Same answer as an empty sky. See `fetchTile`.
        })
        .finally(() => {
          inFlight.delete(job.key);
          running--;
          pump();
        });
    }
  };

  /** Drop the least recently drawn tiles once there are too many to hold. */
  const evict = () => {
    if (tiles.size <= KEEP) return;
    const order = [...tiles.entries()].sort((a, b) => a[1].used - b[1].used);
    for (let i = 0; i < order.length - KEEP; i++) tiles.delete(order[i][0]);
  };

  /**
   * Draw one tile's rectangle, or the best ancestor of it that exists.
   *
   * This is the whole of the lazy load. A tile that has not arrived is not a
   * hole: the level above it covers four times the ground at half the detail
   * and was almost certainly fetched on the way in, so the quadrant of it that
   * belongs here goes up instead. Walk up until something answers. At worst
   * that is level 0, one tile for the planet, which is the cheapest thing in
   * the pyramid and the reason a cold start still shows a sky.
   */
  const drawTile = (ctx, moment, z, x, y, place, now, alpha) => {
    for (let level = z; level >= 0; level--) {
      const patch = ancestorPatch(z, x, y, level);
      const tile = tiles.get(keyOf(moment, level, patch.x, patch.y));
      if (!tile) continue;
      tile.used = clock;
      if (!tile.any) return true; // clear sky, and known to be
      if (tile.tinted !== tint) {
        tile.canvas = paintTile(tile, body, tops);
        tile.tinted = tint;
      }
      // Only a tile drawn at its own level has an arrival worth showing; an
      // ancestor standing in for one is already on the glass and must not blink
      // when the tile it is covering for finally lands.
      const age = level === z ? Math.min(1, (now - tile.born) / TILE_FADE_MS) : 1;
      ctx.globalAlpha = alpha * age;
      ctx.drawImage(
        tile.canvas,
        patch.sx,
        patch.sy,
        patch.step,
        patch.step,
        place.x,
        place.y,
        place.w,
        place.h
      );
      return true;
    }
    return false;
  };

  return {
    /** The tokens the two passes are drawn in; a change repaints, never refetches. */
    palette(nextBody, nextTops) {
      body = nextBody;
      tops = nextTops;
      tint = `${nextBody}|${nextTops}`;
    },

    /** Everything goes: the layer was switched off. */
    clear() {
      tiles.clear();
      queue = [];
      shown = null;
      incoming = null;
      incomingAt = null;
    },

    /**
     * What matters now.
     *
     * Called on a settle, and cheap when nothing moved: the queue is rebuilt
     * from scratch every time, which is the point. A tile that was wanted for
     * the last view and is not wanted for this one should not still be fetching
     * on the reader's behalf, and one that has already arrived costs a map
     * lookup to skip. Requests already in the air are left alone — they are
     * paid for, and the pyramid keeps whatever they bring.
     */
    want(projection, width, height, at) {
      if (!projection || !width || !height) return;
      const moment = String(at);
      if (moment === shown) {
        // Back where we started. Scrubbing the transport away and then straight
        // back before the frame it asked for could arrive leaves an incoming
        // moment nobody wants any more; left standing it would eventually land
        // and fade the map to a time the reader has already left.
        incoming = null;
        incomingAt = null;
        fadeFrom = 0;
      } else if (moment !== incoming) {
        incoming = moment;
        incomingAt = at;
        fadeFrom = 0;
      }

      const frame = mercatorFrame(projection, width, height);
      const z = levelFor(projection);
      const target = incoming ?? shown;
      const targetAt = target === incoming ? incomingAt : at;

      queue = [];
      // Centre outward. There is a ceiling on how many of these can be in the
      // air at once, so the queue's order is the order the sky fills in, and
      // the tile under the reader's eye is worth more than the one in the
      // corner behind the feed.
      for (const tile of tilesFor(frame, z, true)) {
        const key = keyOf(target, tile.z, tile.x, tile.y);
        if (tiles.has(key) || inFlight.has(key)) continue;
        queue.push({ ...tile, key, at: targetAt });
      }
      pump();
    },

    /**
     * The field, onto the map's canvas, in whatever state it has reached.
     *
     * Called every frame from the render loop, so it reads the live projection
     * rather than the settled one and the sky tracks a drag exactly: a tile is
     * a rectangle of the world, and where that rectangle is on the glass is
     * something the projection can answer for any view, mid-gesture or not.
     * There is no stretched-from-the-old-view step here at all, because there
     * is no view the tiles belong to.
     */
    draw(ctx, projection, width, height, now) {
      if (!projection || !width || !height) return;
      const frame = mercatorFrame(projection, width, height);
      const z = levelFor(projection);
      const wanted = tilesFor(frame, z);
      clock++;

      // Metres to screen, both axes at once: EPSG:3857 and d3's Mercator are
      // the same pair of numbers a constant apart, so this is a multiply.
      const k = projection.scale();
      const [tx, ty] = projection.translate();
      const at = (m) => (k * Math.PI * m) / EARTH_HALF;
      // Rounded, and rounded from the shared edge rather than from a width:
      // neighbouring tiles then agree on where the boundary is to the pixel and
      // the grid leaves no hairlines between them.
      const place = (tile) => {
        const f = tileFrame(tile.z, tile.x, tile.y);
        const left = Math.round(at(f.minX) + tx);
        const right = Math.round(at(f.maxX) + tx);
        const top = Math.round(ty - at(f.maxY));
        const bottom = Math.round(ty - at(f.minY));
        return { x: left, y: top, w: right - left, h: bottom - top };
      };

      // The handover between one frame off the satellites and the next waits
      // for the new one to be able to cover the screen. Not for every dish and
      // not for every tile at full detail — an ancestor is a real answer — only
      // for there to be nothing missing, so the sky never thins out mid-fade.
      if (incoming && shown !== null && !fadeFrom) {
        const ready = wanted.every((tile) => {
          for (let level = tile.z; level >= 0; level--) {
            const shift = tile.z - level;
            if (tiles.has(keyOf(incoming, level, tile.x >> shift, tile.y >> shift))) return true;
          }
          return false;
        });
        if (ready) fadeFrom = now;
      }

      // How much of the incoming frame to show. Nothing at all until it can
      // cover the screen — until then the frame already up is the whole of the
      // sky, which is the point of waiting: a half-arrived replacement drawn
      // over its predecessor is exactly the thinning-out this is here to
      // prevent. The one exception is a cold start, where there is nothing to
      // fade from and the tiles simply fill in as they land.
      let fade = 0;
      if (incoming) {
        if (shown === null) fade = 1;
        else if (fadeFrom) fade = Math.min(1, (now - fadeFrom) / MOMENT_FADE_MS);
      }

      // The frame on the glass, on its way out, and the one arriving over it.
      // Both are drawn only while they are worth something, so the ordinary
      // case — one frame, no handover — is a single pass at full weight.
      for (const tile of wanted) {
        const box = place(tile);
        if (box.w <= 0 || box.h <= 0) continue;
        // Out as the other comes in, and the complement is the point: held at
        // full weight the two frames sum to more sky than either of them is,
        // and the pair reads as one field doubled rather than one replacing the
        // other. Both are washes, so the two halves add back to a whole.
        if (shown !== null && fade < 1) {
          drawTile(ctx, shown, tile.z, tile.x, tile.y, box, now, 1 - fade);
        }
        if (incoming && fade > 0) {
          drawTile(ctx, incoming, tile.z, tile.x, tile.y, box, now, fade);
        }
      }

      // Handover complete. The frame that was on the glass is one nobody is
      // going to ask for again, so its tiles go rather than sit in the budget
      // crowding out ground the reader can actually reach.
      if (incoming && fade >= 1) {
        const gone = shown;
        shown = incoming;
        incoming = null;
        incomingAt = null;
        fadeFrom = 0;
        if (gone !== null) {
          for (const key of tiles.keys()) {
            if (key.startsWith(`${gone}/`)) tiles.delete(key);
          }
        }
      }

      ctx.globalAlpha = 1;
      evict();
    },
  };
}
