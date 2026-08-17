// Checks that every palette the configuration can produce is still readable.
//
// The stylesheet is built on an order — line under land under dim under text —
// and the whole interface leans on it: a border is meant to be felt rather than
// read, the land matrix is meant to sit under the marks, and the readouts are
// meant to be the thing you look at. Contrast scales all of that away from the
// ground together, and a phosphor tints it, and both are set by the reader.
//
// The README has always claimed the order survives every combination. Nothing
// checked it, which was tolerable while every phosphor was one ratio over the
// whole tube and became untenable the moment a palette started giving different
// tokens different hues: `neon` gives every token a colour of its own and can move two of them past each other in a
// way no single tint ever could, and the failure is a border that reads as text
// or a matrix that swallows the strikes.
//
//   node scripts/check-palette.cjs

const { pathToFileURL } = require("url");
const path = require("path");
const fs = require("fs");

// Relative luminance, and contrast, exactly as WCAG defines them.
const channel = (c) => {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const luminance = ([r, g, b]) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
const ratio = (a, b) => {
  const [hi, lo] = luminance(a) >= luminance(b) ? [a, b] : [b, a];
  return (luminance(hi) + 0.05) / (luminance(lo) + 0.05);
};

/**
 * The baselines index.css declares, read out of the stylesheet itself.
 *
 * Parsed rather than duplicated here: a copy of the palette in the test is a
 * copy that stops being the palette the first time somebody edits the real one,
 * and then this passes forever while the interface goes grey.
 */
function baselines() {
  const css = fs.readFileSync(path.join(__dirname, "../src/index.css"), "utf8");
  const found = {};
  // `:root` carries dark; the light medium is under its own attribute.
  const split = css.search(/\[data-theme=['"]light['"]\]/);
  if (split < 0) throw new Error("no light medium found in index.css");
  const blocks = [
    ["dark", css.slice(0, split)],
    ["light", css.slice(split)],
  ];
  for (const [medium, block] of blocks) {
    found[medium] = {};
    for (const [, token, value] of block.matchAll(/--c-([a-z-]+):\s*([^;]+);/g)) {
      if (!(token in found[medium])) found[medium][token] = value.trim();
    }
  }
  return found;
}

import(pathToFileURL(path.join(__dirname, "../src/lib/palette.js")).href).then((mod) => {
  const { derive, PHOSPHOR, CONTRAST, rgbOf } = mod;

  let ok = true;
  const check = (pass, what, detail) => {
    if (!pass || process.env.VERBOSE) {
      console.log(`  ${pass ? "✓" : "✗"}  ${what}${detail ? `  ${detail}` : ""}`);
    }
    ok &= pass;
  };

  const base = baselines();
  const phosphors = Object.keys(PHOSPHOR);
  const contrasts = Object.keys(CONTRAST);
  let combinations = 0;

  for (const medium of ["dark", "light"]) {
    for (const phosphor of phosphors) {
      for (const contrast of contrasts) {
        combinations++;
        const name = `${medium}/${phosphor}/${contrast}`;
        const colours = derive(base[medium], { phosphor, contrast, medium });
        const rgb = Object.fromEntries(
          Object.entries(colours).map(([token, value]) => [token, rgbOf(value)])
        );

        // The order is in distance from the ground, not in absolute lightness:
        // on paper the marks are darker than the page and on the tube they are
        // brighter, and the same rule has to serve both.
        const away = (token) => ratio(rgb[token], rgb.void);
        const order = ["line", "land", "dim", "text"];
        for (let i = 0; i < order.length - 1; i++) {
          const [under, over] = [order[i], order[i + 1]];
          check(
            away(under) < away(over),
            `${name}: ${under} sits under ${over}`,
            `${away(under).toFixed(2)} vs ${away(over).toFixed(2)}`
          );
        }

        // The one absolute floor. Readouts, place names and the feed are all
        // drawn in `text`, and below this they stop being readable rather than
        // merely being quiet.
        check(away("text") >= 3, `${name}: text carries 3:1`, `${away("text").toFixed(2)}:1`);

        // The strike is the subject and nothing may outshine it. Not strictly
        // brighter: at max contrast the text is pushed all the way to the
        // strike's own colour and the two meet, which is the ceiling doing what
        // it is for rather than a palette going wrong.
        check(
          away("strike") >= away("text") - 1e-9,
          `${name}: nothing outshines the strike`,
          `${away("strike").toFixed(2)} vs ${away("text").toFixed(2)}`
        );

        // A panel that has drifted from the void reads as a card laid on the
        // screen rather than as the same glass, which is the whole look.
        check(ratio(rgb.panel, rgb.void) < 1.3, `${name}: the panel is the same glass`);

        // And every rung sits where the reference palette puts it.
        //
        // Ordering alone is not enough for a scheme that gives tokens colours
        // of their own: a saturated hue carries more apparent weight than a
        // grey of the same luminance, so a graticule chosen by eye came out at
        // more than twice the contrast the grey one has and took over the map
        // while passing every other test here. This is what says a palette is
        // the same instrument in different colours rather than a louder one.
        if (contrast === "normal") {
          const plain = Object.fromEntries(
            Object.entries(derive(base[medium], { phosphor: "white", contrast, medium })).map(
              ([token, value]) => [token, rgbOf(value)]
            )
          );
          for (const token of ["line", "land", "dim", "text"]) {
            const want = ratio(plain[token], plain.void);
            const got = away(token);
            check(
              Math.abs(got - want) / want <= 0.2,
              `${name}: ${token} carries the weight it should`,
              `${got.toFixed(2)} against ${want.toFixed(2)}`
            );
          }
        }
      }
    }
  }

  console.log(
    ok
      ? `palette: ok  (${combinations} combinations of ${phosphors.length} phosphors, ${contrasts.length} contrasts, 2 media)`
      : "\npalette: FAILED"
  );
  process.exit(ok ? 0 : 1);
});
