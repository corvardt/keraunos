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

// Pair every feature with its bounding box so lookups can skip the expensive
// point-in-polygon test for the ~99% of features that can't possibly match.
export function indexFeatures(features) {
  return features.map((feature) => ({
    feature,
    bbox: extend([Infinity, Infinity, -Infinity, -Infinity], feature.geometry.coordinates),
  }));
}

export function findFeature(index, lon, lat) {
  const point = { type: "Point", coordinates: [lon, lat] };
  for (const { feature, bbox } of index) {
    if (lon < bbox[0] || lon > bbox[2] || lat < bbox[1] || lat > bbox[3]) continue;
    if (booleanPointInPolygon(point, feature)) return feature;
  }
  return null;
}
