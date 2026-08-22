/**
 * A tiled field over the map, and everything that is stateful about drawing one.
 *
 * This is the machinery the cloud field was built as, with the satellites taken
 * out of it. What is left is source-agnostic and turned out to be most of the
 * file: a Mercator tile pyramid, a fetch queue ordered from the middle of the
 * screen outward, an eviction budget, ancestor substitution while tiles are in
 * the air, and a crossfade from one published moment to the next.
 *
 * None of that has anything to say about what is being drawn. It is equally the
 * shape of infrared off the geostationary ring and of a radar composite off the
 * ground, and both are here because a second copy of it would be three hundred
 * lines that have to stay in step with the first by hand.
 *
 * A source supplies four things: how finely it is sampled, how deep the pyramid
 * goes, how to fetch one tile, and how to paint one. See `ir.js` and `rain.js`.
 *
 * ── Why this is a pyramid ───────────────────────────────────────────────────
 *
 * The field is cut into tiles on the standard Mercator grid, and the tile is
 * the unit of everything: fetched once, calibrated once, painted once, and then
 * valid for every view that ever contains it.
 *
 * The first version of the cloud layer was keyed to the viewport instead. It
 * asked each dish for one image the size and shape of the canvas, which sounds
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
 * still arriving. And a source's calibration stops being a function of the
 * view, which it never should have been: a tile carries the same numbers
 * wherever it is drawn.
 */

import { mercatorFrame } from "./view.js";
import { facing } from "./unfold.js";

export const EARTH_HALF = 20037508.342789244; // half the equator, in metres

export const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

/** EPSG:3857 metres back to the sphere. Only this direction is needed: tiles
 *  are laid out in metres by definition, so everything that asks a question
 *  about where a sample is asks it of a coordinate that is already in metres. */
export const lonAt = (x) => (x * 180) / EARTH_HALF;
export const latAt = (y) =>
  (Math.atan(Math.sinh((y * Math.PI) / EARTH_HALF)) * 180) / Math.PI;

// ── The grid ────────────────────────────────────────────────────────────────

/** The pyramid level whose tiles land closest to `tilePx` at this projection. */
export function levelFor(projection, tilePx, maxLevel) {
  // d3's Mercator puts the whole world across 2πk pixels.
  const worldPx = 2 * Math.PI * projection.scale();
  return clamp(Math.round(Math.log2(worldPx / tilePx)), 0, maxLevel);
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
 * cheapest thing in the pyramid and the reason a cold start still shows a field.
 *
 * `x >> shift` is the ancestor's index and the bits shifted out are the way
 * back down: they say which quadrant was taken at each step, which is exactly
 * the offset into the ancestor's pixels.
 */
export function ancestorPatch(z, x, y, level, samples) {
  const shift = z - level;
  const step = samples / 2 ** shift;
  const mask = (1 << shift) - 1;
  return { x: x >> shift, y: y >> shift, sx: (x & mask) * step, sy: (y & mask) * step, step };
}

/**
 * How small a patch is still worth standing in with.
 *
 * The walk above will go all the way to level 0 if nothing nearer has arrived,
 * and the last few rungs of it are not coarse detail, they are no detail. At 64
 * samples a tile six levels down from its ancestor is a single pixel of it, and
 * the rung below that is a quarter of a pixel: `drawImage` is being asked to
 * take one value and spread it across the whole tile. What lands on the glass
 * is a flat rectangle with the tile's own corners, at whatever weight that one
 * pixel happened to hold — and since neighbouring tiles take neighbouring
 * pixels of the same ancestor row, a run of them reads as a bar lying across
 * the map.
 *
 * Which is the failure this layer is otherwise careful never to commit. A
 * missing tile drawn as nothing is a gap in a picture that is admittedly still
 * arriving; the same tile drawn as one flat value is a deck of overcast that
 * was never measured, and it is indistinguishable from weather. `refused`
 * turns away a caption for exactly this reason: of the ways this map can be
 * wrong, inventing a reading is the only unacceptable one.
 *
 * Four is the least that can carry a shape rather than a value — sixteen
 * pixels, coarse and obviously coarse. Below it the ground is left bare and the
 * tile that is already in flight is allowed to answer for itself.
 */
export const MIN_PATCH = 4;

// ── Painting ────────────────────────────────────────────────────────────────

/**
 * An alpha channel, filled through with a colour token.
 *
 * Both sources build their marks as coverage and then colour them this way, and
 * neither ever names a colour itself: the tokens are CSS colours and stay CSS
 * colours, so whatever the stylesheet and the phosphor between them decided a
 * token is, is what gets drawn.
 */
// One sheet, reused. Every source builds both its passes through here, so a
// tile costs two of these and a pan over new ground costs a couple of hundred —
// each of them a canvas and its backing store, allocated to be drawn once and
// dropped. They are all the same size, and nothing reads one after the call it
// was made in, so there is no reason for there to be more than one.
//
// Keyed on the size only because `samples` is a source's own business; in
// practice all three ask for the same one and this is allocated once for the
// life of the page.
let sheet = null;
let sheetCtx = null;

export function fillThrough(ctx, alpha, colour, samples) {
  if (!sheet) {
    sheet = document.createElement("canvas");
  }
  if (sheet.width !== samples || sheet.height !== samples) {
    sheet.width = samples;
    sheet.height = samples;
    sheetCtx = sheet.getContext("2d");
  }
  // `putImageData` replaces rather than composites, so the sheet needs no
  // clearing between uses: every byte of it is written before it is read.
  const image = sheetCtx.createImageData(samples, samples);
  image.data.set(alpha, 0);
  sheetCtx.putImageData(image, 0, 0);
  sheetCtx.globalCompositeOperation = "source-in";
  sheetCtx.fillStyle = colour;
  sheetCtx.fillRect(0, 0, samples, samples);
  ctx.drawImage(sheet, 0, 0);
}

// ── The store ───────────────────────────────────────────────────────────────

// How many tile builds are allowed to be in the air at once. Each is one or
// more requests to somebody else's server, and the queue is ordered from the
// middle of the screen outward, so a low ceiling is not slower in any way the
// reader can see: it only means the corners arrive after the centre.
const IN_FLIGHT = 4;

// How many painted tiles are kept. A tile is its samples as a scalar and the
// same again as a canvas, so this is a few tens of megabytes at the very worst
// and far less in practice — and it is what makes panning back over ground you
// have already looked at cost nothing.
const KEEP = 320;

/**
 * How large one block of the field is on the glass, in CSS pixels.
 *
 * The map is a dot matrix, and a photographic wash behind it was the one thing
 * on this instrument that looked photographed rather than read off something.
 * So the field is composed into a buffer one block to the pixel and enlarged
 * without smoothing, which quantises it to a lattice the same way everything
 * else here is quantised, without turning it into a pattern of its own: it is
 * still a wash, drawn at the resolution the rest of the map is drawn at.
 *
 * Five, because that is where the land matrix's own dots start — they sit about
 * five pixels apart at world zoom, opening to thirteen as you close in — and a
 * field quantised finer than the marks over it reads as blur rather than as
 * structure.
 */
const BLOCK_PX = 5;

// How long a tile takes to come up. Short: there is almost always an ancestor
// underneath showing the same weather more coarsely, so this is a sharpening
// rather than an arrival, and anything longer reads as a lag.
const TILE_FADE_MS = 240;

// And how long a whole new published frame takes to replace the one before it.
// Long enough to read as weather moving rather than as a panel being swapped,
// short enough that the two are never both legible for long.
const MOMENT_FADE_MS = 550;

/**
 * How long a tile that did not answer waits before it is asked for again, and
 * how many times.
 *
 * A tile that fails is deliberately not held — see `fetch` below — so that it
 * is asked for again rather than remembered as empty. What it was asked for
 * again *by* was the next settle, and that is the gap this closes: a settle is
 * the reader panning, and a reader who is not panning is exactly the reader
 * looking steadily at the hole. On a still map the only other thing that
 * re-queues anything is the ten-minute frame tick, so one unlucky request left
 * a square of missing sky on screen for up to ten minutes.
 *
 * It shows worst at shallow zoom, where one level-2 tile is a sixteenth of the
 * planet, and worst of all on the first frame after the layer is switched on,
 * where there is no older moment underneath to cover for it.
 *
 * Bounded, because the two failures this retries are both transient by nature —
 * a GeoServer 500, and RealEarth's "size limit exceeded", which is the same tile
 * refused one minute and served the next. Three tries is enough for both. A
 * service that is genuinely down answers the fourth the same as the first, and
 * past that the ten-minute tick is the right cadence to keep hoping at rather
 * than a timer of our own hammering somebody else's server.
 */
const RETRY_MS = 4000;
const RETRIES = 3;

/**
 * The safety net under the visible level, so that a hole is never a hole.
 *
 * `drawTile` covers a missing tile with the best ancestor it can find, and used
 * to claim that at worst this is level 0 — one tile for the planet, and the
 * reason a cold start still shows a field. That was not true. `want` queues the
 * visible level and nothing else, so ancestors exist only where the reader
 * happened to zoom through them, and a view opened straight at its final depth
 * — a shared link with a hash in it, which is the ordinary way this map is
 * arrived at — has an empty pyramid with nothing beneath the one level it is
 * fetching. One request lost there is a void with no floor under it, and it
 * shows worst at exactly the moment a reader is first looking.
 *
 * So the ancestors are fetched rather than hoped for, and fetched first: a
 * couple of tiles, before the detail, so the ground is covered from the start
 * and the detail sharpens onto it.
 *
 * Two levels, not the whole chain. `DROP` below the visible one is the working
 * net — a quarter the linear resolution, and roughly one tile however deep the
 * view is, because each level up divides the count by four. Level 0 is the
 * backstop under that, and it is one request for the whole planet, which is
 * cheap enough to take unconditionally and is what finally makes the sentence
 * in `drawTile` true. Fetching every level between them would be a dozen
 * requests at depth to insure against a coincidence.
 */
const DROP = 3;

/**
 * How long a new frame is given to arrive in full before it is allowed up
 * coarse.
 *
 * The handover waits for the incoming moment to cover the screen at its own
 * level, because a frame let up on ancestors alone would blur the field and
 * then sharpen, once every ten minutes, for no reason a reader could name. But
 * "waits" cannot mean "forever": a tile that will not load would pin the map to
 * a frame that keeps getting older while the footer goes on reporting the age
 * of the one it asked for. Past this, coarse and honest beats sharp and stale.
 */
const PATIENCE_MS = 15_000;

const keyOf = (moment, z, x, y) => `${moment}/${z}/${x}/${y}`;

const RAD = Math.PI / 180;

// How large a cell of the warp's mesh is.
//
// It buys accuracy against draw calls, and both scale as its square: four
// degrees is 4,050 cells for the planet and puts the error between the quad the
// projection wants and the parallelogram canvas can draw at about a quarter of
// a pixel on a large tube — well under the block the layer is quantised to,
// which is what matters. Halving it would quarter an error nobody can see and
// cost sixteen thousand draws a frame.
//
// So it is the error that is held, and not the cell count. Stated as one number
// the cells were sized to fit a desktop, a phone got the same four thousand
// draws a frame for a planet a third of the width — where the same mesh is an
// order of magnitude finer than it needs to be, because the error falls with
// the size of the thing being drawn. The ladder below is every step that
// divides both the 360 degrees of longitude and the mesh's own span of
// latitude, since a step that does not is a mesh that fails to meet itself at
// the date line.
const MESH_STEPS = [4, 6, 8, 12];
// What the mesh is allowed to be wrong by, in pixels on the glass. A tenth of
// the block this whole layer is quantised to, which is the scale at which being
// any more right stops meaning anything.
const MESH_ERROR_PX = 0.5;

/**
 * The coarsest mesh that still draws the sphere to within that error.
 *
 * A cell of θ radians on a globe of radius R departs from the straight-sided
 * patch canvas can draw by its sagitta, R·θ²/8, and the globe's radius is the
 * world's width over 2π. Everything else here — the unfold's half-flattened
 * shapes included — is less curved than a sphere at the same width, so the
 * sphere is the case that decides it.
 */
function meshFor(worldPx) {
  const radius = worldPx / (2 * Math.PI);
  let pick = MESH_STEPS[0];
  for (const deg of MESH_STEPS) {
    const theta = deg * RAD;
    if ((radius * theta * theta) / 8 <= MESH_ERROR_PX) pick = deg;
  }
  return pick;
}
// Where the mesh stops. The world picture is Mercator and Mercator has no
// poles; this is the last parallel it can name.
const MESH_LAT = 84;
// A ceiling on the world picture. Nothing on this map asks for one anywhere
// near it — a globe on a large tube wants about five hundred — but the size is
// derived from a projection's scale, and a scale is something a caller could
// hand in wrong. A picture that quietly tries to allocate a gigabyte is a worse
// failure than one that is coarse.
// ── Fetching one picture ────────────────────────────────────────────────────
//
// Three layers were doing this three times, and the copies had drifted: the
// cloud field retried a failed tile once, the coverage layer retried once and
// complained in different words, and the radar composite did not retry at all —
// against a service that answers the same intermittent 500 as the other two.
// None of that was a decision; it was the order the files were written in.
//
// Fetched rather than pointed at an `<img>`, and that is the part that matters
// rather than the deduplication. An image tag has exactly one failure — it did
// not load — and every one of this instrument's real failures is invisible
// through it. A 500 from a WMS looks the same as a tile that has not arrived. A
// GeoServer exception is an XML document that fails to decode and reads as a
// network blip. And RealEarth says in a header when it is watermarking a
// refusal, which `ir.js` has been inferring from the pixels because a header is
// not a thing an image tag will show you.
//
// The response has to carry CORS either way: every one of these is read back
// pixel by pixel, so a picture that cannot be inspected is no use even when it
// arrives. The three services that answer `*` are asked directly and the one
// that answers nothing goes through `functions/msg.js`, exactly as before.

// Long enough that the second ask is not the same instant as the first, short
// enough to stay inside the settle that wanted the tile. Not the queue's own
// RETRY_MS above, which is the much slower business of asking again later.
const PICTURE_RETRY_MS = 400;

/** How the picture failed, in the words the console will use. */
const WHY = {
  status: (status) => `HTTP ${status}`,
  type: (type) => `${type || "no content-type"} is not an image`,
  refused: (mark) => `refused: ${mark}`,
  decode: () => "the bytes are not a picture",
  network: () => "no answer",
};

/**
 * One picture, or the reason there is none.
 *
 * Resolves `{ image }` on success and `{ why, refused }` otherwise — never
 * throws and never rejects, because every caller here treats a missing picture
 * as a fact about the sky rather than as an error to handle. `refused` is the
 * one failure worth telling apart: the service answered, and what it answered
 * with was a notice rather than a measurement.
 *
 * Retried once, and once only. Two failures is the evidence that this is the
 * outage rather than the blip; past that the honest thing is to draw the map
 * without this piece and let the footer say so.
 */
export async function loadImage(src) {
  const once = async () => {
    let response;
    try {
      response = await fetch(src);
    } catch {
      return { why: WHY.network() };
    }
    if (!response.ok) return { why: WHY.status(response.status) };

    // RealEarth watermarks rather than refuses: the tile arrives 200 OK with
    // the reason printed across it, and says so in a header the pixels can only
    // be guessed at. Believed over the picture, always.
    //
    // Both spellings, because their own documentation gives the name twice and
    // disagrees with itself — the prose says `RE-Watemark` and the header they
    // actually send is the one you would expect. Asking for both costs a map
    // lookup and removes the chance of this quietly never firing.
    const mark =
      response.headers.get("re-watermark") ?? response.headers.get("re-watemark");
    if (mark) return { why: WHY.refused(mark), refused: true };

    // A WMS answers a bad request with a ServiceExceptionReport, at 200. Left
    // to decode it is simply a picture that failed to arrive, which is the one
    // reading it must not have: a tile that is never coming back should stop
    // being asked for, and a blip should not.
    const type = response.headers.get("content-type") ?? "";
    if (!type.startsWith("image/")) return { why: WHY.type(type) };

    try {
      return { image: await createImageBitmap(await response.blob()) };
    } catch {
      return { why: WHY.decode() };
    }
  };

  const first = await once();
  if (first.image || first.refused) return first;
  await new Promise((resolve) => setTimeout(resolve, PICTURE_RETRY_MS));
  return once();
}

/**
 * The same, with a complaint the first time a given source goes quiet.
 *
 * A layer that fails is now said out loud in the footer, which is where a
 * reader needs it. This is the other half: which service, and what it actually
 * answered, for whoever is looking at a console because the footer told them to
 * look somewhere. Once per name, because a service that is down is down for
 * every tile on the screen.
 */
const silent = new Set();

export async function loadPicture(src, name, note) {
  const got = await loadImage(src);
  if (!got.image && name && !silent.has(name)) {
    silent.add(name);
    console.warn(`[keraunos] ${name}: ${got.why}\n           ${note ?? ""}\n           ${src}`);
  }
  return got;
}

const MAX_WORLD = 2048;

/**
 * The deepest level the globe will ask the whole world for.
 *
 * 256 tiles, which is what a planet drawn twice the size of the glass already
 * asks for and gets. One level further is a thousand, and the queue runs four at
 * a time: the difference between a field that fills in a few seconds and one
 * that never finishes. See its use below for why the globe cannot simply ask
 * for the part on screen the way the flat map does.
 */
const GLOBE_LEVEL = 4;

// The globe holds one view of the world: all of it. There is no screen
// rectangle to work out, because the answer is always the same rectangle.
const WHOLE_WORLD = {
  minX: -EARTH_HALF,
  maxX: EARTH_HALF,
  minY: -EARTH_HALF,
  maxY: EARTH_HALF,
};

/**
 * The pyramid, and everything that is stateful about a field.
 *
 * Held by the map in a ref and driven from two places: `want` on every settle,
 * which says which tiles matter now, and `draw` on every frame, which puts up
 * whatever has arrived. Nothing here goes through React. A field changes on the
 * network's schedule rather than the render's, and a component that re-rendered
 * every time a tile landed would be re-rendering the whole map thirty times to
 * fill one screen.
 *
 * `source` is `{ samples, tilePx, maxLevel, fetch, paint }`. `fetch(z, x, y, at)`
 * resolves to whatever `paint(tile, body, tops)` wants, plus an `any` flag
 * saying whether the tile has anything in it at all; null means the tile was
 * not answered and should be asked for again.
 */
export function createField(source) {
  const { samples, tilePx, maxLevel } = source;
  const tiles = new Map(); // key -> { ...source tile, canvas, tinted, born, used }
  const inFlight = new Set();
  const missed = new Map(); // key -> { job, tries } for tiles that did not answer
  // The detail tiles the last settle asked for, in the moment it asked them of.
  // Read only by `health`.
  let owed = [];
  let queue = [];
  let running = 0;
  let clock = 0;
  let retryAt = null;

  let body = "#fff";
  let tops = "#fff";
  let tint = "";

  // The block buffer, held across frames rather than made each one: it is the
  // largest allocation this layer keeps after the tiles themselves, and at a
  // block to five pixels it is small enough that a resize is the only reason
  // to touch it.
  let buffer = null;
  let bufferCtx = null;
  // What that buffer was last composed from. The flat map used to rebuild it on
  // every frame, which is a clear and thirty scaled `drawImage`s for a picture
  // that is usually identical to the one already on it: the field only changes
  // when a tile lands, a handover moves, or the view does, and none of those is
  // most frames. The globe's world picture has always been kept this way — see
  // `worldAt` below — and the reason the flat one was not is simply that it was
  // written first. It costs one string compare to find out.
  let bufferAt = "";

  // The globe's flat picture of the whole world, and the pixels read back out
  // of it. Held across frames for the same reason the buffer is, and rebuilt on
  // rather less: rotation does not touch it. `worldAt` is what it was last
  // built from, `arrivals` counts tiles landing so that a signature can see
  // one, and `fading` says a tile in it was still coming up when it was drawn —
  // which is the one change a signature cannot see, because it is time passing.
  let world = null;
  let worldCtx = null;
  let worldAt = "";
  let arrivals = 0;
  let fading = false;
  // Counted up every time the picture is actually repainted, so that anything
  // holding a copy of what the world looked like can tell in one comparison
  // that it is looking at an older one. `worldAt` cannot answer that on its
  // own: a fade repaints the same signature.
  let worldGen = 0;

  // The warped sky, as it last went to the glass, and what it was warped from.
  //
  // Laying the world over a sphere is four thousand draws, and a planet nobody
  // is turning is four thousand draws for a picture that is already there. So
  // the result is kept, and the mesh is only walked again when something it is
  // a function of has moved: where the planet is pointed, how much of its far
  // side is up, or the picture underneath. At rest that is never, and a frame
  // of the sky costs one `drawImage`.
  let warp = null;
  let warpCtx = null;
  let warpAt = "";

  // The warp's mesh, held across frames: the nodes are re-projected every frame
  // but the arrays they go in never change size, and the rows' places in the
  // world picture only change when the picture is resized.
  let mesh = null;
  let meshLit = null;
  let meshV = null;
  let meshVAt = 0;

  // Which published frame is on the glass, which one is coming up behind it,
  // and when the handover started. `shown` is null until the very first tile
  // lands, which is the one case that is not a crossfade: there is nothing to
  // fade from, so the field simply fills in.
  let shown = null;
  let incoming = null;
  let incomingAt = null;
  // When the incoming frame started waiting, which is what PATIENCE_MS is
  // measured against. Wall clock rather than the frame moment: it is about how
  // long the reader has been looking at the old picture.
  let incomingSince = 0;
  let fadeFrom = 0;

  const level = (projection) => levelFor(projection, tilePx, maxLevel);

  /**
   * A tile that did not answer, put back for another go.
   *
   * Only while the tab is being looked at. A hidden page stops its render loop
   * and stands its fetches down — see the map — so a timer that kept asking
   * would be spending somebody else's bandwidth on a picture nobody can see.
   * Coming back to the tab calls `want` again, which re-queues everything still
   * missing, so nothing is lost by dropping it here.
   */
  const miss = (job) => {
    if (typeof document !== "undefined" && document.hidden) return;
    const tries = (missed.get(job.key)?.tries ?? 0) + 1;
    if (tries > RETRIES) {
      missed.delete(job.key);
      return;
    }
    missed.set(job.key, { job, tries });
    if (retryAt) return;
    retryAt = setTimeout(() => {
      retryAt = null;
      // Only what is still wanted. A moment can be left behind by a scrub, and
      // a tile can have arrived by another route, in which case the miss is
      // simply stale and the entry goes.
      //
      // Iterated over a copy, and the entries that survive are left in place
      // rather than removed and put back. Both halves of that matter: a Map
      // iterator is live, so deleting a key and re-inserting it during the walk
      // appends it past the cursor and the loop meets it again — and again, and
      // the tab locks. Leaving the entry alone also keeps its try count, which
      // is what makes the bound above bound anything.
      const target = incoming ?? shown;
      for (const [key, held] of [...missed]) {
        if (key.slice(0, key.indexOf("/")) !== target || settled(key) || inFlight.has(key)) {
          missed.delete(key);
          continue;
        }
        queue.push(held.job);
      }
      pump();
    }, RETRY_MS);
  };

  // A tile already answered in full. A partial one is held and drawn but is not
  // done, so it does not close the question the way a complete tile does.
  const settled = (key) => {
    const have = tiles.get(key);
    return have !== undefined && !have.partial;
  };

  const pump = () => {
    while (running < IN_FLIGHT && queue.length) {
      const job = queue.shift();
      if (settled(job.key) || inFlight.has(job.key)) continue;
      inFlight.add(job.key);
      running++;
      source
        .fetch(job.z, job.x, job.y, job.at)
        .then((tile) => {
          if (tile) {
            // The arrival time is inherited when one of these replaces a
            // partial tile already on the glass. It is the same ground being
            // completed, not a tile arriving, and restarting the fade would
            // flash the patch that just got better.
            const had = tiles.get(job.key);
            tiles.set(job.key, {
              ...tile,
              born: had?.born ?? performance.now(),
              used: clock,
            });
            arrivals++;
            if (tile.partial) miss(job);
            else missed.delete(job.key);
          } else {
            // Not held, so that it is asked for again rather than remembered as
            // empty ground.
            miss(job);
          }
        })
        .catch(() => miss(job))
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
   * How much of the incoming frame to show, and whether it may start showing.
   *
   * Lifted out of `draw` when the globe arrived, unchanged. Both painters ask
   * the same question of the same pyramid and the answer is a property of what
   * has landed, not of the projection it is going to be drawn through — and a
   * handover that advanced differently depending on which view was up would put
   * the two a frame of weather apart every ten minutes.
   */
  const handover = (wanted, now) => {
    // The handover between one published frame and the next waits for the new
    // one to be able to cover the screen. Not for every tile at full detail —
    // an ancestor is a real answer — only for there to be nothing missing, so
    // the field never thins out mid-fade.
    //
    // At its own level, now that there is always a floor beneath it. Covered
    // by an ancestor used to be the same test as arrived — only the visible
    // level was ever fetched, so anything answering for a tile was that tile —
    // and it stopped being the same test the moment the floor above started
    // being fetched too. Left as it was, every handover would pass the
    // instant the coarse net landed, and the whole field would soften and
    // re-sharpen once every ten minutes.
    //
    // Unless it has waited too long, in which case coarse goes up rather than
    // the map sitting on a frame that is quietly ageing past what the footer
    // says it is.
    if (incoming && shown !== null && !fadeFrom) {
      const arrived = wanted.every((tile) => tiles.has(keyOf(incoming, tile.z, tile.x, tile.y)));
      const covered = () =>
        wanted.every((tile) => {
          for (let up = tile.z; up >= 0; up--) {
            const shift = tile.z - up;
            if (tiles.has(keyOf(incoming, up, tile.x >> shift, tile.y >> shift))) return true;
          }
          return false;
        });
      if (arrived || (now - incomingSince > PATIENCE_MS && covered())) fadeFrom = now;
    }

    // Nothing at all until it can cover the screen — until then the frame
    // already up is the whole of the field, which is the point of waiting: a
    // half-arrived replacement drawn over its predecessor is exactly the
    // thinning-out this is here to prevent. The one exception is a cold start,
    // where there is nothing to fade from and the tiles simply fill in as they
    // land.
    if (!incoming) return 0;
    if (shown === null) return 1;
    return fadeFrom ? Math.min(1, (now - fadeFrom) / MOMENT_FADE_MS) : 0;
  };

  /**
   * The frame that was on the glass is one nobody is going to ask for again, so
   * its tiles go rather than sit in the budget crowding out ground the reader
   * can actually reach.
   */
  const settle = (fade) => {
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
    evict();
  };

  /**
   * Draw one tile's rectangle, or the best ancestor of it that exists.
   *
   * This is the whole of the lazy load. A tile that has not arrived is not a
   * hole: the level above it covers four times the ground at half the detail
   * and was almost certainly fetched on the way in, so the quadrant of it that
   * belongs here goes up instead. Walk up until something answers. At worst
   * that is level 0, one tile for the planet, which is the cheapest thing in
   * the pyramid and the reason a cold start still shows a field.
   */
  const drawTile = (ctx, moment, z, x, y, place, now, alpha) => {
    for (let up = z; up >= 0; up--) {
      const patch = ancestorPatch(z, x, y, up, samples);
      // The patch shrinks as the walk climbs, so the first rung too coarse to
      // mean anything is also the last one worth trying.
      if (patch.step < MIN_PATCH) break;
      const tile = tiles.get(keyOf(moment, up, patch.x, patch.y));
      if (!tile) continue;
      tile.used = clock;
      if (!tile.any) return true; // nothing here, and known to be
      if (tile.tinted !== tint) {
        tile.canvas = source.paint(tile, body, tops);
        tile.tinted = tint;
      }
      // Only a tile drawn at its own level has an arrival worth showing; an
      // ancestor standing in for one is already on the glass and must not blink
      // when the tile it is covering for finally lands.
      const age = up === z ? Math.min(1, (now - tile.born) / TILE_FADE_MS) : 1;
      // Noted for the globe, which composes the world once and then reads it
      // for as long as it stays the same picture. A tile part way up is the one
      // way it can stop being the same picture without anything happening.
      if (age < 1) fading = true;
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
    /**
     * Whether the sky would draw itself differently a frame from now.
     *
     * The tube stopped repainting when nothing on it is moving, and the sky is
     * the one layer whose moving is nobody else's business: tiles land on the
     * network's schedule and come up over a fifth of a second, and a handover
     * between two moments runs on its own clock. None of that is visible from
     * the render loop, which would otherwise hold a still frame while the
     * weather resolved behind it.
     *
     * Asked rather than published, and computed from the tiles themselves
     * rather than from a flag set during the last paint: a flag only knows what
     * happened the last time something drew, and the frame this is guarding is
     * exactly the one where nothing did.
     */
    restless(now) {
      if (incoming !== null) return true;
      for (const tile of tiles.values()) {
        if (tile.canvas && now - tile.born < TILE_FADE_MS) return true;
      }
      return false;
    },

    /** The tokens the marks are drawn in; a change repaints, never refetches. */
    palette(nextBody, nextTops) {
      body = nextBody;
      tops = nextTops;
      tint = `${nextBody}|${nextTops}`;
    },

    /** Everything goes: the layer was switched off. */
    clear() {
      tiles.clear();
      missed.clear();
      if (retryAt) clearTimeout(retryAt);
      retryAt = null;
      queue = [];
      shown = null;
      incoming = null;
      incomingAt = null;
      incomingSince = 0;
      worldAt = "";
      bufferAt = "";
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
     *
     * `whole` is for the views `drawWarp` paints. The screen rectangle is read
     * as Mercator, which is the right question for the flat map and a wrong one
     * for a sphere: the canvas corners of a globe are not the corners of a
     * Mercator box, and taken as though they were they name a strip of about
     * ±100° of longitude and ±50° of latitude. `drawWarp` draws every tile of
     * the world regardless — half of it is one drag away and the whole of it is
     * on the glass through the unfold — so everything outside that strip was
     * being drawn from whatever ancestor existed, which is level 0, one tile for
     * the planet. It showed as the Pacific and the poles arriving as a smudge
     * while the rest of the sky was sharp, and it showed worst on a cold start,
     * where level 0 is all there is.
     */
    want(projection, width, height, at, whole = false) {
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
        incomingSince = performance.now();
        fadeFrom = 0;
      }

      const frame = whole ? WHOLE_WORLD : mercatorFrame(projection, width, height);
      const z = level(projection);
      const target = incoming ?? shown;
      const targetAt = target === incoming ? incomingAt : at;

      // Moments nobody will ask for again.
      //
      // The store is normally kept by `draw`: it drops the outgoing frame when
      // a handover finishes, and evicts the least recently drawn tiles after
      // it. But `draw` is a render-loop callback, and the render loop stops
      // when the tab is hidden — while the clock does not. A moment that
      // arrives and is replaced before anything is ever drawn leaves its tiles
      // behind with nothing to collect them, and the only bound on how many
      // times that can happen is how long the page is left open.
      //
      // So the sweep also runs here, where it is driven by the settle rather
      // than by the frame. Every tile belongs to `shown` or to `incoming`;
      // there is no third moment anything reads from.
      for (const key of tiles.keys()) {
        const held = key.slice(0, key.indexOf("/"));
        if (held !== shown && held !== incoming) tiles.delete(key);
      }
      evict();

      queue = [];
      const add = (tile) => {
        const key = keyOf(target, tile.z, tile.x, tile.y);
        if (settled(key) || inFlight.has(key)) return;
        queue.push({ ...tile, key, at: targetAt });
      };

      // The floor first. A handful of tiles at most, and until they are down
      // there is nothing under the detail level to cover a request that fails.
      // Cheap enough to ask for on every settle: past the first one they are
      // already held, and the two lookups above skip them.
      for (const level of new Set([Math.max(0, z - DROP), 0])) {
        if (level >= z) continue;
        for (const tile of tilesFor(frame, level)) add(tile);
      }

      // Then the detail, centre outward. There is a ceiling on how many of
      // these can be in the air at once, so the queue's order is the order the
      // field fills in, and the tile under the reader's eye is worth more than
      // the one in the corner behind the feed.
      const detail = tilesFor(frame, z, true);
      for (const tile of detail) add(tile);
      // What this view is owed, so `health` can say how much of it arrived.
      // Recorded here rather than counted from the store, because the store
      // holds the floor levels and other moments too, and neither of those is
      // the question a reader is asking.
      owed = detail.map((tile) => keyOf(target, tile.z, tile.x, tile.y));
      pump();
    },

    /**
     * How much of the ground under the view actually answered.
     *
     * The failure this exists for is the quiet one. A dish that does not reply
     * is dropped from its tile, the tile is kept without it, and the territory
     * it covered draws as clear sky — which on a weather layer is not a blank,
     * it is a reading, and a wrong one. The same is true of a tile that never
     * arrived at all: the ancestor beneath it is stretched over the gap and the
     * result is plausible, smooth, and older than it looks.
     *
     * So the count goes to the glass. `whole` is what the view asked for,
     * `held` what is drawn from real tiles at this level, and `partial` those
     * standing with a dish missing. Nothing here judges — the footer decides
     * what is worth saying, because how much of a sky is missing before it is
     * worth mentioning is a question about reading, not about tiles.
     */
    health() {
      let held = 0;
      let partial = 0;
      for (const key of owed) {
        const tile = tiles.get(key);
        if (!tile) continue;
        held++;
        if (tile.partial) partial++;
      }
      return { whole: owed.length, held, partial, waiting: inFlight.size };
    },

    /**
     * The field, onto the map's canvas, in whatever state it has reached.
     *
     * Called every frame from the render loop, so it reads the live projection
     * rather than the settled one and the field tracks a drag exactly: a tile
     * is a rectangle of the world, and where that rectangle is on the glass is
     * something the projection can answer for any view, mid-gesture or not.
     * There is no stretched-from-the-old-view step here at all, because there
     * is no view the tiles belong to.
     */
    /**
     * `debug` overlays the tile grid and what each tile is actually being
     * drawn from. It exists because this layer's failures are invisible by
     * construction: a tile that never arrived, a tile covered by a coarse
     * ancestor, a tile missing one satellite, and a genuinely cloudless sky all
     * render as the same dark ground. Arguing about which one you are looking
     * at from a screenshot does not work — this says which.
     *
     * Off unless the address carries `?tiles`. See the map.
     */
    draw(ctx, projection, width, height, now, debug) {
      if (!projection || !width || !height) return;
      const frame = mercatorFrame(projection, width, height);
      const z = level(projection);
      const wanted = tilesFor(frame, z);
      clock++;

      // The field is composed into a block-sized buffer and enlarged onto the
      // glass at the end, so everything below works in blocks rather than in
      // pixels. See BLOCK_PX.
      const bw = Math.max(1, Math.round(width / BLOCK_PX));
      const bh = Math.max(1, Math.round(height / BLOCK_PX));
      if (!buffer) {
        buffer = document.createElement("canvas");
        bufferCtx = buffer.getContext("2d");
      }
      if (buffer.width !== bw || buffer.height !== bh) {
        buffer.width = bw;
        buffer.height = bh;
        bufferAt = ""; // a resize clears it, so nothing is held over
      }

      // Metres to screen, both axes at once: EPSG:3857 and d3's Mercator are
      // the same pair of numbers a constant apart, so this is a multiply.
      const k = projection.scale();
      const [tx, ty] = projection.translate();
      const at = (m) => (k * Math.PI * m) / EARTH_HALF;
      const toBlocksX = bw / width;
      const toBlocksY = bh / height;
      // Rounded, and rounded from the shared edge rather than from a width:
      // neighbouring tiles then agree on where the boundary is and the grid
      // leaves no gaps between them. Rounded to whole blocks now rather than to
      // whole pixels, which is the same guarantee one grid coarser — and it
      // keeps every tile edge on the block lattice, so a tile boundary is never
      // a half-lit row of blocks.
      const place = (tile) => {
        const f = tileFrame(tile.z, tile.x, tile.y);
        const left = Math.round((at(f.minX) + tx) * toBlocksX);
        const right = Math.round((at(f.maxX) + tx) * toBlocksX);
        const top = Math.round((ty - at(f.maxY)) * toBlocksY);
        const bottom = Math.round((ty - at(f.minY)) * toBlocksY);
        return { x: left, y: top, w: right - left, h: bottom - top };
      };

      const fade = handover(wanted, now);

      // Whether the buffer already holds this picture.
      //
      // The same question the globe asks of its world picture below, with the
      // view added: that one is the whole planet in world coordinates and a
      // rotation only moves the eye over it, while this one is in screen space,
      // so where a tile sits on it is a function of the projection too. The rest
      // is identical — which moments are up, how far between them, whether
      // anything has landed since, and what colour they are painted in.
      //
      // `fading` is the term no signature can carry, because it is time passing:
      // a tile that arrived within the last fifth of a second is still coming up
      // and has to be redrawn on a frame where nothing else changed.
      const signature = `${shown}|${incoming}|${fade}|${arrivals}|${tint}|${z}|${bw}|${bh}|${k}|${tx}|${ty}`;
      if (signature !== bufferAt || fading) {
        bufferCtx.clearRect(0, 0, bw, bh);
        fading = false;

        // The frame on the glass, on its way out, and the one arriving over it.
        // Both are drawn only while they are worth something, so the ordinary
        // case — one frame, no handover — is a single pass at full weight.
        for (const tile of wanted) {
          const box = place(tile);
          if (box.w <= 0 || box.h <= 0) continue;
          // Out as the other comes in, and the complement is the point: held at
          // full weight the two frames sum to more field than either of them is,
          // and the pair reads as one doubled rather than one replacing the
          // other. Both are washes, so the two halves add back to a whole.
          if (shown !== null && fade < 1) {
            drawTile(bufferCtx, shown, tile.z, tile.x, tile.y, box, now, 1 - fade);
          }
          if (incoming && fade > 0) {
            drawTile(bufferCtx, incoming, tile.z, tile.x, tile.y, box, now, fade);
          }
        }
        bufferAt = signature;
      }

      // And onto the glass, one block to many pixels, unsmoothed. This is the
      // whole of the pixelation: the lattice belongs to the screen rather than
      // to any tile, so it does not shift phase at a tile boundary or change
      // pitch with the zoom, and it lands on whole device pixels the way the
      // land matrix's own dots do.
      //
      // It is also cheaper than drawing the tiles straight onto the canvas was.
      // The composite happens at a hundredth of the area, and what replaces it
      // at full size is a nearest-neighbour enlargement, which is the least
      // work canvas can do.
      bufferCtx.globalAlpha = 1;
      ctx.save();
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(buffer, 0, 0, width, height);
      ctx.restore();

      if (debug) {
        // What each visible tile is actually being drawn from, at the level the
        // pyramid is working at. `own` is the tile itself; `up N` means the
        // tile never arrived and a coarser ancestor is standing in for it;
        // `PARTIAL` means it arrived with a satellite missing; `EMPTY` is a
        // real answer of no cloud; `MISSING` is the only true void.
        const moment = incoming ?? shown;
        ctx.save();
        ctx.font = "11px ui-monospace, monospace";
        ctx.textBaseline = "top";
        ctx.lineWidth = 1;
        for (const tile of wanted) {
          const box = place(tile);
          if (box.w <= 0 || box.h <= 0) continue;
          const x = box.x * BLOCK_PX;
          const y = box.y * BLOCK_PX;
          const w = box.w * BLOCK_PX;
          const h = box.h * BLOCK_PX;
          let state = "MISSING";
          let colour = "#ff3b30";
          for (let up = tile.z; up >= 0; up--) {
            const shift = tile.z - up;
            const held = tiles.get(keyOf(moment, up, tile.x >> shift, tile.y >> shift));
            if (!held) continue;
            if (up !== tile.z) {
              state = `up ${tile.z - up}`;
              colour = "#ff9500";
            } else if (held.partial) {
              state = "PARTIAL";
              colour = "#ffcc00";
            } else if (!held.any) {
              state = "EMPTY";
              colour = "#34c759";
            } else {
              state = "own";
              colour = "#32ade6";
            }
            break;
          }
          ctx.strokeStyle = colour;
          ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
          ctx.fillStyle = colour;
          ctx.fillText(`${tile.z}/${tile.x}/${tile.y} ${state}`, x + 5, y + 4);
        }
        ctx.restore();
      }

      settle(fade);
    },

    /**
     * The field, onto a world that is not flat.
     *
     * A tile is a rectangle of the world, and on the map that is all it ever
     * has to be: four multiplications put its corners on the glass and
     * `drawImage` does the rest. On a sphere it is a curved quad, and half way
     * through the unfold it is a shape with no name at all. There is no
     * transform canvas can be given that draws either.
     *
     * So the tiles are not drawn to the glass. They are composed onto one flat
     * picture of the whole world — the same tiles, the same painter, the same
     * crossfade — and that picture is then laid over the world in patches: a
     * mesh of lat/lon cells, each one a rectangle of the picture put through
     * whatever projection is being asked for. A cell is small enough that the
     * curve inside it is under a pixel, so the affine canvas can draw and the
     * quad that is wanted are the same shape to the eye, and neighbouring
     * patches share their edges rather than being fitted together.
     *
     * That the projection is only ever *asked* is the whole point of the shape
     * of this. It is never inverted and never has to be Mercator, so the globe
     * at rest, the world rolling up into it, and the boot unfold are one path
     * with one picture behind them — which is what lets the sky stay on the
     * ground while the ground is changing shape.
     *
     * The world picture itself is rebuilt only when it has changed, which is on
     * a tile landing and during a crossfade, and never on the projection
     * moving: turning the planet moves the eye over the picture, not the
     * picture.
     */
    drawWarp(ctx, projection, { rotate = null, back = 1, at = 0 } = {}, width, height, now) {
      if (!projection || !width || !height) return;
      clock++;

      const plain = projection.plain ?? projection;

      /**
       * How wide the whole world is, in pixels, at the resolution the reader is
       * looking at it.
       *
       * Measured off the projection rather than read from its scale, and that
       * is not fussiness. `scale` means whatever the projection that carries it
       * decided it means: the globe puts its radius there, and the unfold puts
       * a figure π times smaller, because its raw has a gain of π built in so
       * that a sphere and a Mercator can be mixed in the same units. Read as
       * though the two agreed, the field's resolution jumped by a factor of π
       * at the frame the swap handed over — which is a cloud layer visibly
       * resetting at the end of a move that is meant to be continuous.
       *
       * Two points a quarter degree apart on the equator answer it for any
       * projection, in the units the question was asked in, and go on agreeing
       * through every frame in between.
       */
      const a = plain([at, 0]);
      const b = plain([at + 0.25, 0]);
      const worldPx =
        a && b && isFinite(a[0]) && isFinite(b[0])
          ? (360 * Math.hypot(b[0] - a[0], b[1] - a[1])) / 0.25
          : 2 * Math.PI * projection.scale();

      // The level. It has to be the level the map *asked* for, or the pyramid
      // holds tiles nobody draws and draws tiles nobody fetched — `drawTile`
      // only ever walks up, so a mismatch falls all the way back to the one
      // tile that covers the planet.
      //
      // Held to GLOBE_LEVEL as well, and that stop is the whole difference
      // between this and the flat map. The flat map asks for the tiles under the
      // viewport, so zooming in asks for a deeper level and no more of them. The
      // globe asks for the *world*, every time, so a deeper level is four times
      // as many tiles of it — and the count is what runs away: level 3 is 64
      // tiles, level 5 is 1,024. Measured on a zoomed globe, 1,024 tiles took
      // over a minute to arrive four at a time and the layer simply never
      // finished, which reads as the cloud having disappeared. Stopping the
      // level instead costs a field softer than the planet it is drawn on,
      // which is a wash behind a map and can afford to be.
      const z = clamp(Math.round(Math.log2(worldPx / tilePx)), 0, Math.min(maxLevel, GLOBE_LEVEL));
      // Every tile of it. On a sphere half the planet is on screen and the rest
      // is one drag away; through the unfold it is all arriving at once.
      const wanted = tilesFor(WHOLE_WORLD, z);
      const fade = handover(wanted, now);

      // The world picture, in blocks, at that same resolution.
      const ww = clamp(Math.round(worldPx / BLOCK_PX), 16, MAX_WORLD);
      if (!world) {
        world = document.createElement("canvas");
        worldCtx = world.getContext("2d");
      }
      if (world.width !== ww) {
        world.width = ww;
        world.height = ww; // the whole Mercator square, corner to corner
        worldAt = "";
      }

      // Whether the picture on the world canvas is still the right one. Every
      // term is something that changes what a tile is drawn as: which moments
      // are up, how far between them, whether a tile has landed since, and what
      // colour they are being painted in. `fading` carries the last of it — a
      // tile that arrived within the fade is still coming up, and a signature
      // cannot see time passing.
      const signature = shown + "|" + incoming + "|" + fade + "|" + arrivals + "|" + tint + "|" + z + "|" + ww;
      if (signature !== worldAt || fading) {
        worldCtx.clearRect(0, 0, ww, ww);
        fading = false;
        // Metres to blocks: the world is `ww` blocks across by definition, so
        // this is one multiplication and the tile grid falls straight out.
        // Rounded from the shared edge rather than from a width, so
        // neighbouring tiles agree on where the boundary is and the grid leaves
        // no gaps between them.
        const at = (m) => (ww * m) / (2 * EARTH_HALF);
        for (const tile of wanted) {
          const f = tileFrame(tile.z, tile.x, tile.y);
          const left = Math.round(at(f.minX) + ww / 2);
          const right = Math.round(at(f.maxX) + ww / 2);
          const top = Math.round(ww / 2 - at(f.maxY));
          const bottom = Math.round(ww / 2 - at(f.minY));
          const box = { x: left, y: top, w: right - left, h: bottom - top };
          if (box.w <= 0 || box.h <= 0) continue;
          if (shown !== null && fade < 1) {
            drawTile(worldCtx, shown, tile.z, tile.x, tile.y, box, now, 1 - fade);
          }
          if (incoming && fade > 0) {
            drawTile(worldCtx, incoming, tile.z, tile.x, tile.y, box, now, fade);
          }
        }
        worldCtx.globalAlpha = 1;
        worldAt = signature;
        worldGen++;
      }

      // Onto the glass through a block buffer of its own, sized and enlarged
      // exactly as the flat map's is: the lattice the field is quantised to
      // belongs to the screen in every view, and does not change pitch when the
      // world folds up. Its own rather than the flat map's because this one is
      // kept between frames — see `warpAt` — and a buffer the other view
      // composes into is one that would be handed back holding a flat map.
      const bw = Math.max(1, Math.round(width / BLOCK_PX));
      const bh = Math.max(1, Math.round(height / BLOCK_PX));
      if (!warp) {
        warp = document.createElement("canvas");
        warpCtx = warp.getContext("2d");
      }
      if (warp.width !== bw || warp.height !== bh) {
        warp.width = bw;
        warp.height = bh;
        warpAt = "";
      }

      // Everything the picture on that buffer is a function of. The projection
      // is not asked what it is — it is asked where it puts two points, which
      // is the same question the resolution above is taken from and answers for
      // a sphere, a Mercator, and every shape between them alike. Two points
      // and a rotation fix an orthographic view completely, and through the
      // unfold every one of them is moving, so a frame of a move never matches
      // the frame before it and the mesh is walked exactly when it has to be.
      const laid =
        `${worldGen}|${back}|${rotate ? rotate[0] + "," + rotate[1] : ""}` +
        `|${a[0]},${a[1]},${b[0]},${b[1]}`;

      if (laid !== warpAt) {
        warpAt = laid;
        warpCtx.setTransform(1, 0, 0, 1, 0, 0);
        warpCtx.clearRect(0, 0, bw, bh);

        // How finely the world has to be cut up to be drawn at this size. See
        // `meshFor`: it is the error that is held constant, not the cell count,
        // so a planet on a phone costs a quarter of the draws it did when the
        // mesh was a single number chosen against a desktop.
        const meshDeg = meshFor(worldPx);

        // The mesh: every node projected once and read by the four cells around
        // it. Carried in blocks rather than pixels, because that is what the
        // buffer is in.
        const toX = bw / width;
        const toY = bh / height;
        const cols = Math.round(360 / meshDeg);
        const rows = Math.round((2 * MESH_LAT) / meshDeg);
        const nodes = (cols + 1) * (rows + 1);
        if (!mesh || mesh.length !== nodes * 2) {
          mesh = new Float64Array(nodes * 2);
          meshLit = new Uint8Array(nodes);
        }
        for (let row = 0; row <= rows; row++) {
          const lat = MESH_LAT - row * meshDeg;
          for (let col = 0; col <= cols; col++) {
            const lon = -180 + col * meshDeg;
            const node = row * (cols + 1) + col;
            // Asked without the projection's own culling, which is a property
            // of the globe rather than of the mesh: the far side is wanted
            // here, at whatever weight the caller gives it, and cutting it away
            // in two places by two rules is how the two come to disagree.
            const xy = plain([lon, lat]);
            mesh[node * 2] = xy ? xy[0] * toX : NaN;
            mesh[node * 2 + 1] = xy ? xy[1] * toY : NaN;
            meshLit[node] = !rotate || facing(lon, lat, rotate) ? 1 : 0;
          }
        }

        // Where each row of the mesh sits in the world picture. Latitude is the
        // axis Mercator stretches, so it is worked out rather than stepped.
        if (!meshV || meshV.length !== rows + 1 || meshVAt !== ww) {
          meshV = new Float64Array(rows + 1);
          meshVAt = ww;
          for (let row = 0; row <= rows; row++) {
            const phi = (MESH_LAT - row * meshDeg) * RAD;
            meshV[row] = ww / 2 - (Math.log(Math.tan(Math.PI / 4 + phi / 2)) * ww) / (2 * Math.PI);
          }
        }

        const step = (meshDeg / 360) * ww;
        let alpha = -1;
        for (let row = 0; row < rows; row++) {
          const sy = meshV[row];
          const sh = meshV[row + 1] - sy;
          if (!(sh > 0)) continue;
          for (let col = 0; col < cols; col++) {
            const node = row * (cols + 1) + col;
            const below = node + cols + 1;
            // The far side of a sphere, at whatever weight the caller gives it.
            // Asked first: on a globe at rest half the mesh is behind the
            // planet and weighs nothing, and there is no sense reading three
            // corners out of the mesh to place a patch that is not drawn.
            const lit = meshLit[node] && meshLit[node + 1] && meshLit[below];
            const want = lit ? 1 : back;
            if (want <= 0) continue;

            const x00 = mesh[node * 2];
            const x10 = mesh[(node + 1) * 2];
            const x01 = mesh[below * 2];
            // NaN: the projection had nothing to say about this corner.
            if (!(x00 === x00) || !(x10 === x10) || !(x01 === x01)) continue;
            const y00 = mesh[node * 2 + 1];
            const y10 = mesh[(node + 1) * 2 + 1];
            const y01 = mesh[below * 2 + 1];

            // A cell that leaps the whole buffer is the projection wrapping at
            // the antimeridian, not a patch of sky.
            if (Math.abs(x10 - x00) > bw / 2) continue;

            if (want !== alpha) {
              warpCtx.globalAlpha = want;
              alpha = want;
            }

            const sx = col * step;
            // The affine that carries the picture's rectangle onto the cell's
            // parallelogram. Three corners fix it; the fourth is where the quad
            // and the parallelogram part company, and at this mesh that is a
            // fraction of a pixel — under the block this whole layer is
            // quantised to, which is why the patches leave no seams.
            const ax = (x10 - x00) / step;
            const bx = (y10 - y00) / step;
            const cx = (x01 - x00) / sh;
            const dx = (y01 - y00) / sh;
            warpCtx.setTransform(ax, bx, cx, dx, x00 - ax * sx - cx * sy, y00 - bx * sx - dx * sy);
            // Drawn a hair over its own edges. The patches already meet, but
            // they meet on fractional coordinates, and a rasteriser rounding
            // two abutting edges the same way leaves the odd pixel unclaimed.
            warpCtx.drawImage(world, sx, sy, step, sh, sx - 0.5, sy - 0.5, step + 1, sh + 1);
          }
        }
        warpCtx.setTransform(1, 0, 0, 1, 0, 0);
        warpCtx.globalAlpha = 1;
      }

      ctx.save();
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(warp, 0, 0, width, height);
      ctx.restore();

      settle(fade);
    },
  };
}
