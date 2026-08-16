import { memo } from "react";

const Bolt = () => (
  <svg viewBox="0 0 12 16" width="11" height="15" aria-hidden="true" className="fill-text">
    <path d="M7.4 0 0 9.1h3.9L4.6 16 12 6.9H8.1L7.4 0Z" />
  </svg>
);

// Every control on the right reads as the same kind of thing.
//
// The padding is the whole control on a phone. Drawn, these are four letters
// tall — a 14px target, where a fingertip covers about forty — so under a
// coarse pointer each one is given a box it can actually be hit in, and lights
// on press rather than on a hover that never arrives.
const item =
  "text-2xs uppercase tracking-label text-dim transition-colors hover:text-text active:text-text touch:px-1.5 touch:py-3";

/** Splits the controls into what they do: display, panels, elsewhere. */
const Rule = () => <span className="h-2.5 w-px bg-line" aria-hidden="true" />;

function Navbar({ phase, host, pulse, theme, onTheme, onConfig, onKey, onGuide }) {
  const live = phase === "live";
  const down = phase === "down";
  // When live, the dot and the node name already say it. Only speak up otherwise.
  const state = down ? "no signal" : live ? null : "linking";

  return (
    <header className="relative flex h-11 shrink-0 items-center justify-between border-b border-line px-3 sm:px-4">
      <div className="flex min-w-0 items-baseline gap-2.5">
        <span className="translate-y-px">
          <Bolt />
        </span>
        {/* Gives way first. On a narrow screen with the link state showing,
            something has to, and the name of the instrument is the one thing
            on this row nobody needs to read twice. */}
        <span className="truncate text-base font-semibold tracking-mark text-text glow">
          KERAUNOS
        </span>
        <span className="hidden text-2xs uppercase tracking-label text-dim sm:inline">
          &#47;&#47; global strike detection
        </span>
      </div>

      {/* Never squeezed: the controls are the reason the header is here, and a
          narrow screen must take the mark's room rather than theirs. */}
      <div className="flex shrink-0 items-center gap-2.5 sm:gap-4">
        <span className="flex items-center gap-2">
          {/* The indicator is itself a strike counter: it flashes on arrival. */}
          <span
            key={pulse}
            className={`h-1.5 w-1.5 rounded-full bg-dim ${live ? "alive" : "seek"}`}
          />
          {state && (
            <span className="text-2xs uppercase tracking-label text-text glow">
              [ {state} ]
            </span>
          )}
          <span className="hidden text-2xs uppercase tracking-label text-dim sm:inline">
            {host ? `node ${host}` : "no node"}
          </span>
        </span>

        {/* The gap closes on a phone because the controls have grown their own
            padding by then, and the space between two 40px targets is already
            space. Keeping both would have pushed the last of them off the edge,
            which is the same as not having it. */}
        <span
          data-tour="controls"
          className="flex items-center gap-1 border-l border-line pl-2.5 sm:gap-3 sm:pl-4"
        >
          {/* Two media, named for what they are rather than "light"/"dark". */}
          <button
            type="button"
            onClick={() => onTheme(theme === "dark" ? "light" : "dark")}
            aria-label={`switch to ${theme === "dark" ? "paper" : "tube"}`}
            className={item}
          >
            {theme === "dark" ? "tube" : "paper"}
          </button>
          <Rule />
          {/* First of the three, and the only one that walks: it is what the
              other two are for once you already know what you are looking at. */}
          <button type="button" onClick={onGuide} className={item}>
            guide
          </button>
          <button type="button" onClick={onKey} className={item}>
            key
          </button>
          <button type="button" onClick={onConfig} className={item}>
            cfg
          </button>
          {/* Elsewhere, and the first thing to go when the row will not fit:
              nobody came to this page to leave it, and the three above are what
              the instrument is driven with. */}
          <span className="hidden items-center gap-3 sm:flex">
            <Rule />
            <a
              className={item}
              target="_blank"
              rel="noreferrer"
              href="https://github.com/corvardt/keraunos"
            >
              src
            </a>
            <a
              className={item}
              target="_blank"
              rel="noreferrer"
              href="https://twitter.com/corvardt"
            >
              x
            </a>
          </span>
        </span>
      </div>
    </header>
  );
}

// Only the connection state and the medium reach it; the feed and the clock
// ticking underneath are not its business.
export default memo(Navbar);
