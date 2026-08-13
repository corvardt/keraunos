/** @type {import('tailwindcss').Config} */
import { TOKENS } from "./src/lib/theme.js";

export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      // The palette stays in CSS, where the canvas can read the same values the
      // stylesheet uses. But a bare `var()` has nowhere to put <alpha-value>,
      // and Tailwind's response to that is to emit no rule at all rather than
      // to complain: `bg-void/70` computed to transparent, silently, wherever
      // it was asked for. Every scrim in the app was one of those. Mixing
      // toward transparent keeps the token as the single source of truth, so
      // palette.js rewriting these same properties still carries through.
      colors: Object.fromEntries(
        TOKENS.map((t) => [
          t,
          ({ opacityValue }) => {
            if (opacityValue === undefined) return `var(--c-${t})`;
            // A literal (`/70`, `/[0.82]`) can be resolved here; the opacity
            // utilities hand over a custom property instead, which has to stay
            // an expression and be worked out by the browser.
            const share = Number.isNaN(Number(opacityValue))
              ? `calc(${opacityValue} * 100%)`
              : `${Number(opacityValue) * 100}%`;
            return `color-mix(in srgb, var(--c-${t}) ${share}, transparent)`;
          },
        ])
      ),
      fontFamily: {
        mono: ['"IBM Plex Mono"', "ui-monospace", "SFMono-Regular", "monospace"],
        sans: ['"IBM Plex Mono"', "ui-monospace", "monospace"],
      },
      fontSize: {
        // An instrument reads small and precise; the map carries the scale.
        "2xs": ["10px", "14px"],
        xs: ["11px", "16px"],
        sm: ["12px", "18px"],
        base: ["13px", "20px"],
      },
      letterSpacing: {
        label: "0.14em",
        mark: "0.22em",
      },
    },
  },
  plugins: [],
};
