/**
 * The poles, from the satellites that actually fly over them.
 *
 * `ir.js` is a ring of five geostationary dishes, and a geostationary dish sits
 * over the equator. It sees a pole at a grazing angle if it sees it at all, and
 * past about 70° the ring stops answering: not clear sky, which is a reading,
 * but no reading. On the flat map that never showed, because Mercator has no
 * poles and the map stops at 74° with it. On the globe it was a bald cap in the
 * middle of the planet, and there is no way to draw it out of data that does
 * not exist.
 *
 * The polar orbiters are the other half of the same picture. VIIRS crosses both
 * poles fourteen times a day, on the same 11-micron window the ring is read on,
 * and NASA's GIBS publishes it on the identical Web Mercator tile grid this map
 * is already laid out on: the same z/x/y, 256 square, no reprojection anywhere.
 * So the caps are a sixth source rather than a special case, weighed in by
 * latitude the way the five are weighed by longitude, and handed to the same
 * accumulator.
 *
 * What it costs is time. This is a daily mosaic of swaths, not a scan of a
 * whole face every ten minutes, so the caps are a day behind the tropics and
 * carry the seams of one orbit meeting the next. That is the honest trade and
 * it is made where it costs least: nothing this instrument is about happens up
 * here. Lightning needs a deep warm column and the poles do not have one.
 */

import { loadPicture } from "./field.js";
import { BREAK, COLDEST } from "./ir.js";

// GIBS, the same tiles their own viewer draws. Reached directly: unlike
// EUMETSAT's GeoServer it sends `access-control-allow-origin`, so the pixels
// can be read back without a hop through our own origin.
const GIBS = "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best";

// The instrument. I5 is VIIRS's thermal window, the same 11 microns the ring's
// band 13 is, which is why the two can be put on one scale at all.
//
// Day and night are two mosaics rather than one, and both are asked for: which
// of them holds a given pole is a question about the season, not the tile. In
// August the Arctic is entirely in the day mosaic and Antarctica entirely in
// the night one, and at the equinoxes each cap is split between them. Merged
// per pixel, so nothing has to know which month it is.
const LAYERS = [
  "VIIRS_NOAA20_Brightness_Temp_BandI5_Day",
  "VIIRS_NOAA20_Brightness_Temp_BandI5_Night",
];

const MATRIX = "GoogleMapsCompatible_Level9";

// How far back the mosaic is asked for.
//
// GIBS fills the current day's mosaic as the orbits come in, so asking for
// today gives a cap with the swaths that have not been flown yet missing from
// it, which is the hole this file exists to close. A day back is whole. It is
// the poles: the cost of being a day late there is nothing.
const LAG_MS = 24 * 60 * 60 * 1000;

/**
 * Where the ring hands over.
 *
 * The same two parallels the ring's own mask fades out across, read the other
 * way round, so the two weights sum to one everywhere and neither has to know
 * about the other. Below CORE this file contributes nothing; above LIMB it is
 * the only thing there is.
 */
export const POLAR_CORE = 60;
export const POLAR_LIMB = 74;

export const polarWeight = (lat) => {
  const a = Math.abs(lat);
  if (a <= POLAR_CORE) return 0;
  if (a >= POLAR_LIMB) return 1;
  return (a - POLAR_CORE) / (POLAR_LIMB - POLAR_CORE);
};

/**
 * The colour ramp GIBS renders brightness temperature through, as hex.
 *
 * The tiles are 8-bit paletted and the palette index *is* the colormap's own
 * entry number, so this is a lookup and not a fit: every colour on a tile is
 * one of these 255 and stands for one temperature. Canvas hands back RGB rather
 * than the index it was stored as, which is the only reason the table has to be
 * carried at all.
 *
 * From `gibs.earthdata.nasa.gov/colormaps/v1.3/VIIRS_Brightness_Temp_BandI5.xml`.
 * The entries run 180 K to 340 K and are uniform in temperature to within a
 * tenth of a kelvin, so the value is worked out from the position rather than
 * stored beside it.
 */
const RAMP =
  "00001601021b03042004072605092b060b30080d35090f3a0a12400b14450d164a0e184f0f1a54101c59121f5f132164" +
  "14236915246a17256b18266c19276d1b276e1c286f1d29701f2a72202b73212c74222d75242e76252e77262f78283079" +
  "29317a2a327b2c337c2d337d2e347e2f357f313680323781333882343883363984373a85383b86393c873b3c883c3d89" +
  "3d3e8a3f3f8a403f8b42408b44418c45418c47428c49438d4b448d4c448d4e458e50468e51468f53478f55488f564890" +
  "5849905a4a905c4a915d4b915f4c91614c91634d92644e92664f92684f926a50936b51936d51936f5293715394725394" +
  "7454947655947856957956957b57957d58957f5996815996835a96845b96865c97885c978a5d978c5e978d5f988f5f98" +
  "9160989261989461989562979663979763979964979a65969b66969c66969e67969f6895a06895a16995a36a95a46a94" +
  "a56b94a66c94a76c93a86d93a96e93aa6e92ab6f92ac7091ad7191ae7191af7290b07390b17390b2748fb3758fb4758e" +
  "b5768eb6778eb7778db8788db9798dba798cbb7a8cbc7a8bbd7b8bbe7c8bbf7c8ac07d8ac17e8ac27e89c37f89c47f88" +
  "c58088c68289c78389c8858ac9868bca888bcb898ccc8b8cce8d8dcf8e8ed0908ed1918fd29390d39490d49691d59791" +
  "d69992d79b93d89d95d9a096daa298dba499dca69bdda89cdeab9edfad9fe0afa0e1b1a2e2b3a3e3b5a5e4b8a6e5baa8" +
  "e6bca9e7beaae8c0ace9c2adeac5afebc7b0ecc9b1edcbb3eecdb4eecfb5efd1b7f0d3b8f1d6baf2d8bbf3dabcf4dcbe" +
  "f5debff6e1c1f8e3c2f9e6c4fae8c6fbebc7fdedc9fef0cafff2ccfff2cdfff3cefff3cffff4d0fff4d1fff5d2fff5d3" +
  "fff6d4fff6d5fff7d6fff7d7fff8d9fff8dafff8dbfff9dcfff9ddfffadefffadffffbe0fffbe1fffbe2fffbe3fffbe4" +
  "fffbe5fffbe6fffbe7fffbe8fffce8fffce9fffceafffcebfffcecfffcedfffdedfffdeefffdeffffdf0fffdf1fffdf2" +
  "fffef2fffef3fffef4fffef5fffef6fffef7fffff7fffff8fffff9fffffafffffbfffffcfffffdfffffeffffff";

const RAMP_LO = 180; // K, the first entry
const RAMP_HI = 340; // K, the last

/**
 * Brightness temperature onto the scale the whole layer is drawn from.
 *
 * `ir.js` anchors that scale on three points of a greyscale it had to measure,
 * because neither service publishes what its bytes mean. This one publishes
 * kelvin, so the same three anchors are simply read off in the units they were
 * always about: warm ground at the bottom, -30°C at BREAK, -80°C at COLDEST.
 * It is the best-calibrated source on the map, which is a pleasing thing for
 * the one that only covers the part nobody is watching.
 */
const WARM_K = 313.15; // +40°C, where the ring's warm end sits
const BREAK_K = 243.15; // -30°C
const COLD_K = 193.15; // -80°C

const scalarForK = (k) => {
  if (k >= WARM_K) return 0;
  if (k >= BREAK_K) return (BREAK * (WARM_K - k)) / (WARM_K - BREAK_K);
  const past = Math.min(1, (BREAK_K - k) / (BREAK_K - COLD_K));
  return BREAK + past * (COLDEST - BREAK);
};

// Packed RGB to the scale. A map rather than a search: a tile is a quarter of a
// million lookups and there are 255 answers.
//
// Built on first use rather than at load, and that is not laziness. `ir.js`
// imports this file and this file reads its calibration, which is a cycle, and
// a cycle resolves in whichever order the bundler happened to pick. Anchors
// read inside a function are read after both modules exist, whatever that order
// turned out to be.
let SCALE = null;
const scale = () => {
  if (SCALE) return SCALE;
  SCALE = new Map();
  for (let i = 0; i < RAMP.length / 6; i++) {
    const rgb = parseInt(RAMP.slice(i * 6, i * 6 + 6), 16);
    // The entry's own midpoint. Uniform in temperature, so this is arithmetic.
    const k = RAMP_LO + ((i + 0.5) * (RAMP_HI - RAMP_LO)) / (RAMP.length / 6);
    SCALE.set(rgb, scalarForK(k));
  }
  return SCALE;
};

const dayOf = (at) => new Date(at - LAG_MS).toISOString().slice(0, 10);

const url = (layer, z, x, y, at) =>
  `${GIBS}/${layer}/default/${dayOf(at)}/${MATRIX}/${z}/${y}/${x}.png`;

/**
 * A note on what the caps read as, and why nothing is done about it.
 *
 * Over the tropics an infrared window reads a cloud top against warm ground and
 * the difference is the whole signal. Over a winter cap there is no warm ground:
 * the Antarctic plateau in August sits near -60°C, which is a cloud-top
 * temperature by any absolute scale. So Antarctica draws as solid overcast for
 * half the year, and it is not a fault in this file: it is what an 11-micron
 * window sees when it looks at ice.
 *
 * Two things were tried and are written down here so they are not tried again.
 * A floor per cap, subtracted: the Southern Ocean is 55°C warmer than the
 * plateau it surrounds, so one number for the cap lands on the ocean and the
 * continent saturates above it. Then a background per pixel, the cap blurred
 * and subtracted from itself: it works on Antarctica and empties the Arctic,
 * because a summer Arctic stratus is broad and flat enough that the blur climbs
 * onto it and subtracts the cloud from itself. The contrast that survived was
 * three kelvin.
 *
 * What is drawn instead is the reading, on the same scale as the rest of the
 * map, which is the one thing that is certainly continuous across the handover
 * at 60°-74°: a cloud does not change brightness as it drifts off the ring and
 * onto the orbiters. The claim that a cold top means a storm is already
 * discounted to nothing up here by `convective`, so what the caps assert is
 * cloud and never convection.
 *
 * The one liberty taken is the ceiling: a cap is never drawn at the full white
 * of a tropical anvil, because an anvil is what that white means everywhere
 * else on the map and the ice is not one.
 */
const CAP_TOP = 0.9;

/**
 * One tile of the caps, on the common scale.
 *
 * Answers `SAMPLES` square of scalars with -1 where the orbiters have nothing,
 * which is the same shape and the same convention the ring's own decode uses,
 * or null if neither mosaic answered at all. A missing tile is a tile to ask
 * again for, not an assertion of clear sky over a pole.
 */
export async function polarSheet(z, x, y, at, SAMPLES) {
  const images = await Promise.all(
    LAYERS.map((layer) =>
      loadPicture(url(layer, z, x, y, at), layer, "the poles will draw as clear sky.")
    )
  );
  if (!images.some((got) => got.image)) return null;

  const sheet = document.createElement("canvas");
  sheet.width = SAMPLES;
  sheet.height = SAMPLES;
  const ctx = sheet.getContext("2d", { willReadFrequently: true });
  // Nearest neighbour, and it is not a preference.
  //
  // The ring's tiles are a greyscale, where a pixel halfway between two others
  // is a temperature halfway between them and smoothing a tile down to SAMPLES
  // is the right thing to do. These are palette indices rendered through a
  // colour ramp that turns corners, so a pixel blended out of two of them is a
  // colour that is not on the ramp at all and stands for no temperature. Read
  // through the table below, those pixels are dropped, and a fifth of every
  // tile went missing as a scatter of holes that looked exactly like the gap in
  // coverage this file was written to close.
  ctx.imageSmoothingEnabled = false;

  const table = scale();
  const out = new Float32Array(SAMPLES * SAMPLES).fill(-1);
  let any = false;
  for (const got of images) {
    if (!got.image) continue;
    ctx.clearRect(0, 0, SAMPLES, SAMPLES);
    ctx.drawImage(got.image, 0, 0, SAMPLES, SAMPLES);
    const { data } = ctx.getImageData(0, 0, SAMPLES, SAMPLES);
    for (let p = 0; p < out.length; p++) {
      const j = p * 4;
      // Index 0 of the palette is the fill value and is transparent with it, so
      // the alpha channel is the coverage mask, exactly as it is for a dish.
      if (!data[j + 3]) continue;
      const t = table.get((data[j] << 16) | (data[j + 1] << 8) | data[j + 2]);
      // A colour that is not on the ramp is a colour the tile was not drawn
      // with: a scaled edge, or a browser that colour-managed the PNG. Left
      // alone rather than guessed at.
      if (t === undefined) continue;
      // Where the two mosaics overlap, the colder of the two. They are separate
      // overpasses of the same ground and the one that saw the cloud is the one
      // with something to say; a mean would only dilute it with the pass that
      // missed it.
      //
      out[p] = Math.max(out[p], Math.min(CAP_TOP, t));
      any = true;
    }
  }
  return any ? out : null;
}
