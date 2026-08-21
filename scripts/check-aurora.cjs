// Checks the auroral oval: the layout of somebody else's file, the summary the
// map draws from it, and the service itself.
//
// Nothing here can be checked by looking. The payload is 65,160 numbers in an
// order the service never promised to keep, and a layout that quietly changed
// would not throw — it would draw a plausible oval in the wrong place, which is
// the failure this instrument is least able to notice. The summary has the same
// property: a block walk that drops the poleward half of every row, or averages
// the band away as it zooms out, produces a perfectly believable curtain.
//
//   node scripts/check-aurora.cjs

const { pathToFileURL } = require("url");
const path = require("path");

let ok = true;
const check = (pass, what, detail = "") => {
  console.log(`  ${pass ? "✓" : "✗"}  ${what.padEnd(52)} ${detail}`);
  ok &= pass;
  return pass;
};

const load = (file) => import(pathToFileURL(path.join(__dirname, "..", "src", "lib", file)).href);

load("aurora.js").then(async (aurora) => {
  const { decode, litCells, indexOf, probabilityAt, FLOOR, CELLS, LON_COLS, LAT_ROWS } = aurora;

  // ── The grid's own arithmetic ─────────────────────────────────────────────
  console.log("the packed grid");
  check(CELLS === LON_COLS * LAT_ROWS, "one value per whole degree", `${LON_COLS}x${LAT_ROWS}`);
  check(indexOf(0, -90) === 0, "the first cell is 0°, 90°S");
  check(indexOf(0, 90) === LAT_ROWS - 1, "a column is one meridian, south to north");
  check(indexOf(1, -90) === LAT_ROWS, "and the next column follows it");
  check(indexOf(359, 90) === CELLS - 1, "the last cell is 359°, 90°N");

  // ── The summary ───────────────────────────────────────────────────────────
  //
  // Built on a synthetic oval rather than on live data, so the answers are known
  // in advance and the check does not change with the sun.
  const grid = new Uint8Array(CELLS);
  const OVAL = 67; // where the band is put, north and south
  const WIDTH = 4; // how far either side of it reaches
  for (let lon = 0; lon < LON_COLS; lon++) {
    for (let lat = -90; lat <= 90; lat++) {
      const off = Math.min(Math.abs(Math.abs(lat) - OVAL), 90);
      if (off <= WIDTH) grid[indexOf(lon, lat)] = Math.round(90 - off * 15);
    }
  }

  console.log("\nreading a value back");
  check(probabilityAt(grid, 0, OVAL) === 90, "the middle of the band is the peak");
  check(probabilityAt(grid, 0, 0) === 0, "the equator is empty");
  check(probabilityAt(grid, -1, OVAL) === probabilityAt(grid, 359, OVAL), "west of zero wraps east");
  check(probabilityAt(grid, 0, 200) === 0, "off the grid is nothing, not a throw");

  console.log("\nthe block walk");
  const full = litCells(grid, 1);
  const lats = full.map((c) => Math.abs(c[1]));
  check(full.length > 0, "the oval is found at all", `${full.length} blocks`);
  check(
    Math.min(...lats) >= OVAL - WIDTH && Math.max(...lats) <= OVAL + WIDTH,
    "and only where it was put",
    `|lat| ${Math.min(...lats)}..${Math.max(...lats)}`
  );
  check(
    full.every(([, , v]) => v >= FLOOR),
    "nothing under the floor is reported"
  );

  // The cosine correction: a fixed longitude step would report the same number
  // of blocks at 67° as at the equator, which is three times more than the
  // ground there can hold. This is the check that the step opens with latitude.
  const perRow = new Map();
  for (const [, lat] of full) perRow.set(lat, (perRow.get(lat) ?? 0) + 1);
  check(
    [...perRow.values()].every((n) => n < LON_COLS),
    "longitude opens out with the cosine",
    `${Math.max(...perRow.values())} blocks in the fullest row, of ${LON_COLS} degrees`
  );

  // Coarsening must lose blocks and must not lose the band. The peak surviving
  // is the whole point of summarising by the strongest rather than the mean: an
  // averaged block that is half band and half nothing halves the band, so the
  // oval would fade exactly as it was zoomed out.
  console.log("\ncoarsening");
  let last = Infinity;
  for (const step of [1, 2, 3, 4, 6, 8]) {
    const cells = litCells(grid, step);
    const peak = Math.max(...cells.map((c) => c[2]));
    const held = cells.length > 0 && peak === 90 && cells.length <= last;
    check(held, `step ${step} keeps the peak and costs blocks`, `${cells.length} blocks, peak ${peak}`);
    last = cells.length;
  }
  check(litCells(grid, 8).length < litCells(grid, 1).length / 4, "and coarsening actually pays");

  // A block stands for ground, and the span it reports is how the map sizes the
  // mark it draws. A span that did not match the walk would draw a curtain with
  // holes in it, or one that overlapped itself into a solid cap.
  check(
    litCells(grid, 3).every(([, , , lonSpan, latSpan]) => lonSpan >= 1 && latSpan >= 1 && latSpan <= 3),
    "every block reports the ground it stands for"
  );

  console.log("\nan empty sky");
  check(litCells(new Uint8Array(CELLS), 1).length === 0, "a quiet sun draws nothing");
  check(litCells(null, 1).length === 0, "and no data at all is not a throw");

  // ── A malformed frame ─────────────────────────────────────────────────────
  //
  // The one failure worth being loud about. Refused whole rather than
  // half-decoded, because half an oval is still a plausible oval.
  console.log("\na file that is not what it says");
  const shuffled = {
    "Observation Time": "2026-08-21T21:06:00Z",
    "Forecast Time": "2026-08-21T22:01:00Z",
    coordinates: Array.from({ length: CELLS }, (_, i) => [i % LON_COLS, (i % LAT_ROWS) - 90, 0]),
  };
  let threw = false;
  try {
    decode(shuffled);
  } catch {
    threw = true;
  }
  check(threw, "a reordered payload is refused");

  threw = false;
  try {
    decode({ coordinates: [[0, -90, 1]] });
  } catch {
    threw = true;
  }
  check(threw, "a short payload is refused");

  // ── Against the service ───────────────────────────────────────────────────
  console.log("\nagainst the service");
  try {
    const response = await fetch(
      "https://services.swpc.noaa.gov/json/ovation_aurora_latest.json",
      { signal: AbortSignal.timeout(45000) }
    );
    check(response.ok, "the service answers", `HTTP ${response.status}`);
    check(
      response.headers.get("access-control-allow-origin") === "*",
      "and says a browser may read it"
    );

    const live = decode(await response.json());
    check(Number.isFinite(live.observedAt), "the frame is stamped", new Date(live.observedAt).toISOString());
    check(
      live.forecastAt >= live.observedAt,
      "and looks forward, not back",
      `${Math.round((live.forecastAt - live.observedAt) / 60000)} min ahead`
    );

    const age = (Date.now() - live.observedAt) / 60000;
    check(age < 60, "the observation is recent", `${age.toFixed(0)} min old`);

    const liveCells = litCells(live.grid, 1);
    // The floor exists to keep the model's noise off the map, and the way to
    // tell it is doing that is where the lowest lit cell sits. Aurora is a
    // high-latitude phenomenon even in a storm; anything reported near the
    // equator is the model talking to itself.
    if (liveCells.length) {
      const lowest = Math.min(...liveCells.map((c) => Math.abs(c[1])));
      check(lowest >= 30, "nothing lit is anywhere near the equator", `lowest |lat| ${lowest}`);
    } else {
      console.log("  ·  the sun is quiet enough that nothing clears the floor");
    }
    console.log(`  ·  ${liveCells.length} blocks lit right now, of ${CELLS} cells`);
  } catch (error) {
    check(false, "the service could be read", String(error.message ?? error));
  }

  console.log(ok ? "\naurora: ok" : "\naurora: FAILED");
  process.exit(ok ? 0 : 1);
});
