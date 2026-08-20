import { geoProjection, geoOrthographicRaw } from "d3-geo";
import { PAD } from "./view.js";
import { facing } from "./unfold.js";

/**
 * The globe, as a place to stand rather than as a move.
 *
 * `unfold.js` owns the planet that comes apart into the map: one projection at
 * two values of one number, and the whole of it is in service of the frame
 * where the two are the same picture. This is the other thing the same sphere
 * can be — a view the reader stays in — and it is kept apart from that for one
 * reason: the unfold is a gesture with an end, and everything in it is timed.
 * Nothing here is. The world simply sits where it was last turned to.
 *
 * The two agree on the geometry, and have to: the gain and the radius below are
 * the unfold's own at t = 0, so switching the mode on is the same sphere the
 * boot screen drew, at the same size, in the same place.
 */

const RAD = Math.PI / 180;

/** The planet's radius on the glass: as large a sphere as the tube will take. */
export const globeRadius = (width, height) => (Math.min(width, height) - PAD * 2) / 2;

/**
 * The rotation a centre longitude and latitude make, in d3's own terms.
 *
 * Everything on this map that already knows about a sphere — `facing`, and the
 * `sphere` block `paintLand` takes — speaks in rotations, because that is what
 * the unfold hands it. The globe thinks in where it is pointed. One conversion,
 * in one place, rather than a scattering of minus signs.
 */
export const rotationFor = ([lon, lat]) => [-lon, -lat];

// What a culled point comes back as. Not null: every caller on this map already
// guards a projected point with `isFinite`, because Mercator hands back
// infinities at the poles and always has. Answering a point behind the planet
// the same way means the cull costs nothing anywhere — no call site learns that
// a globe exists, and the ones that would have drawn Sumatra through the middle
// of the Pacific simply skip it, on the check they were already making.
const BEHIND = [NaN, NaN];

/**
 * The planet, centred on `[lon, lat]`, as something every caller can use.
 *
 * A d3 projection with one addition: points on the far side are not projected.
 * Orthographic is two-to-one — the hidden hemisphere folds onto the visible one,
 * mirrored — so a strike in Java drawn without this lands in the Pacific, at a
 * position that is not wrong by a little.
 *
 * `k` is how much of that radius the planet is drawn at. One is the sphere the
 * boot screen leaves and the unfold hands over — the size the two shapes agree
 * on — and below it the reader has pushed the world away to stand further off.
 * Everything the projection reports about itself is taken from the same scaled
 * radius, so the limb, the inverse and the sky's warp all move together and no
 * caller has to be told the planet can be a different size.
 */
export function globeProjection(width, height, [lon, lat], k = 1) {
  const radius = globeRadius(width, height) * k;
  // Orthographic raw puts the sphere in a unit disk, so the scale *is* the
  // radius on the glass. The unfold's own globe carries a gain of π on top of
  // this, because it has to hand over to a Mercator whose units are ±π and the
  // two have to be in the same ones to be mixed; there is nothing to hand over
  // to here, so there is nothing to convert.
  const inner = geoProjection(geoOrthographicRaw)
    .scale(radius)
    .translate([width / 2, height / 2])
    .rotate([-lon, -lat]);

  const rotate = rotationFor([lon, lat]);
  const projection = (point) => (facing(point[0], point[1], rotate) ? inner(point) : BEHIND);

  /**
   * Screen back to the sphere.
   *
   * d3's own inverse would answer this, and answer it for points off the disk
   * too: outside its radius an orthographic inverse does not return nothing, it
   * returns a point, and that point is on a planet that is not there. The disk
   * is tested first for that reason. Written out rather than delegated because
   * the sky's warp asks this of every block on the glass, sixty times a second,
   * and d3's version allocates a pair of arrays each time it is asked.
   */
  projection.invert = ([x, y]) => {
    const dx = x - width / 2;
    // Screen y grows downward; the sphere's does not.
    const dy = height / 2 - y;
    const rho = Math.hypot(dx, dy);
    if (rho > radius) return null;
    // The angular distance from the centre of the disk to the point under it.
    const c = Math.asin(Math.min(1, rho / radius));
    const sinC = Math.sin(c);
    const cosC = Math.cos(c);
    const sinLat = Math.sin(lat * RAD);
    const cosLat = Math.cos(lat * RAD);
    // Dead centre: rho is zero and the arithmetic below divides by it.
    if (rho === 0) return [lon, lat];
    const east = lon + Math.atan2(dx * sinC, rho * cosC * cosLat - dy * sinC * sinLat) / RAD;
    return [
      // Wrapped, because the centre it is measured from is itself a longitude
      // and the sum runs past the antimeridian near the limb. Everything
      // downstream — the readout, the country lookup — expects a coordinate.
      ((((east + 180) % 360) + 360) % 360) - 180,
      Math.asin(cosC * sinLat + (dy * sinC * cosLat) / rho) / RAD,
    ];
  };

  // The same projection with the cull taken off.
  //
  // For the one caller that has to be told about the far side rather than have
  // it hidden: the sky lays the world down in patches and decides each one's
  // weight for itself, so it wants every corner answered and the facing test
  // made once, in its own terms. Cutting the far side away in two places by two
  // rules is how the two come to disagree at the limb.
  projection.plain = inner;
  // Read by anything that wants the sphere itself rather than a point on it:
  // the sky's warp, and the tube's own limb.
  projection.sphere = { x: width / 2, y: height / 2, r: radius, lon, lat, rotate };
  // Carried so the callers that already ask a projection its scale — the tile
  // pyramid picks its level from it — get an answer in the units they expect.
  projection.scale = inner.scale;
  projection.translate = inner.translate;
  return projection;
}

// How far the world turns for one pixel of drag, in degrees.
//
// Taken from the planet's own size rather than fixed, so the surface keeps up
// with the pointer whatever the tube is: a radian at the centre of the disk is
// the radius in pixels, so a pixel is a radian over the radius. Dragging the
// width of the visible hemisphere turns it by a little under sixty degrees,
// which is the rate at which the ball reads as being rolled rather than scrubbed.
const DEG_PER_PX = 180 / Math.PI;

// The poles are where an orthographic view stops being one: past this the
// planet is being looked down on, the graticule closes into rings, and the drag
// that got there has no way back that does not feel like it is fighting.
const TILT_LIMIT = 80;

/**
 * The rotation after a drag of `dx, dy` pixels.
 *
 * The surface goes where the pointer goes, which is why the longitude runs
 * against the drag: pulling the ball to the right brings its western face to
 * the middle, and the meridian under the eye moves west with it. The latitude
 * does not need the same inversion — screen y grows downward, and pulling down
 * brings the north up — so the two signs disagreeing here is the correct
 * arithmetic rather than a slip.
 */
export function turned(at, dx, dy, radius) {
  const per = DEG_PER_PX / radius;
  return pointed(at, -dx * per, dy * per);
}

/** The rotation `dLon, dLat` degrees on from this one. */
export function pointed([lon, lat], dLon, dLat) {
  const next = lon + dLon;
  return [
    // Kept in ±180 so that everything reading it — the readout, the country
    // lookup — gets a longitude rather than a winding count.
    ((((next + 180) % 360) + 360) % 360) - 180,
    Math.max(-TILT_LIMIT, Math.min(TILT_LIMIT, lat + dLat)),
  ];
}
