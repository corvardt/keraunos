// Holds the baked land mask to the polygons it was baked from.
//
//   node scripts/check-land.cjs
//
// `src/lib/land.js` is generated, committed, and then never looked at again,
// which makes it exactly the kind of file that goes quietly stale: edit
// world.json, run `shrink:geo`, and the mask still answers for the coastline as
// it was. Nothing about the map would look broken — the matrix would simply be
// drawn from a world that no longer exists.
//
// So this re-asks the polygons, at every cell centre, and requires the answers
// to be identical. Not "close": the mask is a pure function of world.json and
// there is no tolerance to spend. A mismatch means run `npm run build:land`.

const fs = require("fs");
const path = require("path");
const booleanPointInPolygon = require("@turf/boolean-point-in-polygon").default;

const LAND = path.join(__dirname, "../src/lib/land.js");
const WORLD = path.join(__dirname, "../src/lib/world.json");

const source = fs.readFileSync(LAND, "utf8");
const read = (name) => {
  const found = source.match(new RegExp(`export const ${name} = ([0-9.]+);`));
  if (!found) {
    console.log(`✗ ${name} missing from land.js — regenerate with: npm run build:land`);
    process.exit(1);
  }
  return Number(found[1]);
};
const RES = read("LAND_RES");
const COLS = read("LAND_COLS");
const ROWS = read("LAND_ROWS");

const packed = source.match(/"([A-Za-z0-9+/=]+)"/);
if (!packed) {
  console.log("✗ no packed mask in land.js — regenerate with: npm run build:land");
  process.exit(1);
}
// Decoded here rather than imported, and deliberately written out a second
// time: land.js is an ES module in a tree of CommonJS scripts, and a check that
// runs the very code it is checking is not a check. If the two decoders ever
// disagree, that disagreement is the thing worth finding.
const raw = Buffer.from(packed[1], "base64");
const bits = new Uint8Array(Math.ceil((COLS * ROWS) / 8));
{
  let read = 0;
  let value = raw[read++] & 1;
  let at = 0;
  while (read < raw.length) {
    let run = 0;
    let shift = 0;
    let byte;
    do {
      byte = raw[read++];
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
  if (at !== COLS * ROWS) {
    console.log(`✗ runs cover ${at} cells, expected ${COLS * ROWS} for ${COLS}x${ROWS}`);
    process.exit(1);
  }
}

// The same bucketed index the map and the builder use.
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

const world = JSON.parse(fs.readFileSync(WORLD, "utf8"));
const index = new Array(BCOLS * BROWS);
for (const feature of world.features) {
  const bbox = extend([Infinity, Infinity, -Infinity, -Infinity], feature.geometry.coordinates);
  const entry = { feature, bbox };
  for (let y = brow(bbox[1]); y <= brow(bbox[3]); y++) {
    for (let x = bcol(bbox[0]); x <= bcol(bbox[2]); x++) {
      const at = y * BCOLS + x;
      if (index[at]) index[at].push(entry);
      else index[at] = [entry];
    }
  }
}

function isLand(lon, lat) {
  const candidates = index[brow(lat) * BCOLS + bcol(lon)];
  if (!candidates) return false;
  const point = { type: "Point", coordinates: [lon, lat] };
  for (const { feature, bbox } of candidates) {
    if (lon < bbox[0] || lon > bbox[2] || lat < bbox[1] || lat > bbox[3]) continue;
    if (booleanPointInPolygon(point, feature)) return true;
  }
  return false;
}

let wrong = 0;
let set = 0;
const examples = [];
for (let y = 0; y < ROWS; y++) {
  const lat = 90 - (y + 0.5) * RES;
  for (let x = 0; x < COLS; x++) {
    const lon = -180 + (x + 0.5) * RES;
    const at = y * COLS + x;
    const stored = ((bits[at >> 3] >> (at & 7)) & 1) === 1;
    if (stored) set++;
    const truth = isLand(lon, lat);
    if (stored === truth) continue;
    wrong++;
    if (examples.length < 8) {
      examples.push(`  ✗ ${lon.toFixed(2)},${lat.toFixed(2)} stored ${stored ? "land" : "sea"}`);
    }
  }
}

for (const line of examples) console.log(line);
console.log(
  `\nland mask ${COLS}x${ROWS} @ ${RES}°: ${set} land cells, ` +
    `${COLS * ROWS - wrong} of ${COLS * ROWS} agree with world.json`
);
if (wrong) console.log(`${wrong} cells disagree — regenerate with: npm run build:land`);
process.exit(wrong ? 1 : 0);
