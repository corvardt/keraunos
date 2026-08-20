import { useCallback, useEffect, useState } from "react";

// Palette values live in CSS (see index.css) so the stylesheet and the canvas
// can never drift apart. These are the token names, in both places.
export const TOKENS = ["void", "panel", "line", "land", "dim", "text", "strike"];

// The medium is shared with the rest of corvardt.com, so the choice lives in a
// cookie scoped to the domain rather than in localStorage, which is per-origin
// and would not survive the walk between the index and a project.
const COOKIE_KEY = "corvardt-theme";

const stored = () => document.cookie.match(/(?:^|;\s*)corvardt-theme=(dark|light)/)?.[1] ?? null;

function write(theme) {
  const domain = location.hostname.endsWith("corvardt.com") ? "; domain=.corvardt.com" : "";
  document.cookie = `${COOKIE_KEY}=${theme}; path=/; max-age=31536000; samesite=lax${domain}`;
}

/**
 * Two media, not one palette inverted. Dark is a phosphor tube: light emitted
 * on black, marks composited additively. Light is ink on chart paper: marks
 * deposited, composited by multiplication. The mode decides which.
 */
export const COMPOSITE = { dark: "lighter", light: "multiply" };

/**
 * Resolves the medium for the canvas, which can't read classes. The attribute
 * is always written synchronously before a render, so this never reads stale
 * values off the previous theme.
 */
export function readMedium(theme) {
  const style = getComputedStyle(document.documentElement);
  const palette = {};
  for (const token of TOKENS) {
    palette[token] = style.getPropertyValue(`--c-${token}`).trim();
  }
  return { palette, composite: COMPOSITE[theme] ?? COMPOSITE.dark };
}

// Applied synchronously rather than in an effect: effects run child-first, so
// a child reading computed style would otherwise see the outgoing theme.
function apply(next) {
  document.documentElement.dataset.theme = next;
  return next;
}

export function useTheme() {
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme || "dark");

  // Follow the system while the reader hasn't expressed a preference.
  useEffect(() => {
    if (stored()) return;
    const query = window.matchMedia("(prefers-color-scheme: light)");
    const onChange = (e) => setTheme(apply(e.matches ? "light" : "dark"));
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  const choose = useCallback((next) => {
    write(next);
    setTheme(apply(next));
  }, []);

  return { theme, setTheme: choose };
}
