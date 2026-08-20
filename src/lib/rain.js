/**
 * The rain field: ground radar, composited.
 *
 * The cloud field says where the column is deep. It cannot say where anything
 * is reaching the ground, because 10.8µm reads the top of the column and
 * nothing below it: a dying anvil and a shelf about to drop hail off its front
 * look much the same from above. Radar looks at the other end. It reports what
 * is falling — how much of it, in what size of drop — and it is the only layer
 * here measured from underneath the weather rather than over it.
 *
 * The two therefore answer different questions and are offered as alternatives
 * rather than stacked. Their footprints are almost complementary: infrared
 * covers the whole ring including every ocean, and radar covers only the ground
 * somebody built a radar network on. Where they do overlap they land on the
 * same storm, and drawing both would put two washes and two sets of bright
 * cores over one another, which is one wash too many for a map whose subject is
 * the strikes on top of it.
 *
 * ── The source ──────────────────────────────────────────────────────────────
 *
 * RainViewer composites the national networks and publishes the result as
 * Mercator tiles on the same grid this file already works in, with an index of
 * exactly which frames exist. That index is the part worth having. The cloud
 * field has to guess how far behind the satellites are running and ask for a
 * rounded-off moment in the hope that something is there (see `LAG_MS` in
 * `ir.js`); here the published times are a fact, and a moment is resolved
 * against them rather than assumed.
 *
 * ── Why the colours are the data ────────────────────────────────────────────
 *
 * The tiles come rendered rather than raw. There is a colour parameter in the
 * URL and it is ignored: every tile arrives in scheme 2, "Universal Blue",
 * whatever is asked for. So the reading has to be taken back out of the
 * picture, which is exactly as fragile as it sounds unless it is done exactly.
 *
 * It can be. The scheme is a 256-entry table, one entry per dBZ from -32 up,
 * published as RGBA — so the ramp below is that table and the inversion is a
 * lookup rather than a fit. Two conditions make it exact, and both are
 * requested in `url` for this reason and no other: smoothing off, because a
 * blurred tile interpolates between palette entries and produces colours that
 * are not in the table and do not mean anything; and snow in the rain colours,
 * because the separate snow ramp is a second table over the same pixels.
 *
 * Above 65 dBZ the scheme stops being injective — white covers 65 to 74 and
 * green everything past it — and the map takes the lowest dBZ of any repeated
 * colour. That whole region is past the top of real precipitation (60 dBZ is
 * already giant hail), so what is being rounded is the difference between
 * saturated and more saturated.
 */

import { clamp, createField, fillThrough, tileFrame, tilesFor } from "./field.js";
import { levelFor as baseLevelFor, ancestorPatch as basePatch } from "./field.js";

const INDEX = "https://api.rainviewer.com/public/weather-maps.json";

// ── The grid ────────────────────────────────────────────────────────────────

/**
 * How many samples across a tile is fetched and stored.
 *
 * The same 64 as the cloud field, and for the same reason, which is the block
 * rather than the sensor. A tile lands near TILE_PX on the glass and the field
 * is quantised to a block every 5px, so a tile is about sixty blocks wide and a
 * sample finer than a block is a sample nobody ever sees.
 *
 * This does throw away real detail, unlike over there. The composite resolves
 * something like a kilometre and a level-7 tile at 64 samples is closer to
 * five, so what is drawn is a reduction of a sharper picture rather than the
 * whole of a soft one. Which is why the reduction below takes the strongest
 * sample of each block rather than the mean: a hail core four samples across is
 * the one thing on this layer worth crossing the screen for, and averaging is
 * how you lose it.
 */
export const SAMPLES = 64;
const TILE_PX = 300;

/**
 * Where the pyramid stops.
 *
 * Not where the radar stops — the composite has detail past this — but where
 * the map does. Level 7 is already about as deep as the tube's own MAX_K
 * reaches, so a level 8 tile would be a request for ground no view can get to.
 */
export const MAX_LEVEL = 7;

export const levelFor = (projection) => baseLevelFor(projection, TILE_PX, MAX_LEVEL);
export const ancestorPatch = (z, x, y, level) => basePatch(z, x, y, level, SAMPLES);
export { tileFrame, tilesFor };

// How often the index is asked whether anything new has been published. The
// composite runs on a ten-minute cycle, so asking faster only re-reads the same
// list of frames.
export const REFRESH_MS = 10 * 60 * 1000;
export const STEP_MS = 10 * 60 * 1000;

/**
 * How far behind the clock a live moment is asked for.
 *
 * Much shorter than the cloud field's twenty minutes, because there are no
 * satellites to wait for: the newest listed frame is typically a couple of
 * minutes old. Five gives the composite time to be published and indexed, and
 * anything it does not cover is covered anyway — a moment with no frame at or
 * before it is resolved to the newest one there is rather than failing.
 */
export const LAG_MS = 5 * 60 * 1000;

// ── Calibration ─────────────────────────────────────────────────────────────

// Scheme 2, rain, as published: one RGBA entry per dBZ, contiguous from RAMP0.
const RAMP0 = -10;
const RAMP =
  "6361591466635a1969665c1e6c685d246f6b5f29726e612e75706234787364397c75653e" +
  "7f786744827b6949857d6a4e88806c548b826d598e856f5e928871649e93756eaa9e7978" +
  "b6a97e82c2b4828ccec08796d2c48ba0d6c88faadacc93b4ded097be88ddeeff6cd1ebff" +
  "51c5e8ff36bae5ff1baee2ff00a3e0ff009ad5ff0091caff0088bfff007fb4ff0077aaff" +
  "0070a3ff00699cff006295ff005b8eff005588ff005180ff004e78ff004a70ff004768ff" +
  "ffee00ffffe000ffffd200ffffc500ffffb700ffffaa00ffff9f00ffff9500ffff8b00ff" +
  "ff8100ffff4400fff23600ffe62800ffd91b00ffcd0d00ffc10000ffa80000ff8f0000ff" +
  "760000ff5d0000ffffaaffffff9fffffff95ffffff8bffffff81ffffff77ffffff6cffff" +
  "ff62ffffff58ffffff4effffffffffffffffffffffffffffffffffffffffffffffffffff" +
  "ffffffffffffffffffffffffffffffff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff" +
  "00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff" +
  "00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff00ff";

/** Packed RGBA, which is what a lookup on four bytes has to be to be quick. */
const packed = (r, g, b, a) => (((r << 24) | (g << 16) | (b << 8) | a) >>> 0);

// Colour to dBZ. First occurrence wins, so a colour the scheme reuses at the
// top of its range is read as the lowest reading it can stand for rather than
// the highest — the conservative direction, and the only one that does not
// invent intensity out of a palette that has run out of colours.
const SCALE = (() => {
  const map = new Map();
  for (let i = 0; i * 8 < RAMP.length; i++) {
    const hex = RAMP.slice(i * 8, i * 8 + 8);
    const key = packed(
      parseInt(hex.slice(0, 2), 16),
      parseInt(hex.slice(2, 4), 16),
      parseInt(hex.slice(4, 6), 16),
      parseInt(hex.slice(6, 8), 16)
    );
    if (!map.has(key)) map.set(key, RAMP0 + i);
  }
  return map;
})();

/**
 * What one pixel is reporting, in dBZ, or null for ground the radar is not
 * looking at.
 *
 * Transparent means outside coverage, which is a different fact from no rain
 * and has to stay different: most of this planet has no radar over it, and a
 * layer that drew "no echo" everywhere it had nothing would be claiming clear
 * skies over every ocean on earth.
 */
export function dbzFor(r, g, b, a) {
  if (!a) return null;
  const found = SCALE.get(packed(r, g, b, a));
  return found === undefined ? null : found;
}

// The reading, as the layer draws it. Below the floor is drizzle and the sort
// of clutter a composite never fully cleans out of itself; the core is where
// the echo has stopped being rain and become the inside of a convective cell,
// which is the same thing the cloud field's second pass is looking for from the
// other side; and the top is where the scale is pinned, well past hail.
const FLOOR_DBZ = 5;
const CORE_DBZ = 40;
const TOP_DBZ = 60;

/** dBZ onto 0..1, which is what both passes are drawn from. */
export const scalarFor = (dbz) => clamp((dbz - FLOOR_DBZ) / (TOP_DBZ - FLOOR_DBZ), 0, 1);

// ── Fetching ────────────────────────────────────────────────────────────────

/**
 * The published frames, cached for as long as they are current.
 *
 * One request for the whole index rather than one per tile: it names every
 * frame the service is holding, which at ten-minute steps is the last two
 * hours, and every tile of every moment on screen is answered out of it.
 */
let index = null;
let indexAt = 0;
let inFlight = null;

export async function frames(now = Date.now()) {
  if (index && now - indexAt < REFRESH_MS) return index;
  if (inFlight) return inFlight;
  inFlight = fetch(INDEX)
    .then((response) => response.json())
    .then((data) => {
      index = { host: data.host, past: data.radar?.past ?? [] };
      indexAt = now;
      return index;
    })
    .catch(() => index ?? { host: null, past: [] })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

/**
 * Which published frame answers for this moment.
 *
 * The newest at or before it, which is what makes a rewound map show the
 * weather that was there rather than the weather that is. A moment older than
 * anything held gets the oldest frame there is, and one newer than the last
 * gets the last: the alternative is a hole in the map at exactly the two edges
 * a reader is most likely to be scrubbing against.
 */
export function frameFor(past, at) {
  if (!past.length) return null;
  let best = past[0];
  for (const frame of past) {
    if (frame.time * 1000 <= at) best = frame;
  }
  return best;
}

/**
 * One tile's address.
 *
 * `0_0` is not a default. The first zero is smoothing, which has to be off or
 * the tile interpolates between palette entries and the calibration above
 * stops being a lookup. The second is snow, which has to be off or frozen
 * precipitation arrives in a second colour table over the same pixels. Both are
 * the difference between reading this layer and guessing at it.
 */
export function url(host, path, z, x, y) {
  return `${host}${path}/256/${z}/${x}/${y}/2/0_0.png`;
}

function load(src) {
  return new Promise((resolve) => {
    const img = new Image();
    // The pixels are read back below, so the canvas they land on must not be
    // tainted. The tile cache answers with `access-control-allow-origin: *`.
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

// The tile arrives at 256 and is stored at SAMPLES, so each stored sample is a
// square of this many pixels.
const REDUCE = 256 / SAMPLES;

async function fetchTile(z, x, y, at) {
  const { host, past } = await frames();
  const frame = host && frameFor(past, at);
  if (!frame) return null;

  const image = await load(url(host, frame.path, z, x, y));
  if (!image) return null;

  const sheet = document.createElement("canvas");
  sheet.width = 256;
  sheet.height = 256;
  const ctx = sheet.getContext("2d", { willReadFrequently: true });
  // One to one, and unsmoothed even so. The palette is a set of exact colours
  // and any resampling at all invents ones that are not in it.
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(image, 0, 0, 256, 256);
  const { data } = ctx.getImageData(0, 0, 256, 256);

  // Reduced by taking the strongest reading in each block rather than the mean.
  // An intense core is small and a mean is exactly the operation that would
  // dissolve it into the light rain around it; the whole reason to look at this
  // layer is to find the cores.
  const field = new Uint8Array(SAMPLES * SAMPLES);
  let any = false;
  for (let row = 0; row < SAMPLES; row++) {
    for (let col = 0; col < SAMPLES; col++) {
      let peak = null;
      for (let dy = 0; dy < REDUCE; dy++) {
        for (let dx = 0; dx < REDUCE; dx++) {
          const j = ((row * REDUCE + dy) * 256 + col * REDUCE + dx) * 4;
          const dbz = dbzFor(data[j], data[j + 1], data[j + 2], data[j + 3]);
          if (dbz !== null && (peak === null || dbz > peak)) peak = dbz;
        }
      }
      if (peak === null || peak < FLOOR_DBZ) continue;
      field[row * SAMPLES + col] = Math.round(scalarFor(peak) * 255);
      any = true;
    }
  }

  // A tile with no echo in it is still a tile: it is the answer "nothing
  // falling here", and holding it stops the pyramid asking the same question
  // again on the next pan.
  return { field, any };
}

// ── Painting ────────────────────────────────────────────────────────────────

// Where the second pass starts, on the 0..1 scale the field is stored in.
const CORE = (CORE_DBZ - FLOOR_DBZ) / (TOP_DBZ - FLOOR_DBZ);

/**
 * A tile, as something to look at.
 *
 * Two passes, the same shape as the cloud field's and for the same reason:
 * rain and the inside of a storm are not the same reading and should not be the
 * same mark. The body is the rain, laid down as terrain. Over it, only the
 * cores, hard enough to find with the eye without looking for them.
 *
 * Firmer than the cloud wash at both ends. That layer covers the whole planet
 * and has to be dark enough to see a map through; this one is only ever over
 * the fraction of the ground somebody has a radar on, so it is not competing
 * for the same screen and can afford to be read.
 */
function paintTile({ field }, body, tops) {
  const size = SAMPLES * SAMPLES;
  const wet = new Uint8ClampedArray(size * 4);
  const core = new Uint8ClampedArray(size * 4);
  let anyCore = false;

  for (let p = 0; p < size; p++) {
    const v = field[p];
    if (!v) continue;
    const t = v / 255;
    // Not squared, unlike the cloud. A cloud field is mostly cloud and has to
    // fall away fast to stay a backdrop; rain is sparse to begin with, and the
    // light end of it is the shape of the system, which is worth seeing.
    wet[p * 4 + 3] = t * 60;
    if (t > CORE) {
      core[p * 4 + 3] = Math.sqrt((t - CORE) / (1 - CORE)) * 150;
      anyCore = true;
    }
  }

  const canvas = document.createElement("canvas");
  canvas.width = SAMPLES;
  canvas.height = SAMPLES;
  const ctx = canvas.getContext("2d");

  fillThrough(ctx, wet, body, SAMPLES);
  if (anyCore) fillThrough(ctx, core, tops, SAMPLES);
  return canvas;
}

// ── The store ───────────────────────────────────────────────────────────────

/**
 * The pyramid, driven by the map.
 *
 * Everything stateful is in `field.js` and shared with the cloud field. What is
 * particular to the rain is above: the published index, the inversion of a
 * rendered palette, and a reduction that keeps peaks instead of averaging them.
 */
export function createRain() {
  return createField({
    samples: SAMPLES,
    tilePx: TILE_PX,
    maxLevel: MAX_LEVEL,
    fetch: fetchTile,
    paint: paintTile,
  });
}
