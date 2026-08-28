import { useId } from "react";

import Panel, { Group } from "./panel.jsx";
import { wake } from "../../lib/audio.js";
import { phosphorsFor } from "../../lib/palette.js";

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
        <span className="shrink-0 text-2xs uppercase tracking-label text-dim">{label}</span>
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
      {/* Wraps rather than overflowing. Seven options do not fit on one line
          beside their own name, and a row of them running off the edge of the
          panel is worse than a second line: the name holds its width and the
          choices fall under themselves, still right-aligned to the same edge
          every other control in the panel ends at. */}
      <span className="flex min-w-0 flex-wrap items-baseline justify-end gap-y-0.5">
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

/** An action rather than a setting: the brackets are the control here too. */
function Action({ label, hint, verb, onClick }) {
  return (
    <Row label={label} hint={hint}>
      <button
        type="button"
        onClick={onClick}
        className="shrink-0 text-2xs uppercase tracking-label text-dim transition-colors hover:text-text active:text-text touch:py-3 touch:pl-6"
      >
        [ {verb} ]
      </button>
    </Row>
  );
}

/**
 * The one control in this panel that takes something in.
 *
 * A file input drawn as itself would be the only button here that is not four
 * letters in brackets, and it would be the loudest thing in the panel by some
 * margin. So the real input is hidden and the label is the control, which is
 * also what makes it work from the keyboard.
 *
 * The value is cleared on the way out. Without that, picking the same file
 * twice in a row is silent, because the input has not changed and nothing
 * fires. Reloading the archive you are already watching is exactly what someone
 * does after leaving it by accident.
 */
function Upload({ label, hint, verb, accept, onFile }) {
  const id = useId();
  return (
    <Row label={label} hint={hint}>
      <label
        htmlFor={id}
        className="shrink-0 cursor-pointer text-2xs uppercase tracking-label text-dim transition-colors hover:text-text active:text-text touch:py-3 touch:pl-6"
      >
        [ {verb} ]
        <input
          id={id}
          type="file"
          accept={accept}
          className="sr-only"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            onFile(file);
          }}
        />
      </label>
    </Row>
  );
}

export default function Settings({
  settings,
  set,
  reset,
  theme,
  onClose,
  onKey,
  onSaveStrikes,
  onSaveFrame,
  archive,
  archiveRange,
  archiveError,
  onLoadArchive,
  onLeaveArchive,
}) {
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
      {/* The medium before the marks on it. Contrast moves everything that is
          not the background away from it together, so the hierarchy the palette
          was built with survives whatever is chosen here. */}
      <Group title="Tube">
        {/* Absent in light mode rather than disabled. A phosphor is a coating
            on a tube and paper has none: both the tints and the borrowed
            palettes are arithmetic for emitted light, and on a pale ground the
            first turn the graticule into the loudest mark on the map while the
            second wash out to beige. Paper has one ink, so there is nothing
            here to choose and no control to choose it with. */}
        {phosphorsFor(theme).length > 0 && (
          <Choice
            label="Phosphor"
            hint="The first four tint the whole tube one hue. The last three are borrowed palettes: only their colours change, never how far each mark sits from the ground."
            value={settings.phosphor}
            options={phosphorsFor(theme)}
            onChange={(v) => set("phosphor", v)}
          />
        )}
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

      <Group title="Screen">
        <Toggle label="Scanlines" value={settings.scanlines} onChange={(v) => set("scanlines", v)} />
        <Toggle label="Refresh sweep" value={settings.sweep} onChange={(v) => set("sweep", v)} />
        <Toggle
          label="Phosphor drift"
          hint="Two very soft blooms wandering the glass, so the brightness across the page is never flat."
          value={settings.drift}
          onChange={(v) => set("drift", v)}
        />
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
        {/* Silent until the reader has said where they are: there is no such
            thing as the sound of a strike from nowhere in particular, and the
            whole of this is the distance. */}
        <Toggle
          label="Thunder"
          value={settings.thunder}
          onChange={(v) => {
            if (v) wake();
            set("thunder", v);
          }}
        />
      </Group>

      <Group title="Layout">
        <Toggle label="Side panel" value={settings.sidebar} onChange={(v) => set("sidebar", v)} />
        {/* Hiding the chrome takes the header with it, and the header is where
            this panel is opened from. The map keeps a way back. */}
        <Toggle label="Header and footer" value={settings.chrome} onChange={(v) => set("chrome", v)} />
      </Group>

      {/* Which world, the field, the storm cells and the burn window are not
          here: they are on the tube, beside the region presets. They are the
          ones that get changed while watching rather than set once, and a
          control you reach for that often does not belong behind a panel. What
          is left is the furniture. */}
      <Group title="Map">
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
        <Toggle
          label="Frontiers"
          hint="Interior borders. Off leaves the coastline alone."
          value={settings.frontiers}
          onChange={(v) => set("frontiers", v)}
        />
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
        <Toggle label="Session day" value={settings.day} onChange={(v) => set("day", v)} />
        <Toggle label="Reach" value={settings.reach} onChange={(v) => set("reach", v)} />
        <Toggle label="Most active" value={settings.regions} onChange={(v) => set("regions", v)} />
        <Toggle label="Strike feed" value={settings.feed} onChange={(v) => set("feed", v)} />
      </Group>

      {/* The only group here that does something rather than sets something.
          It sits in this panel because this is where the instrument's own
          controls live, and because the alternative was two more words in a
          header that is already four. */}
      <Group title="Session">
        <Action
          label="Strikes"
          verb="csv"
          hint="Everything still retained, as it is held: where each strike was, when it happened, and when this browser heard about it. The gap between those two times is the network's own delay. Nothing is fetched to fill the file in, so it is as long as the session has been open. It reads back in below."
          onClick={onSaveStrikes}
        />
        <Action
          label="Frame"
          verb="png"
          hint="The tube as drawn, rewound or live. A picture of the moment rather than the moment itself: the address already carries the view, but the strikes under it belong to this session and cannot travel with a link, so a shared URL opens on the right coordinates and no weather."
          onClick={onSaveFrame}
        />
        {/* The other end of the CSV above. The file is not played as a
            recording of a map: the strikes go back into the front of the same
            pipe the network feeds, one at a time and at life size, so the cells
            are tracked and the rings drawn and the track fills in behind you,
            all of it built rather than replayed. */}
        {archive ? (
          <Action
            label="Archive"
            verb="live"
            hint={`Playing ${archive.name}: ${archiveRange}, ${archive.count.toLocaleString()} strikes.${
              archive.dropped ? ` ${archive.dropped.toLocaleString()} unreadable rows were skipped.` : ""
            }${
              archive.trimmed
                ? ` Only the last ${archive.count.toLocaleString()} are played, because the file is longer than the hour this instrument holds.`
                : ""
            } The field is off while it runs, because the sky behind the map is fetched for now and this is not now. Going back to live empties the session and relinks.`}
            onClick={onLeaveArchive}
          />
        ) : (
          <Upload
            label="Archive"
            verb="load"
            accept=".csv,text/csv"
            hint="A strike file saved above, played back at life size from its first strike. The map builds itself from it exactly as it does from the network, so the feed, the storm cells and the rewind track all work. But which detectors placed each strike is not in the file and cannot be, so the reach and the detector count read as unavailable. The live feed stops while it plays."
            onFile={onLoadArchive}
          />
        )}
        {/* Said in the panel it was asked for in, rather than as a dialog over
            the map: the file was picked here and this is where the reader is
            looking. */}
        {archiveError && (
          <p className="mt-1 text-xs leading-snug text-text glow">{archiveError}</p>
        )}
      </Group>
    </Panel>
  );
}
