/**
 * What is behind the planet.
 *
 * The flat map has a ground: the world fills the tube edge to edge and the void
 * is a margin. The globe does not — it is a disk with the whole rest of the
 * glass around it, and that emptiness is what makes the sphere read as a
 * drawing of a ball rather than as something standing off in space. So the
 * emptiness gets a depth, and the cheapest honest one is the sky.
 *
 * Honest is meant literally. There is one camera here, and everything the sky
 * does is read off it rather than dialled:
 *
 * The reader is somebody standing off the planet, not somebody spinning it. A
 * drag flies the camera around a stationary earth, so the stars turn with the
 * look direction at exactly the rate it turns — no fraction, no drift constant.
 * That the field sweeps across the glass faster than the ground under the
 * pointer does is not a fault to be tuned out; it is the whole of the parallax,
 * and it is what "the ground is near and the sky is not" looks like.
 *
 * The camera is a lens, so its focal length fixes both things at once. The
 * planet is a ball of known size at a known distance and the stars are at no
 * distance at all, which means one number — `f` below — sets how large the
 * globe is drawn *and* how far a star travels for a degree of turn. There is no
 * second knob to disagree with the first.
 *
 * Pushing the world away moves the camera back. The globe shrinks and the sky
 * does not, because infinity does not get closer or further; that is the only
 * place on this instrument where the depth is stated outright rather than
 * implied, and it costs nothing to state, since holding `f` fixed is the same
 * as holding the lens still.
 *
 * The stars are the real ones. Yale's catalogue, at J2000, turned under the
 * earth by sidereal time from the same clock that puts the sun where it is — so
 * the night side of the globe faces the constellations that are actually behind
 * it, and the sky at four in the morning is not the sky at midnight.
 *
 * Nothing is drawn over the planet. The globe's land is dots on the void with
 * no fill behind them, so a star inside the disk is not a star behind the
 * earth, it is the earth turning transparent. It is cut at the limb — and the
 * limb is exactly where the camera says the earth occludes the sky, so the cut
 * is the same geometry stated once rather than an effect laid on top.
 *
 * And it is light, not furniture. Some sixty read at a glance and the rest are
 * there for an eye that rests. The field is drawn at full strength in the ink
 * the caller picks for the medium, which on the tube is the one the readouts
 * use: a star is the only light source on this glass that is not weather, and
 * held under the coastline it stopped reading as one. Depth is carried by the
 * limb and by the parallax, which is what they were built to carry — it was
 * never the brightness doing it.
 *
 * Sixty on average, is the honest way to put it — between thirty and a hundred,
 * depending on where the globe is pointed. The decorative field was even
 * everywhere, because it was made that way. This one is thin over the galactic
 * poles and crowded through Sagittarius, and a reader who turns the planet far
 * enough will pass the Milky Way going the other way behind it.
 */

import { globeRadius } from "./globe.js";
import { gmst } from "./sun.js";
import { catalogue, SKY_COUNT } from "./bsc.js";

const RAD = Math.PI / 180;

/**
 * Where the reader is standing, in earth radii from the centre, when the world
 * is drawn at full size.
 *
 * The one number this whole file rests on, and the reason it is this number is
 * that it is somewhere: 6.61 radii is the geostationary belt, the altitude
 * every weather satellite whose pictures this instrument draws is actually at.
 * The planet at that distance spans about 17 degrees, and the lens that fits it
 * to the tube is a mild telephoto — near enough to rectilinear that the field
 * does not bow, far enough that the limb is a circle and not a horizon.
 *
 * It replaces two constants that used to be tuned against each other: how large
 * the sky was drawn, and what fraction of the world's turn it took. Both are
 * now consequences of standing here.
 */
const ALTITUDE = 6.6107;

// The lens, as a multiple of the planet's full radius on the glass.
//
//   r = f · tan(asin(1/D))   ⟹   f = r · √(D² − 1)
//
// A ball of radius one at distance D subtends asin(1/D); a pinhole camera of
// focal length f puts that angle at f·tan of it. Which makes f the sky's scale
// too, since a star at angle θ off the axis lands at f·tanθ — the same lens,
// asked about something infinitely further away.
const FOCAL = Math.sqrt(ALTITUDE * ALTITUDE - 1);

// The band outside the limb where a star fades in, in CSS pixels. Without it a
// planet being pushed away uncovers its stars by switching them on.
const HEM = 8;

// How the catalogue's magnitudes become weights on the glass.
//
// Real flux is 10^(−0.4·m), which over the catalogue's range is a factor of
// sixteen hundred: drawn linearly, forty stars would be visible and nine
// thousand would be zero. `COMPRESS` is the gamma that pulls that into a range
// a screen has, and it is the one place left where the sky is a picture of the
// numbers rather than the numbers.
//
// It is also the only knob the geometry did not take away, and that is
// deliberate. The camera has a real altitude and the stars have real places,
// and neither can be moved to make the field fuller — but no display has
// sixteen hundred to one, and every star chart and every long exposure
// compresses this same range for the same reason. So when the honest sky came
// out emptier than the drawn one it replaced, this is what gave, and nothing
// else did.
//
// At 0.22 the whole of the naked-eye catalogue reads at a glance and the sixth
// magnitude is a third of the weight of the first. Brightest to faintest is
// under four to one, which is close to the floor: flatter than this and the
// field stops having a bright end at all, and a sky with no order of brightness
// in it is a texture. Anything more than this has to come from the ink.
//
// It is the faint end that this is really for. Nine stars in ten on the glass
// are past the fifth magnitude, so lifting them is what the eye reads as a
// brighter sky — where lifting the ceiling would only touch the dozen that were
// already the brightest things out there.
const COMPRESS = 0.22;

// The whole field's weight, against the map it sits behind.
//
// The ceiling, not a level: this is what fraction of its ink the brightest star
// in the sky gets, and at one it gets all of it. There is nothing above this —
// a brighter sky than a full-strength mark is a brighter ink, which is the
// choice the caller makes and not a number here.
//
// The cost of standing at the top is that the twinkle has nowhere left to go:
// the thirty or so brightest stars now only breathe downward, since their peak
// is already the whole ink. Below the first magnitude, which is nearly the
// entire field, it breathes both ways as before.
const WEIGHT = 1;

// Where a star earns a mark the size of a dot of land rather than the smallest
// mark the glass can hold. Two sizes and no more; this is roughly the fifty
// stars that have names people use.
const BIG = 2;

// How long a star takes to breathe once, at the slowest and the fastest. Long:
// this is meant to be noticed by somebody who was already looking, and a field
// that flickers is a fault report, not a sky.
//
// The one thing on this tube that is a drawing rather than a fact. Scintillation
// is an atmosphere the camera is above, so strictly there is none of it out
// here; it is kept because a field of perfectly still points reads as dirt on
// the glass, which is a worse lie than the one it tells.
const SLOW = 7200;
const QUICK = 2600;

/**
 * The frame the sky is quantised to, in milliseconds.
 *
 * The tube holds a frame when nothing about it has changed, and a twinkle is
 * time rather than state — left alone it would mean the globe repaints sixty
 * times a second forever, which is exactly the silence the hold was written
 * for. So the twinkle advances in steps, the render loop's rest signature
 * carries which step it is on, and a globe nobody is touching repaints at this
 * rate instead of never. Slow enough to cost almost nothing, fast enough that
 * no step is visible as a step.
 */
export const STAR_STEP = 120;

/**
 * The catalogue as the loop wants it: unit vectors in the celestial frame, and
 * a weight and a size per star.
 *
 * Built on the first sky drawn rather than at import, and Cartesian rather than
 * spherical because the loop below asks each star for three dot products and
 * nothing else. The trigonometry is nine thousand calls once instead of
 * twenty-seven thousand a frame.
 *
 * The breathing is derived from the index rather than stored. Golden-angle
 * phases are as close to unrelated as a sequence gets, which is all this needs:
 * two stars a degree apart must not be seen to pulse together.
 */
let field = null;

const build = () => {
  const { ra, dec, mag } = catalogue();
  const x = new Float32Array(SKY_COUNT);
  const y = new Float32Array(SKY_COUNT);
  const z = new Float32Array(SKY_COUNT);
  const weight = new Float32Array(SKY_COUNT);
  const size = new Uint8Array(SKY_COUNT);
  const phase = new Float32Array(SKY_COUNT);
  const period = new Float32Array(SKY_COUNT);

  for (let i = 0; i < SKY_COUNT; i++) {
    const a = ra[i] * RAD;
    const d = dec[i] * RAD;
    const cosD = Math.cos(d);
    x[i] = cosD * Math.cos(a);
    y[i] = cosD * Math.sin(a);
    z[i] = Math.sin(d);
    // Clamped at the bright end rather than scaled to it: Sirius is a full
    // magnitude clear of the next star down, and letting it set the ceiling
    // would take the whole rest of the sky with it.
    weight[i] = Math.min(1, 10 ** (-0.4 * COMPRESS * mag[i]));
    size[i] = mag[i] < BIG ? 1 : 0;
    phase[i] = (i * 2.399963) % (Math.PI * 2);
    period[i] = SLOW + (QUICK - SLOW) * ((i * 0.6180339887) % 1);
  }

  field = { x, y, z, weight, size, phase, period };
  return field;
};

/**
 * The sky behind `sphere`, on the tube.
 *
 * `sphere` is the globe's own — centre, radius on the glass, and where it is
 * pointed — which is what makes the cut at the limb and the turn of the field
 * the same fact stated once. `at` is the wall clock the sun is drawn from; the
 * sky reads the same one, or the two would be pictures of different moments.
 *
 * Drawn in device pixels for the same reason the land matrix is: a point light
 * at a fractional coordinate is spread across three pixels and loses most of
 * the little weight it was given, and a star is nothing but that weight.
 */
export function paintStars(ctx, sphere, { colour, alpha = 1, dpr, width, height, now, at }) {
  if (alpha <= 0) return;
  const stars = field ?? build();

  // The lens, in device pixels. Off the planet's *full* radius, not the radius
  // it is currently drawn at: pushing the world away moves the camera, it does
  // not change the lens, and that is the whole of the parallax.
  const f = globeRadius(width, height) * FOCAL * dpr;

  const cx = sphere.x * dpr;
  const cy = sphere.y * dpr;
  const limb = sphere.r * dpr;
  const band = HEM * dpr;
  const deviceW = width * dpr;
  const deviceH = height * dpr;

  // Where the camera is looking: down at the point the globe is centred on,
  // which in the sky's own frame is that point's right ascension. Sidereal
  // time is the whole of the conversion, and it is why the field is a moment
  // rather than a texture.
  const raC = (sphere.lon + gmst(new Date(at)) * 15) * RAD;
  const decC = sphere.lat * RAD;
  const cosC = Math.cos(decC);
  const sinC = Math.sin(decC);
  const cosR = Math.cos(raC);
  const sinR = Math.sin(raC);

  // The camera's basis. `n` is the outward normal at the point below it, so the
  // look direction is its negative; east is to the right and north is up, which
  // is the orientation the globe underneath is already drawn in.
  const nx = cosC * cosR;
  const ny = cosC * sinR;
  const nz = sinC;
  const ex = -sinR;
  const ey = cosR;
  const ux = -sinC * cosR;
  const uy = -sinC * sinR;
  const uz = cosC;

  // The narrowest cone that can hold the glass. A star at angle θ off the axis
  // lands at f·tanθ, so anything beyond the corner is out of the picture before
  // it is worth projecting — which is most of the catalogue, rejected on three
  // multiplies. Measured from the sphere's centre because that is where the
  // axis meets the glass.
  const reach = Math.max(
    Math.hypot(cx, cy),
    Math.hypot(deviceW - cx, cy),
    Math.hypot(cx, deviceH - cy),
    Math.hypot(deviceW - cx, deviceH - cy)
  );
  const cone = f / Math.hypot(f, reach);

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = colour;

  for (let i = 0; i < SKY_COUNT; i++) {
    const sx = stars.x[i];
    const sy = stars.y[i];
    const sz = stars.z[i];

    // Along the look direction, which is the negative of the normal. Behind the
    // camera and outside the frame come out as the same test.
    const depth = -(sx * nx + sy * ny + sz * nz);
    if (depth < cone) continue;

    const x = cx + (f * (sx * ex + sy * ey)) / depth;
    const y = cy - (f * (sx * ux + sy * uy + sz * uz)) / depth;
    if (x < 0 || y < 0 || x > deviceW || y > deviceH) continue;

    // The planet's own silhouette. Not a separate rule: the earth blocks the
    // sky within its angular radius of the axis, and `limb` is where the same
    // lens puts that angle.
    const out = Math.hypot(x - cx, y - cy) - limb;
    if (out <= 0) continue;

    // A star breathes about its own weight rather than by a fixed amount, so
    // the faint ones stay faint instead of the whole field pulsing together.
    const lift = 1 + 0.3 * Math.sin((now / stars.period[i]) * Math.PI * 2 + stars.phase[i]);
    const near = out < band ? out / band : 1;
    ctx.globalAlpha = Math.min(1, alpha * near * WEIGHT * stars.weight[i] * lift);

    // Two sizes and no more. The bright end of the field earns a mark the size
    // of a dot of land; everything else is the smallest thing the glass can
    // hold, which is what a star is.
    const size = stars.size[i] ? Math.max(2, Math.round(1.5 * dpr)) : Math.max(1, Math.round(0.9 * dpr));
    ctx.fillRect(Math.round(x - size / 2), Math.round(y - size / 2), size, size);
  }

  ctx.restore();
}
