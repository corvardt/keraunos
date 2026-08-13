import booleanPointInPolygon from "@turf/boolean-point-in-polygon";

const EARTH_KM = 6371;
const RAD = Math.PI / 180;

/** Great-circle distance in kilometres. */
export function distanceKm(lon1, lat1, lon2, lat2) {
  const dLat = (lat2 - lat1) * RAD;
  const dLon = (lon2 - lon1) * RAD;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

// Walk a GeoJSON coordinate tree of any depth, growing [minLon, minLat, maxLon, maxLat].
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

// Lookups are bucketed into a coarse grid of the globe, because scanning every
// feature's bounding box is only cheap until you do it often enough. Building
// the land matrix asks 14,548 questions of this at world zoom, and answering
// each by walking all 177 countries is 2.5 million box comparisons for 3,845
// dots: 40ms of the main thread on every settle. Bucketed first, it is 22,530
// comparisons and 17ms, for the same answers: what remains is the
// point-in-polygon work itself, which is the part that was ever the point.
//
// Ocean is where it pays. Most of the planet is water, most questions are about
// water, and an empty bucket answers instantly instead of testing 177 boxes to
// arrive at nothing.
const BUCKET_DEG = 10;
const COLS = 360 / BUCKET_DEG;
const ROWS = 180 / BUCKET_DEG;

// Clamped rather than wrapped: a coordinate off the edge of the world belongs
// to the edge bucket, and the bounding-box test below still has to agree before
// anything is claimed. Being generous here costs a box comparison, being wrong
// costs a feature.
const col = (lon) => Math.min(COLS - 1, Math.max(0, Math.floor((lon + 180) / BUCKET_DEG)));
const row = (lat) => Math.min(ROWS - 1, Math.max(0, Math.floor((lat + 90) / BUCKET_DEG)));

/**
 * Features by bucket, each still carrying the bounding box that guards the
 * point-in-polygon test.
 *
 * Feature order is preserved within a bucket, which the water bodies depend on:
 * they arrive sorted smallest-first so that the first hit is the most specific
 * name: the Adriatic before the Mediterranean, the Mediterranean before the
 * Atlantic. Bucketing must not quietly reorder that.
 */
export function indexFeatures(features) {
  const buckets = new Array(COLS * ROWS);
  for (const feature of features) {
    const bbox = extend([Infinity, Infinity, -Infinity, -Infinity], feature.geometry.coordinates);
    const entry = { feature, bbox };
    const [west, south, east, north] = bbox;
    // A country spanning the date line has a bbox the width of the world and
    // lands in every bucket of its latitudes. That is what it cost before, too.
    for (let y = row(south); y <= row(north); y++) {
      for (let x = col(west); x <= col(east); x++) {
        const at = y * COLS + x;
        if (buckets[at]) buckets[at].push(entry);
        else buckets[at] = [entry];
      }
    }
  }
  return buckets;
}

export function findFeature(index, lon, lat) {
  const candidates = index[row(lat) * COLS + col(lon)];
  if (!candidates) return null;
  const point = { type: "Point", coordinates: [lon, lat] };
  for (const { feature, bbox } of candidates) {
    if (lon < bbox[0] || lon > bbox[2] || lat < bbox[1] || lat > bbox[3]) continue;
    if (booleanPointInPolygon(point, feature)) return feature;
  }
  return null;
}
