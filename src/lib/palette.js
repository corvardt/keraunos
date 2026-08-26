import { useRef } from "react";
import { TOKENS } from "./theme.js";

// Customising the medium.
//
// The rule from theme.js holds and everything here follows from it: the palette
// lives in CSS so the stylesheet and the canvas can never disagree. So nothing
// in this file paints anything. It derives new values for the same tokens and
// writes them back as inline properties on the root element, and the whole app
// (Tailwind classes, glow shadows, the canvas reading computed style as it
// draws) follows without knowing that anything was customised.
//
// The stylesheet stays the source of truth. Derivation always starts from the
// values index.css declares for the current theme, never from whatever is
// currently applied, or a run of adjustments would compound into a palette
// nobody chose.

// The tube's colour.
//
// Two shapes, because two different things are being described.
//
// A ratio array is a phosphor: a coating does not repaint a grey, it decides
// which part of the beam survives, so these multiply the neutral palette and
// the mark that was the brightest thing on screen still is. That is the first
// four, and they are the instrument's own.
//
// A `{ dark }` object is a palette: colours chosen against each other by
// somebody, which no single ratio can produce. These are borrowed rather than
// invented, with the author named, because picking hex values by eye is how the
// first attempt at this ended up as a violet wash with one loud magenta grid.
//
// What is borrowed is the *hue*. The weight is not: see `derive`. A palette
// hands over a set of colours and the instrument decides how far from the
// ground each of them sits, which is what keeps a scheme from redecorating the
// hierarchy the whole interface is read through.
//
// None of this applies in light mode, where there is no phosphor at all.
//
// Both shapes turned out to be describing a tube and only a tube, each failing
// on paper in its own way. A palette held to the weight the grey reference
// gives each token has to travel much further down to carry the same contrast
// against a pale ground, and the only way along that line is toward the page:
// crimson's red graticule came out pale sand and its wine mid-tone washed
// mauve. A ratio fails harder still, because multiplying is not what ink does.
// Light's strike is `#000000`, and black times any ratio is black, so the one
// mark the instrument is about took no colour in any of the four; meanwhile
// `line` multiplied up into a saturated stroke lighter than the page, which
// made the faintest furniture on the map the loudest thing on it.
//
// So paper has one ink, and the whole of this constant is the dark medium's.
// `phosphorsFor` is what says so, and the configuration drops the control
// entirely rather than offering a list of one.
export const PHOSPHOR = {
  white: null,
  green: [0.55, 1, 0.62], // P1, the oscilloscope green
  amber: [1, 0.72, 0.34], // P3, the terminal that came after
  ice: [0.64, 0.84, 1],

  // Oil 6, by GrafxKid. https://lospec.com/palette-list/oil-6
  //
  // Cream to dark navy through sand, rose, mauve and slate. The tube reads it
  // from the navy end up, which is the end it has the most room in.
  oil: {
    dark: {
      void: "#272744",
      panel: "#494d7e",
      line: "#494d7e",
      land: "#8b6d9c",
      dim: "#c69fa5",
      text: "#f2d3ab",
      strike: "#fbf5ef",
    },
  },

  // Crimson, by WildLeoKnight. https://lospec.com/palette-list/crimson
  //
  // Four colours, so hues repeat across the rungs, which is not a shortfall.
  // A four-colour palette has four hues, and the levels between them are the
  // instrument's to set.
  crimson: {
    dark: {
      void: "#1b0326",
      panel: "#7a1c4b",
      line: "#7a1c4b",
      land: "#ba5044",
      dim: "#ba5044",
      text: "#eff9d6",
      strike: "#eff9d6",
    },
  },

  // Blood Demon RX, by Chicknhawk.
  // https://lospec.com/palette-list/blood-demon-rx
  //
  // Dark navy up through wine and crimson to a hot pink. The one that was never
  // going to have a light end: inverted it is a page the colour of a wound.
  demon: {
    dark: {
      void: "#171f37",
      panel: "#3c263d",
      line: "#5d2c44",
      land: "#81334a",
      dim: "#d14258",
      text: "#ed4960",
      strike: "#ff7b8a",
    },
  },
};

/**
 * What the configuration offers, for a medium: all of them on the tube, none at
 * all on paper.
 *
 * Empty rather than `["white"]`, because white is not a choice among one. It is
 * the absence of a coating, which is what paper has. The panel reads the
 * length of this and drops the control.
 *
 * `derive` makes the same test rather than trusting this one. Both halves are
 * needed: hiding the control alone would leave a reader who chose `demon` on
 * the tube and then switched to paper looking at a palette the panel no longer
 * admits to, and refusing it alone would leave a control that visibly does
 * nothing.
 */
export const phosphorsFor = (medium) => (medium === "dark" ? Object.keys(PHOSPHOR) : []);

const isPalette = (entry) => Boolean(entry) && !Array.isArray(entry);

// Distance from the background, scaled. Everything that is not the ground moves
// away from it or toward it together, so the hierarchy the palette was built
// with survives at every setting: line under land under dim under text.
export const CONTRAST = { soft: 0.82, normal: 1, hard: 1.18, max: 1.36 };

// How far a lit pixel bleeds into the glass.
export const BLOOM = { off: 0, soft: 0.5, normal: 1, heavy: 1.7 };

const BLOOM_TOKENS = ["bloom", "bloom-hot"];
const GROUND = new Set(["void", "panel"]);

const clamp = (n) => Math.max(0, Math.min(255, Math.round(n)));

export const rgbOf = parse;

function parse(value) {
  const text = String(value).trim();
  if (text.startsWith("#")) {
    const hex = text.length === 4
      ? text.slice(1).split("").map((c) => c + c).join("")
      : text.slice(1);
    const n = parseInt(hex, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const parts = text.match(/[\d.]+/g);
  return parts ? parts.slice(0, 3).map(Number) : [0, 0, 0];
}

const hex = (rgb) => `#${rgb.map((c) => clamp(c).toString(16).padStart(2, "0")).join("")}`;

// Alpha only: the bloom's colour belongs to the medium (white light added on
// the tube, black ink spreading in paper) and is not ours to reinterpret.
function scaleAlpha(value, factor) {
  const parts = String(value).match(/[\d.]+/g);
  if (!parts || parts.length < 4) return value;
  const alpha = Math.max(0, Math.min(1, Number(parts[3]) * factor));
  return `rgba(${parts[0]}, ${parts[1]}, ${parts[2]}, ${alpha.toFixed(3)})`;
}

/** The medium's own alpha, carrying somebody else's colour. */
function recoloured(value, rgb) {
  const parts = String(value).match(/[\d.]+/g);
  if (!parts || parts.length < 4) return value;
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${parts[3]})`;
}

// Preserves perceived brightness: the ratios are normalised by their own
// luminance, so tinting changes the hue of a value and not its weight. Without
// this, green would arrive as a brightening and amber as a dimming, and every
// contrast decision in the stylesheet would quietly stop holding.
function tinted(rgb, ratio) {
  const lum = 0.2126 * ratio[0] + 0.7152 * ratio[1] + 0.0722 * ratio[2];
  return rgb.map((c, i) => clamp((c * ratio[i]) / lum));
}

// Relative luminance and contrast, as WCAG defines them. Present here because
// the weight of a colour is the thing this file is actually deciding, and it is
// deliberately re-derived in `scripts/check-palette.cjs` rather than imported
// from here: a test that borrows the implementation's own arithmetic cannot
// catch a mistake in it.
const channel = (c) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const luminance = ([r, g, b]) =>
  0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
const contrastOf = (a, b) => {
  const [hi, lo] = luminance(a) >= luminance(b) ? [a, b] : [b, a];
  return (luminance(hi) + 0.05) / (luminance(lo) + 0.05);
};

const mix = (ground, colour, t) => colour.map((c, i) => clamp(ground[i] + (c - ground[i]) * t));

/**
 * The palette's hue, at the instrument's weight.
 *
 * A borrowed scheme says which colours belong together; it has no opinion about
 * which of them should be a hairline and which should be a readout, because it
 * was not drawn for this map. And the difference matters more than it sounds: a
 * saturated hue carries far more apparent weight than a grey of the same
 * luminance, so a graticule taken at face value came out at over twice the
 * contrast the grey one has and took over the whole map.
 *
 * So each colour is slid along the line between it and the ground until it sits
 * at exactly the contrast the reference palette gives that token. Hue and
 * chroma are the palette's; the level is the instrument's. Bisection rather
 * than a closed form because the channels clamp, which the arithmetic cannot
 * invert.
 */
function atWeight(ground, colour, target) {
  let lo = 0;
  let hi = 6;
  for (let i = 0; i < 32; i++) {
    const mid = (lo + hi) / 2;
    if (contrastOf(mix(ground, colour, mid), ground) < target) lo = mid;
    else hi = mid;
  }
  return mix(ground, colour, (lo + hi) / 2);
}

const baselines = new Map();

/**
 * What index.css declares for this theme, read once and remembered.
 *
 * Our own overrides are cleared before reading, because a custom property set
 * inline is what computed style would report back; the derivation would be
 * reading its own output.
 */
function baseline(theme) {
  const cached = baselines.get(theme);
  if (cached) return cached;

  const root = document.documentElement;
  for (const token of TOKENS) root.style.removeProperty(`--c-${token}`);
  for (const token of BLOOM_TOKENS) root.style.removeProperty(`--${token}`);

  const style = getComputedStyle(root);
  const base = { colours: {}, bloom: {} };
  for (const token of TOKENS) base.colours[token] = style.getPropertyValue(`--c-${token}`).trim();
  for (const token of BLOOM_TOKENS) base.bloom[token] = style.getPropertyValue(`--${token}`).trim();

  baselines.set(theme, base);
  return base;
}

/**
 * The whole derivation, as arithmetic on a baseline rather than on the DOM.
 *
 * Pure so it can be checked. `scripts/check-palette.cjs` runs every phosphor
 * against every contrast on both media and asserts the hierarchy the stylesheet
 * was built with still holds, a claim the README has always made and nothing
 * ever tested, which is a comfortable place for a new palette to break it.
 */
export function derive(colours, { phosphor, contrast, medium = "dark" }) {
  // Neither shape survives paper, so on paper neither is read: whatever is
  // stored, light derives the instrument's own ink. One condition rather than
  // two, because it is one fact: a phosphor is a property of a tube.
  const tube = medium === "dark";
  const entry = tube ? (PHOSPHOR[phosphor] ?? null) : null;
  const given = isPalette(entry) ? entry.dark : null;
  const ratio = Array.isArray(entry) ? entry : null;
  const reach = CONTRAST[contrast] ?? 1;
  const plain = parse(colours.void);

  // What the instrument asks of each token: its own distance from its own
  // ground, at this contrast. Every palette is held to these, so switching one
  // changes the colours and nothing else.
  const wanted = {};
  for (const token of TOKENS) {
    if (token === "void" || !colours[token]) continue;
    const at = parse(colours[token]).map((c, i) => clamp(plain[i] + (c - plain[i]) * reach));
    wanted[token] = contrastOf(at, plain);
  }

  const ground = given ? parse(given.void) : plain;
  const out = { void: hex(ground) };

  for (const token of TOKENS) {
    if (token === "void") continue;
    const value = given?.[token] ?? colours[token];
    if (!value) continue;
    if (given) {
      // Borrowed hue, own weight.
      out[token] = hex(atWeight(ground, parse(value), wanted[token] ?? contrastOf(parse(value), ground)));
      continue;
    }
    if (GROUND.has(token)) {
      out[token] = hex(parse(value));
      continue;
    }
    // Away from the ground, or toward it. Signed distance, so the same
    // arithmetic serves light emitted on black and ink laid down on paper.
    let rgb = parse(value).map((c, i) => clamp(ground[i] + (c - ground[i]) * reach));
    if (ratio) rgb = tinted(rgb, ratio);
    out[token] = hex(rgb);
  }
  return out;
}

export function applyPalette(theme, { phosphor, contrast, bloom }) {
  const root = document.documentElement;
  const base = baseline(theme);

  const colours = derive(base.colours, { phosphor, contrast, medium: theme });
  for (const token of TOKENS) {
    if (colours[token]) root.style.setProperty(`--c-${token}`, colours[token]);
  }

  // The halo. Normally the medium's own, white light added on the tube and
  // black ink spreading in paper, but a palette may hand over its own, which is
  // what puts a cyan glow around a white strike.
  const entry = PHOSPHOR[phosphor];
  // The same test `derive` makes, and it has to stay the same one: a halo
  // taking a palette's colour while the marks under it had fallen back to ink
  // is the one way these two can disagree.
  const given = isPalette(entry) && theme === "dark" ? entry.dark : null;
  const glow = BLOOM[bloom] ?? 1;
  for (const token of BLOOM_TOKENS) {
    // Under a palette the halo takes the strike's own colour, at the medium's
    // own alpha. It is not a separate choice: a bloom is the mark spreading
    // into the glass, so whatever the mark is, the bloom is.
    const halo = given ? recoloured(base.bloom[token], parse(colours.strike)) : base.bloom[token];
    root.style.setProperty(`--${token}`, scaleAlpha(halo, glow));
  }

  // The browser chrome is part of the medium: it follows the ground the tube
  // has just been set to rather than the system, which the reader is allowed to
  // overrule. Here rather than in theme.js because a phosphor moves the ground
  // as surely as the medium does, and this is the one function both go through.
  const chrome = document.querySelector("meta[name=theme-color]");
  if (chrome && colours.void) chrome.content = colours.void;
}

/**
 * Applied during render rather than from an effect, for exactly the reason
 * theme.js gives for doing the same with the theme itself: effects run
 * child-first, so the canvas would read the outgoing palette out of computed
 * style and draw a frame in it. Returns a key the canvas can watch, since a
 * change here is invisible to React: the values it cares about live in the
 * DOM, not in props.
 */
export function usePalette(theme, phosphor, contrast, bloom) {
  const key = `${theme}|${phosphor}|${contrast}|${bloom}`;
  const applied = useRef(null);
  if (applied.current !== key) {
    applied.current = key;
    applyPalette(theme, { phosphor, contrast, bloom });
  }
  return key;
}
