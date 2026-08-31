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
// new strike joining a 130-strike cluster drags the centroid ~430 m: fifteen
// times further. Measured sample-to-sample, the reading is pure noise, so
// displacement is taken across minutes instead.
// How long a baseline has to be is set by geometry, not preference. A 45 km/h
// cell covers 3.75 km in five minutes while being ~100 km across, three per
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

// The lightning jump.
//
// Where a cell is going is one reading; whether it is winding up is the other,
// and it is the one that leads. A cell's flash rate climbing sharply precedes
// severe weather at the ground by ten to twenty minutes, because the updraught
// that separates charge fast enough to fire at that rate is the same updraught
// that carries hail and produces the gust. The map already holds everything
// needed to see it: the strikes are in memory and the cells keep an identity
// between passes, so this is arithmetic over what is already there.
//
// Every trail point therefore records the rate as well as the position, and
// the rate is read the same way the heading is: regressed over a window rather
// than differenced between two samples.
const RECENT_MIN = RECENT_MS / 60000; // the rate window, in minutes
// Short, unlike the velocity fit. A heading is a property of a storm and holds
// for tens of minutes; a jump is by definition a departure from what the cell
// was doing, and regressing half an hour of it would average the surge away
// with the calm before it.
const RATE_FIT_MS = 360000; // 6 min
const MIN_RATE_POINTS = 12; // 4 minutes of samples, at one per 20s
const MIN_BASELINE_POINTS = 3; // a minute of settled rate to compare against

// Flashes are counted, so the noise on a count is Poisson: a baseline that
// predicts N flashes will deliver N ± √N without anything having changed. The
// test is therefore in standard deviations rather than in per cent, which is
// what keeps a quiet cell of four flashes from reading as a doubling every
// time it fires a fifth. Two sigma is the threshold in the literature.
//
// It is a floor rather than a proof. Flashes within a storm arrive in bursts
// rather than independently, so the true variance runs above Poisson and this
// overstates significance; the absolute rate below is the second gate, and the
// pair of them is what the reading rests on rather than the sigma alone.
const JUMP_SIGMA = 2;
const MIN_JUMP_RATE = 10; // flashes/min: below this a surge is not a storm yet

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

// A bin's key, as a number rather than as `${cx},${cy}`.
//
// The window is minutes of a planet's lightning — tens of thousands of strikes
// — and it is rebuilt twice a second, and once per step of the replay's walk.
// A string key is an allocation per strike, so a cold scrub was over a million
// of them for an answer that is arithmetic.
//
// Unique because the row index is bounded: ±90° over CELL_DEG is ±225, well
// inside the 1024 the column is multiplied by, so no two bins can collide.
const binKey = (cx, cy) => cx * 1024 + cy;

/**
 * The clusters in a window of the strike history.
 *
 * `lo` and `hi` bound the window inside `strikes` rather than the caller
 * slicing it out: every caller already has the two indices from a binary
 * search, and the slice was a copy of tens of thousands of entries made to be
 * read once and dropped.
 */
export function detectStorms(strikes, now, windowMs, lo = 0, hi = strikes.length) {
  const cells = new Map();
  for (let i = lo; i < hi; i++) {
    const strike = strikes[i];
    if (now - strike.t > windowMs) continue;
    const cx = Math.floor(strike.lon / CELL_DEG);
    const cy = Math.floor(strike.lat / CELL_DEG);
    const key = binKey(cx, cy);
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
          const neighbour = binKey(current.cx + dx, current.cy + dy);
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

    // The rate rides along on the trail rather than in a history of its own:
    // it is sampled on the same cadence, over the same lifetime, and thrown
    // away with the same points.
    const sample = { lon: storm.tlon, lat: storm.tlat, t: now, r: storm.recent / RECENT_MIN };

    if (!match) {
      return {
        ...storm,
        id: nextId++,
        trail: [sample],
        vlon: 0,
        vlat: 0,
        baseline: 0,
        age: 0,
        t: now,
      };
    }

    claimed.add(match.id);

    // Subsampled: a point every TRAIL_STEP_MS is enough to fix a heading, and
    // keeps the trail small however long a cell lives.
    const trail = match.trail.filter((p) => now - p.t <= TRAIL_MS);
    const latest = trail[trail.length - 1];
    if (!latest || now - latest.t >= TRAIL_STEP_MS) trail.push(sample);

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
 * (a cluster merging or being matched to its neighbour) and are withheld
 * rather than displayed.
 *
 * Worked out once per cell and kept on it, here and in `surge`. A cell is a new
 * object on every pass of the tracker, so the answer cannot go stale; what it
 * stops is the render loop asking the same question of the same object sixty
 * times a second, and `surge` in particular is two filters and a regression
 * over a trail that has not moved since it was last asked.
 */
export function motion(storm) {
  if (storm.track === undefined) storm.track = trackOf(storm);
  return storm.track;
}

function trackOf(storm) {
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
 * How hard the cell is firing, and whether that is changing.
 *
 * `rate` is flashes per minute now. `trend` is the slope of that rate over the
 * last six minutes, in flashes per minute per minute. `sigma` is how far the
 * present three minutes sits above what the three before it predicted, in
 * Poisson standard deviations, and `jump` is that test passed alongside a rate
 * worth calling a storm.
 *
 * The two windows do not overlap. Each trail point's rate is itself a boxcar
 * over the three minutes ending at that point, so the baseline is taken from
 * points at least that far back: without that the cell would be compared
 * against a period containing most of the surge being tested for, and every
 * jump would be measured against itself and shrink.
 *
 * Null until the cell has been watched long enough for any of it to mean
 * something, on the same principle as `motion`. A cell younger than the rate
 * window has a rate still filling from zero, which climbs whatever the weather
 * is doing, and reading a jump off that would fire on every cell at birth.
 */
export function surge(storm) {
  if (storm.rate === undefined) storm.rate = surgeOf(storm);
  return storm.rate;
}

function surgeOf(storm) {
  const now = storm.t;
  // Points whose own window lies entirely within the cell's life, so the ramp
  // of a filling boxcar is never mistaken for a rising storm.
  const settled = storm.trail.filter(
    (p) => now - p.t <= RATE_FIT_MS && storm.age * 1000 - (now - p.t) >= RECENT_MS
  );
  if (settled.length < MIN_RATE_POINTS) return null;

  const before = settled.filter((p) => now - p.t >= RECENT_MS);
  if (before.length < MIN_BASELINE_POINTS) return null;

  const rate = storm.recent / RECENT_MIN;
  const expected = (before.reduce((sum, p) => sum + p.r, 0) / before.length) * RECENT_MIN;
  // A baseline of nothing still carries the noise of one flash. Without the
  // floor the test divides by zero in exactly the case where the rise is most
  // obvious: a cell that was silent and is now firing.
  const sigma = (storm.recent - expected) / Math.sqrt(Math.max(expected, 1));
  const trend = slope(settled, "r") * 60;

  return { rate, trend, sigma, jump: sigma >= JUMP_SIGMA && rate >= MIN_JUMP_RATE };
}

/**
 * Where the cell reaches in `seconds` if it holds its present course, measured
 * from the recent centroid rather than the windowed one: the forecast starts
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
