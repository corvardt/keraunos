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
 * forty minutes ago depending on whose satellite it came from: one moment
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
 * cheaper, five requests instead of thirty, and is the reason the layer felt
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
 * the finer ones land, so the map is never empty and never wrong, only
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
  MIN_PATCH,
  metresAt,
  loadPicture,
} from "./field.js";
import { polarSheet, polarWeight } from "./polar.js";

// The map wants three things from this file: `createSky`, and the two cadences.
// Everything else exported below is the pure half, the grid, the territory and
// the calibration, exported because `scripts/check-ir.cjs` is the only thing
// that can tell whether any of it is right. None of it can be checked
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
//
// Asked over WMS rather than through the tile API it used to use, and the
// reason is the meter rather than the bytes. RealEarth's tile endpoint returns
// 256 square whatever it is asked for, and `&size=64` is a no-op, measured
// identical to the byte at every level, so each tile arrived at sixteen times
// the samples this file has anywhere to put, and the extra fifteen sixteenths
// were thrown away on the next line. `mapserv` honours WIDTH and HEIGHT, so the
// same tile is 4.5 KB instead of 40.
//
// The bytes are the smaller half of it. RealEarth meters anonymous use by pixel
// volume, 500 megapixels in a rolling day, and past it the imagery comes back
// watermarked rather than refused, which is the caption `refused` below exists
// to catch. At 256 a single tab left at world zoom spent about 264 MP a day,
// over half the allowance, before anybody panned. At SAMPLES it spends 17.
const REALEARTH = "https://realearth.ssec.wisc.edu/cgi-bin/mapserv";

// EUMETSAT's GeoServer, reached by way of our own origin rather than directly.
//
// It serves the picture and sends no `access-control-allow-origin` with it, and
// every tile on this layer is read back pixel by pixel, so the browser is
// allowed to fetch the image and then not allowed to look at it, which is the
// same as not having it. `functions/msg.js` makes the request from somewhere
// that is not a tab and says who may read the answer; `vite.config.js` does the
// same for the dev server, so both take the identical path.
//
// A relative URL, and that is the point: whatever the site is served from is
// what fetches this, and there is no second hostname to keep in agreement. The
// other three dishes answer for themselves and are still called directly.
const EUMETVIEW = "/msg";

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
// hour costs six steps rather than one per tick, and each of those six is a
// moment the pyramid can hold, so scrubbing back over ground already covered
// costs nothing at all.
export const STEP_MS = 10 * 60 * 1000;

/**
 * How far behind the clock the live moment is set.
 *
 * A scan is not published the moment it is taken: the dish has to finish the
 * disc, and the agency has to process it and put it on a server. Both services
 * answer a time they do not have yet by handing back the newest frame they do
 * have, except EUMETSAT, which answers 502 for a moment past its own last
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
 * near TILE_PX and a block is BLOCK_PX, so a tile covers about sixty blocks,
 * and a sample finer than the block it will be averaged into is a sample nobody
 * ever sees. This was 128 when the field went to the canvas unquantised; half
 * of that was being thrown away at the last step, and being a square, dropping
 * it is four times less of everything the main thread does here: samples
 * calibrated, bytes held, and pixels painted.
 */
export const SAMPLES = 64;

/**
 * How large a tile is meant to land on the glass, which is what picks the
 * level.
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
export { tileFrame, tilesFor, metresAt, MIN_PATCH };

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
// warm column to build in and essentially does not happen up here.
//
// This closes and nothing is lost by it, which was not always true. The band it
// fades out used to be the band nothing was drawn in at all, and on a globe that
// is a bald cap in the middle of the planet where Mercator used to hide it. It
// is now the band `polar.js` owns: the same two parallels, read the other way
// round, so the ring hands the caps to the orbiters that fly over them and the
// two weights sum to one the whole way across.
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

/** And the fade toward the poles, which only a polar orbiter can improve on. */
const latitudeWeight = (lat) => ramp(Math.abs(lat), LAT_LIMB, LAT_CORE);

/**
 * The dishes with any claim at all on a tile.
 *
 * An overlap between two intervals, and it has to be: this asked the two edge
 * longitudes whether any dish could see them, which is the same question only
 * while a tile is narrower than the gap between two dishes. A tile wider than a
 * territory contains that territory *strictly between* its edges, neither edge
 * is in it, and the dish is never asked at all.
 *
 * The tiles that wide are the shallow ones, and the failure was silent in the
 * worst way. A dish that is not asked is indistinguishable further down from a
 * dish that answered nothing. `fetchTile` treats a missing image as a disc
 * missing from the tile rather than as an error, deliberately, because a ring
 * of five is still a map with four, so the tile came back with a band of the
 * planet blank in it and was stored as a good answer. Nothing retried it,
 * because nothing had failed. At level 0, three of the five dishes were being
 * left out: everything from the eastern Pacific to the Indian Ocean was simply
 * not on the map, for as long as that tile was held.
 *
 * `scripts/check-ir.cjs` now holds every level to this, since it is not a thing
 * that can be seen by looking: a blank band over an ocean looks like an ocean.
 */
export function discsFor(frame) {
  const west = lonAt(frame.minX);
  const east = lonAt(frame.maxX);
  return DISCS.filter((disc) => {
    const { from, to } = TERRITORY.get(disc.id);
    // Every turn of the globe, for the same reason `longitudeWeight` tries
    // them: a territory can run off the end of the coordinate system when its
    // dish sits near the antimeridian.
    for (const turn of [-360, 0, 360]) {
      if (from + turn - SEAM < east && to + turn + SEAM > west) return true;
    }
    return false;
  });
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
 * points on its own ramp that matter, which are where it leaves the warm floor,
 * where -30°C lands, and where it tops out, and read onto the common scale
 * through them.
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
export const COLDEST = 0.97; // ...and where each service's white point does

/**
 * Each service's own greyscale, as the three bytes that anchor it: the warm
 * end of its ramp, its -30°C, and its coldest.
 */
export const STRETCH = {
  [EUMETVIEW]: { warm: 0, break: 148, cold: 255 },
  [REALEARTH]: { warm: 50, break: 113, cold: 190 },
};

/**
 * The byte to read a pixel at, which is not always the byte that arrived.
 *
 * RealEarth has served the two GOES mapfiles with the ramp the other way round:
 * warm ground bright, cold tops dark, the reverse of Himawari on the same
 * service and of both EUMETSAT layers. It drew as a solid deck of cloud over
 * everything from the dateline to the mid-Atlantic and clear sky exactly where
 * the storms were. Read from the other end the same three anchors hold: over
 * the Atlantic, where GOES-East and Meteosat see the same sky, the two
 * distributions agree to a hundredth of the scale at every quantile.
 *
 * They have since been served the normal way round again, so no dish is flagged
 * today. The flag stays because the flip has happened in both directions and is
 * not announced either time.
 *
 * Which way each dish runs is a live property of somebody else's service, so
 * `scripts/check-polarity.cjs` asks it rather than trusting these flags, and
 * `--apply` sets them from the answer.
 */
const reading = (disc, l) => (disc.invert ? 255 - l : l);

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
 *
 * It does two things at once, which is worth knowing before moving it. It is a
 * cut, and it is also the bottom of the stretch below: everything kept is
 * rescaled across what is left, so lowering it both admits fainter cloud and
 * makes the cloud already drawn more solid. It was 0.47, then 0.34, and each
 * move has been the second effect more than the first: the extra ground let in
 * is thin stuff that lands near the bottom of the curve and stays faint, while
 * everything already drawn thickens across the board.
 *
 * At 0.25 a faint cloud at 0.55 carries about a quarter more weight than it did
 * at 0.34, and a mid one at 0.65 about an eighth. What is newly admitted is the
 * band from 0.25 to 0.34, and none of it can arrive at more than a tenth or so
 * of full weight, which is the shape this cut is meant to have: the sky filling
 * in rather than the ground fogging up. It is the fogging that sets the limit
 * on going further, and the limit is a thing to be looked at rather than
 * derived, because warm sea is most of the planet and it does not announce
 * which side of the line it sits on.
 *
 * What it does not touch is the storm tops. TOPS below is defined as a fraction
 * of what is left above this line, so `v > TOPS` is `t > 0.8` at any floor, and
 * the second pass draws the same pixels at the same weight wherever this sits.
 */
const FLOOR = 0.25;

/**
 * How heavy the two passes are allowed to get. The calibration knob for this
 * layer: everything else here is arithmetic, and these two are set by looking.
 *
 * WASH is the body of the cloud, drawn in the land token. It was 150, which put
 * an overcast near 14% and the coldest anything gets at 57%, and it was tuned
 * on a tube with strikes falling on it. On a quiet feed, on a coating, or over
 * the tropics at midday, a layer reaching 57% of the land token is the loudest
 * thing on the glass, and the instrument's one rule is that the loudest thing
 * on the glass is a strike. Backed off to 110, which is an overcast near 10%
 * and a ceiling near 43%: still terrain, no longer competing.
 *
 * TOP is the cold tops, drawn in the reading token, and it is not backed off
 * with it. That pass is very nearly a map of where this map is about to have
 * something to show, and it is meant to be findable with the eye.
 *
 * Both are a straight ceiling on an alpha, so either can be moved on its own
 * and nothing downstream has to be re-derived.
 */
const WASH = 110;
const TOP = 135;

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
 * Both then resolve that name the same way, with the newest frame at or before
 * it, so a moment between scans, or one a dish has not reached yet, is answered
 * with the last real picture rather than an error or a gap.
 */
export function url(disc, frame, at) {
  // One WMS call for both services now, because both of them are one. They
  // differ only in how the moment is named, which is the block below.
  const params = new URLSearchParams({
    SERVICE: "WMS",
    VERSION: "1.3.0",
    REQUEST: "GetMap",
    STYLES: "",
    CRS: "EPSG:3857",
    BBOX: [frame.minX, frame.minY, frame.maxX, frame.maxY].join(","),
    WIDTH: String(SAMPLES),
    HEIGHT: String(SAMPLES),
    FORMAT: "image/png",
    TRANSPARENT: "TRUE",
  });

  if (disc.service === REALEARTH) {
    // RealEarth has no TIME dimension. It publishes every scan it holds as a
    // layer of its own, named for the moment it was taken, inside a mapfile of
    // the product's own name, so the moment is chosen by asking for a
    // different layer rather than by a parameter.
    //
    // Asked at the far end of the step rather than its start, exactly as the
    // tile API was: the scan stamped 13:20 is published at 13:20:20, so a
    // request naming 13:10:00 resolves to the step before it and loses a free
    // ten minutes to a rounding. Measured: `..._131959` and `..._131020` are
    // the same image to the byte, and `..._131000` is the previous scan.
    const t = new Date(at + STEP_MS - 1000).toISOString(); // 2026-08-16T13:59:59.000Z
    const stamp = `${t.slice(0, 4)}${t.slice(5, 7)}${t.slice(8, 10)}_${t.slice(11, 13)}${t.slice(14, 16)}${t.slice(17, 19)}`;
    params.set("map", `${disc.layer}.map`);
    params.set("LAYERS", `${disc.layer}_${stamp}`);
    // ponytail: a layer name RealEarth does not recognise is answered with the
    // current scan, 200 OK and no complaint, so a change to their naming would
    // show up as a map that quietly stopped rewinding rather than as an error.
    // `scripts/check-ir.cjs` holds the resolution to account; if that is ever
    // not enough, the fix is to read the stamp back out of GetCapabilities.
    return `${disc.service}?${params}`;
  }

  params.set("LAYERS", disc.layer);
  params.set("TIME", new Date(at).toISOString().replace(/\.\d+Z$/, "Z"));
  return `${disc.service}?${params}`;
}

// Whether the service refused a tile is a header now, read in `loadImage` and
// handed back as `refused`. It used to be a guess made from the pixels: the
// refusal arrives as a picture with "Size limit exceeded" printed across it,
// and white text reads as the coldest cloud top on the scale, so the caption
// drew as a storm, the one failure on this map that invented a reading rather
// than omitting one. The test looked for pure black and pure white in one tile,
// which real infrared never contains, and it worked; it was still a heuristic
// standing in for a service that had been saying so out loud all along.
//
// Worth keeping the reason written down, because it explains the quota this
// layer lives inside. Both of RealEarth's triggers are cumulative over a
// rolling day rather than per request, 1,024 pixels in either dimension with
// adjacent requests counting together, and 500 megapixels of volume, and a tile
// pyramid is nothing but adjacent requests. That is why it seemed to be a
// threshold nothing could stay under, refusing one minute and serving the next,
// and why asking over WMS at SAMPLES rather than the tile API's fixed 256 is
// what buys the room.

/**
 * The other thing that arrives 200 OK with no weather in it: a sheet that is
 * one value from edge to edge.
 *
 * It draws as a flat rectangle of cloud with the tile's own corners, which is
 * the shape nothing in the sky has, and it is bright enough to read as a deck
 * of overcast rather than as a fault. The caption above at least looks wrong.
 *
 * Told apart from weather by having no variation at all, which is the one thing
 * measured infrared always has: the comment above puts a live tile between
 * about 70 and about 200, and the point is less where it sits than that it is a
 * spread. Sixty-four samples of a real sky do not land on one byte. So the test
 * is exact equality rather than a tolerance: a near-flat overcast tile is
 * weather and is kept, and only a sheet with literally nothing in it is turned
 * away.
 *
 * Two guards on top, because a false positive here is worse than a miss. The
 * value has to be one that would actually be painted: below the floor it draws
 * nothing, so a tile of dead black off the limb is left alone rather than
 * refused forever. And there has to be enough of the sheet to be worth judging:
 * a dish reaching this tile with a sliver of its horizon can be uniform
 * honestly, where a quarter of a tile cannot.
 */
const ENOUGH = (SAMPLES * SAMPLES) / 4;

export function flat(data, stretch, disc) {
  let seen = -1;
  let opaque = 0;
  for (let j = 0; j < data.length; j += 4) {
    if (!data[j + 3]) continue; // outside this disc's horizon
    if (seen < 0) seen = data[j];
    else if (data[j] !== seen) return false;
    opaque++;
  }
  if (opaque < ENOUGH) return false;
  return scalarFor(stretch, reading(disc, seen)) > FLOOR;
}

/**
 * A disc, asked for one tile.
 *
 * The retry, the CORS, the exception bodies and the watermark header all live
 * in `loadImage` now (see `field.js`, which explains why an `<img>` could not
 * see any of them). What is left here is what is particular to the ring: a disc
 * that does not answer is a disc missing from the tile rather than an error,
 * because five independent services are five, and a map with four of them is
 * still a map.
 */
const load = (src, disc) =>
  loadPicture(src, disc.id, "its territory will draw as clear sky.");

async function fetchTile(z, x, y, at) {
  const frame = tileFrame(z, x, y);
  const discs = discsFor(frame);
  if (!discs.length) return null;

  // The mask is separable and the tile is a Mercator box, so both cuts are one
  // number per column and one per row rather than a pass over every pixel.
  const cols = new Float32Array(SAMPLES);
  const rows = new Float32Array(SAMPLES);
  const caps = new Float32Array(SAMPLES);
  const lat = new Float32Array(SAMPLES);
  for (let i = 0; i < SAMPLES; i++) {
    const yM = frame.maxY - ((i + 0.5) / SAMPLES) * (frame.maxY - frame.minY);
    lat[i] = latAt(yM);
    rows[i] = latitudeWeight(lat[i]);
    caps[i] = polarWeight(lat[i]);
  }

  // Weighed before it is fetched, not after, and the ring and the orbiters are
  // asked separately for it. Mercator gives the polar rows an enormous share of
  // the grid: at level 4 the top row of tiles is entirely above the parallel the
  // ring closes at, and every one of them used to be five requests paid for,
  // decoded, and multiplied by nothing. Now they are the caps' own tiles and the
  // ring is the one not asked.
  const wantRing = rows.some((w) => w > 0);
  const wantCaps = caps.some((w) => w > 0);
  if (!wantRing && !wantCaps) {
    return { field: new Uint8Array(SAMPLES * SAMPLES), lat, any: false };
  }

  const [images, polar] = await Promise.all([
    wantRing ? Promise.all(discs.map((disc) => load(url(disc, frame, at), disc))) : [],
    wantCaps ? polarSheet(z, x, y, at, SAMPLES) : null,
  ]);
  if (!images.some(Boolean) && !polar) return null;

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

  // Whether a dish that owns ground in this tile failed to hand any over. The
  // tile is still worth keeping, since four fifths of a sky is not nothing and
  // throwing it away would leave the ground blank rather than merely
  // incomplete, but it must not be mistaken for a finished answer, because
  // what it looks like is clear weather over somebody's afternoon.
  let short = false;

  // Skipped whole when the tile is above the ring: `images` is empty then, and
  // there is nothing for a dish's own weights to be worked out against.
  (wantRing ? discs : []).forEach((disc, i) => {
    // Weighed before the image is looked at. The other order cannot tell a dish
    // that had nothing to contribute here from one that had plenty and did not
    // arrive, and those are the two cases this whole flag is here to separate.
    for (let col = 0; col < SAMPLES; col++) {
      const xM = frame.minX + ((col + 0.5) / SAMPLES) * (frame.maxX - frame.minX);
      cols[col] = longitudeWeight(disc, lonAt(xM));
    }
    // Nothing of this dish reaches this tile after all: the corners said it
    // might, the columns say otherwise.
    if (!cols.some((w) => w > 0)) return;

    // The header said the service was refusing this one. Kept apart from a
    // dish that simply did not answer: a refusal is temporary and the tile has
    // to be asked again, where a silent dish is drawn around.
    const got = images[i];
    if (got.refused) {
      turnedAway = true;
      return;
    }
    if (!got.image) {
      short = true;
      return;
    }

    ctx.clearRect(0, 0, SAMPLES, SAMPLES);
    ctx.drawImage(got.image, 0, 0, SAMPLES, SAMPLES);
    const { data } = ctx.getImageData(0, 0, SAMPLES, SAMPLES);
    const stretch = STRETCH[disc.service];
    // Counted as a dish that did not arrive rather than as a refusal, which is
    // the difference between asking this tile again and throwing away the four
    // dishes that did answer. It is also the honest description: something came
    // back, and there was no sky in it.
    if (flat(data, stretch, disc)) {
      short = true;
      return;
    }

    for (let row = 0; row < SAMPLES; row++) {
      const wRow = rows[row];
      if (!wRow) continue;
      for (let col = 0; col < SAMPLES; col++) {
        const weight = cols[col] * wRow;
        if (!weight) continue;
        const p = row * SAMPLES + col;
        const j = p * 4;
        if (!data[j + 3]) continue; // outside this disc's horizon
        const t = scalarFor(stretch, reading(disc, data[j]));
        sum[p] += t * weight;
        total[p] += weight;
      }
    }
  });

  // The caps, into the same accumulator and on the same scale. One weight per
  // row and none per column: an orbiter crosses every longitude and has no
  // territory, which is the whole difference between it and a dish.
  if (wantCaps) {
    if (!polar) short = true;
    else {
      for (let row = 0; row < SAMPLES; row++) {
        const weight = caps[row];
        if (!weight) continue;
        for (let col = 0; col < SAMPLES; col++) {
          const p = row * SAMPLES + col;
          if (polar[p] < 0) continue; // no swath over this ground
          sum[p] += polar[p] * weight;
          total[p] += weight;
        }
      }
    }
  }

  // A refusal is not an answer, so it is not kept. Returning null leaves the
  // key out of the pyramid, which puts the tile back in the queue on the next
  // settle, which is right for a thing that is temporary by nature. Until then
  // the ancestor covers the ground, as it does for any tile still in the air.
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
  //
  // `partial` is the exception to that: held so there is something on the
  // ground, and asked again anyway until the dish that was missing turns up.
  return { field, lat, any, partial: short };
}

// ── Painting ────────────────────────────────────────────────────────────────

/**
 * A tile, as something to look at.
 *
 * Two passes, because cloud and storm are not the same reading and should not
 * be the same mark. The body of the cloud is laid down in the land token at low
 * alpha: it is terrain, the same class of thing as the coastline, and it is
 * there to be seen past. Over it, only the coldest tops, in the reading token
 * and much harder. What that second pass draws is very nearly a map of where
 * this map is about to have something to show, which is why it is allowed to be
 * bright enough to find with the eye.
 *
 * Both passes are built as an alpha channel and then filled through: the tokens
 * are CSS colours and stay CSS colours, so whatever the stylesheet and the
 * phosphor between them decided a token is, is what gets drawn.
 */
// The two channels, reused. `fillThrough` copies each into the sheet before it
// returns, so nothing here outlives the call, and a tile that allocated them
// fresh was thirty-two kilobytes of garbage per paint against a pyramid that
// repaints whole whenever the medium changes.
const warm = new Uint8ClampedArray(SAMPLES * SAMPLES * 4);
const cold = new Uint8ClampedArray(SAMPLES * SAMPLES * 4);

function paintTile({ field, lat }, body, tops, ground) {
  // Cleared, unlike a fresh allocation: the loop below writes only the samples
  // that have something in them, so what it does not write is last tile's sky.
  warm.fill(0);
  cold.fill(0);
  let anyCold = false;

  for (let row = 0; row < SAMPLES; row++) {
    const lift = convective(lat[row]);
    for (let col = 0; col < SAMPLES; col++) {
      const p = row * SAMPLES + col;
      const v = field[p];
      if (!v) continue;
      const t = v / 255;
      // Linear, and the ceiling raised to match. It was squared once, on the
      // reasoning that this is a backdrop rather than a photograph and should
      // be dark everywhere the weather is not, which is right about the
      // intent and was wrong about the arithmetic. Squaring a value that has
      // already been floored and rescaled crushes the whole middle of the
      // scale: ordinary cloud at grey 87 came out at two parts in 255, which is
      // not a faint backdrop but an invisible one. Measured over northern
      // France on an afternoon of scattered cumulus, the mean opacity of the
      // entire layer was 0.67% and nothing anywhere reached ten.
      //
      // What the curve has to separate is cloud from clear, and that job is
      // already done twice over before this line: FLOOR cuts the warm ground
      // away, and the second pass below draws the cold tops in their own token.
      // This one only has to make the body of a cloud visible as terrain, so it
      // is a straight ramp.
      //
      // The ceiling was set by looking rather than by arithmetic, which is the
      // only way it could have been. Rendered against the real tube at 56, an
      // overcast sky measured out at three grey levels of movement on the
      // glass. The numbers said it was drawn and the eye said it was not, and
      // the eye is the instrument this is for. WASH is where that landed and
      // where it is adjusted; see its note above.
      warm[p * 4 + 3] = t * WASH;
      if (v > TOPS && lift > 0) {
        cold[p * 4 + 3] = Math.sqrt((v - TOPS) / (255 - TOPS)) * TOP * lift;
        anyCold = true;
      }
    }
  }

  const canvas = document.createElement("canvas");
  canvas.width = SAMPLES;
  canvas.height = SAMPLES;
  const ctx = canvas.getContext("2d");

  // Laid on the ground first, so the tile is opaque and can meet its neighbours
  // edge to edge without a seam of half-composited weather between them. The
  // ground is the identity of the operation the whole field is laid down with,
  // so a tile of clear sky is still a tile of clear sky. See GROUND in field.js.
  ctx.fillStyle = ground;
  ctx.fillRect(0, 0, SAMPLES, SAMPLES);
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
