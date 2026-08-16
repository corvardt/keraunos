// Checks the cloud field's grid, its territories and its two calibrations.
//
// None of this is visible. A wash drawn behind a map looks equally plausible
// whether the tiles are aligned or half a tile out, whether the ring covers the
// whole planet or leaves a strip at the antimeridian uncovered, and whether the
// two agencies' pictures agree about what -30°C looks like or disagree by a
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

import(pathToFileURL(path.join(__dirname, "../src/lib/ir.js")).href).then((ir) => {
  const {
    DISCS,
    SAMPLES,
    MAX_LEVEL,
    BREAK,
    levelFor,
    tileFrame,
    tilesFor,
    ancestorPatch,
    longitudeWeight,
    greyScalar,
    enhancedScalar,
  } = ir;

  // ── The grid ──────────────────────────────────────────────────────────────
  //
  // A tile's box is what goes into the WMS request, so an error here is imagery
  // fetched for one piece of ground and drawn over another. It would still look
  // like clouds.
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

    const metresPerSample = EQUATOR / (2 ** MAX_LEVEL * SAMPLES);
    near(metresPerSample / 1000, 2.45, 0.1, "last level matches the satellites' ~2.4km");

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
  }

  // ── Calibration ───────────────────────────────────────────────────────────
  //
  // The two agencies draw the same measurement with different stretches. If
  // they do not meet at the -30°C landmark, the same storm changes temperature
  // as it drifts across a seam, and the colder half of the scale is unreachable
  // on the EUMETSAT side.
  console.log("\nCalibration");
  {
    near(greyScalar(0), 0, 1e-9, "EUMETSAT black is the warm end of the scale");
    near(greyScalar(255), 0.97, 1e-9, "EUMETSAT white is very nearly the cold end");
    near(greyScalar(0.58 * 255), BREAK, 1e-3, "EUMETSAT mid-grey lands on the -30°C break");

    // NASA's own greyscale runs out exactly at the break, which is where its
    // colour enhancement takes over.
    near(enhancedScalar(255, 255, 255), BREAK, 1e-9, "NASA white ends on the break");
    pass(enhancedScalar(200, 200, 200) < BREAK, "NASA grey stays below the break");

    // The enhancement is read by hue, and it begins at hue 200 — a blue-cyan,
    // not pure cyan — running backwards through green and yellow to red at the
    // coldest tops.
    near(enhancedScalar(0, 170, 255), BREAK, 1e-3, "the colour ramp begins on the break");
    pass(
      enhancedScalar(0, 255, 255) > BREAK,
      "pure cyan is already past the break, on the cold side",
      enhancedScalar(0, 255, 255).toFixed(3)
    );
    pass(enhancedScalar(255, 0, 0) > 0.99, "NASA red is the coldest top", enhancedScalar(255, 0, 0).toFixed(3));
    // Magenta is past red, which is colder still; read as a hue it would come
    // back near the warm end and draw the deepest cores as ordinary cloud.
    pass(
      enhancedScalar(255, 0, 255) > 0.99,
      "NASA magenta folds back as colder, not warmer",
      enhancedScalar(255, 0, 255).toFixed(3)
    );

    // The two agencies must meet: a cloud at the break reads the same whichever
    // one drew it, or the same storm changes temperature crossing a seam.
    const seam = Math.abs(greyScalar(0.58 * 255) - enhancedScalar(0, 170, 255));
    pass(seam < 0.01, "the two agencies agree at the break", seam.toFixed(4));

    // The enhanced scale must rise with cold all the way round the ramp, from
    // its start at hue 200 through red and into the magenta fold.
    let ramp = true;
    let last = -1;
    for (let hue = 200; hue >= 0; hue -= 2) {
      const h = hue / 60;
      const sector = Math.floor(h) % 6;
      const f = h - Math.floor(h);
      const [r, g, b] = [
        [1, f, 0],
        [1 - f, 1, 0],
        [0, 1, f],
        [0, 1 - f, 1],
        [f, 0, 1],
        [1, 0, 1 - f],
      ][sector].map((v) => Math.round(v * 255));
      const v = enhancedScalar(r, g, b);
      if (v < last - 1e-9) ramp = false;
      last = v;
    }
    pass(ramp, "the colour ramp rises with cold from its start to red");

    // Both scales must rise with cold, all the way, or a colder cloud can draw
    // dimmer than a warmer one.
    let rising = true;
    for (let l = 1; l <= 255; l++) if (greyScalar(l) < greyScalar(l - 1)) rising = false;
    pass(rising, "EUMETSAT's scale rises with cold throughout");
  }

  console.log(`\n${ok ? "✓ cloud field checks passed" : "✗ cloud field checks FAILED"}\n`);
  process.exit(ok ? 0 : 1);
});
