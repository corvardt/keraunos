// Turns the raw 24MB water body dump into a GeoJSON FeatureCollection small
// enough to bundle. The map names a 1° cell, so kilometre precision is ample.
const fs = require("fs");
const path = require("path");

// water.json is the raw source and is never imported by the app; water.geo.json
// is what ships. Re-run this (npm run build:water) if the source is replaced.
const SRC = path.join(__dirname, "../src/lib/water.json");
const OUT = path.join(__dirname, "../src/lib/water.geo.json");

const TOLERANCE = 0.1; // degrees (~11km); we are naming a sea, not charting it
const MIN_RING = 4; // a ring needs 3 distinct points plus closure

// Perpendicular distance simplification. Plain lon/lat space: at the scale we
// simplify to, the distortion is far smaller than the tolerance itself.
function simplify(points, tolerance) {
  if (points.length <= 2) return points;
  const [ax, ay] = points[0];
  const [bx, by] = points[points.length - 1];
  let index = -1;
  let best = 0;
  const dx = bx - ax;
  const dy = by - ay;
  const norm = dx * dx + dy * dy;
  for (let i = 1; i < points.length - 1; i++) {
    const [px, py] = points[i];
    let t = norm ? ((px - ax) * dx + (py - ay) * dy) / norm : 0;
    t = Math.max(0, Math.min(1, t));
    const cx = ax + t * dx;
    const cy = ay + t * dy;
    const d = (px - cx) ** 2 + (py - cy) ** 2;
    if (d > best) {
      best = d;
      index = i;
    }
  }
  if (best <= tolerance * tolerance) return [points[0], points[points.length - 1]];
  return [
    ...simplify(points.slice(0, index + 1), tolerance).slice(0, -1),
    ...simplify(points.slice(index), tolerance),
  ];
}

const round = (n) => Math.round(n * 10) / 10;

function cleanRing(ring) {
  const simplified = simplify(ring, TOLERANCE);
  const out = [];
  for (const [lon, lat] of simplified) {
    const point = [round(lon), round(lat)];
    const last = out[out.length - 1];
    if (last && last[0] === point[0] && last[1] === point[1]) continue;
    out.push(point);
  }
  if (out.length < MIN_RING - 1) return null;
  const first = out[0];
  const last = out[out.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) out.push([first[0], first[1]]);
  return out.length >= MIN_RING ? out : null;
}

// The dump is not uniform: most bodies are a list of rings, but the four that
// straddle the antimeridian (both Pacifics, Bering, Chukchi) are a list of
// polygons instead. Flatten to one list of rings either way.
const depth = (value) => (Array.isArray(value) ? 1 + depth(value[0]) : 0);
function rings(geometry) {
  return depth(geometry) === 4 ? geometry.flat() : geometry;
}

const raw = JSON.parse(fs.readFileSync(SRC, "utf8"));
const features = [];
for (const body of raw) {
  const polygons = [];
  for (const ring of rings(body.geometry)) {
    const cleaned = cleanRing(ring);
    if (cleaned) polygons.push([cleaned]);
  }
  if (!polygons.length) continue;
  features.push({
    type: "Feature",
    properties: { name: body.name, area: body.area },
    geometry:
      polygons.length === 1
        ? { type: "Polygon", coordinates: polygons[0] }
        : { type: "MultiPolygon", coordinates: polygons },
  });
}

// Smallest first: the Adriatic should win over the Mediterranean, and the
// Mediterranean over the Atlantic.
features.sort((a, b) => a.properties.area - b.properties.area);

fs.writeFileSync(OUT, JSON.stringify({ type: "FeatureCollection", features }));
const size = fs.statSync(OUT).size;
console.log(`${features.length} bodies, ${(size / 1024).toFixed(0)} kB`);
console.log(features.slice(0, 5).map((f) => f.properties.name).join(", "));
