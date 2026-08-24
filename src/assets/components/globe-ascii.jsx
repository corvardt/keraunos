import { useEffect, useRef } from "react";
import { geoOrthographic } from "d3-geo";
import { findFeature } from "../../lib/geo.js";
import { subsolar } from "../../lib/sun.js";

// A character cell is 0.6 as wide as it is tall, at the size and leading set on
// the block below. Longitude therefore has to be sampled 1/0.6 as densely as
// latitude or the planet comes out an egg, the same correction the land matrix
// makes against the glass, made here against the type.
const ASPECT = 0.6;
// As large as the narrowest screen this runs on will take. 29 rows of 11px is
// 319px of planet, and the 48 columns of 6.6px cell that pair with them are
// 317px across, inside the 328px a 360px phone leaves once the screen's own
// padding is off. Bigger than this and the globe would have to shrink itself on
// phones, and a planet that is one size here and another there is two drawings
// rather than one.
const ROWS = 29;
const COLS = Math.round(ROWS / ASPECT);
// A hair inside the block, so the limb is never clipped flat by the last row.
const RADIUS = ROWS / 2 - 0.5;

// Where the eye sits. A satellite looking down the equator sees a band and no
// poles; lifted a little, the disk reads as a sphere and the northern
// continents, the ones anybody recognises, face the viewer.
const TILT = 16;
// The meridian under the viewer when the screen appears. Africa and Europe are
// the most legible thing this grid can draw, so the planet starts showing them
// and turns east from there.
const START_LON = 10;

// The turn is a gesture with a beginning and an end, not a loop that happens to
// be running: the planet is still in the first frame, is carried through most
// of a third of a turn, and is easing off again by the time the curtain lifts.
// The ends are what make it: a constant rate reads as a texture scrolling past,
// and it is the settling that makes it read as mass being brought to rest.
// Taken no faster than this, because past about a degree a frame the continents
// stop being places and become a pattern going by.
const SWEEP = 110;
// The whole of the screen, fade included, so the planet is still easing as the
// curtain goes and is never seen to arrive.
const SPIN_MS = 1520;
// What it settles to, rather than what it stops at. The screen is normally gone
// before this matters; it matters when a slow fetch holds the door, and a
// planet frozen mid-frame under a line reading "fetching..." looks like a
// machine that has hung. So it never quite stops.
const DRIFT_PER_S = 14;

// Zero slope at both ends, so the planet leaves rest and arrives at the drift
// without a kick at either join.
const ease = (t) => 0.5 - Math.cos(Math.PI * t) / 2;

// Degrees turned since the screen appeared.
const turned = (ms) =>
  ms >= SPIN_MS
    ? SWEEP + (DRIFT_PER_S * (ms - SPIN_MS)) / 1000
    : SWEEP * ease(ms / SPIN_MS);

const RAD = Math.PI / 180;

// Land is asked for once, on a 2° grid, and read off that grid every frame
// after. Rotation only changes which cells of it are visible, so re-testing the
// polygons per frame would be paying 900 point-in-polygon questions, sixty
// times a second, for an answer that never changes. At 2° the raster is finer
// than the type it feeds: one character here spans about 7° of latitude.
const STEP = 2;
const RASTER_COLS = 360 / STEP;
const RASTER_ROWS = 180 / STEP;

let raster = null;

function landRaster(index) {
  if (raster) return raster;
  raster = new Uint8Array(RASTER_COLS * RASTER_ROWS);
  for (let row = 0; row < RASTER_ROWS; row++) {
    const lat = 90 - (row + 0.5) * STEP;
    for (let col = 0; col < RASTER_COLS; col++) {
      const lon = -180 + (col + 0.5) * STEP;
      if (findFeature(index, lon, lat)) raster[row * RASTER_COLS + col] = 1;
    }
  }
  return raster;
}

const isLand = (grid, lon, lat) => {
  const col = Math.floor((lon + 180) / STEP);
  const row = Math.floor((90 - lat) / STEP);
  if (row < 0 || row >= RASTER_ROWS) return 0;
  return grid[row * RASTER_COLS + ((col % RASTER_COLS) + RASTER_COLS) % RASTER_COLS];
};

/**
 * The planet, from far enough away to be a disk.
 *
 * Two passes of the same grid, printed one exactly over the other: everything
 * the sun is up over goes in the top layer, everything in night goes in the
 * bottom one, a step darker. Neither layer draws the other's cells, so the
 * terminator is not a line anybody plots. It is the seam between the two
 * printings, and it falls where the sun actually puts it right now.
 *
 * Sea and land are told apart within a layer by weight of glyph rather than by
 * colour, which is what leaves colour free to mean day and night.
 */
function frame(grid, centreLon, sun) {
  const projection = geoOrthographic().translate([0, 0]).scale(RADIUS).rotate([-centreLon, -TILT]);
  const sinDecl = Math.sin(sun.decl * RAD);
  const cosDecl = Math.cos(sun.decl * RAD);

  let day = "";
  let night = "";

  for (let row = 0; row < ROWS; row++) {
    const y = row + 0.5 - ROWS / 2;
    for (let col = 0; col < COLS; col++) {
      const x = (col + 0.5 - COLS / 2) * ASPECT;
      // Off the disk before asking the projection anything: outside its own
      // radius an orthographic inverse does not return nothing, it returns a
      // point, and that point is on a planet that isn't there.
      if (x * x + y * y > RADIUS * RADIUS) {
        day += " ";
        night += " ";
        continue;
      }
      const point = projection.invert([x, y]);
      if (!point || !isFinite(point[0]) || !isFinite(point[1])) {
        day += " ";
        night += " ";
        continue;
      }
      const [lon, lat] = point;
      const land = isLand(grid, lon, lat);
      // Cosine of the solar zenith angle: positive is sun above the horizon.
      const lit =
        sinDecl * Math.sin(lat * RAD) +
        cosDecl * Math.cos(lat * RAD) * Math.cos((lon - sun.lon) * RAD) >
        0;
      const glyph = land ? "#" : ":";
      day += lit ? glyph : " ";
      night += lit ? " " : land ? "+" : ".";
    }
    if (row < ROWS - 1) {
      day += "\n";
      night += "\n";
    }
  }

  return { day, night };
}

export default function Globe({ index }) {
  const dayRef = useRef(null);
  const nightRef = useRef(null);

  useEffect(() => {
    const grid = landRaster(index);
    // Taken once. The sun moves a quarter of a degree in the time this screen
    // is up, which is a twentieth of a character.
    const sun = subsolar(new Date());

    const paint = (centreLon) => {
      const { day, night } = frame(grid, centreLon, sun);
      // Written to the nodes rather than through state: the parent re-renders
      // twice a second on its own, and a component that asked React for sixty
      // more would be spending the frame budget on reconciliation instead of on
      // the planet.
      if (dayRef.current) dayRef.current.textContent = day;
      if (nightRef.current) nightRef.current.textContent = night;
    };

    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (still) {
      paint(START_LON);
      return;
    }

    const started = performance.now();
    let raf = 0;
    const tick = (now) => {
      paint(START_LON + turned(now - started));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [index]);

  return (
    // The two layers are one printing in two inks, so they are stacked rather
    // than laid out: same grid, same origin, same metrics, and the box takes
    // its size from the first of them.
    <div className="relative shrink-0 select-none whitespace-pre text-[11px] leading-[11px]" aria-hidden="true">
      <pre ref={dayRef} className="text-dim" />
      <pre ref={nightRef} className="absolute inset-0 text-land/70" />
    </div>
  );
}
