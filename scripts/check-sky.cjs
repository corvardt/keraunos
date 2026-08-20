// Checks the sky behind the globe against astronomy computed a different way.
//
// Nothing on screen would betray a wrong sky. A field of points around a planet
// looks equally plausible whether the stars are where they are or mirrored,
// rotated, or drifting at some fraction of the truth — which is exactly what
// the sky used to do, and the reason it was rewritten. So the claims are made
// here instead, where they can fail:
//
//   the catalogue decodes to the stars it was packed from
//   a star overhead the camera is behind the camera
//   a star behind the planet's centre lands at the centre of the glass
//   every star lands where spherical trigonometry independently puts it
//   the field turns with the camera one for one, with no drift constant
//   the earth's limb is where this lens says a ball that size is
//   pushing the world away moves the planet and not the sky
//   an hour of clock turns the sky by an hour of sidereal time
//
// The projection in stars.js is vector algebra in the camera's own basis; the
// expectations below are the cosine rule and a position angle, which is the
// route a nautical almanac would take. Agreeing to a pixel is worth something.
//
//   node scripts/check-sky.cjs

const { pathToFileURL } = require("url");
const path = require("path");

const RAD = Math.PI / 180;
const load = (file) => import(pathToFileURL(path.join(__dirname, "../src/lib", file)).href);

let ok = true;
const report = (pass, what, detail = "") => {
  ok &&= pass;
  console.log(`  ${pass ? "✓" : "✗"}  ${what.padEnd(50)} ${detail}`);
};
const near = (actual, expected, tolerance, what) =>
  report(
    Math.abs(actual - expected) <= tolerance,
    what,
    `${actual.toFixed(3).padStart(10)}  (expected ${expected}±${tolerance})`
  );

// A canvas that keeps the marks instead of drawing them.
const recorder = () => {
  const marks = [];
  return {
    marks,
    globalAlpha: 1,
    fillStyle: "",
    save() {},
    restore() {},
    setTransform() {},
    fillRect(x, y, w, h) {
      marks.push({ x: x + w / 2, y: y + h / 2, alpha: this.globalAlpha, size: w });
    },
  };
};

// The nearest mark to a point, and how far off it is.
const nearest = (marks, x, y) =>
  marks.reduce(
    (best, m) => {
      const d = Math.hypot(m.x - x, m.y - y);
      return d < best.d ? { ...m, d } : best;
    },
    { d: Infinity }
  );

(async () => {
  const { catalogue, SKY_COUNT } = await load("bsc.js");
  const { paintStars } = await load("stars.js");
  const { gmst } = await load("sun.js");
  const { globeRadius } = await load("globe.js");

  // ── The catalogue ────────────────────────────────────────────────────────
  //
  // Five stars anybody can check, at J2000, from any almanac. Between them they
  // cover both hemispheres, the pole, and the bright end of the packing.
  console.log("catalogue");
  const { ra, dec, mag } = catalogue();
  report(ra.length === SKY_COUNT, "decodes to the packed count", `${SKY_COUNT}`);

  const find = (expectRa, expectDec) => {
    let best = -1;
    let bestD = Infinity;
    for (let i = 0; i < SKY_COUNT; i++) {
      const d = Math.hypot(ra[i] - expectRa, dec[i] - expectDec);
      if (d < bestD) [bestD, best] = [d, i];
    }
    return { i: best, off: bestD };
  };

  for (const [name, expectRa, expectDec, expectMag] of [
    ["Sirius", 101.287, -16.716, -1.46],
    ["Canopus", 95.988, -52.696, -0.72],
    ["Betelgeuse", 88.793, 7.407, 0.5],
    ["Polaris", 37.955, 89.264, 2.02],
    ["Vega", 279.234, 38.784, 0.03],
  ]) {
    const { i, off } = find(expectRa, expectDec);
    report(
      off < 0.01 && Math.abs(mag[i] - expectMag) < 0.03,
      `${name} at its almanac position and magnitude`,
      `${off.toFixed(4)}° off, mag ${mag[i].toFixed(2)}`
    );
  }

  // ── The camera ───────────────────────────────────────────────────────────

  const WIDTH = 1200;
  const HEIGHT = 800;
  const DPR = 1;
  const FULL = globeRadius(WIDTH, HEIGHT);
  const AT = Date.UTC(2026, 2, 14, 3, 27, 11);

  // Repeated here rather than imported, because a constant imported from the
  // thing under test cannot disagree with it.
  const ALTITUDE = 6.6107;
  const FOCAL = FULL * Math.sqrt(ALTITUDE * ALTITUDE - 1);

  const paint = (lon, lat, k = 1, at = AT) => {
    const ctx = recorder();
    paintStars(
      ctx,
      { x: WIDTH / 2, y: HEIGHT / 2, r: FULL * k, lon, lat },
      { colour: "#fff", alpha: 1, dpr: DPR, width: WIDTH, height: HEIGHT, now: 0, at }
    );
    return ctx.marks;
  };

  // Where the camera is pointed, in the sky's own terms: through the earth,
  // from the point the globe is centred on.
  const axis = (lon, lat, at = AT) => ({
    ra: (lon + gmst(new Date(at)) * 15 + 180) % 360,
    dec: -lat,
  });

  // Where a star should land, by the other route: angular distance from the
  // axis by the cosine rule, direction by position angle from north through
  // east, and the lens turning the one into a radius on the glass.
  //
  // The minus on the sine is the whole handedness question in one character.
  // Screen east is to the right on the ground below, and therefore to the left
  // in the sky beyond it — the camera looks down at the earth from outside and
  // out at the stars from inside, and a chart of each is mirrored against the
  // other. Getting this backwards is the one error that still looks like a sky.
  const expected = (star, a) => {
    const dRa = (star.ra - a.ra) * RAD;
    const d = star.dec * RAD;
    const dA = a.dec * RAD;
    const cos = Math.sin(dA) * Math.sin(d) + Math.cos(dA) * Math.cos(d) * Math.cos(dRa);
    const theta = Math.acos(Math.max(-1, Math.min(1, cos)));
    const pa = Math.atan2(
      Math.sin(dRa) * Math.cos(d),
      Math.cos(dA) * Math.sin(d) - Math.sin(dA) * Math.cos(d) * Math.cos(dRa)
    );
    const rho = FOCAL * Math.tan(theta);
    return {
      theta: theta / RAD,
      x: WIDTH / 2 - rho * Math.sin(pa),
      y: HEIGHT / 2 - rho * Math.cos(pa),
    };
  };

  // ── Behind the planet ────────────────────────────────────────────────────
  //
  // Point the globe so that Sirius is exactly opposite the camera, and it must
  // land dead centre. This is the whole chain at once — sidereal time, the
  // camera's basis, the lens — with an answer that cannot be arrived at by
  // accident. The planet is shrunk to nothing for it, because at full size the
  // earth is in the way, which is itself the point of the next test.
  console.log("\nwhere the camera is looking");
  const sirius = { ra: ra[find(101.287, -16.716).i], dec: dec[find(101.287, -16.716).i] };
  const behindLat = -sirius.dec;
  const behindLon = (((sirius.ra + 180 - gmst(new Date(AT)) * 15) % 360) + 540) % 360 - 180;

  const centred = nearest(paint(behindLon, behindLat, 0), WIDTH / 2, HEIGHT / 2);
  near(centred.d, 0, 0.75, "a star opposite the camera lands at the centre");
  report(centred.size > 1, "and is drawn as a bright one", `${centred.size}px`);

  // The same pointing at full size: the earth is in front of it now.
  const hidden = nearest(paint(behindLon, behindLat, 1), WIDTH / 2, HEIGHT / 2);
  report(hidden.d > FULL, "and is occluded when the planet is there", `${hidden.d.toFixed(0)}px out`);

  // Overhead. The camera looks down, so a star at the zenith of the point below
  // it is behind the camera and cannot be in the picture at all — where a sign
  // flip on the look direction would put it dead centre, which is the same
  // place the test above wanted a star and the reason both are here.
  const overheadLat = sirius.dec;
  const overheadLon = (((sirius.ra - gmst(new Date(AT)) * 15) % 360) + 540) % 360 - 180;
  const zenith = nearest(paint(overheadLon, overheadLat, 0), WIDTH / 2, HEIGHT / 2);
  report(zenith.d > 4, "a star overhead the camera is behind it", `centre is ${zenith.d.toFixed(0)}px clear`);

  // ── Every star, not a chosen one ─────────────────────────────────────────
  //
  // Each mark on the glass has to be some star, and the star it is has to be
  // the one the almanac route puts there. Run the other way — take every star
  // that ought to be visible and demand a mark within half a pixel — this
  // catches a field that is right about the ones we thought to name and wrong
  // about the rest.
  console.log("\nagainst spherical trigonometry");
  for (const [lon, lat, what] of [
    [0, 0, "on the equator at Greenwich"],
    [-58, 42, "over the north Atlantic"],
    [147, -37, "over the Tasman Sea"],
    [12, 89, "all but over the pole"],
  ]) {
    const marks = paint(lon, lat, 1);
    const a = axis(lon, lat);
    let worst = 0;
    let checked = 0;
    for (let i = 0; i < SKY_COUNT; i++) {
      const e = expected({ ra: ra[i], dec: dec[i] }, a);
      // Only the ones the painter should have drawn: on the glass, off the
      // planet, and clear of both edges so that rounding cannot argue.
      const out = Math.hypot(e.x - WIDTH / 2, e.y - HEIGHT / 2);
      if (out < FULL + 4 || e.theta > 80) continue;
      if (e.x < 4 || e.y < 4 || e.x > WIDTH - 4 || e.y > HEIGHT - 4) continue;
      checked++;
      worst = Math.max(worst, nearest(marks, e.x, e.y).d);
    }
    report(checked > 20 && worst < 0.75, `${checked} stars, ${what}`, `worst ${worst.toFixed(2)}px`);
  }

  // ── The parallax itself ──────────────────────────────────────────────────
  console.log("\nparallax");

  // The lens and the ball agree about the limb: a sphere of radius one at
  // 6.6107 radii, through this focal length, is exactly as big as the planet is
  // drawn. This is the equation that replaced the two tuned constants, so it is
  // the one worth stating twice.
  near(
    FOCAL * Math.tan(Math.asin(1 / ALTITUDE)),
    FULL,
    0.001,
    "the limb is where a ball at that distance is"
  );

  // Turning the camera turns the sky by the same angle and no fraction of one.
  //
  // Stated as an equivalence rather than as a measurement, because there is a
  // second thing on this instrument that turns the sky by a known angle and it
  // is not the hand: the earth's own rotation. Dragging six degrees east and
  // letting six degrees of sidereal time pass are the same rotation of the same
  // celestial sphere, so they have to put every star on the same pixel.
  //
  // A drift constant is exactly what this cannot survive. At the 0.35 the sky
  // used to carry, the drag would move the field by two degrees where the clock
  // moved it by six, and a hundred stars would be a hundred pixels apart.
  const TURN = 6;
  const PER_MS = (24.06570982441908 * 15) / 86400000; // degrees of sidereal turn
  const dragged = paint(-58 + TURN, 42, 1);
  const waited = paint(-58, 42, 1, AT + TURN / PER_MS);
  let apart = 0;
  for (const m of dragged) apart = Math.max(apart, nearest(waited, m.x, m.y).d);
  report(
    dragged.length === waited.length && apart < 0.75,
    "a drag east is the earth turning east",
    `${dragged.length} stars, worst ${apart.toFixed(2)}px`
  );

  // Pushing the world away moves the camera back, not the lens. The planet
  // shrinks; every star that was already clear of the limb stays exactly where
  // it was. A sky that scaled with the globe would fail this by hundreds of
  // pixels, and a sky drawn on a sphere of its own would fail it by a few.
  const near1 = paint(-58, 42, 1);
  const far = paint(-58, 42, 0.55);
  let moved = 0;
  let matched = 0;
  for (const m of near1) {
    const found = nearest(far, m.x, m.y);
    moved = Math.max(moved, found.d);
    if (found.d < 0.01) matched++;
  }
  report(
    matched === near1.length && moved < 0.01,
    "pushing the world away moves no star",
    `${matched}/${near1.length} unmoved`
  );
  report(far.length > near1.length, "and uncovers the ones it was hiding", `+${far.length - near1.length}`);

  // ── The clock ────────────────────────────────────────────────────────────
  //
  // The sky is a moment, not a texture. An hour of wall clock is 15.041 degrees
  // of sidereal turn, and a sidereal day brings the same stars back to the same
  // place — which is the difference between a sky anchored to the earth's
  // rotation and one anchored to nothing.
  console.log("\nthe clock");
  const HOUR = 3600000;
  near(
    (gmst(new Date(AT + HOUR)) - gmst(new Date(AT))) * 15,
    15.041,
    0.001,
    "an hour of clock is an hour of sidereal time"
  );

  const SIDEREAL = 86164090;
  const now_ = paint(-58, 42, 1);
  const later = paint(-58, 42, 1, AT + SIDEREAL);
  let drift = 0;
  for (const m of now_) drift = Math.max(drift, nearest(later, m.x, m.y).d);
  report(drift < 0.75, "a sidereal day brings the sky back", `${drift.toFixed(2)}px`);

  const hourOn = paint(-58, 42, 1, AT + HOUR);
  let ran = 0;
  for (const m of now_) ran = Math.max(ran, nearest(hourOn, m.x, m.y).d);
  report(ran > 20, "and an hour visibly moves it", `${ran.toFixed(0)}px`);

  console.log(ok ? "\nsky ok" : "\nsky FAILED");
  process.exit(ok ? 0 : 1);
})();
