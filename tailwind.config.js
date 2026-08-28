/** @type {import('tailwindcss').Config} */
import { TOKENS } from "./src/lib/theme.js";

export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  // A hover state on a touch screen is not a hover state: the browser fakes one
  // on tap and then leaves it stuck on the last thing pressed, so a control the
  // finger has moved on from goes on claiming the pointer is over it.
  future: {
    hoverOnlyWhenSupported: true,
  },
  theme: {
    extend: {
      // Not a width. The instrument is drawn at 10px because that is the scale
      // an instrument reads at, and that is right on any screen; what changes
      // on a phone is the pointer, which is a fingertip and not a pixel. So the
      // controls keep their type and are given the room around it that a finger
      // needs, keyed off the pointer itself rather than off the viewport: a
      // tablet is wide and still coarse.
      screens: {
        touch: { raw: "(pointer: coarse)" },
        // Where the instrument sits side by side rather than stacked.
        //
        // Not a width, for the same reason `touch` is not: the question is
        // whether there is a landscape to put a world map in, and a phone
        // turned on its side has one while being nowhere near a desktop's
        // width. Held at `lg` before, it got the worst of the three layouts:
        // the map clamped to 45vh of a 390px-tall viewport is a 175px strip,
        // with the panel below the fold, on the one orientation somebody turned
        // the phone to *for* the map. The short-landscape arm is what phones
        // and small tablets answer.
        wide: { raw: "(min-width: 1024px), (orientation: landscape) and (max-height: 560px)" },
        // That same short landscape on its own. The panel is a fixed column,
        // and a column sized for a desktop takes half of a phone held sideways,
        // so there it gives some back. Declared after `wide`, because it is the
        // narrower case and has to be the one that wins.
        short: { raw: "(orientation: landscape) and (max-height: 560px)" },
      },
      // The palette stays in CSS, where the canvas can read the same values the
      // stylesheet uses. But a bare `var()` has nowhere to put <alpha-value>,
      // and Tailwind's response to that is to emit no rule at all rather than
      // to complain: `bg-void/70` computed to transparent, silently, wherever
      // it was asked for. Every scrim in the app was one of those. Mixing
      // toward transparent keeps the token as the single source of truth, so
      // palette.js rewriting these same properties still carries through.
      // `fail` rides along here but is deliberately not one of TOKENS: it is
      // declared in index.css and never derived, so a coating cannot recolour
      // it. See the note there.
      colors: Object.fromEntries(
        [...TOKENS, "fail"].map((t) => [
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
        // The one large number on a page, and at most one. Everything else in
        // the panel is a 13px value against a 10px caption, which is the whole
        // hierarchy there; without this there is no way in to a column of
        // twenty of them.
        figure: ["2.75rem", { lineHeight: "1.1", letterSpacing: "-0.02em", fontWeight: "600" }],
      },
      letterSpacing: {
        label: "0.14em",
        mark: "0.22em",
      },
    },
  },
  plugins: [],
};
