// Bakes the land/sea answer into a bitmask, so the dot matrix stops asking
// polygons where the coastline is.
//
//   node scripts/build-land.cjs           # measure, write nothing
//   node scripts/build-land.cjs --apply   # rewrite src/lib/land.js
//
// The matrix is rebuilt every time the map settles, and building it means
// asking `findFeature` — a bucketed bounding-box test in front of a real
// point-in-polygon — once per candidate dot. At world zoom that is 21,333
// questions on a desktop tube and 60,637 on a phone, where the gap is tightened
// to 2.9px and the world is a quarter as wide. Measured on this machine, in
// Node, that is 33ms and 59ms of blocking main thread, inside a `useMemo` that
// runs during render. A phone is three to four times slower again.
//
// Every one of those questions has the same answer every time it is asked. The
// coastline does not move, so the whole of that work is a lookup table that was
// never written down. This writes it down.
//
// At a quarter degree the table is 1440x720 bits, 129,600 bytes packed, and
// what it costs to ship is the only reason the resolution is not finer. It
// gzips to about 11 KB as bytes; carried as base64 in a JS module — which is
// what keeps it a synchronous import, with no fetch to wait for before the
// first matrix can be built — it is a little more. See the report at the end.
//
// It does not replace the polygons. A quarter degree is 28 km, and past roughly
// k=10 the matrix is sampled finer than that, at which point the mask would
// quantise the coastline into blocks. `buildMatrix` hands back to the polygon
// test there, which is exactly where the polygon test is already cheap: the
// grid is built for the visible extent only, so a city view asks 144 questions
// and takes 0.2ms. The expensive end is the one with the table.

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const booleanPointInPolygon = require("@turf/boolean-point-in-polygon").default;

// A quarter degree: 28 km at the equator, comfortably finer than the 152 km the
// matrix is sampled at when the whole world is on the tube, which is the view
// this exists for.
const RES = 0.25;
const COLS = Math.round(360 / RES);
const ROWS = Math.round(180 / RES);

// A cell is land if its centre is.
//
// The obvious worry is islands smaller than a cell, and the obvious fix is to
// sample the corners too and take any hit. Measured, that fix is all cost: it
// finds 5,775 more land cells — a coastline dilated by up to half a cell, and
// a matrix 1.8% larger everywhere — while turning up exactly one isolated
// island the centre missed. The reason is that there are no such islands to
// find. `world.json` carries 177 countries at a coarseness where Malta, the
// Maldives, Barbados and Cape Verde are not present at all, so nothing is being
// preserved by looking harder, and the coastline is what pays for it.
const SAMPLES = [[0.5, 0.5]];

const OUT = path.join(__dirname, "../src/lib/land.js");
const WORLD = path.join(__dirname, "../src/lib/world.json");

// ── The same index the map builds ──────────────────────────────────────────
// Duplicated from lib/geo.js rather than imported: that file is an ES module in
// a tree of CommonJS scripts, and the twenty lines it would take to share are
// twenty lines of build tooling around a bucketing rule that has not changed
// since it was written. If it does change, this only gets slower, never wrong —
// the bboxes still guard the polygon test below.
const BUCKET_DEG = 10;
const BCOLS = 360 / BUCKET_DEG;
const BROWS = 180 / BUCKET_DEG;
const bcol = (lon) => Math.min(BCOLS - 1, Math.max(0, Math.floor((lon + 180) / BUCKET_DEG)));
const brow = (lat) => Math.min(BROWS - 1, Math.max(0, Math.floor((lat + 90) / BUCKET_DEG)));

function extend(box, coords) {
  if (typeof coords[0] === "number") {
    const [lon, lat] = coords;
    if (lon < box[0]) box[0] = lon;
    if (lat < box[1]) box[1] = lat;
    if (lon > box[2]) box[2] = lon;
    if (lat > box[3]) box[3] = lat;
    return box;
  }
  for (const part of coords) extend(box, part);
  return box;
}

function indexFeatures(features) {
  const buckets = new Array(BCOLS * BROWS);
  for (const feature of features) {
    const bbox = extend([Infinity, Infinity, -Infinity, -Infinity], feature.geometry.coordinates);
    const entry = { feature, bbox };
    const [west, south, east, north] = bbox;
    for (let y = brow(south); y <= brow(north); y++) {
      for (let x = bcol(west); x <= bcol(east); x++) {
        const at = y * BCOLS + x;
        if (buckets[at]) buckets[at].push(entry);
        else buckets[at] = [entry];
      }
    }
  }
  return buckets;
}

function isLand(index, lon, lat) {
  const candidates = index[brow(lat) * BCOLS + bcol(lon)];
  if (!candidates) return false;
  const point = { type: "Point", coordinates: [lon, lat] };
  for (const { feature, bbox } of candidates) {
    if (lon < bbox[0] || lon > bbox[2] || lat < bbox[1] || lat > bbox[3]) continue;
    if (booleanPointInPolygon(point, feature)) return true;
  }
  return false;
}

// ── Build ──────────────────────────────────────────────────────────────────

const world = JSON.parse(fs.readFileSync(WORLD, "utf8"));
const index = indexFeatures(world.features);

const started = Date.now();
const bits = new Uint8Array(Math.ceil((COLS * ROWS) / 8));
let set = 0;
for (let y = 0; y < ROWS; y++) {
  const top = 90 - y * RES;
  for (let x = 0; x < COLS; x++) {
    const left = -180 + x * RES;
    for (const [dx, dy] of SAMPLES) {
      if (!isLand(index, left + dx * RES, top - dy * RES)) continue;
      const at = y * COLS + x;
      bits[at >> 3] |= 1 << (at & 7);
      set++;
      break;
    }
  }
}
const buildMs = Date.now() - started;

// ── What it is worth ───────────────────────────────────────────────────────
// The table is only defensible if it gives the same picture. Both paths are run
// over the views the map actually sits at, and the dot counts compared: a
// coastline that has moved shows up here as a matrix that has changed size.
const EARTH_RADIUS_KM = 6371;
const RAD = Math.PI / 180;

function viaMask(lon, lat) {
  const x = Math.min(COLS - 1, Math.max(0, Math.floor((lon + 180) / RES)));
  const y = Math.min(ROWS - 1, Math.max(0, Math.floor((90 - lat) / RES)));
  const at = y * COLS + x;
  return ((bits[at >> 3] >> (at & 7)) & 1) === 1;
}

function walk([west, south, east, north], stepKm, test) {
  const kmToDeg = (stepKm / (2 * Math.PI * EARTH_RADIUS_KM)) * 360;
  let dots = 0;
  let asked = 0;
  const at = Date.now();
  for (let lat = south; lat <= north; lat += kmToDeg) {
    const cosLat = Math.abs(Math.cos(lat * RAD));
    const step = cosLat > 1e-6 ? kmToDeg / cosLat : 360;
    for (let lon = west; lon <= east; lon += step) {
      asked++;
      if (test(lon, lat)) dots++;
    }
  }
  return { dots, asked, ms: Date.now() - at };
}

const VIEWS = [
  { name: "k=1 world, desktop gap", box: [-180, -74, 180, 74], km: 152 },
  { name: "k=1 world, phone gap   ", box: [-180, -74, 180, 74], km: 90 },
  { name: "k=3 atlantic           ", box: [-90, -10, 20, 60], km: 67 },
  { name: "k=6 europe             ", box: [0, 44, 20, 56], km: 38 },
];

console.log(`land mask ${COLS}x${ROWS} @ ${RES}deg, built in ${(buildMs / 1000).toFixed(1)}s`);
console.log(`  ${set} of ${COLS * ROWS} cells land (${((100 * set) / (COLS * ROWS)).toFixed(1)}%)`);
console.log("");

// ── Encoding ───────────────────────────────────────────────────────────────
// Run-length, then varint, then base64.
//
// The bitmap is 129,600 bytes and gzips to 10.8 KB, but it cannot ship as
// bytes: carried as base64 in a JS module — which is what keeps it a
// synchronous import, with no fetch between the map opening and the first
// matrix it can build — base64 costs a third of that saving back, and the
// module is a 173 KB source file the parser has to walk.
//
// A coastline is enormous runs of sea and enormous runs of land: 1,036,800
// cells are 8,105 runs. Encoded as run lengths the whole world is 10 KB before
// compression, which is smaller than the *compressed* bitmap, and the module
// that carries it is 14 KB rather than 173 KB.
const runs = [];
{
  let current = (bits[0] >> 0) & 1;
  let n = 0;
  for (let at = 0; at < COLS * ROWS; at++) {
    const bit = (bits[at >> 3] >> (at & 7)) & 1;
    if (bit === current) {
      n++;
      continue;
    }
    runs.push(n);
    current = bit;
    n = 1;
  }
  runs.push(n);
}
// The first run says how many cells share the value of cell zero, and nothing
// in the stream says what that value is. Written down rather than assumed: it
// happens to be sea today, and "happens to be" is not a decoder.
const bytes = [(bits[0] >> 0) & 1];
for (const run of runs) {
  let value = run;
  while (value > 127) {
    bytes.push((value & 127) | 128);
    value >>>= 7;
  }
  bytes.push(value);
}
const encoded = Buffer.from(bytes);
const base64 = encoded.toString("base64");

const gzBits = zlib.gzipSync(bits).length;
const gzShipped = zlib.gzipSync(Buffer.from(base64)).length;
console.log(`  bitmap      ${bits.length} B raw, ${(gzBits / 1024).toFixed(1)} KB gzipped`);
console.log(`  ${runs.length} runs -> ${encoded.length} B raw`);
console.log(`  gzipped     ${(gzShipped / 1024).toFixed(1)} KB as base64 in a module  <- what ships`);
console.log("");

let worst = 0;
for (const view of VIEWS) {
  const poly = walk(view.box, view.km, (lon, lat) => !!isLand(index, lon, lat));
  const mask = walk(view.box, view.km, viaMask);
  const drift = poly.dots ? Math.abs(mask.dots - poly.dots) / poly.dots : 0;
  worst = Math.max(worst, drift);
  const speed = mask.ms > 0 ? `${(poly.ms / mask.ms).toFixed(0)}x` : ">50x";
  console.log(
    `  ${view.name}  polygons ${String(poly.ms).padStart(3)}ms -> mask ${String(mask.ms).padStart(3)}ms  ${speed.padStart(5)}   ` +
      `${poly.dots} -> ${mask.dots} dots (${(drift * 100).toFixed(2)}%)`
  );
}
console.log("");
console.log(`  worst drift in the matrix: ${(worst * 100).toFixed(2)}%`);

if (!process.argv.includes("--apply")) {
  console.log("\nnothing written; pass --apply to rewrite src/lib/land.js");
  process.exit(0);
}

const module_ = `// Generated by scripts/build-land.cjs — do not edit.
//
// Which quarter-degree cells of the world are land, one bit each, row-major
// from the north-west corner. See the script for why this exists and where the
// map stops trusting it.

export const LAND_RES = ${RES};
export const LAND_COLS = ${COLS};
export const LAND_ROWS = ${ROWS};

// Alternating run lengths, varint, base64. The leading byte is the value of the
// first run; every run after it is the other value. See the script for why the
// table is not simply the bitmap.
const RUNS =
  "${base64}";

// Unpacked once, on the first question rather than at import: the module is
// pulled in by the map, and a tube that never leaves the boot screen should not
// pay for a table it has not asked anything of.
let bits = null;

function unpack() {
  const raw = atob(RUNS);
  bits = new Uint8Array((LAND_COLS * LAND_ROWS) / 8);
  let read = 0;
  let value = raw.charCodeAt(read++) & 1;
  let at = 0;
  while (read < raw.length) {
    let run = 0;
    let shift = 0;
    let byte;
    do {
      byte = raw.charCodeAt(read++);
      run |= (byte & 127) << shift;
      shift += 7;
    } while (byte & 128);
    if (value) {
      for (let i = 0; i < run; i++) {
        const cell = at + i;
        bits[cell >> 3] |= 1 << (cell & 7);
      }
    }
    at += run;
    value ^= 1;
  }
  return bits;
}

/**
 * Whether the cell containing this point is land.
 *
 * Coarse by construction — the cell is 28 km across at the equator — so this is
 * only the right answer to ask when the matrix is sampled more coarsely than
 * that. \`buildMatrix\` owns that decision; see \`MASK_MIN_DEG\` there.
 */
export function landAt(lon, lat) {
  const table = bits ?? unpack();
  const x = Math.min(LAND_COLS - 1, Math.max(0, Math.floor((lon + 180) / LAND_RES)));
  const y = Math.min(LAND_ROWS - 1, Math.max(0, Math.floor((90 - lat) / LAND_RES)));
  const at = y * LAND_COLS + x;
  return ((table[at >> 3] >> (at & 7)) & 1) === 1;
}
`;

fs.writeFileSync(OUT, module_);
console.log(`\nwrote ${path.relative(process.cwd(), OUT)} (${(module_.length / 1024).toFixed(0)} KB)`);
