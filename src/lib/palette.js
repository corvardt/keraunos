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

// The tube's colour, as ratios rather than colours. A phosphor does not repaint
// a grey, it decides which part of the beam survives the coating, so these
// multiply the neutral palette rather than replacing it, and the mark that was
// the brightest thing on screen still is.
export const PHOSPHOR = {
  white: null,
  green: [0.55, 1, 0.62], // P1, the oscilloscope green
  amber: [1, 0.72, 0.34], // P3, the terminal that came after
  ice: [0.64, 0.84, 1],
};

// Distance from the background, scaled. Everything that is not the ground moves
// away from it or toward it together, so the hierarchy the palette was built
// with survives at every setting: line under land under dim under text.
export const CONTRAST = { soft: 0.82, normal: 1, hard: 1.18, max: 1.36 };

// How far a lit pixel bleeds into the glass.
export const BLOOM = { off: 0, soft: 0.5, normal: 1, heavy: 1.7 };

const BLOOM_TOKENS = ["bloom", "bloom-hot"];
const GROUND = new Set(["void", "panel"]);

const clamp = (n) => Math.max(0, Math.min(255, Math.round(n)));

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

// Preserves perceived brightness: the ratios are normalised by their own
// luminance, so tinting changes the hue of a value and not its weight. Without
// this, green would arrive as a brightening and amber as a dimming, and every
// contrast decision in the stylesheet would quietly stop holding.
function tinted(rgb, ratio) {
  const lum = 0.2126 * ratio[0] + 0.7152 * ratio[1] + 0.0722 * ratio[2];
  return rgb.map((c, i) => clamp((c * ratio[i]) / lum));
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

export function applyPalette(theme, { phosphor, contrast, bloom }) {
  const root = document.documentElement;
  const base = baseline(theme);
  const ratio = PHOSPHOR[phosphor] ?? null;
  const reach = CONTRAST[contrast] ?? 1;
  const ground = parse(base.colours.void);

  for (const token of TOKENS) {
    const value = base.colours[token];
    if (!value) continue;
    if (GROUND.has(token)) {
      root.style.setProperty(`--c-${token}`, value);
      continue;
    }
    // Away from the ground, or toward it. Signed distance, so the same
    // arithmetic serves light emitted on black and ink laid down on paper.
    let rgb = parse(value).map((c, i) => clamp(ground[i] + (c - ground[i]) * reach));
    if (ratio) rgb = tinted(rgb, ratio);
    root.style.setProperty(`--c-${token}`, hex(rgb));
  }

  const glow = BLOOM[bloom] ?? 1;
  for (const token of BLOOM_TOKENS) {
    root.style.setProperty(`--${token}`, scaleAlpha(base.bloom[token], glow));
  }
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
