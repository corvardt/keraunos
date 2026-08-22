// Checks the cloud field's grid, its territories, its calibrations and the
// requests it builds from them.
//
// None of this is visible. A wash drawn behind a map looks equally plausible
// whether the tiles are aligned or half a tile out, whether the ring covers the
// whole planet or leaves a strip at the antimeridian uncovered, and whether the
// two services' pictures agree about what -30°C looks like or disagree by a
// third of the scale. The layer is soft and dim by design, which is exactly what
// makes a wrong one impossible to spot: it renders, it moves, it sits over the
// weather roughly where weather is. The arithmetic is the only thing that can
// say, so it is checked here.
//
//   node scripts/check-ir.cjs

const { pathToFileURL } = require("url");
const path = require("path");

const EARTH_HALF = 20037508.342789244;
const EQUATOR = 2 * EARTH_HALF;

let ok = true;
const pass = (good, what, detail = "") => {
  console.log(`  ${good ? "✓" : "✗"}  ${what.padEnd(52)} ${detail}`);
  if (!good) ok = false;
};
const near = (actual, expected, tolerance, what) =>
  pass(
    Math.abs(actual - expected) <= tolerance,
    what,
    `${actual.toFixed(4).padStart(10)}  (expected ${expected}±${tolerance})`
  );

import(pathToFileURL(path.join(__dirname, "../src/lib/ir.js")).href).then(async (ir) => {
  const {
    DISCS,
    SAMPLES,
    MAX_LEVEL,
    BREAK,
    levelFor,
    tileFrame,
    tilesFor,
    ancestorPatch,
    url,
    longitudeWeight,
    discsFor,
    STRETCH,
    scalarFor,
    flat,
    MIN_PATCH,
    STEP_MS,
    LAG_MS,
  } = ir;

  // ── The grid ──────────────────────────────────────────────────────────────
  //
  // A tile's box is what one service is asked for and its address is what the
  // other is, so an error here is imagery fetched for one piece of ground and
  // drawn over another. It would still look like clouds.
  console.log("\nThe grid");
  {
    // Level 0 is the planet, exactly. Everything else is defined off it.
    const world = tileFrame(0, 0, 0);
    near(world.minX, -EARTH_HALF, 1e-6, "level 0 runs the full width of the world");
    near(world.maxY, EARTH_HALF, 1e-6, "level 0 runs the full height of the world");

    // Adjacent tiles must share an edge to the bit, or the field has hairline
    // gaps or overlaps that the drawn-and-rounded rectangles would paper over.
    let shared = true;
    let covers = true;
    for (const z of [1, 3, 5, 7]) {
      const n = 2 ** z;
      for (const [x, y] of [[0, 0], [1, 2], [n - 1, n - 1], [n >> 1, n >> 1]]) {
        const here = tileFrame(z, x, y);
        if (x + 1 < n && Math.abs(tileFrame(z, x + 1, y).minX - here.maxX) > 1e-6) shared = false;
        if (y + 1 < n && Math.abs(tileFrame(z, x, y + 1).maxY - here.minY) > 1e-6) shared = false;
      }
      // And the level as a whole is the world, with nothing left over.
      const first = tileFrame(z, 0, 0);
      const last = tileFrame(z, n - 1, n - 1);
      if (Math.abs(first.minX + EARTH_HALF) > 1e-6) covers = false;
      if (Math.abs(last.maxX - EARTH_HALF) > 1e-6) covers = false;
      if (Math.abs(first.maxY - EARTH_HALF) > 1e-6) covers = false;
      if (Math.abs(last.minY + EARTH_HALF) > 1e-6) covers = false;
      if (Math.abs((first.maxX - first.minX) * n - EQUATOR) > 1e-6) covers = false;
    }
    pass(shared, "neighbouring tiles share an edge exactly", "levels 1,3,5,7");
    pass(covers, "each level tiles the whole world, no remainder", "levels 1,3,5,7");
  }

  // ── Level selection ───────────────────────────────────────────────────────
  //
  // The claim in the module is that the pyramid stops where the satellites do.
  // If that number is wrong the deepest zoom is either fetching detail nobody
  // measured or refusing detail that exists.
  console.log("\nLevel selection");
  {
    const at = (worldPx) => levelFor({ scale: () => worldPx / (2 * Math.PI) });
    // A desktop world view, and the deepest the map can go (MAX_K = 40).
    pass(at(1440) === 2, "desktop world view picks a shallow level", `z=${at(1440)}`);
    pass(at(390) === 0, "a phone world view is one tile", `z=${at(390)}`);
    pass(at(1440 * 40) === MAX_LEVEL, "the map's deepest zoom reaches the last level");

    // The pyramid is sampled to the block it will be drawn as, not to the
    // dishes: a sample finer than the block it gets averaged into is one the
    // reader never sees. So what has to hold is that a tile's samples and the
    // blocks it lands on are about the same count.
    const blocksPerTile = 300 / 5; // TILE_PX / BLOCK_PX
    pass(
      SAMPLES >= blocksPerTile && SAMPLES <= blocksPerTile * 1.5,
      "a tile carries about one sample per block",
      `${SAMPLES} samples over ~${blocksPerTile} blocks`
    );
    const metresPerSample = EQUATOR / (2 ** MAX_LEVEL * SAMPLES);
    near(metresPerSample / 1000, 4.9, 0.2, "the last level is as fine as the block allows");

    // Never past the ends of the pyramid, however far the map is pushed.
    const bounded = [1, 1e3, 1e6, 1e9].every((px) => at(px) >= 0 && at(px) <= MAX_LEVEL);
    pass(bounded, "level stays inside the pyramid at any scale");

    // And monotonic: zooming in must never ask for a coarser level.
    let rising = true;
    for (let px = 200; px < 4e6; px *= 1.3) if (at(px) < at(px / 1.3)) rising = false;
    pass(rising, "zooming in never picks a coarser level");
  }

  // ── Coverage and order ────────────────────────────────────────────────────
  console.log("\nCoverage and order");
  {
    const frames = {
      centred: { minX: -6e6, maxX: 6e6, minY: -3.5e6, maxY: 3.5e6 },
      "off-centre": { minX: -1.1e6, maxX: 9.9e6, minY: -1e6, maxY: 5.6e6 },
      "against the edge": { minX: -EARTH_HALF, maxX: -EARTH_HALF + 9e6, minY: -2e6, maxY: 3.6e6 },
      "whole world": { minX: -EARTH_HALF, maxX: EARTH_HALF, minY: -EARTH_HALF, maxY: EARTH_HALF },
    };

    let covered = true;
    let inside = true;
    for (const [, frame] of Object.entries(frames)) {
      for (const z of [2, 4, 6]) {
        const tiles = tilesFor(frame, z);
        // Every tile returned must actually touch the screen: a tile that does
        // not is a request paid for and never drawn.
        for (const t of tiles) {
          const f = tileFrame(z, t.x, t.y);
          if (f.maxX <= frame.minX || f.minX >= frame.maxX) inside = false;
          if (f.maxY <= frame.minY || f.minY >= frame.maxY) inside = false;
        }
        // And between them they must leave no part of the screen unanswered.
        // Sampled rather than proved, on a grid fine enough to catch an error
        // of less than one tile.
        for (let i = 1; i < 12 && covered; i++) {
          for (let j = 1; j < 12 && covered; j++) {
            const px = frame.minX + ((frame.maxX - frame.minX) * i) / 12;
            const py = frame.minY + ((frame.maxY - frame.minY) * j) / 12;
            const hit = tiles.some((t) => {
              const f = tileFrame(z, t.x, t.y);
              return px >= f.minX && px <= f.maxX && py >= f.minY && py <= f.maxY;
            });
            if (!hit) covered = false;
          }
        }
      }
    }
    pass(inside, "every tile returned touches the screen");
    pass(covered, "the tiles leave no part of the screen unanswered");

    // Centre outward, measured from the frame's own centre rather than from the
    // middle of the block of tiles — the two differ most in the last case here,
    // which is the one that used to be ranked wrong.
    let ordering = true;
    for (const [, frame] of Object.entries(frames)) {
      const z = 4;
      const span = EQUATOR / 2 ** z;
      const cx = (frame.minX + frame.maxX) / 2 / span + 2 ** z / 2;
      const cy = 2 ** z / 2 - (frame.minY + frame.maxY) / 2 / span;
      const d = (t) => Math.hypot(t.x + 0.5 - cx, t.y + 0.5 - cy);
      const tiles = tilesFor(frame, z, true);
      for (let i = 1; i < tiles.length; i++) {
        if (d(tiles[i]) < d(tiles[i - 1]) - 1e-9) ordering = false;
      }
    }
    pass(ordering, "ordered tiles run centre outward", "4 framings");

    // The unordered call is the frame loop's, sixty times a second; it must
    // return the same set, only unsorted.
    const frame = frames["off-centre"];
    const a = tilesFor(frame, 4).map((t) => `${t.x},${t.y}`).sort();
    const b = tilesFor(frame, 4, true).map((t) => `${t.x},${t.y}`).sort();
    pass(String(a) === String(b), "ordering changes the order and nothing else");
  }

  // ── The ancestor patch ────────────────────────────────────────────────────
  //
  // This is the lazy load. Get it wrong and a missing tile is filled with the
  // wrong quadrant of its parent: a piece of weather from several hundred
  // kilometres away, drawn confidently in the gap.
  console.log("\nAncestor patches");
  {
    // A tile standing in for itself is the whole tile.
    const self = ancestorPatch(5, 11, 20, 5);
    pass(
      self.x === 11 && self.y === 20 && self.sx === 0 && self.sy === 0 && self.step === SAMPLES,
      "a tile is its own ancestor, whole"
    );

    // The four children of one parent must land in its four quadrants, and
    // between them cover it exactly once.
    const half = SAMPLES / 2;
    const quads = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([dx, dy]) => {
      const p = ancestorPatch(4, 6 + dx, 8 + dy, 3);
      return `${p.x},${p.y},${p.sx},${p.sy},${p.step}`;
    });
    const want = [
      `3,4,0,0,${half}`,
      `3,4,${half},0,${half}`,
      `3,4,0,${half},${half}`,
      `3,4,${half},${half},${half}`,
    ];
    pass(String(quads) === String(want), "four children tile their parent exactly");

    // Deeper up the pyramid the patch shrinks by half each level, stays inside
    // the ancestor, and keeps pointing at the same ground.
    let nested = true;
    const z = 7;
    const x = 101;
    const y = 77;
    for (let level = z; level >= 0; level--) {
      const p = ancestorPatch(z, x, y, level);
      const shift = z - level;
      if (p.step !== SAMPLES / 2 ** shift) nested = false;
      if (p.x !== Math.floor(x / 2 ** shift) || p.y !== Math.floor(y / 2 ** shift)) nested = false;
      if (p.sx < 0 || p.sy < 0 || p.sx + p.step > SAMPLES || p.sy + p.step > SAMPLES) nested = false;
      // The patch must sit over the same ground the tile itself covers.
      const tile = tileFrame(z, x, y);
      const anc = tileFrame(level, p.x, p.y);
      const left = anc.minX + ((anc.maxX - anc.minX) * p.sx) / SAMPLES;
      const top = anc.maxY - ((anc.maxY - anc.minY) * p.sy) / SAMPLES;
      if (Math.abs(left - tile.minX) > 1e-6 || Math.abs(top - tile.maxY) > 1e-6) nested = false;
    }
    pass(nested, "every ancestor patch covers the tile's own ground", `z=${z} up to 0`);
  }

  // ── Territory ─────────────────────────────────────────────────────────────
  //
  // The ring has to close. A gap means a strip of the planet no dish is asked
  // for, which draws as permanently clear sky — the one failure that looks
  // exactly like good weather.
  console.log("\nTerritory");
  {
    let gap = null;
    let over = null;
    for (let lon = -180; lon <= 180; lon += 0.25) {
      const total = DISCS.reduce((sum, disc) => sum + longitudeWeight(disc, lon), 0);
      if (total < 0.999 && gap === null) gap = lon;
      // Inside a seam two dishes share the ground and the weights are a mean,
      // so they may sum above one; three at once would mean a territory is far
      // wider than the gaps between the dishes.
      const claiming = DISCS.filter((disc) => longitudeWeight(disc, lon) > 0).length;
      if (claiming > 2 && over === null) over = lon;
    }
    pass(gap === null, "every longitude is claimed by some dish", gap === null ? "" : `gap at ${gap}°`);
    pass(over === null, "never more than two dishes over one longitude", over === null ? "" : `${over}°`);

    // Specifically the antimeridian, which is the join the ring is derived
    // around and the only one that depends on the wrap being handled.
    for (const lon of [-180, -179.9, 179.9, 180]) {
      const total = DISCS.reduce((sum, disc) => sum + longitudeWeight(disc, lon), 0);
      pass(total >= 0.999, `the dateline is covered at ${lon}°`, total.toFixed(3));
    }

    // Each dish should be at full weight directly beneath itself.
    const nadir = DISCS.every((disc) => longitudeWeight(disc, disc.lon) > 0.999);
    pass(nadir, "each dish is at full weight over its own nadir");

    // A closed ring is not enough on its own: the tile has to actually ask the
    // dishes that cover it. These are two different questions and they came
    // apart at the shallow levels, where a tile is wider than a territory —
    // asking only the tile's edges left every dish whose ground lay strictly
    // inside it unasked, and the band came back blank and was cached as an
    // answer. Blank sky over an ocean is invisible to inspection, so it is
    // checked here instead, at every level of the pyramid.
    const EARTH_HALF = Math.PI * 6378137;
    const lonOf = (x) => (x / EARTH_HALF) * 180;
    let unasked = null;
    for (let z = 0; z <= MAX_LEVEL && !unasked; z++) {
      for (let x = 0; x < 2 ** z; x++) {
        const frame = tileFrame(z, x, 0);
        const asked = new Set(discsFor(frame).map((d) => d.id));
        const west = lonOf(frame.minX);
        const east = lonOf(frame.maxX);
        for (const disc of DISCS) {
          if (asked.has(disc.id)) continue;
          for (let i = 0; i <= 200; i++) {
            if (longitudeWeight(disc, west + ((east - west) * i) / 200) > 0) {
              unasked = `${disc.id} at z${z} x${x} (${west.toFixed(0)}..${east.toFixed(0)}°)`;
              break;
            }
          }
          if (unasked) break;
        }
        if (unasked) break;
      }
    }
    pass(
      unasked === null,
      "every tile asks every dish that can see into it",
      unasked === null ? `levels 0-${MAX_LEVEL}` : unasked
    );
  }

  // ── Calibration ───────────────────────────────────────────────────────────
  //
  // The two services draw the same measurement with different stretches. If
  // they do not meet at the -30°C landmark, the same storm changes temperature
  // as it drifts across a seam, and the colder half of the scale is unreachable
  // on one side of it.
  //
  // The anchors themselves were measured against the sky rather than derived,
  // over the patches of ocean two dishes on different services can both see, so
  // what is checked here is not their values but that they are self-consistent:
  // that each stretch spans the scale, meets the other at the break, and never
  // draws a colder cloud dimmer than a warmer one.
  console.log("\nCalibration");
  {
    const stretches = Object.entries(STRETCH);
    pass(stretches.length === 2, "both services have a stretch", `${stretches.length} of them`);

    for (const [service, stretch] of stretches) {
      const name = service.includes("eumetsat") ? "EUMETSAT" : "RealEarth";
      near(scalarFor(stretch, stretch.warm), 0, 1e-9, `${name} starts at the warm end`);
      near(scalarFor(stretch, stretch.break), BREAK, 1e-9, `${name} puts -30°C on the break`);
      near(scalarFor(stretch, stretch.cold), 0.97, 1e-9, `${name} tops out at the cold end`);

      // Below its warm anchor is warmer still, and past its cold one there is
      // nothing colder to say; both must clamp rather than run off the scale.
      pass(scalarFor(stretch, 0) >= 0, `${name} clamps below its warm point`);
      pass(scalarFor(stretch, 255) <= 0.97 + 1e-9, `${name} clamps above its cold point`,
        scalarFor(stretch, 255).toFixed(3));

      // And it must rise with cold all the way, or a colder cloud draws dimmer
      // than a warmer one.
      let rising = true;
      for (let l = 1; l <= 255; l++) {
        if (scalarFor(stretch, l) < scalarFor(stretch, l - 1)) rising = false;
      }
      pass(rising, `${name}'s scale rises with cold throughout`);

      // The anchors have to be in order, or the two segments fold back on
      // themselves and the arithmetic above is meaningless.
      pass(
        stretch.warm < stretch.break && stretch.break < stretch.cold,
        `${name}'s anchors are in order`,
        `${stretch.warm} < ${stretch.break} < ${stretch.cold}`
      );
    }

    // The services must meet: a cloud at -30°C reads the same whichever one drew
    // it, or the same storm changes temperature crossing a seam.
    const [a, b] = stretches.map(([, s]) => scalarFor(s, s.break));
    pass(Math.abs(a - b) < 1e-9, "the two services agree at the break", Math.abs(a - b).toFixed(6));

    // The TOPS threshold the second pass keys off sits just past the break, so
    // both services have to be able to reach it. A stretch whose cold anchor
    // fell below it would never draw a storm at all.
    for (const [service, stretch] of stretches) {
      const name = service.includes("eumetsat") ? "EUMETSAT" : "RealEarth";
      pass(scalarFor(stretch, stretch.cold) > 0.8, `${name} can reach the storm tops`);
    }
  }

  // ── The request ───────────────────────────────────────────────────────────
  //
  // Two services, two shapes of request, and the same moment has to mean the
  // same thing in both. Neither can be checked by looking at the map: a tile
  // fetched for the wrong ground or the wrong ten minutes still draws clouds.
  console.log("\nThe request");
  {
    const at = Date.UTC(2026, 7, 16, 13, 20, 0);
    const tile = { z: 5, x: 9, y: 17 };
    const frame = tileFrame(tile.z, tile.x, tile.y);
    const byId = Object.fromEntries(DISCS.map((d) => [d.id, d]));

    const re = url(byId["goes-east"], frame, at);
    // RealEarth has no TIME dimension: every scan it holds is a layer of its
    // own inside a mapfile named for the product, so the moment is chosen by
    // asking for a different layer.
    pass(/[?&]map=G19-ABI-FD-BAND13\.map(&|$)/.test(re),
      "RealEarth is asked in the product's own mapfile");
    // The far end of the step, not its start: a scan stamped 13:20 is published
    // at 13:20:20, and a request for 13:20:00 resolves to the step before it.
    pass(/[?&]LAYERS=G19-ABI-FD-BAND13_20260816_132959(&|$)/.test(re),
      "RealEarth is asked at the end of the moment's step",
      re.match(/LAYERS=([^&]*)/)[1]);
    const reBox = decodeURIComponent(re.match(/BBOX=([^&]*)/)[1]).split(",").map(Number);
    pass(Math.abs(reBox[0] - frame.minX) < 1e-6 && Math.abs(reBox[3] - frame.maxY) < 1e-6,
      "RealEarth is asked for the tile's own box");
    // The whole point of the WMS port: mapserv honours WIDTH and HEIGHT, where
    // the tile API returned 256 square whatever it was asked for. Sixteen times
    // the pixels, against a service that meters anonymous use by pixel volume.
    pass(new RegExp(`[?&]WIDTH=${SAMPLES}(&|$)`).test(re) &&
      new RegExp(`[?&]HEIGHT=${SAMPLES}(&|$)`).test(re),
      "RealEarth is asked at the resolution we store", `${SAMPLES}x${SAMPLES}`);

    const wms = url(byId["msg-0deg"], frame, at);
    pass(wms.includes("TIME=2026-08-16T13%3A20%3A00Z"), "EUMETSAT is asked at the moment itself",
      decodeURIComponent(wms.match(/TIME=([^&]*)/)[1]));
    const bbox = decodeURIComponent(wms.match(/BBOX=([^&]*)/)[1]).split(",").map(Number);
    const boxed = Math.abs(bbox[0] - frame.minX) < 1e-6 && Math.abs(bbox[1] - frame.minY) < 1e-6 &&
      Math.abs(bbox[2] - frame.maxX) < 1e-6 && Math.abs(bbox[3] - frame.maxY) < 1e-6;
    pass(boxed, "EUMETSAT is asked for the tile's own box");

    // Every step of every hour has to format, and land inside its own step —
    // one second over and the moment names the next ten minutes.
    let stepped = true;
    for (let m = 0; m < 24 * 60; m += 10) {
      const t = Date.UTC(2026, 7, 16, 0, m, 0);
      const layer = url(byId["goes-east"], frame, t).match(/LAYERS=([^&]*)/)[1];
      const stamp = layer.replace("G19-ABI-FD-BAND13_", "");
      if (!/^\d{8}_\d{6}$/.test(stamp)) stepped = false;
      const back = Date.UTC(
        +stamp.slice(0, 4), +stamp.slice(4, 6) - 1, +stamp.slice(6, 8),
        +stamp.slice(9, 11), +stamp.slice(11, 13), +stamp.slice(13, 15)
      );
      if (back < t || back >= t + 10 * 60 * 1000) stepped = false;
    }
    pass(stepped, "every moment of the day stamps inside its own step", "144 steps");
  }

  // ── How far a stand-in may be stretched ───────────────────────────────────
  //
  // The lazy load covers a missing tile with an ancestor, and the last rungs of
  // that walk have no detail left in them: at 64 samples, six levels up is one
  // pixel spread across a whole tile and seven is a quarter of one. That draws
  // a flat rectangle with the tile's corners, which is a deck of overcast
  // nobody measured — and neighbouring tiles take neighbouring pixels of the
  // same ancestor row, so a run of them lies across the map as a bar. Seen on
  // 2026-08-19 over the Americas, three of them.
  console.log("\nkeeping a stand-in honest");
  {
    // The rungs the walk is allowed to use all carry a real patch.
    let sound = true;
    let degenerate = 0;
    for (let z = 0; z <= MAX_LEVEL; z++) {
      for (let up = z; up >= 0; up--) {
        const { step, sx, sy } = ancestorPatch(z, 100 % 2 ** z || 0, 50 % 2 ** z || 0, up);
        if (step < MIN_PATCH) {
          degenerate++;
          continue; // refused by drawTile, never drawn
        }
        // A patch that is drawn has to be whole pixels, or drawImage is
        // resampling across a boundary that is not there.
        if (!Number.isInteger(step) || !Number.isInteger(sx) || !Number.isInteger(sy)) sound = false;
        if (step * step < MIN_PATCH * MIN_PATCH) sound = false;
      }
    }
    pass(sound, "every patch the walk may draw is whole pixels", `min ${MIN_PATCH}x${MIN_PATCH}`);
    pass(degenerate > 0, "and the walk does reach rungs that are not", `${degenerate} refused`);

    // The specific shapes that were on the glass.
    pass(
      ancestorPatch(MAX_LEVEL, 100, 50, 1).step < MIN_PATCH,
      "one pixel stretched over a tile is refused",
      `level 1 of ${MAX_LEVEL}`
    );
    pass(
      ancestorPatch(MAX_LEVEL, 100, 50, 0).step < MIN_PATCH,
      "and so is a quarter of a pixel",
      `level 0 of ${MAX_LEVEL}`
    );
    // The deepest stand-in still allowed, which must remain useful.
    const deepest = ancestorPatch(MAX_LEVEL, 100, 50, MAX_LEVEL - 4);
    pass(deepest.step === MIN_PATCH, "four levels up is still allowed", `${deepest.step}px patch`);
  }

  // ── The sheet with no sky in it ───────────────────────────────────────────
  //
  // A tile of one value paints a flat rectangle with the tile's own corners,
  // which is the shape no weather has, and it is bright enough to pass for a
  // deck of overcast. What is checked here is mostly the other direction: this
  // test throws a dish's whole contribution away, so it has to be sure. The
  // floor is deliberately not asserted against — it has moved three times, and
  // a check that has to be edited every time it moves is a check that will be
  // edited without being thought about.
  console.log("\ntelling a flat sheet from a sky");
  {
    const sheet = (fill) => {
      const d = new Uint8ClampedArray(SAMPLES * SAMPLES * 4);
      for (let p = 0; p < SAMPLES * SAMPLES; p++) {
        const v = fill(p);
        if (v === null) continue; // left transparent: outside this disc
        d[p * 4] = v;
        d[p * 4 + 3] = 255;
      }
      return d;
    };
    const QUARTER = (SAMPLES * SAMPLES) / 4;

    for (const [service, stretch] of Object.entries(STRETCH)) {
      const host = service.replace(/^https?:\/\//, "").split("/")[0];
      // A live tile is a spread, and anything with a spread is weather.
      pass(
        !flat(sheet((p) => stretch.warm + 20 + (p % 97)), stretch),
        "a varied sheet is kept",
        host
      );
      // The one that has to be caught: every byte the same, and bright enough
      // to be painted.
      pass(flat(sheet(() => stretch.break + 1), stretch), `a uniform sheet is refused`, host);
      // The near miss, which is the whole reason this is exact equality: one
      // byte out of 4,096 differs and it is overcast, not an artifact.
      pass(
        !flat(sheet((p) => (p === 0 ? stretch.break + 2 : stretch.break + 1)), stretch),
        "one differing byte makes it a sky again",
        host
      );
      // Dead black off the limb draws nothing at any floor, so there is nothing
      // to suppress and no reason to spend a refetch on it.
      pass(!flat(sheet(() => 0), stretch), "a black sheet is left alone", host);
      // A dish reaching a tile with a sliver of horizon can be uniform
      // honestly. Too little of the sheet to judge.
      pass(
        !flat(sheet((p) => (p < QUARTER - 1 ? stretch.break + 1 : null)), stretch),
        "a sliver is not judged",
        `${QUARTER - 1} px`
      );
      pass(
        flat(sheet((p) => (p < QUARTER ? stretch.break + 1 : null)), stretch),
        "a quarter of a sheet is enough to judge",
        `${QUARTER} px`
      );
      // Nothing of this disc reaches the tile at all.
      pass(!flat(sheet(() => null), stretch), "an empty sheet is left alone", host);
    }
  }

  // ── Against the service ───────────────────────────────────────────────────
  //
  // The two things the WMS port rests on, neither of which can be seen by
  // looking at the map. RealEarth's tile API returned 256 square whatever it
  // was asked for, and the whole reason for moving was that `mapserv` does not:
  // if it ever starts ignoring WIDTH again, the layer keeps drawing perfectly
  // while quietly spending sixteen times the pixel volume it is metered on.
  //
  // And the moment. RealEarth has no TIME dimension — a scan is addressed by
  // asking for a layer named after it — and a layer name it does not recognise
  // is answered with the current scan, 200 OK and no complaint. So a change to
  // their naming would not fail: it would pin every rewound frame to now, on a
  // map where one wash of cloud looks much like another.
  console.log("\nAgainst the service");
  {
    const at = Math.floor((Date.now() - LAG_MS) / STEP_MS) * STEP_MS;
    const goes = DISCS.find((d) => d.id === "goes-east");
    // A tile over the Atlantic, well inside GOES-East's own territory.
    const frame = tileFrame(2, 1, 1);
    const get = async (when) => {
      const res = await fetch(url(goes, frame, when));
      if (!res.ok) return { status: res.status };
      const body = Buffer.from(await res.arrayBuffer());
      if (body.slice(1, 4).toString() !== "PNG") return { status: "not an image" };
      return {
        status: 200,
        width: body.readUInt32BE(16),
        height: body.readUInt32BE(20),
        bytes: body.length,
        hash: require("crypto").createHash("md5").update(body).digest("hex"),
      };
    };

    const now = await get(at);
    pass(now.status === 200, "the service answers", `HTTP ${now.status}`);
    if (now.status === 200) {
      // The whole point of the port.
      pass(
        now.width === SAMPLES && now.height === SAMPLES,
        "and honours the size we ask for",
        `${now.width}x${now.height}, ${(now.bytes / 1024).toFixed(1)} KB`
      );
      // A step back is a different scan. If these match, the stamp is not being
      // recognised and both are the current frame.
      const before = await get(at - STEP_MS);
      pass(
        before.status === 200 && before.hash !== now.hash,
        "and a step back is a different scan",
        before.status === 200 ? "" : `HTTP ${before.status}`
      );
      // The far-end stamp and the scan's own stamp are the same picture: this
      // is the newest-at-or-before resolution the moment naming relies on.
      const early = await get(at - STEP_MS + 1000);
      pass(
        early.status === 200 && early.hash === before.hash,
        "and a moment mid-step resolves to the scan before it"
      );
    }
  }

  console.log(`\n${ok ? "✓ cloud field checks passed" : "✗ cloud field checks FAILED"}\n`);
  process.exit(ok ? 0 : 1);
});
