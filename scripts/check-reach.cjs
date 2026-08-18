// Drives the reach accumulator with paths whose answers are known in advance,
// and checks that what comes back is the geometry that went in.
//
// This is the one reading in the instrument that is a claim about physics
// rather than a report of a number, and it can be wrong quietly: a sign error
// in the solar elevation swaps the two bins, and the result is a perfectly
// plausible pair of curves saying the opposite of the truth. Nobody would catch
// that by looking at it — the shapes are the shapes either way — so it is
// checked here instead.
//
//   node scripts/check-reach.cjs

const { pathToFileURL } = require("url");
const path = require("path");

const lib = (name) => pathToFileURL(path.join(__dirname, "../src/lib", name)).href;

Promise.all([import(lib("reach.js")), import(lib("stations.js")), import(lib("sun.js"))]).then(
  ([{ createReach, midpoint, STEP_KM }, { record }, { subsolar }]) => {
    let ok = true;
    const check = (pass, what, detail) => {
      console.log(`  ${pass ? "✓" : "✗"}  ${what}${detail ? `  ${detail}` : ""}`);
      ok &= pass;
    };

    // ── The half-way point ──────────────────────────────────────────────────
    //
    // Averaging the coordinates is the obvious way to do this and is wrong in
    // exactly the cases a global network produces, so both of them are here.
    console.log("finding the middle of a path");
    const equator = midpoint(0, 0, 90, 0);
    check(
      Math.abs(equator.lon - 45) < 0.01 && Math.abs(equator.lat) < 0.01,
      "along the equator it is the average",
      `(${equator.lon.toFixed(2)}, ${equator.lat.toFixed(2)})`
    );
    // Tokyo to Anchorage. Averaging the two longitudes gives −5°, which is off
    // west Africa: the wrong ocean, the wrong hemisphere, and the far side of
    // the planet from either end of the path. The great circle runs up over the
    // north Pacific and its middle is out near Kamchatka.
    const pacific = midpoint(139.7, 35.7, -149.9, 61.2);
    check(
      pacific.lon > 140,
      "a Pacific path runs over the Pacific, not over the average of its ends",
      `(${pacific.lon.toFixed(1)}, ${pacific.lat.toFixed(1)})`
    );
    check(pacific.lat > 35.7, "and rides north of both ends, as a great circle does", `(${pacific.lat.toFixed(1)}°)`);
    // Either side of the antimeridian, where a plain average lands in the
    // wrong hemisphere entirely.
    const dateline = midpoint(179, 0, -179, 0);
    check(
      Math.abs(Math.abs(dateline.lon) - 180) < 0.01,
      "and a path straddling the antimeridian stays on it",
      `(${dateline.lon.toFixed(2)})`
    );

    // ── Which side of the terminator ────────────────────────────────────────
    //
    // Built around the actual subsolar point at a fixed instant, so the test is
    // about the binning rather than about a hard-coded almanac.
    console.log("\nsorting paths by what was over them");
    const noon = Date.UTC(2026, 5, 21, 12, 0); // northern solstice, midday UTC
    const sun = subsolar(new Date(noon));

    // One station under the sun and one on the far side of the planet, with a
    // strike a short way from each: a path that short cannot cross out of the
    // hemisphere its ends are in.
    record([
      { sta: 1, lon: sun.lon, lat: sun.decl },
      { sta: 2, lon: ((sun.lon + 360) % 360) - 180, lat: -sun.decl },
    ]);

    const sorted = createReach();
    sorted.record(sun.lon + 4, sun.decl, [1], noon);
    sorted.record(((sun.lon + 360) % 360) - 184, -sun.decl, [2], noon);
    const split = sorted.read();
    check(split.day.n === 1, "the path under the subsolar point is filed as day", `(${split.day.n})`);
    check(split.night.n === 1, "the path opposite it is filed as night", `(${split.night.n})`);

    // The D region is lit from below the ground horizon, so the two terminators
    // do not coincide: a path whose middle sits a few degrees past sunset is
    // still under a sunlit ceiling. The bin has to follow the higher one.
    console.log("\nputting the terminator where the ionosphere is");
    const dusk = createReach();
    // Ninety-four degrees of longitude from the subsolar meridian, on the
    // equinox-like line through the subsolar latitude: past the ground
    // terminator at 90°, inside the D region's at ~98°.
    const past = sun.lon + 94;
    record([{ sta: 3, lon: past, lat: sun.decl }]);
    dusk.record(past + 3, sun.decl, [3], noon);
    const twilight = dusk.read();
    check(
      twilight.day.n === 1 && twilight.night.n === 0,
      "just past sunset on the ground is still daylight at 70 km",
      `(day ${twilight.day.n}, night ${twilight.night.n})`
    );

    // ── The figures read off the histogram ──────────────────────────────────
    console.log("\nreading the distributions");
    // A session in which night paths carry half again as far as day paths, and
    // nothing else differs. Both ends of every path are placed near their own
    // pole of illumination so the binning is unambiguous, and the distance is
    // set by how far the station is put from the strike.
    const session = createReach();
    const KM_PER_DEG = 111.32;
    for (let i = 0; i < 600; i++) {
      // Day: 1,000 to 3,000 km. Night: 1,500 to 4,500.
      const dayKm = 1000 + (i % 100) * 20;
      const nightKm = dayKm * 1.5;
      const dayId = 100 + i;
      const nightId = 1000 + i;
      // Laid out along the subsolar parallel and its opposite, so the whole
      // path stays on the side of the terminator it started on.
      record([
        { sta: dayId, lon: sun.lon + dayKm / KM_PER_DEG, lat: 0 },
        { sta: nightId, lon: sun.lon + 180 + nightKm / KM_PER_DEG, lat: 0 },
      ]);
      session.record(sun.lon, 0, [dayId], noon);
      session.record(sun.lon + 180, 0, [nightId], noon);
    }
    const read = session.read();
    check(read.day.n === 600 && read.night.n === 600, "every strike landed in one bin or the other", `(${read.day.n} / ${read.night.n})`);
    check(read.day.ready && read.night.ready, "both distributions report themselves ready");
    // The day distribution is uniform over 1,000–2,980 km, so its median is
    // near the middle of that; the night one is the same times 1.5.
    check(
      Math.abs(read.day.median - 1990) <= STEP_KM,
      "the day median is the middle of the day distribution",
      `(${Math.round(read.day.median)} km)`
    );
    check(
      Math.abs(read.night.median - 2985) <= STEP_KM,
      "the night median is the middle of the night one",
      `(${Math.round(read.night.median)} km)`
    );
    check(read.night.median > read.day.median, "and night reads further than day, which is the whole reading");
    check(
      read.night.tail > read.night.median && read.day.tail > read.day.median,
      "the tail sits beyond the median on both",
      `(${Math.round(read.day.tail)} / ${Math.round(read.night.tail)} km)`
    );
    check(
      read.span * STEP_KM >= 4470 && read.span * STEP_KM <= 4470 + 2 * STEP_KM,
      "the axis ends at the farthest thing heard",
      `(${read.span * STEP_KM} km)`
    );

    // ── What is not a reach ─────────────────────────────────────────────────
    console.log("\nrefusing what it cannot measure");
    const empty = createReach();
    empty.record(0, 0, [], noon);
    empty.record(0, 0, undefined, noon);
    empty.record(0, 0, [999999], noon); // ids the registry has never seen
    const nothing = empty.read();
    check(
      nothing.day.n === 0 && nothing.night.n === 0,
      "a strike with no locatable stations is dropped rather than counted at zero"
    );
    check(nothing.day.median === null, "and a distribution too thin to read says so");

    console.log(ok ? "\nreach holds up." : "\nreach does not hold up.");
    process.exit(ok ? 0 : 1);
  }
);
