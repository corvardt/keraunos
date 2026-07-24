// Trims the boundary data to the precision the display can resolve.
//
//   node scripts/shrink-geo.cjs           # measure, write nothing
//   node scripts/shrink-geo.cjs --apply   # rewrite in place
//
// The obvious suspicion is that the coastline has too many vertices. It does
// not: world.json carries 10,354 of them across 177 countries, and dropping
// any meaningful number starts putting coastal capitals — Helsinki, Tallinn,
// Algiers, Beirut — into the sea. What it carries instead is precision.
// Coordinates are stored to six decimal places, which is 0.1 m, on a map whose
// finest sampling is the 11 km dot matrix at maximum zoom and whose finest
// question is which country a strike fell in.
//
// So this rounds rather than simplifies. At three decimals — 111 m, still a
// hundred times finer than the matrix — nothing measurably changes: zero of
// 60,000 sampled points are renamed and no capital moves. Two decimals would
// save more and does start renaming points, so it is not what runs.
//
// Rewriting is one-way. The originals are in git history.

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const booleanPointInPolygon = require("@turf/boolean-point-in-polygon").default;

const PRECISION_DP = 3; // 111 m
const SAMPLES = 60000;

const FILES = ["world.json", "us.json", "water.geo.json"].map((name) => ({
  name,
  file: path.join(__dirname, "../src/lib", name),
}));

// ── Rounding ───────────────────────────────────────────────────────────────
// Rounding pulls neighbouring vertices onto the same point, so consecutive
// duplicates are dropped — they are pure cost, and a ring of them can confuse
// a point-in-polygon test. The closing point is restored afterwards, because a
// ring that no longer meets itself is not a ring.
function roundRing(ring, factor) {
  const out = [];
  let lastLon = null;
  let lastLat = null;
  for (const [lon, lat] of ring) {
    const x = Math.round(lon * factor) / factor;
    const y = Math.round(lat * factor) / factor;
    if (x === lastLon && y === lastLat) continue;
    lastLon = x;
    lastLat = y;
    out.push([x, y]);
  }
  if (out.length > 1) {
    const [fx, fy] = out[0];
    const [lx, ly] = out[out.length - 1];
    if (fx !== lx || fy !== ly) out.push([fx, fy]);
  }
  // A ring too small to survive rounding keeps every vertex, rounded in place:
  // a sliver island is still an island.
  if (out.length < 4) {
    return ring.map(([lon, lat]) => [Math.round(lon * factor) / factor, Math.round(lat * factor) / factor]);
  }
  return out;
}

const walk = (coords, factor) =>
  typeof coords[0][0] === "number" ? roundRing(coords, factor) : coords.map((part) => walk(part, factor));

const round = (doc, dp) => ({
  ...doc,
  features: doc.features.map((feature) => ({
    ...feature,
    geometry: { ...feature.geometry, coordinates: walk(feature.geometry.coordinates, 10 ** dp) },
  })),
});

// ── Did any answer change? ─────────────────────────────────────────────────
// Indexed by bounding box exactly as src/lib/geo.js does, so this measures the
// lookup the app actually performs rather than a stand-in for it.
function extend(box, coords) {
  if (typeof coords[0] === "number") {
    if (coords[0] < box[0]) box[0] = coords[0];
    if (coords[1] < box[1]) box[1] = coords[1];
    if (coords[0] > box[2]) box[2] = coords[0];
    if (coords[1] > box[3]) box[3] = coords[1];
    return box;
  }
  for (const part of coords) extend(box, part);
  return box;
}

const index = (doc) =>
  doc.features.map((feature) => ({
    feature,
    bbox: extend([Infinity, Infinity, -Infinity, -Infinity], feature.geometry.coordinates),
  }));

const locate = (indexed, lon, lat) => {
  const point = { type: "Point", coordinates: [lon, lat] };
  for (const { feature, bbox } of indexed) {
    if (lon < bbox[0] || lon > bbox[2] || lat < bbox[1] || lat > bbox[3]) continue;
    if (booleanPointInPolygon(point, feature)) return feature.properties.name;
  }
  return null;
};

// Deterministic, so a rerun compares like with like.
let seed = 20260724;
const random = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const sample = Array.from({ length: SAMPLES }, () => [-180 + random() * 360, -74 + random() * 148]);

const capitals = [
  ...fs
    .readFileSync(path.join(__dirname, "../src/lib/capitals.js"), "utf8")
    .matchAll(/\["(.+?)", "(.+?)", (-?[\d.]+), (-?[\d.]+), (\d)\]/g),
].map((m) => ({ name: m[1], lon: +m[3], lat: +m[4] }));

const gzipKb = (obj) => zlib.gzipSync(Buffer.from(JSON.stringify(obj))).length / 1024;

const apply = process.argv.includes("--apply");
let before = 0;
let after = 0;
let failed = false;

for (const { name, file } of FILES) {
  const original = JSON.parse(fs.readFileSync(file, "utf8"));
  const originalIndex = index(original);
  const was = gzipKb(original);
  before += was;

  const rounded = round(original, PRECISION_DP);
  const roundedIndex = index(rounded);
  const now = gzipKb(rounded);
  after += now;

  let renamed = 0;
  for (const [lon, lat] of sample) {
    if (locate(originalIndex, lon, lat) !== locate(roundedIndex, lon, lat)) renamed++;
  }
  const moved =
    name === "world.json"
      ? capitals.filter((c) => locate(originalIndex, c.lon, c.lat) !== locate(roundedIndex, c.lon, c.lat))
      : [];

  console.log(
    `${name.padEnd(16)} ${was.toFixed(1).padStart(6)} → ${now.toFixed(1).padStart(6)} KB gzipped ` +
      `(${(((was - now) / was) * 100).toFixed(0).padStart(2)}% smaller)  ` +
      `${renamed}/${SAMPLES} renamed` +
      (moved.length ? `  CAPITALS MOVED: ${moved.map((c) => c.name)}` : "")
  );

  if (renamed || moved.length) failed = true;
  if (apply) fs.writeFileSync(file, JSON.stringify(rounded));
}

console.log(
  `\ntotal ${before.toFixed(1)} → ${after.toFixed(1)} KB gzipped, saving ${(before - after).toFixed(1)} KB` +
    (apply ? " — written" : " — nothing written, pass --apply")
);

// The whole justification for rounding is that it changes nothing. If it has
// changed something, the tolerance is wrong and this should not pass quietly.
if (failed) {
  console.log("\nFAILED: rounding altered a lookup. Lower PRECISION_DP.");
  process.exit(1);
}
