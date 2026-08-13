import Panel, { Group } from "./panel.jsx";
import { wake } from "../../lib/click.js";

/** A terminal switch: the brackets are the control, not decoration. */
function Toggle({ label, value, onChange }) {
  return (
    <div className="flex items-baseline justify-between py-1.5">
      <span className="text-2xs uppercase tracking-label text-dim">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={value}
        aria-label={label}
        onClick={() => onChange(!value)}
        className={`text-2xs uppercase tracking-label transition-colors ${
          value ? "text-text glow" : "text-dim hover:text-text"
        }`}
      >
        [ {value ? "on" : "off"} ]
      </button>
    </div>
  );
}

function Choice({ label, value, options, onChange }) {
  return (
    <div className="flex items-baseline justify-between py-1.5">
      <span className="text-2xs uppercase tracking-label text-dim">{label}</span>
      <span className="flex items-baseline">
        {options.map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={value === option}
            onClick={() => onChange(option)}
            className={`pl-2 text-2xs uppercase tracking-label transition-colors ${
              value === option ? "text-text glow" : "text-dim hover:text-text"
            }`}
          >
            {option}
          </button>
        ))}
      </span>
    </div>
  );
}

export default function Settings({ settings, set, reset, onClose }) {
  return (
    <Panel
      title="Configuration"
      onClose={onClose}
      footer={
        <footer className="flex items-center justify-between border-t border-line px-5 py-3">
          <span className="text-2xs uppercase tracking-label text-dim">Stored locally</span>
          <button
            type="button"
            onClick={reset}
            className="text-2xs uppercase tracking-label text-dim transition-colors hover:text-text"
          >
            [ defaults ]
          </button>
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
        <Toggle label="Storm cells" value={settings.storms} onChange={(v) => set("storms", v)} />
        <Choice
          label="Cell detail"
          value={settings.cells}
          options={["ring", "track", "full"]}
          onChange={(v) => set("cells", v)}
        />
        <Toggle label="Cell bounds" value={settings.bounds} onChange={(v) => set("bounds", v)} />
        <Toggle label="Graticule" value={settings.graticule} onChange={(v) => set("graticule", v)} />
        <Toggle label="Frontiers" value={settings.frontiers} onChange={(v) => set("frontiers", v)} />
        <Toggle label="Daylight" value={settings.daylight} onChange={(v) => set("daylight", v)} />
        <Toggle label="Capitals" value={settings.capitals} onChange={(v) => set("capitals", v)} />
        <Toggle
          label="Detector threads"
          value={settings.stations}
          onChange={(v) => set("stations", v)}
        />
        <Choice
          label="Persistence"
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
