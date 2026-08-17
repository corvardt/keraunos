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
 * Nothing here is a forecast. Every pixel was measured, between twenty and
 * forty minutes ago depending on whose satellite it came from — one moment
 * named across the whole ring, and each service's newest scan at or before it.
 * See LAG_MS.
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
} from "./field.js";

// The map wants three things from this file: `createSky`, and the two cadences.
// Everything else exported below is the pure half — the grid, the territory and
// the calibration — which is exported because `scripts/check-ir.cjs` is the
// only thing that can tell whether any of it is right. None of it can be checked
// by looking: a tile grid that is subtly misaligned, a territory with a gap at
// the antimeridian, and a calibration that disagrees with itself across a seam
// all produce a plausible wash over a plausible map.

// The ring, west to east by sub-satellite longitude. Wisconsin's RealEarth
// carries the three on the Pacific and American side, EUMETSAT the two on the
// African and Indian side, and between them there is no gap. Nothing else in
// this file names a satellite: the territories below are derived from these
// longitudes, so a dish being moved, replaced or added is a change to this list
// and nothing more.
//
// The three were NASA's GIBS once, which is the same measurement and the better
// archive. It was dropped for being slow: GIBS holds a frame back thirty-five
// minutes and then flaps, answering for it one minute and not the next as it
// works through their caches, and this is an instrument about a storm that is
// happening. RealEarth publishes the same scans within fifteen, in Mercator
// tiles that land exactly on the grid below, and will say what it has.
const REALEARTH = "https://realearth.ssec.wisc.edu/api/image";
const EUMETVIEW = "https://view.eumetsat.int/geoserver/wms";

export const DISCS = [
  { id: "goes-west", lon: -137.0, service: REALEARTH, layer: "G18-ABI-FD-BAND13" },
  { id: "goes-east", lon: -75.2, service: REALEARTH, layer: "G19-ABI-FD-BAND13" },
  { id: "msg-0deg", lon: 0.0, service: EUMETVIEW, layer: "msg_fes:ir108" },
  { id: "msg-iodc", lon: 45.5, service: EUMETVIEW, layer: "msg_iodc:ir108" },
  { id: "himawari", lon: 140.7, service: REALEARTH, layer: "HIMAWARI-B13" },
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

/**
 * How far behind the clock the live moment is set.
 *
 * A scan is not published the moment it is taken: the dish has to finish the
 * disc, and the agency has to process it and put it on a server. Both services
 * answer a time they do not have yet by handing back the newest frame they do
 * have — except EUMETSAT, which answers 502 for a moment past its own last
 * one. So this only has to clear EUMETSAT's publication, and theirs is the
 * quickest of the five at about fifteen minutes.
 *
 * One lag for the whole ring rather than one per dish. A screen assembled out
 * of several moments is the thing that made the clouds jump on a zoom, and the
 * seams are where mixed times would show worst.
 */
export const LAG_MS = 20 * 60 * 1000;


// ── The grid ────────────────────────────────────────────────────────────────
//
// The pyramid itself now lives in `field.js`, because none of it is about
// infrared: the same tiles, queue, ancestors and crossfade carry the radar
// composite as well. What stays here is the pair of numbers that make the grid
// this source's own, and they are both statements about the instrument at the
// far end of it rather than preferences.

/**
 * How many samples across a tile is fetched and stored.
 *
 * The field is a soft, coarse thing and is meant to be: geostationary infrared
 * resolves 2-3km at nadir and much less at the limb, and it is being drawn as a
 * wash behind a map rather than as an image.
 *
 * Matched to the block, which is what actually reaches the glass. A tile lands
 * near TILE_PX and a block is BLOCK_PX, so a tile covers about sixty blocks —
 * and a sample finer than the block it will be averaged into is a sample nobody
 * ever sees. This was 128 when the field went to the canvas unquantised; half
 * of that was being thrown away at the last step, and being a square, dropping
 * it is four times less of everything the main thread does here: samples
 * calibrated, bytes held, and pixels painted.
 */
export const SAMPLES = 64;

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

// Bound to this source's grid, and re-exported under their old names because
// `scripts/check-ir.cjs` is what says whether any of the geometry is right and
// it asks this file for them.
export const levelFor = (projection) => baseLevelFor(projection, TILE_PX, MAX_LEVEL);
export const ancestorPatch = (z, x, y, level) => basePatch(z, x, y, level, SAMPLES);
export { tileFrame, tilesFor };

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
 * services onto it is the only genuinely hard thing in this file.
 *
 * Both ship plain greyscale, black warm and white cold, and neither ships the
 * same one. EUMETSAT runs its ramp across the full byte, black at about +40°C
 * and white at about -80°C. RealEarth renders a wider range of temperature into
 * the same byte, so the weather occupies the middle of it: nothing on a live
 * tile is darker than about 50 or brighter than about 190, and the same cloud
 * that EUMETSAT draws at 148 it draws at 113.
 *
 * Which means brightness cannot be compared across a seam. Read off the byte
 * alone, a storm cools as it drifts west out of Meteosat's ground and into
 * GOES-East's, and the coldest tops RealEarth can draw would never reach a
 * threshold set on EUMETSAT's white. So each service is described by the three
 * points on its own ramp that matter — where it leaves the warm floor, where
 * -30°C lands, and where it tops out — and read onto the common scale through
 * them.
 *
 * The numbers were measured rather than looked up, by the only method that can
 * settle it: over the Atlantic and the Indian Ocean two dishes on different
 * services see the same clouds, so a tile from each is one scene rendered
 * twice, and matching their distributions gives the mapping directly. Three
 * such patches agree to within a hundredth of the scale.
 *
 * None of this is radiometry. Nobody is publishing brightness temperature here,
 * only a picture of it. It is calibrated well enough that the same storm reads
 * the same on both sides of a seam, which is all the layer asks of it.
 */
export const BREAK = 0.72; // where -30°C sits on the common scale
const COLDEST = 0.97; // ...and where each service's white point does

/**
 * Each service's own greyscale, as the three bytes that anchor it: the warm
 * end of its ramp, its -30°C, and its coldest.
 */
export const STRETCH = {
  [EUMETVIEW]: { warm: 0, break: 148, cold: 255 },
  [REALEARTH]: { warm: 50, break: 113, cold: 190 },
};

export function scalarFor(stretch, l) {
  if (l <= stretch.warm) return 0;
  if (l <= stretch.break) {
    return ((l - stretch.warm) / (stretch.break - stretch.warm)) * BREAK;
  }
  const past = Math.min(1, (l - stretch.break) / (stretch.cold - stretch.break));
  return BREAK + past * (COLDEST - BREAK);
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

/**
 * One disc's picture of one tile, at one named moment.
 *
 * The moment is always named, live as well as rewound. It was left off when
 * live once, on the reasoning that a service asked for nothing would hand back
 * whatever is newest, which is fresher than any timestamp this page could
 * compute for itself. EUMETSAT does not do that. Asked for the same ground in
 * two different boxes it hands back two different frames, each stable for its
 * own box, and neither of them one of the last few hours' published ones.
 *
 * Which is invisible until the pyramid crosses a level. A tile and the parent
 * it was drawn from are two different boxes, so they come back as two different
 * moments, and the zoom that swaps one for the other moves every cloud on the
 * map about a degree sideways. Named, parent and children agree to the sample
 * at every level, on both services.
 *
 * Both then resolve that name the same way — the newest frame at or before it —
 * so a moment between scans, or one a dish has not reached yet, is answered
 * with the last real picture rather than an error or a gap.
 */
export function url(disc, tile, frame, at) {
  if (disc.service === REALEARTH) {
    // RealEarth cuts the world on the same grid this file does, so there is no
    // box to describe: the tile's own address is the request. Asked at the far
    // end of the step rather than its start, because the scan stamped 13:20 is
    // published at 13:20:21 and a request for 13:20:00 exactly resolves to the
    // step before it — a free ten minutes lost to a rounding.
    //
    // And asked at SAMPLES across, which is the same thing the WMS call below
    // asks for and the only resolution this file has anywhere to put. Left off,
    // the tile arrives at 256 and half of it is thrown away on the next line —
    // but worse, asking for detail finer than the dish measured is a thing
    // RealEarth refuses in the rudest possible way. It serves the tile with
    // "Size limit exceeded" printed across it, and a caption rendered into the
    // imagery is read by the calibration below as a cloud: pure white is the
    // coldest top there is, so the layer draws the words as a storm. It only
    // bites where a Mercator tile covers least ground, which is to say away
    // from the equator and at the deepest zoom, and the map is at its most
    // convincing exactly there.
    const t = new Date(at + STEP_MS - 1000).toISOString(); // 2026-08-16T13:59:59.000Z
    const stamp = `${t.slice(0, 4)}${t.slice(5, 7)}${t.slice(8, 10)}.${t.slice(11, 13)}${t.slice(14, 16)}${t.slice(17, 19)}`;
    return (
      `${disc.service}?products=${disc.layer}` +
      `&time=${stamp}&x=${tile.x}&y=${tile.y}&z=${tile.z}&size=${SAMPLES}`
    );
  }

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
    TIME: new Date(at).toISOString().replace(/\.\d+Z$/, "Z"),
  });
  return `${disc.service}?${params}`;
}

/**
 * Did the service refuse this one?
 *
 * RealEarth answers a request it will not serve with a picture rather than a
 * status: the tile arrives 200 OK with "Size limit exceeded" printed across it,
 * and a caption rendered into the imagery is read by the calibration above as
 * weather. White is the coldest top there is, so the layer draws the words as a
 * storm — the one failure on this map that invents a reading rather than
 * omitting one.
 *
 * It is not a threshold anything here can stay under. It moves: the same tile,
 * at the same moment and the same size, is refused one minute and served the
 * next, and asking more slowly does not help. Asking at SAMPLES rather than at
 * the native 256 makes it rare, and this catches the rest.
 *
 * The test is exact because the caption is the only thing in this data that is
 * drawn rather than measured. Infrared arrives as a stretch well inside the
 * byte — a live tile runs from about 70 to about 200, and even the saturated
 * disc edge bottoms out near 72 — so pure black and pure white in one tile is
 * text, every time.
 */
function refused(data) {
  let dark = false;
  let bright = false;
  for (let j = 0; j < data.length; j += 4) {
    if (!data[j + 3]) continue;
    if (data[j] === 0) dark = true;
    if (data[j] === 255) bright = true;
    if (dark && bright) return true;
  }
  return false;
}

function attempt(src) {
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

// Long enough that the second ask is not the same instant as the first, short
// enough to stay inside the settle that wanted the tile.
const RETRY_MS = 400;

/**
 * A disc, asked twice before it is given up on.
 *
 * A WMS backend under load and a service that is genuinely down look identical
 * at the first attempt and are not remotely the same thing. EUMETSAT's GeoServer
 * answers the occasional 500 to a request that succeeds when repeated a second
 * later, and without this that costs more than the request: a tile spanning two
 * territories keeps whatever the other dishes gave it, so the tile is held —
 * with a hole where this disc should have been — until the frame rolls over ten
 * minutes later. The refusal path a few lines down already draws exactly this
 * distinction, and treats a temporary no as no answer at all rather than as an
 * answer worth keeping.
 *
 * One retry and no more. Two failures is the evidence that this is the outage
 * rather than the blip, and past that the old behaviour is the right one: take
 * the tile without this disc, because a ring of five is still a map with four
 * and a service that is down would otherwise be asked forever.
 */
async function load(src) {
  const first = await attempt(src);
  if (first) return first;
  await new Promise((resolve) => setTimeout(resolve, RETRY_MS));
  return attempt(src);
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

  // Weighed before it is fetched, not after. Mercator gives the polar rows an
  // enormous share of the grid — at level 4 the top two rows of tiles are
  // entirely above the latitude the mask closes at, and every one of them used
  // to be a request paid for, decoded, and multiplied by nothing. Returned as
  // an empty tile rather than as a failure, because that is what it is: this
  // ground is answered, and the answer is no cloud here. A failure would be
  // asked for again on the next settle, forever.
  if (!rows.some((w) => w > 0)) {
    return { field: new Uint8Array(SAMPLES * SAMPLES), lat, any: false };
  }

  const tile = { z, x, y };
  const images = await Promise.all(discs.map((disc) => load(url(disc, tile, frame, at))));
  if (!images.some(Boolean)) return null;

  // Each disc is decoded on its own sheet rather than after they are stacked.
  // It has to be: which of the two stretches above a pixel was drawn with is
  // knowable here and nowhere later, and a composite of two calibrations is a
  // picture no single scale can read.
  const sheet = document.createElement("canvas");
  sheet.width = SAMPLES;
  sheet.height = SAMPLES;
  const ctx = sheet.getContext("2d", { willReadFrequently: true });

  // A weighted mean, kept as a running sum and a running weight rather than
  // blended in place. Blending in place looks equivalent and is not: a pixel
  // that only one disc can see, and that one only faintly, would come out
  // scaled by that faint weight instead of simply being what the one disc that
  // can see it says.
  const sum = new Float32Array(SAMPLES * SAMPLES);
  const total = new Float32Array(SAMPLES * SAMPLES);
  let turnedAway = false;

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
    if (refused(data)) {
      turnedAway = true;
      return;
    }
    const stretch = STRETCH[disc.service];

    for (let row = 0; row < SAMPLES; row++) {
      const wRow = rows[row];
      if (!wRow) continue;
      for (let col = 0; col < SAMPLES; col++) {
        const weight = cols[col] * wRow;
        if (!weight) continue;
        const p = row * SAMPLES + col;
        const j = p * 4;
        if (!data[j + 3]) continue; // outside this disc's horizon
        const t = scalarFor(stretch, data[j]);
        sum[p] += t * weight;
        total[p] += weight;
      }
    }
  });

  // A refusal is not an answer, so it is not kept. Returning null leaves the
  // key out of the pyramid, which puts the tile back in the queue on the next
  // settle — right, for a thing that is temporary by nature. Until then the
  // ancestor covers the ground, as it does for any tile still in the air.
  if (turnedAway) return null;

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

  fillThrough(ctx, warm, body, SAMPLES);
  if (anyCold) fillThrough(ctx, cold, tops, SAMPLES);
  return canvas;
}

// ── The store ───────────────────────────────────────────────────────────────

/**
 * The pyramid, driven by the map.
 *
 * Everything stateful about drawing a tiled field is in `field.js` and shared
 * with the radar composite. What is particular to the sky is above: which
 * dishes cover a tile, how each service's greyscale is read, and how a cloud
 * and a storm top are two different marks.
 */
export function createSky() {
  return createField({
    samples: SAMPLES,
    tilePx: TILE_PX,
    maxLevel: MAX_LEVEL,
    fetch: fetchTile,
    paint: paintTile,
  });
}
