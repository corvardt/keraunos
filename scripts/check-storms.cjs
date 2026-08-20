// Drives the clustering and tracking with a cell whose motion is known, and
// checks that the reported ground track is the one it was given.
//
// The speed a cell is labelled with is the one number on the map that cannot
// be eyeballed: a wrong figure looks exactly like a right one. It is also
// derived through a long chain (bin, flood fill, recent centroid, trail,
// least-squares slope) where a sign or a unit can invert quietly. So it is
// measured against a synthetic storm instead.
//
//   node scripts/check-storms.cjs

const { pathToFileURL } = require("url");
const path = require("path");

const KM_PER_DEG = 111.32;
const WINDOW_MS = 12 * 60 * 1000; // must match STORM_WINDOW_MS in App.jsx
const STEP_MS = 2000; // and STORM_EVERY_MS
const JUMP_SIGMA = 2; // and the threshold in storms.js

// Deterministic, so a failure is reproducible rather than a coin toss.
let seed = 20260724;
const random = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

import(pathToFileURL(path.join(__dirname, "../src/lib/storms.js")).href).then(
  ({ detectStorms, trackStorms, motion, forecast, surge }) => {
    /**
     * Runs a cell across the sky at a known speed and bearing.
     *
     * `perStep` sets how many strikes it fires each pass, as a function of the
     * minutes it has been alive, so a cell can be given a rate history as well
     * as a course. `watch` sees every pass rather than only the last, which is
     * what a jump has to be caught in.
     */
    function fly({ kmh, bearing, lat0, lon0, minutes, perStep = () => 40, watch }) {
      const rad = (bearing * Math.PI) / 180;
      const north = (Math.cos(rad) * kmh) / 3600 / KM_PER_DEG;
      const east =
        (Math.sin(rad) * kmh) / 3600 / (KM_PER_DEG * Math.cos((lat0 * Math.PI) / 180));

      const t0 = Date.UTC(2026, 6, 24, 12);
      let strikes = [];
      let tracked = [];

      for (let step = 0; step * STEP_MS <= minutes * 60000; step++) {
        const now = t0 + step * STEP_MS;
        const seconds = (now - t0) / 1000;
        const lon = lon0 + east * seconds;
        const lat = lat0 + north * seconds;
        // A blob of strikes around the moving centre, dense enough to clear
        // MIN_STORM_STRIKES and scattered enough to be a real cluster.
        for (let i = 0; i < perStep(seconds / 60); i++) {
          strikes.push({
            lon: lon + (random() - 0.5) * 0.5,
            lat: lat + (random() - 0.5) * 0.5,
            t: now,
          });
        }
        strikes = strikes.filter((s) => now - s.t <= WINDOW_MS);
        tracked = trackStorms(tracked, detectStorms(strikes, now, WINDOW_MS), now);
        watch?.(tracked, seconds / 60);
      }
      return tracked;
    }

    let ok = true;
    const check = (pass, what, detail) => {
      console.log(`  ${pass ? "✓" : "✗"}  ${what}${detail ? `  ${detail}` : ""}`);
      ok &= pass;
    };

    console.log("tracking a cell of known course");
    for (const [kmh, bearing, lat0] of [
      [50, 90, 45],
      [30, 0, -20],
      [80, 225, 30],
    ]) {
      const tracked = fly({ kmh, bearing, lat0, lon0: 10, minutes: 25 });
      check(tracked.length === 1, `${kmh}km/h @${bearing}° lat${lat0}: one cell`, `(${tracked.length})`);
      const track = motion(tracked[0]);
      if (!track) {
        check(false, "  reports a course after 25 minutes", "(null)");
        continue;
      }
      // The recent-centroid lag biases the reading low while the trail fills,
      // so the tolerance is one-sided in practice; 12% covers it.
      check(
        Math.abs(track.kmh - kmh) / kmh < 0.12,
        `  speed within 12%`,
        `read ${track.kmh.toFixed(1)} of ${kmh}`
      );
      const off = Math.min(
        Math.abs(track.bearing - bearing),
        360 - Math.abs(track.bearing - bearing)
      );
      check(off < 6, `  bearing within 6°`, `read ${track.bearing.toFixed(1)} of ${bearing}`);

      // The forecast must be the course, extended, not a second opinion.
      const ahead = forecast(tracked[0], 1800);
      const moved =
        Math.hypot(
          (ahead[0] - tracked[0].tlon) * Math.cos((lat0 * Math.PI) / 180),
          ahead[1] - tracked[0].tlat
        ) * KM_PER_DEG;
      check(
        Math.abs(moved - track.kmh / 2) < 1,
        `  30min forecast advances by half an hour of travel`,
        `${moved.toFixed(1)}km vs ${(track.kmh / 2).toFixed(1)}km`
      );
    }

    // Speeds outside weather's range are tracking errors and must be withheld
    // rather than drawn. A cell at 500km/h is a cluster being mismatched.
    console.log("\nrefusing what it cannot mean");
    const silly = fly({ kmh: 900, bearing: 90, lat0: 45, lon0: 10, minutes: 25 });
    check(
      silly.every((storm) => motion(storm) === null),
      "900km/h is withheld, not displayed"
    );
    const crawl = fly({ kmh: 2, bearing: 90, lat0: 45, lon0: 10, minutes: 25 });
    check(
      crawl.every((storm) => motion(storm) === null),
      "2km/h is drift, not a track"
    );

    // A course is never stated before there is a baseline to state it from.
    console.log("\nwaiting for a baseline");
    const young = fly({ kmh: 50, bearing: 90, lat0: 45, lon0: 10, minutes: 7 });
    check(
      young.every((storm) => motion(storm) === null),
      "no speed offered at 7 minutes"
    );

    // The rate reading. A jump is an alarm, so the cost of a false one is
    // higher than the cost of a late one, and the steady cases below are the
    // half of this worth testing hardest: a cell that fires at a constant rate
    // from birth must never once report a surge, however long it is watched.
    console.log("\nreading the flash rate");

    // 30/min, unchanging. The birth ramp is the trap: for its first three
    // minutes the cell's own rate window is still filling, so a reading taken
    // without the age gate climbs from zero to 30 and looks exactly like a
    // storm winding up.
    let jumped = 0;
    let steadyRate = null;
    fly({
      kmh: 50,
      bearing: 90,
      lat0: 45,
      lon0: 10,
      minutes: 25,
      perStep: () => 1,
      watch: (tracked) => {
        const reading = tracked[0] && surge(tracked[0]);
        if (!reading) return;
        if (reading.jump) jumped++;
        steadyRate = reading;
      },
    });
    check(jumped === 0, "a steady cell never jumps, across 25 minutes", `(${jumped} times)`);
    check(
      steadyRate && Math.abs(steadyRate.rate - 30) < 3,
      "  reads 30/min",
      `(${steadyRate ? steadyRate.rate.toFixed(1) : "null"})`
    );
    check(
      steadyRate && Math.abs(steadyRate.trend) < 1.5,
      "  reports a flat trend",
      `(${steadyRate ? steadyRate.trend.toFixed(2) : "null"}/min per min)`
    );

    // Ten quiet minutes and then four times the rate, which is what an
    // intensifying updraught looks like from here.
    let firstJumpAt = null;
    let earlyJump = false;
    fly({
      kmh: 50,
      bearing: 90,
      lat0: 45,
      lon0: 10,
      minutes: 25,
      perStep: (minutes) => (minutes < 10 ? 1 : 4),
      watch: (tracked, minutes) => {
        const reading = tracked[0] && surge(tracked[0]);
        if (!reading?.jump) return;
        if (minutes < 10) earlyJump = true;
        if (firstJumpAt === null) firstJumpAt = minutes;
      },
    });
    check(!earlyJump, "no jump reported before the cell steps up");
    check(firstJumpAt !== null, "the step up is caught", `at ${firstJumpAt?.toFixed(1)} min`);
    // The rate window is a three-minute boxcar, so a step change arrives as a
    // ramp and cannot be seen in full before it has passed through. Caught
    // inside that window is as early as this measurement can honestly be.
    check(
      firstJumpAt !== null && firstJumpAt - 10 <= 3,
      "  within the rate window of the step",
      `${(firstJumpAt - 10).toFixed(1)} min after`
    );

    // A cell falling apart is the same arithmetic with the sign turned over,
    // and must read as such rather than as an absence of anything. Measured
    // across the collapse rather than at the end of the run: the baseline is
    // the cell's own recent past, so fifteen minutes later a quiet cell has
    // become its own normal again and reads flat, correctly.
    let lowest = Infinity;
    let falling = Infinity;
    let decayJumped = 0;
    fly({
      kmh: 50,
      bearing: 90,
      lat0: 45,
      lon0: 10,
      minutes: 25,
      perStep: (minutes) => (minutes < 10 ? 4 : 1),
      watch: (tracked) => {
        const reading = tracked[0] && surge(tracked[0]);
        if (!reading) return;
        if (reading.jump) decayJumped++;
        lowest = Math.min(lowest, reading.sigma);
        falling = Math.min(falling, reading.trend);
      },
    });
    check(decayJumped === 0, "a collapsing cell never reads as a jump", `(${decayJumped} times)`);
    check(lowest < -JUMP_SIGMA, "  falls below its own baseline", `(${lowest.toFixed(1)} sigma)`);
    check(falling < -5, "  reports a falling trend", `(${falling.toFixed(1)}/min per min)`);

    console.log(ok ? "\nstorms: ok" : "\nstorms: FAILED");
    process.exit(ok ? 0 : 1);
  }
);
