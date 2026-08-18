// How far the network hears, and what the sun does to it.
//
// A sferic — the radio crack a stroke puts out at a few kilohertz — does not
// travel in a straight line to the horizon and stop. It is trapped between the
// ground and the underside of the ionosphere and bounces along the gap, which
// is why a lightning network can be a network at all: a strike over Java is
// heard in Finland. What the gap is made of at the top changes twice a day.
// Sunlight ionises a thin layer at about 60–70 km, the D region, and that layer
// is lossy — the waveguide it roofs is low and absorbs. After sunset the D
// region decays within the hour and the reflecting height moves up to 85–90 km:
// a taller waveguide, fewer bounces over the same ground, and much less lost at
// each one. Measured on WWLLN, eastward propagation runs about 1.13 dB per
// megametre by day against about 0.71 by night (Hutchins et al. 2013, JGR 118).
//
// So the instrument can watch the ionosphere turn on and off, using nothing but
// lightning and the stations that heard it, and this is the accumulator that
// lets it. Every strike names the detectors that solved it and the registry
// already knows where they stand, so the distance to the farthest one is
// already in the building — no new field on the wire, nothing stored, and it
// costs one pass over at most forty stations per strike.
//
// Three things have to be said about the figure, because two of them are large:
//
//   The farthest station is a floor on the reach, not a measurement of it. It
//   says the signal got that far. It cannot say it would not have gone further,
//   and where it stops is mostly a fact about where volunteers live: a strike
//   in the South Pacific has nobody downrange and reads short no matter how far
//   it actually carried. That would ruin an absolute number — and it is exactly
//   why the reading here is a comparison. Station geography is the same at
//   midnight as at noon, so it cancels between the two bins, and what is left
//   over is the part that changed, which is the sky.
//
//   A path is binned by its midpoint. A sferic that leaves a storm in daylight
//   and arrives in the dark spent half its journey under each roof, and the
//   midpoint puts the whole of it in one bin. That smears the two distributions
//   into each other and makes the effect read weaker than it is; it is a
//   simplification in the honest direction, which is the only kind worth making
//   without saying so.
//
//   Day and night are not the only thing propagation cares about. East-west
//   asymmetry — the earth's magnetic field makes westward paths lossier than
//   eastward ones — is comparable in size to the effect being drawn here, and
//   is not separated out. The two distributions are day against night with that
//   left in.
//
// The terminator that matters is not the one on the map. The map's line is
// where the sun sets on the ground; what governs the waveguide is whether the
// sun is up as seen from 70 km, and from up there it is still up when it has
// gone from below. The geometry is acos(R / (R + h)) = 8.4° for h = 70 km, so
// the D region's own terminator trails the ground's by that much, and this bins
// on the higher one.

import { subsolar } from "./sun.js";
import { stations } from "./stations.js";
import { distanceKm } from "./geo.js";

const RAD = Math.PI / 180;

// Solar elevation, in degrees, below which the D region has gone. Negative
// because the sun has to be down at the ground before it is down at altitude.
const D_LAYER_DIP = -8.4;

// The histogram. Two hundred kilometres is finer than any of the caveats above
// and coarse enough that the shape survives a short session, and half the
// planet's circumference is as far as a great circle can go.
export const STEP_KM = 200;
export const BINS = 100;

// Below this a distribution is a handful of strikes and the median it hands
// back is noise. The two bins fill at whatever rate the weather offers, so
// neither is waited for: each says whether it is ready on its own.
const ENOUGH = 200;

/** Solar elevation at a point, in degrees. */
function elevation(lon, lat, sun) {
  const hour = (lon - sun.lon) * RAD;
  return (
    Math.asin(
      Math.sin(sun.decl * RAD) * Math.sin(lat * RAD) +
        Math.cos(sun.decl * RAD) * Math.cos(lat * RAD) * Math.cos(hour)
    ) / RAD
  );
}

/**
 * The half-way point of the great circle between two places.
 *
 * The straight average of the coordinates is not this, and is wrong in exactly
 * the cases that matter here: a path from Japan to Alaska averages to somewhere
 * near Siberia rather than to the middle of the Pacific, and a path either side
 * of the dateline averages to the wrong hemisphere entirely.
 */
export function midpoint(lon1, lat1, lon2, lat2) {
  const φ1 = lat1 * RAD;
  const φ2 = lat2 * RAD;
  const Δλ = (lon2 - lon1) * RAD;
  const bx = Math.cos(φ2) * Math.cos(Δλ);
  const by = Math.cos(φ2) * Math.sin(Δλ);
  const lat = Math.atan2(
    Math.sin(φ1) + Math.sin(φ2),
    Math.sqrt((Math.cos(φ1) + bx) ** 2 + by ** 2)
  );
  const lon = lon1 * RAD + Math.atan2(by, Math.cos(φ1) + bx);
  return { lon: ((((lon / RAD + 180) % 360) + 360) % 360) - 180, lat: lat / RAD };
}

/** Percentile off a histogram, interpolated inside the bin it lands in. */
function percentile(counts, total, fraction) {
  if (!total) return null;
  const want = total * fraction;
  let seen = 0;
  for (let bin = 0; bin < counts.length; bin++) {
    if (seen + counts[bin] < want) {
      seen += counts[bin];
      continue;
    }
    // Where inside this bin the crossing falls. The bin is a range and the
    // answer is a distance, so it is read across the bin rather than off its
    // edge: without this every median in a short session is a round 200.
    const across = counts[bin] ? (want - seen) / counts[bin] : 0;
    return (bin + across) * STEP_KM;
  }
  return counts.length * STEP_KM;
}

export function createReach() {
  const day = new Int32Array(BINS);
  const night = new Int32Array(BINS);
  let dayTotal = 0;
  let nightTotal = 0;

  // The subsolar point moves a degree every four minutes and is the same for
  // every strike arriving in that minute, so it is worked out once a minute
  // rather than once a strike.
  let sun = null;
  let sunAt = -1;

  // Rebuilt only when something has landed in it, and handed back by identity
  // otherwise: the panel reading this re-renders twice a second and the shape
  // moves at the speed of the weather.
  let cached = null;
  let dirty = true;

  return {
    /**
     * Files one strike by how far it was heard and what the sky was doing over
     * the path. `used` is the station ids that solved it; a strike nobody is
     * recorded as having heard has nothing to say and is dropped.
     */
    record(lon, lat, used, now = Date.now()) {
      if (!used?.length) return;
      const network = stations();

      let far = 0;
      let farthest = null;
      for (const id of used) {
        const station = network.get(id);
        if (!station) continue;
        const km = distanceKm(lon, lat, station.lon, station.lat);
        if (km > far) {
          far = km;
          farthest = station;
        }
      }
      // Either the registry has not caught up with these ids yet, or the whole
      // solution came from one place. Neither is a reach.
      if (!farthest || far <= 0) return;

      const minute = Math.floor(now / 60000);
      if (sunAt !== minute) {
        sun = subsolar(new Date(now));
        sunAt = minute;
      }

      const middle = midpoint(lon, lat, farthest.lon, farthest.lat);
      const lit = elevation(middle.lon, middle.lat, sun) > D_LAYER_DIP;

      const bin = Math.min(BINS - 1, Math.floor(far / STEP_KM));
      if (lit) {
        day[bin]++;
        dayTotal++;
      } else {
        night[bin]++;
        nightTotal++;
      }
      dirty = true;
    },

    /**
     * The two distributions, each with the two figures worth reading off it:
     * the middle of it, and the far end. The tail is the ninetieth percentile
     * rather than the maximum, because a maximum is one strike and one strike
     * is not a propagation condition.
     */
    read() {
      if (!dirty && cached) return cached;
      const side = (counts, total) => ({
        counts,
        n: total,
        // A distribution says so itself rather than being suppressed from
        // outside: the two fill at whatever rate the weather offers, and it is
        // ordinary for one to be ready an hour before the other.
        ready: total >= ENOUGH,
        median: total >= ENOUGH ? percentile(counts, total, 0.5) : null,
        tail: total >= ENOUGH ? percentile(counts, total, 0.9) : null,
      });
      // How many bins anything at all landed in. Both the axis and the heading
      // are drawn from it, so it is worked out once here rather than twice
      // over the same two arrays in the panel.
      let span = 0;
      for (let bin = BINS - 1; bin >= 0; bin--) {
        if (day[bin] || night[bin]) {
          span = bin + 1;
          break;
        }
      }
      dirty = false;
      cached = { day: side(day, dayTotal), night: side(night, nightTotal), span };
      return cached;
    },
  };
}
