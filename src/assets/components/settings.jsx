import Panel, { Group } from "./panel.jsx";

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
      <Group title="Screen">
        <Toggle label="Scanlines" value={settings.scanlines} onChange={(v) => set("scanlines", v)} />
        <Toggle label="Refresh sweep" value={settings.sweep} onChange={(v) => set("sweep", v)} />
        <Toggle label="Strike shake" value={settings.shake} onChange={(v) => set("shake", v)} />
      </Group>

      <Group title="Map">
        <Toggle label="Storm cells" value={settings.storms} onChange={(v) => set("storms", v)} />
        <Toggle label="Cell bounds" value={settings.bounds} onChange={(v) => set("bounds", v)} />
        <Toggle label="Graticule" value={settings.graticule} onChange={(v) => set("graticule", v)} />
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
