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
const COVER = 0.9; // share of a cluster's strikes the drawn ring encloses
const MATCH_DEG = 1.2; // how far a cell may move between passes and stay itself
const KM_PER_DEG = 111.32;

const TRAIL_MS = 3600000; // centroid history retained per cell, for drawing (60 min)
const TRAIL_STEP_MS = 20000; // how often a centroid is recorded
const MIN_KMH = 8; // below this a cell is drifting, not tracking
const MAX_KMH = 140; // above this it is a tracking error, not weather

// Where the cell is going, and why it is not read off the centroid.
//
// The heading used to be the least-squares slope of the cluster's centroid
// against time. That is the obvious reading and it does not work, which took a
// recorded hour to see: scored against where the cells actually went, the
// centroid fit was worse than assuming they did not move at all. Placing a
// cell's ring fifteen minutes ahead by its own reported velocity put it 20.6 km
// from the cell; leaving the ring where it was put it 16.0 km away.
//
// The reason is that a cluster's centroid is a mean over strikes, so it tracks
// where the cluster is *firing*, and inside a storm the firing migrates from
// flank to flank faster than the storm translates. One recorded complex over
// western New York tracked southeast for an hour while its heading read
// northwest, because a flank on the west side had lit up and taken the mean
// with it. This is not noise and no amount of averaging removes it: the slope
// was strongly significant, and gating on its own standard error kept the wrong
// arrows (at four sigma the moved ring still lost, 52% against 59%).
//
// So the motion is measured the way radar measures it, by alignment rather than
// by mass. The cell's strikes are splatted onto a small grid at two times and
// the offset that best lines the later field up with the earlier one is the
// displacement. A migrating flank changes what the field weighs; it does not
// move the pattern, so the correlation stays where the storm is. Same recording,
// same scoring: 11.4 km against the field's own measured drift, against 16.0 km
// for leaving the ring alone, so this is the first version of the reading that
// beats standing still.
//
// The lag is the whole sensitivity. A cell 100 km across moving 60 km/h covers
// 15 km in fifteen minutes, a seventh of its own width, and shorter lags do not
// resolve it: at five minutes the gain over persistence was 15.2 to 14.2 km,
// at fifteen it is 16.0 to 11.4, and it keeps improving out to twenty-five.
// Fifteen buys most of it while still giving a cell a heading inside half an
// hour of being found.
const XCORR_LAG_MS = 900000; // time between the two fields compared
const XCORR_HALF_MS = 450000; // strikes gathered into each field
const XCORR_GRID = 0.15; // degrees per grid cell
const XCORR_BLUR = 1.2; // grid cells: the gaussian each strike is laid down with
const XCORR_SPLAT = 2; // how far that gaussian is carried before it is dropped
// A dense complex fires thousands of times in seven minutes and the shape of
// its field is settled long before that, so the field is built from a stride
// through the strikes rather than all of them. This is the only figure here
// chosen for cost rather than for accuracy, and it did not cost accuracy.
const XCORR_CAP = 800;
const XCORR_MIN_CELLS = 40; // occupied grid cells before a field can be matched
// The peak of a normalised correlation is a cosine, so this is a real
// threshold and not a tuned one: below it the two fields are not the same
// storm, which is what a cell that has split, merged or died looks like.
const XCORR_MIN_CORR = 0.5;
// A fresh reading is one measurement of a noisy thing. Held against the last
// one it is worth about half a kilometre of the fifteen-minute error, which is
// small but free.
const XCORR_EMA = 0.3;
// The field is matched on its shape, not on its brightest patch.
//
// A gaussian laid down per strike makes a grid cell's weight proportional to
// the local strike density, and a correlation is a dot product, so without this
// a compact core fires far above the rest of the storm and the alignment
// follows the core: exactly the failure the centroid had, arrived at by a
// different route. Measured on a synthetic cell holding still while a dense
// core swept a hundred kilometres across it, the raw field read 122 km/h and
// the square root reads 47. It costs nothing on the recordings, which is the
// other half of the case for it: 13.2 km against 13.3, and 6.4 against 6.9.
const XCORR_POWER = 0.5;
const XCORR_MASK = 1.3; // radii of the cell whose strikes take part

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

// The first strike at or after `t`. The history is appended in arrival order,
// so the field windows are a range rather than a scan.
function lowerBound(strikes, t) {
  let lo = 0;
  let hi = strikes.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (strikes[mid].t < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * The cell's strikes between two times, as a grid of weights.
 *
 * Laid down with a gaussian rather than counted into buckets: a strike falling
 * a millimetre either side of a boundary would otherwise move a whole cell's
 * worth of weight, and the correlation below is read to a fraction of a cell,
 * which needs a surface with no steps in it. Offsets are from the cell's own
 * centre, so the two fields being compared share an origin.
 */
function fieldOf(strikes, from, to, lon, lat, mask) {
  const start = lowerBound(strikes, from);
  const end = lowerBound(strikes, to);
  const stride = Math.max(1, Math.ceil((end - start) / XCORR_CAP));
  const field = new Map();
  for (let i = start; i < end; i += stride) {
    const strike = strikes[i];
    if (Math.hypot(strike.lon - lon, strike.lat - lat) > mask) continue;
    const gx = (strike.lon - lon) / XCORR_GRID;
    const gy = (strike.lat - lat) / XCORR_GRID;
    const cx = Math.round(gx);
    const cy = Math.round(gy);
    for (let dx = -XCORR_SPLAT; dx <= XCORR_SPLAT; dx++) {
      for (let dy = -XCORR_SPLAT; dy <= XCORR_SPLAT; dy++) {
        const x = cx + dx;
        const y = cy + dy;
        const w = Math.exp(-((x - gx) ** 2 + (y - gy) ** 2) / (2 * XCORR_BLUR * XCORR_BLUR));
        if (w < 0.02) continue;
        const key = binKey(x, y);
        field.set(key, (field.get(key) || 0) + w);
      }
    }
  }
  for (const [key, w] of field) field.set(key, w ** XCORR_POWER);
  return field;
}

function magnitude(field) {
  let sum = 0;
  for (const w of field.values()) sum += w * w;
  return Math.sqrt(sum);
}

// The cosine between the later field and the earlier one slid by (sx, sy).
// Normalised against only the part of the earlier field that is overlapped, so
// a shift is not rewarded for covering more of it.
function align(later, earlier, energy, sx, sy) {
  let dot = 0;
  let seen = 0;
  for (const [key, w] of later) {
    const x = Math.floor(key / 1024);
    const y = key - x * 1024;
    const previous = earlier.get(binKey(x - sx, y - sy));
    if (previous) {
      dot += w * previous;
      seen += previous * previous;
    }
  }
  return seen > 0 ? dot / (energy * Math.sqrt(seen)) : 0;
}

/**
 * The offset, in grid cells, that best lines the two fields up.
 *
 * Searched no further than weather can travel in the lag, and refined below a
 * whole cell by fitting a parabola to the peak and its two neighbours on each
 * axis: at this grid a cell is 17 km, and a storm covers a fraction of that
 * between the two fields, so an answer rounded to the grid would be mostly
 * quantisation.
 */
function bestShift(later, earlier, span) {
  const energy = magnitude(later);
  if (!energy) return null;
  const scores = new Map();
  let best = 0;
  let bx = 0;
  let by = 0;
  for (let sx = -span; sx <= span; sx++) {
    for (let sy = -span; sy <= span; sy++) {
      if (Math.hypot(sx, sy) > span) continue;
      const score = align(later, earlier, energy, sx, sy);
      scores.set(binKey(sx, sy), score);
      if (score > best) {
        best = score;
        bx = sx;
        by = sy;
      }
    }
  }
  if (best < XCORR_MIN_CORR) return null;
  const at = (x, y) => scores.get(binKey(x, y)) ?? 0;
  const refine = (low, high) => {
    const curve = low - 2 * best + high;
    if (Math.abs(curve) < 1e-9) return 0;
    return Math.max(-0.5, Math.min(0.5, (0.5 * (low - high)) / curve));
  };
  return {
    x: bx + refine(at(bx - 1, by), at(bx + 1, by)),
    y: by + refine(at(bx, by - 1), at(bx, by + 1)),
  };
}

/**
 * Measures how each cell is moving, from the strikes themselves.
 *
 * Called by whoever holds the history, once per pass, after `trackStorms`: the
 * cells carry identity across passes and this reads the raw strike record
 * behind them, which is a longer window than the one they were detected in.
 * Cells younger than the lag are left unmeasured rather than matched against a
 * stretch of sky they were not in yet.
 */
export function measureMotion(storms, strikes, now) {
  const span = Math.ceil(((MAX_KMH / 3600) * (XCORR_LAG_MS / 1000)) / KM_PER_DEG / XCORR_GRID);
  for (const storm of storms) {
    if (storm.age * 1000 < XCORR_LAG_MS) continue;
    // The fields are minutes wide and the callers ask twice a second. Taken at
    // the cadence the trail is sampled on, which is as often as the answer can
    // have changed.
    if (storm.measured && now - storm.measuredAt < TRAIL_STEP_MS) continue;
    const mask = storm.radius * XCORR_MASK;
    const earlier = fieldOf(
      strikes,
      now - XCORR_LAG_MS - XCORR_HALF_MS,
      now - XCORR_LAG_MS,
      storm.tlon,
      storm.tlat,
      mask
    );
    if (earlier.size < XCORR_MIN_CELLS) continue;
    const later = fieldOf(strikes, now - XCORR_HALF_MS, now, storm.tlon, storm.tlat, mask);
    if (later.size < XCORR_MIN_CELLS) continue;

    const shift = bestShift(later, earlier, span);
    if (!shift) continue;

    const seconds = XCORR_LAG_MS / 1000;
    const vlon = (shift.x * XCORR_GRID) / seconds;
    const vlat = (shift.y * XCORR_GRID) / seconds;
    storm.vlon = storm.measured ? storm.vlon + XCORR_EMA * (vlon - storm.vlon) : vlon;
    storm.vlat = storm.measured ? storm.vlat + XCORR_EMA * (vlat - storm.vlat) : vlat;
    storm.measured = true;
    storm.measuredAt = now;
    // The reading `motion` memoised was taken before this pass had one.
    storm.track = undefined;
  }
  return storms;
}

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
    // The ring holds the bulk of the cell, not its furthest bin. Drawn to the
    // outermost bin it was a ring around a two-strike straggler forty-five
    // kilometres off the storm: measured over two recorded hours, ninety per
    // cent of a cell's strikes sat inside eighty per cent of that radius, so
    // the ring was enclosing a third more area than the cell occupied, and for
    // the worst tenth two thirds. Bins are taken nearest first until they carry
    // COVER of the strikes, which is the same density argument the centroid
    // already makes by being a mean over strikes rather than over bins.
    const ranked = group
      .map((cell) => ({
        n: cell.n,
        d: Math.hypot((cell.cx + 0.5) * CELL_DEG - lon, (cell.cy + 0.5) * CELL_DEG - lat),
      }))
      .sort((a, b) => a.d - b.d);
    let radius = CELL_DEG;
    let held = 0;
    for (const cell of ranked) {
      radius = Math.max(radius, cell.d + CELL_DEG * 0.5);
      held += cell.n;
      if (held >= count * COVER) break;
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
        measured: false,
        measuredAt: 0,
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

    // The velocity is not read off this trail: it is measured from the strikes
    // by `measureMotion`, and carried across the match so a fresh reading has
    // something to be held against.
    const dt = (now - match.t) / 1000;
    return {
      ...storm,
      id: match.id,
      trail,
      vlon: match.vlon,
      vlat: match.vlat,
      measured: match.measured,
      measuredAt: match.measuredAt,
      age: match.age + dt,
      t: now,
    };
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
  if (!storm.measured) return null;
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
 * Gated on `motion` deliberately: a cell whose field would not align well
 * enough to state a speed is one whose course cannot be extrapolated either,
 * and drawing it anyway would put a confident line on the map that the readout
 * beside it declines to back.
 */
export function forecast(storm, seconds) {
  if (!motion(storm)) return null;
  return [storm.tlon + storm.vlon * seconds, storm.tlat + storm.vlat * seconds];
}
