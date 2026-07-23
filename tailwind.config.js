/** @type {import('tailwindcss').Config} */
import { TOKENS } from "./src/lib/theme.js";

export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: Object.fromEntries(TOKENS.map((t) => [t, `var(--c-${t})`])),
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
