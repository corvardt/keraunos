// Checks the solar position against dates whose answers are known in advance.
//
// Nothing on screen would betray a wrong terminator: a smooth curve across the
// map looks equally plausible whether it is placed correctly or an hour and a
// hemisphere out. The astronomy is the only thing that can say, so it is
// checked against the solstices, the equinoxes, and the definition of noon.
//
//   node scripts/check-sun.cjs

const { pathToFileURL } = require("url");
const path = require("path");

const near = (actual, expected, tolerance, what) => {
  const ok = Math.abs(actual - expected) <= tolerance;
  console.log(
    `  ${ok ? "✓" : "✗"}  ${what.padEnd(46)} ${actual.toFixed(2).padStart(8)}  (expected ${expected}±${tolerance})`
  );
  return ok;
};

import(pathToFileURL(path.join(__dirname, "../src/lib/sun.js")).href).then(
  ({ subsolar, terminator }) => {
    let ok = true;
    const LIMIT = 74;

    // Declination is the earth's tilt at the solstices and zero at the equinoxes.
    console.log("declination");
    ok &= near(subsolar(new Date("2026-06-21T12:00:00Z")).decl, 23.44, 0.05, "june solstice");
    ok &= near(subsolar(new Date("2026-12-21T12:00:00Z")).decl, -23.44, 0.05, "december solstice");
    ok &= near(subsolar(new Date("2026-03-20T12:00:00Z")).decl, 0, 0.3, "march equinox");
    ok &= near(subsolar(new Date("2026-09-23T12:00:00Z")).decl, 0, 0.3, "september equinox");

    // Local noon is where the sun is overhead: 0° at 12:00Z, 90°E at 06:00Z.
    // This is what catches a sidereal-time error, which tilts nothing and
    // simply puts the whole day in the wrong place.
    console.log("\nsubsolar longitude (noon walks 15° west an hour)");
    for (const [hour, expected] of [[0, -180], [6, 90], [12, 0], [18, -90]]) {
      const lon = subsolar(new Date(Date.UTC(2026, 5, 21, hour))).lon;
      // ±180 is one place, not two.
      const off = Math.min(Math.abs(lon - expected), 360 - Math.abs(lon - expected));
      ok &= near(off, 0, 1, `${String(hour).padStart(2, "0")}:00Z → ${expected}°`);
    }

    // At a solstice the terminator is tangent to the polar circles, which is
    // what those circles are defined as.
    console.log("\nterminator");
    const june = terminator(new Date("2026-06-21T12:00:00Z"), LIMIT);
    const lats = june.points.map((p) => p[1]);
    ok &= near(Math.max(...lats), 66.56, 0.2, "june reaches the arctic circle");
    ok &= near(Math.min(...lats), -66.56, 0.2, "june reaches the antarctic circle");
    ok &= near(june.nightEdge, -LIMIT, 0, "june night lies south");
    ok &= near(
      terminator(new Date("2026-12-21T12:00:00Z"), LIMIT).nightEdge,
      LIMIT,
      0,
      "december night lies north"
    );

    // The equinox is the degenerate case: tan δ passes through zero and the
    // curve runs to the poles. It must clamp, not produce NaN.
    const equinox = terminator(new Date("2026-03-20T12:00:00Z"), LIMIT);
    const finite = [...june.points, ...equinox.points].every(
      (p) => isFinite(p[0]) && isFinite(p[1])
    );
    console.log(`  ${finite ? "✓" : "✗"}  equinox stays finite (clamps to the poles)`);
    ok &= finite;

    const spread = new Set(equinox.points.map((p) => Math.round(p[1])));
    const hugs = [...spread].every((lat) => Math.abs(lat) >= LIMIT - 3);
    console.log(`  ${hugs ? "✓" : "✗"}  equinox terminator runs pole to pole`);
    ok &= hugs;

    console.log(ok ? "\nsun: ok" : "\nsun: FAILED");
    process.exit(ok ? 0 : 1);
  }
);
