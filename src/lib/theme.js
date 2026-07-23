import { useCallback, useEffect, useState } from "react";

// Palette values live in CSS (see index.css) so the stylesheet and the canvas
// can never drift apart. These are the token names, in both places.
export const TOKENS = ["void", "panel", "line", "land", "dim", "text", "strike"];

// The medium is shared with the rest of unmod.fun, so the choice lives in a
// cookie scoped to the domain rather than in localStorage, which is per-origin
// and would not survive the walk between the index and a project.
const COOKIE_KEY = "unmod-theme";

const STORAGE_KEY = "keraunos-theme";
// Written before the rename, and before the medium became domain-wide. Both
// are read as fallbacks so a returning reader keeps their medium; the next
// choice they make writes the cookie.
const LEGACY_KEY = "lightning-theme";

const cookie = () => document.cookie.match(/(?:^|;\s*)unmod-theme=(dark|light)/)?.[1] ?? null;

const stored = () =>
  cookie() ?? localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_KEY);

function write(theme) {
  const domain = location.hostname.endsWith("unmod.fun") ? "; domain=.unmod.fun" : "";
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
