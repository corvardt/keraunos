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

// ── Painting ────────────────────────────────────────────────────────────────

/**
 * An alpha channel, filled through with a colour token.
 *
 * Both sources build their marks as coverage and then colour them this way, and
 * neither ever names a colour itself: the tokens are CSS colours and stay CSS
 * colours, so whatever the stylesheet and the phosphor between them decided a
 * token is, is what gets drawn.
 */
export function fillThrough(ctx, alpha, colour, samples) {
  const scratch = document.createElement("canvas");
  scratch.width = samples;
  scratch.height = samples;
  const sctx = scratch.getContext("2d");
  const image = sctx.createImageData(samples, samples);
  image.data.set(alpha, 0);
  sctx.putImageData(image, 0, 0);
  sctx.globalCompositeOperation = "source-in";
  sctx.fillStyle = colour;
  sctx.fillRect(0, 0, samples, samples);
  ctx.drawImage(scratch, 0, 0);
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
        incomingSince = performance.now();
        fadeFrom = 0;
      }

      const frame = mercatorFrame(projection, width, height);
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
      for (const tile of tilesFor(frame, z, true)) add(tile);
      pump();
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
      }
      bufferCtx.clearRect(0, 0, bw, bh);

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

      // How much of the incoming frame to show. Nothing at all until it can
      // cover the screen — until then the frame already up is the whole of the
      // field, which is the point of waiting: a half-arrived replacement drawn
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

      evict();
    },
  };
}
