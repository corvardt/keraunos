// Drives the clustering and tracking with a cell whose motion is known, and
// checks that the reported ground track is the one it was given.
//
// The speed a cell is labelled with is the one number on the map that cannot
// be eyeballed: a wrong figure looks exactly like a right one. It is also
// derived through a long chain — bin, flood fill, recent centroid, trail,
// least-squares slope — where a sign or a unit can invert quietly. So it is
// measured against a synthetic storm instead.
//
//   node scripts/check-storms.cjs

const { pathToFileURL } = require("url");
const path = require("path");

const KM_PER_DEG = 111.32;
const WINDOW_MS = 12 * 60 * 1000; // must match STORM_WINDOW_MS in App.jsx
const STEP_MS = 2000; // and STORM_EVERY_MS

// Deterministic, so a failure is reproducible rather than a coin toss.
let seed = 20260724;
const random = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

import(pathToFileURL(path.join(__dirname, "../src/lib/storms.js")).href).then(
  ({ detectStorms, trackStorms, motion, forecast }) => {
    /** Runs a cell across the sky at a known speed and bearing. */
    function fly({ kmh, bearing, lat0, lon0, minutes }) {
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
        for (let i = 0; i < 40; i++) {
          strikes.push({
            lon: lon + (random() - 0.5) * 0.5,
            lat: lat + (random() - 0.5) * 0.5,
            t: now,
          });
        }
        strikes = strikes.filter((s) => now - s.t <= WINDOW_MS);
        tracked = trackStorms(tracked, detectStorms(strikes, now, WINDOW_MS), now);
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

      // The forecast must be the course, extended — not a second opinion.
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

    console.log(ok ? "\nstorms: ok" : "\nstorms: FAILED");
    process.exit(ok ? 0 : 1);
  }
);
