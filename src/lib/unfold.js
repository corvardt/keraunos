import { geoProjection, geoOrthographicRaw, geoMercatorRaw } from "d3-geo";
import { fitProjection, LAT_LIMIT, PAD } from "./view.js";

/**
 * The globe unrolling into the map.
 *
 * Not two pictures with a dissolve between them: one projection, interpolated.
 * A projection in d3 is a raw function from lon/lat to the plane wrapped in a
 * scale and a translate, and raw functions can be mixed. So the planet on the
 * boot screen and the map underneath it are the same object at two values of
 * one number, and everything between is a real projection that a point can be
 * put through, which is why the coast arrives where it belongs rather than
 * being tweened into place and hoping.
 *
 * The end has to be exact, not close: at t = 1 this is `fitProjection` to the
 * pixel, so the frame where the unfold stops and the map's own land layer takes
 * over is the same frame twice. That is the whole trick. Everything else here
 * is in service of it.
 */

// Orthographic raw puts the sphere in a unit disk; Mercator raw puts the world
// in ±π. Mixed as they come, the Mercator term is three times the size of the
// other and the blend is nearly flat by the time it is a third of the way
// through: the globe would not unroll, it would snap. This gain puts the two
// in the same units first, so t moves the shape at the rate t suggests.
const GAIN = Math.PI;

// Mercator raw runs to infinity at the poles. Nothing drawn through this goes
// past the limit the map itself stops at, but a projection that returns
// Infinity for an argument it was never going to be asked for is a trap left
// lying for the next caller.
const clamp = (phi) => {
  const limit = (LAT_LIMIT * Math.PI) / 180;
  return Math.max(-limit, Math.min(limit, phi));
};

function blend(t) {
  const raw = (lambda, phi) => {
    const sphere = geoOrthographicRaw(lambda, phi);
    const flat = geoMercatorRaw(lambda, clamp(phi));
    return [
      (1 - t) * GAIN * sphere[0] + t * flat[0],
      (1 - t) * GAIN * sphere[1] + t * flat[1],
    ];
  };
  return raw;
}

/** The globe's scale, at t = 0: as large a sphere as the glass will take. */
export function globeScale(width, height) {
  return (Math.min(width, height) - PAD * 2) / (2 * GAIN);
}

/**
 * The projection at `t`, spun to `rotate`.
 *
 * The spin is folded into t as well. A map left rotated is a map centred
 * somewhere other than where every other part of this app believes it is
 * centred, so whatever longitude the planet had reached on the boot screen is
 * unwound to zero over the same move that flattens it: the world turns the last
 * few degrees into place as it comes apart.
 */
export function unfoldProjection(t, width, height, rotate) {
  const end = fitProjection(width, height);
  const scale = globeScale(width, height) * (1 - t) + end.scale() * t;
  const [ex, ey] = end.translate();
  return geoProjection(blend(t))
    .scale(scale)
    .translate([(width / 2) * (1 - t) + ex * t, (height / 2) * (1 - t) + ey * t])
    .rotate([rotate[0] * (1 - t), rotate[1] * (1 - t)]);
}

/**
 * Whether a point is on the side of the sphere facing the viewer.
 *
 * Orthographic raw is two-to-one: without a clip angle the far hemisphere folds
 * onto the near one and the globe is drawn twice, mirrored, which reads as a
 * fault rather than as a planet. d3's own orthographic clips those points away
 * entirely, and that is exactly what cannot be done here, because they are
 * needed at the end, when the world is flat and has no far side. So they are
 * not clipped, they are faded: this says which are which, and the unfold brings
 * them up as they swing round the limb.
 */
export function facing(lon, lat, rotate) {
  return cosCentre(lon, lat, rotate) > 0;
}

/**
 * The cosine of the angular distance from the point the sphere is pointed at.
 *
 * What `facing` tests, handed out as the number rather than the verdict. One is
 * the middle of the disk, zero is the limb, and negative is round the back, so
 * a caller that knows how much of the planet its canvas can hold can cull at
 * that angle instead of at the horizon. On a globe drawn larger than the glass
 * most of the near side is off the edge, and asking each of those vertices
 * whether it is also in daylight is a turn's frame rate spent on ground nobody
 * can see.
 */
export function cosCentre(lon, lat, rotate) {
  const RAD = Math.PI / 180;
  // Rotation is applied as [-centreLon, -centreLat], so the centre is its
  // negative. The cosine of the angular distance from there is the test.
  const centreLon = -rotate[0];
  const centreLat = -rotate[1];
  return (
    Math.sin(centreLat * RAD) * Math.sin(lat * RAD) +
    Math.cos(centreLat * RAD) * Math.cos(lat * RAD) * Math.cos((lon - centreLon) * RAD)
  );
}
