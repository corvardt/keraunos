// Storm-cell detection and tracking.
//
// A storm cell is a spatially coherent cluster of strikes, not a grid square.
// Strikes are binned fine (~45 km), sparse bins are discarded as noise, and
// what survives is grouped by 8-neighbour connectivity. Clusters are then
// matched to the previous pass by proximity so each keeps an identity long
// enough to measure how it is moving.

const CELL_DEG = 0.4; // ~45 km, near the scale of a real cell
// Detection wants a long window (more strikes define the cluster better), but
// a centroid averaged over that window lags the cell and, while the window is
// still filling, advances at only half its speed. Tracking therefore uses a
// separate centroid built from recent strikes alone.
const RECENT_MS = 180000;
const MIN_RECENT = 20; // below this the recent centroid is too noisy to use
const MIN_CELL_STRIKES = 2; // a bin below this is noise, not a cell
const MIN_STORM_STRIKES = 12; // a cluster below this is not worth tracking
const MATCH_DEG = 1.2; // how far a cell may move between passes and stay itself
const KM_PER_DEG = 111.32;

// Velocity needs a long baseline. A 50 km/h cell moves ~28 m in 2 s, while one
// new strike joining a 130-strike cluster drags the centroid ~430 m — fifteen
// times further. Measured sample-to-sample, the reading is pure noise, so
// displacement is taken across minutes instead.
// How long a baseline has to be is set by geometry, not preference. A 45 km/h
// cell covers 3.75 km in five minutes while being ~100 km across — three per
// cent of its own width, which no centroid is accurate enough to resolve. Over
// ten minutes it moves far enough to measure, so that is the wait.
// Retention and fitting are two different jobs and want two different windows.
// The drawn track wants to be long: a 50 km/h cell covers 21 km in 25 minutes,
// which is a smudge on its own ring at any zoom you would actually use. The
// velocity fit wants to be short: `slope` is a straight line, and storms curve,
// so regressing an hour of a turning cell reports a heading it no longer has.
const TRAIL_MS = 3600000; // centroid history retained per cell, for drawing (60 min)
const FIT_MS = 1500000; // recent window the velocity is regressed over (25 min)
const TRAIL_STEP_MS = 20000; // how often a centroid is recorded
const MIN_BASELINE_S = 600; // observation span before speed is reported
const MIN_TRAIL_POINTS = 15; // samples the regression needs to be meaningful
const MIN_KMH = 8; // below this a cell is drifting, not tracking
const MAX_KMH = 140; // above this it is a tracking error, not weather

let nextId = 1;

// Least-squares slope of a coordinate against time, in degrees per second.
// Differencing the two endpoints would discard every sample between them and
// carry the full centroid noise of both, which is enough to invert the sign of
// a slow component. Regression uses the whole trail.
function slope(points, key) {
  const n = points.length;
  const t0 = points[0].t;
  let sumT = 0;
  let sumV = 0;
  let sumTT = 0;
  let sumTV = 0;
  for (const point of points) {
    const t = (point.t - t0) / 1000;
    const v = point[key];
    sumT += t;
    sumV += v;
    sumTT += t * t;
    sumTV += t * v;
  }
  const denominator = n * sumTT - sumT * sumT;
  if (Math.abs(denominator) < 1e-9) return 0;
  return (n * sumTV - sumT * sumV) / denominator;
}

export function detectStorms(strikes, now, windowMs) {
  const cells = new Map();
  for (const strike of strikes) {
    if (now - strike.t > windowMs) continue;
    const cx = Math.floor(strike.lon / CELL_DEG);
    const cy = Math.floor(strike.lat / CELL_DEG);
    const key = `${cx},${cy}`;
    let cell = cells.get(key);
    if (!cell) {
      cells.set(key, (cell = { cx, cy, n: 0, sumLon: 0, sumLat: 0, rn: 0, rLon: 0, rLat: 0 }));
    }
    cell.n++;
    cell.sumLon += strike.lon;
    cell.sumLat += strike.lat;
    if (now - strike.t <= RECENT_MS) {
      cell.rn++;
      cell.rLon += strike.lon;
      cell.rLat += strike.lat;
    }
  }

  for (const [key, cell] of cells) {
    if (cell.n < MIN_CELL_STRIKES) cells.delete(key);
  }

  const seen = new Set();
  const storms = [];

  for (const key of cells.keys()) {
    if (seen.has(key)) continue;

    // Flood fill across the 8-neighbourhood.
    const stack = [key];
    const group = [];
    seen.add(key);
    while (stack.length) {
      const current = cells.get(stack.pop());
      group.push(current);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          if (!dx && !dy) continue;
          const neighbour = `${current.cx + dx},${current.cy + dy}`;
          if (cells.has(neighbour) && !seen.has(neighbour)) {
            seen.add(neighbour);
            stack.push(neighbour);
          }
        }
      }
    }

    let count = 0;
    let sumLon = 0;
    let sumLat = 0;
    let recent = 0;
    let rLon = 0;
    let rLat = 0;
    for (const cell of group) {
      count += cell.n;
      sumLon += cell.sumLon;
      sumLat += cell.sumLat;
      recent += cell.rn;
      rLon += cell.rLon;
      rLat += cell.rLat;
    }
    if (count < MIN_STORM_STRIKES) continue;

    const lon = sumLon / count;
    const lat = sumLat / count;
    // Where the cell is now, as opposed to where it has been.
    const tlon = recent >= MIN_RECENT ? rLon / recent : lon;
    const tlat = recent >= MIN_RECENT ? rLat / recent : lat;
    let radius = CELL_DEG;
    for (const cell of group) {
      const dx = (cell.cx + 0.5) * CELL_DEG - lon;
      const dy = (cell.cy + 0.5) * CELL_DEG - lat;
      radius = Math.max(radius, Math.hypot(dx, dy) + CELL_DEG * 0.5);
    }

    storms.push({ lon, lat, tlon, tlat, count, recent, radius, extent: group.length });
  }

  return storms;
}

/** Carries identity and velocity forward from the previous pass. */
export function trackStorms(previous, current, now) {
  const claimed = new Set();

  return current.map((storm) => {
    let match = null;
    let closest = MATCH_DEG;
    for (const old of previous) {
      if (claimed.has(old.id)) continue;
      const distance = Math.hypot(old.lon - storm.lon, old.lat - storm.lat);
      if (distance < closest) {
        closest = distance;
        match = old;
      }
    }

    if (!match) {
      const trail = [{ lon: storm.tlon, lat: storm.tlat, t: now }];
      return { ...storm, id: nextId++, trail, vlon: 0, vlat: 0, baseline: 0, age: 0, t: now };
    }

    claimed.add(match.id);

    // Subsampled: a point every TRAIL_STEP_MS is enough to fix a heading, and
    // keeps the trail small however long a cell lives.
    const trail = match.trail.filter((p) => now - p.t <= TRAIL_MS);
    const latest = trail[trail.length - 1];
    if (!latest || now - latest.t >= TRAIL_STEP_MS) {
      trail.push({ lon: storm.tlon, lat: storm.tlat, t: now });
    }

    // The whole trail is kept, but only its recent end is fitted.
    const fit = trail.filter((p) => now - p.t <= FIT_MS);
    let vlon = 0;
    let vlat = 0;
    let baseline = 0;
    if (fit.length >= MIN_TRAIL_POINTS) {
      baseline = (fit[fit.length - 1].t - fit[0].t) / 1000;
      if (baseline >= MIN_BASELINE_S) {
        vlon = slope(fit, "lon");
        vlat = slope(fit, "lat");
      }
    }

    const dt = (now - match.t) / 1000;
    return { ...storm, id: match.id, trail, vlon, vlat, baseline, age: match.age + dt, t: now };
  });
}

/**
 * Ground track, or null when the cell has not been watched long enough for the
 * reading to mean anything. Speeds outside weather's range are tracking errors
 * — a cluster merging or being matched to its neighbour — and are withheld
 * rather than displayed.
 */
export function motion(storm) {
  if (storm.baseline < MIN_BASELINE_S) return null;
  const lonKm = storm.vlon * KM_PER_DEG * Math.cos((storm.lat * Math.PI) / 180);
  const latKm = storm.vlat * KM_PER_DEG;
  const kmh = Math.hypot(lonKm, latKm) * 3600;
  if (kmh < MIN_KMH || kmh > MAX_KMH) return null;
  return {
    kmh,
    bearing: (Math.atan2(storm.vlon, storm.vlat) * 180) / Math.PI,
    ux: storm.vlon / Math.hypot(storm.vlon, storm.vlat),
    uy: storm.vlat / Math.hypot(storm.vlon, storm.vlat),
  };
}

/**
 * Where the cell reaches in `seconds` if it holds its present course, measured
 * from the recent centroid rather than the windowed one — the forecast starts
 * from where the cell is, not from where it has been on average.
 *
 * Gated on `motion` deliberately: a course too short-baselined to state as a
 * speed is too short-baselined to extrapolate, and drawing it anyway would put
 * a confident line on the map that the readout beside it declines to back.
 */
export function forecast(storm, seconds) {
  if (!motion(storm)) return null;
  return [storm.tlon + storm.vlon * seconds, storm.tlat + storm.vlat * seconds];
}
