import Panel, { Group } from "./panel.jsx";
import { wake } from "../../lib/click.js";

/**
 * The name of a control, and a line saying what it does where the name cannot.
 *
 * Only some of them carry one. Most of this panel demonstrates itself: the
 * modal does not cover the tube, so a phosphor or a contrast or a scanline is
 * answered by pressing it and looking. What that leaves is the handful naming
 * something you would have to already know about the instrument to picture, and
 * those are worth a line each. Glossing the rest would bury them.
 */
function Row({ label, hint, children }) {
  return (
    // The controls carry their own padding under a coarse pointer, so the row
    // gives its own back rather than adding to it: two 40px targets a row apart
    // is a panel you scroll through twice.
    <div className="py-1.5 touch:py-0">
      <div className="flex items-baseline justify-between gap-3 sm:gap-5">
        <span className="text-2xs uppercase tracking-label text-dim">{label}</span>
        {children}
      </div>
      {/* Beneath the pair rather than beside the name. Sharing the line with the
          control leaves the gloss a column about twenty characters wide, which
          turns one sentence into four ragged ones and reads worse than saying
          nothing. */}
      {hint && <p className="mt-1 text-xs leading-snug text-dim">{hint}</p>}
    </div>
  );
}

/** A terminal switch: the brackets are the control, not decoration. */
function Toggle({ label, hint, value, onChange }) {
  return (
    <Row label={label} hint={hint}>
      <button
        type="button"
        role="switch"
        aria-checked={value}
        aria-label={label}
        onClick={() => onChange(!value)}
        className={`shrink-0 text-2xs uppercase tracking-label transition-colors touch:py-3 touch:pl-6 ${
          value ? "text-text glow" : "text-dim hover:text-text active:text-text"
        }`}
      >
        [ {value ? "on" : "off"} ]
      </button>
    </Row>
  );
}

function Choice({ label, hint, value, options, onChange }) {
  return (
    <Row label={label} hint={hint}>
      <span className="flex shrink-0 items-baseline">
        {options.map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={value === option}
            onClick={() => onChange(option)}
            className={`pl-2 text-2xs uppercase tracking-label transition-colors touch:px-2 touch:py-3 ${
              value === option ? "text-text glow" : "text-dim hover:text-text active:text-text"
            }`}
          >
            {option}
          </button>
        ))}
      </span>
    </Row>
  );
}

export default function Settings({ settings, set, reset, onClose, onKey }) {
  return (
    <Panel
      title="Configuration"
      onClose={onClose}
      footer={
        <footer className="flex items-center justify-between border-t border-line px-5 py-3">
          <span className="text-2xs uppercase tracking-label text-dim">Stored locally</span>
          <span className="flex items-baseline gap-3">
            {/* What each of these marks actually is belongs in the key, and the
                key is a different panel. Without this you had to close the
                configuration, find the catalogue, read one line, and come back
                to a panel scrolled to the top. */}
            {onKey && (
              <button
                type="button"
                onClick={onKey}
                title="What every mark and figure means"
                className="text-2xs uppercase tracking-label text-dim transition-colors hover:text-text active:text-text touch:px-2 touch:py-2"
              >
                [ key ]
              </button>
            )}
            <button
              type="button"
              onClick={reset}
              className="text-2xs uppercase tracking-label text-dim transition-colors hover:text-text active:text-text touch:px-2 touch:py-2"
            >
              [ defaults ]
            </button>
          </span>
        </footer>
      }
    >
      {/* The medium before the marks on it. Phosphor multiplies the palette
          rather than replacing it, and contrast moves everything that is not
          the background away from it together, so the hierarchy the palette
          was built with survives whatever is chosen here. */}
      <Group title="Tube">
        <Choice
          label="Phosphor"
          value={settings.phosphor}
          options={["white", "green", "amber", "ice"]}
          onChange={(v) => set("phosphor", v)}
        />
        <Choice
          label="Contrast"
          value={settings.contrast}
          options={["soft", "normal", "hard", "max"]}
          onChange={(v) => set("contrast", v)}
        />
        <Choice
          label="Bloom"
          hint="How far a lit mark bleeds into the glass."
          value={settings.bloom}
          options={["off", "soft", "normal", "heavy"]}
          onChange={(v) => set("bloom", v)}
        />
      </Group>

      <Group title="Layout">
        <Toggle label="Side panel" value={settings.sidebar} onChange={(v) => set("sidebar", v)} />
        {/* Hiding the chrome takes the header with it, and the header is where
            this panel is opened from. The map keeps a way back. */}
        <Toggle label="Header and footer" value={settings.chrome} onChange={(v) => set("chrome", v)} />
      </Group>

      <Group title="Screen">
        <Toggle label="Scanlines" value={settings.scanlines} onChange={(v) => set("scanlines", v)} />
        <Toggle label="Refresh sweep" value={settings.sweep} onChange={(v) => set("sweep", v)} />
        <Toggle label="Strike shake" value={settings.shake} onChange={(v) => set("shake", v)} />
        {/* Turning it on is the gesture the browser needs before it will let a
            page make a sound, so the audio is started from the toggle itself
            rather than from the first strike that wants to be heard. */}
        <Toggle
          label="Detector clicks"
          value={settings.clicks}
          onChange={(v) => {
            if (v) wake();
            set("clicks", v);
          }}
        />
      </Group>

      <Group title="Map">
        <Toggle
          label="Cloud field"
          hint="Thermal infrared from the five geostationary satellites, behind the map. The bright tops are the cold ones, which is where the lightning is about to be. Fetched from NASA and EUMETSAT; nothing else here leaves the page."
          value={settings.ir}
          onChange={(v) => set("ir", v)}
        />
        <Toggle label="Storm cells" value={settings.storms} onChange={(v) => set("storms", v)} />
        <Choice
          label="Cell detail"
          hint="Ring is the cell and its count, track adds where it has been, full adds where it is going."
          value={settings.cells}
          options={["ring", "track", "full"]}
          onChange={(v) => set("cells", v)}
        />
        <Choice
          label="Density window"
          hint="How far back the burn-in reaches. Four minutes is where it is raining lightning now; an hour is where it has been this session."
          value={settings.density}
          options={["4m", "20m", "1h"]}
          onChange={(v) => set("density", v)}
        />
        <Toggle
          label="Cell bounds"
          hint="Corner ticks around a 1° cell that is firing right now."
          value={settings.bounds}
          onChange={(v) => set("bounds", v)}
        />
        <Toggle
          label="Graticule"
          hint="The latitude and longitude grid."
          value={settings.graticule}
          onChange={(v) => set("graticule", v)}
        />
        <Toggle label="Frontiers" value={settings.frontiers} onChange={(v) => set("frontiers", v)} />
        <Toggle label="Daylight" value={settings.daylight} onChange={(v) => set("daylight", v)} />
        <Toggle label="Capitals" value={settings.capitals} onChange={(v) => set("capitals", v)} />
        <Toggle
          label="Detector threads"
          hint="As a strike lands, a line back to each detector that placed it."
          value={settings.stations}
          onChange={(v) => set("stations", v)}
        />
        <Choice
          label="Persistence"
          hint="How long a strike stays lit before it fades."
          value={settings.persistence}
          options={["short", "normal", "long"]}
          onChange={(v) => set("persistence", v)}
          />
      </Group>

      <Group title="Panel">
        <Toggle label="Rate trace" value={settings.trace} onChange={(v) => set("trace", v)} />
        <Toggle label="Most active" value={settings.regions} onChange={(v) => set("regions", v)} />
        <Toggle label="Strike feed" value={settings.feed} onChange={(v) => set("feed", v)} />
      </Group>
    </Panel>
  );
}
