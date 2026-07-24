// Where the sun is, and therefore where the night is.
//
// Lightning is violently diurnal — the global strike band is afternoon
// convection walking around the planet — so the terminator is not decoration
// here. It is the single line that makes the pattern legible: strikes cluster
// behind it, over land, in the hours after local noon.
//
// This is the low-precision solar position (the one in the Astronomical
// Almanac's "approximate" section), good to about a hundredth of a degree for
// a century either side of 2000. The terminator is a soft edge on a map where
// one pixel is tens of kilometres; nothing finer would survive being drawn.

const RAD = Math.PI / 180;
const J2000 = Date.UTC(2000, 0, 1, 12);

/** Declination and longitude of the point the sun is directly over, in degrees. */
export function subsolar(date = new Date()) {
  const n = (date.getTime() - J2000) / 86400000; // days since J2000.0
  const meanLon = 280.46 + 0.9856474 * n;
  const anomaly = (357.528 + 0.9856003 * n) * RAD;
  // Ecliptic longitude: the mean, corrected for the orbit not being a circle.
  const ecliptic =
    (meanLon + 1.915 * Math.sin(anomaly) + 0.02 * Math.sin(2 * anomaly)) * RAD;
  const obliquity = (23.439 - 4e-7 * n) * RAD;

  const decl = Math.asin(Math.sin(obliquity) * Math.sin(ecliptic)) / RAD;
  const rightAscension =
    Math.atan2(Math.cos(obliquity) * Math.sin(ecliptic), Math.cos(ecliptic)) / RAD;
  // Greenwich sidereal time turns right ascension into a longitude on the
  // ground; without it the sun would sit still and the earth would not turn.
  const gmst = (18.697374558 + 24.06570982441908 * n) % 24;

  const lon = rightAscension - gmst * 15;
  return { decl, lon: ((((lon + 180) % 360) + 360) % 360) - 180 };
}

/**
 * The terminator, as a latitude sampled along every longitude, plus the edge
 * of the map that night closes against.
 *
 * The curve is where the sun sits exactly on the horizon:
 *
 *   sin δ sin φ + cos δ cos φ cos H = 0   ⟹   tan φ = −cos H / tan δ
 *
 * At the equinoxes tan δ passes through zero and φ runs off to the poles.
 * That looks like the case needing special handling and is in fact the case
 * that handles itself: clamping φ to the drawn limit collapses the curve onto
 * the top and bottom edges, which is exactly a terminator running pole to pole.
 */
export function terminator(date, limit, step = 2) {
  const { decl, lon: sunLon } = subsolar(date);
  const tanDecl = Math.tan(decl * RAD);
  const points = [];

  for (let lon = -180; lon <= 180; lon += step) {
    const hour = (lon - sunLon) * RAD;
    let lat = Math.atan(-Math.cos(hour) / tanDecl) / RAD;
    // Only ever 0/0 — the equinox meridian at the exact moment of equinox.
    if (!isFinite(lat)) lat = 0;
    points.push([lon, Math.max(-limit, Math.min(limit, lat))]);
  }

  // Northern summer lights the north pole, so night is the southern side.
  return { points, nightEdge: decl > 0 ? -limit : limit };
}
