import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "keraunos-settings";
// Written before the rename; read once so saved configuration survives it.
const LEGACY_KEY = "lightning-settings";

export const DEFAULTS = {
  // tube: the medium itself. Defaults reproduce the palette index.css
  // declares, so an untouched configuration is the design as drawn.
  phosphor: "white",
  contrast: "normal",
  bloom: "normal",
  // screen
  scanlines: true,
  sweep: true,
  // A tube does not emit evenly. The faintest layer on the glass and the most
  // expensive to composite, so it is the first thing worth taking off on a
  // machine that is struggling.
  drift: true,
  shake: true,
  // Silent unless asked for. A page that makes noise on arrival is a page that
  // gets closed on arrival.
  clicks: false,
  // The other sound, and a different subject: the click is the instrument
  // counting, this is the weather arriving. Needs a position before it can do
  // anything at all, so it is off for a second reason as well.
  thunder: false,
  // layout
  sidebar: true,
  chrome: true,
  // map
  //
  // The world as a sphere rather than as a sheet. Off, and off by default: this
  // instrument is mostly about watching the whole planet at once, and a globe
  // shows you half of one. It is the mode you go to when you want to see where
  // the weather is rather than all of it, and it is the same planet the boot
  // screen draws, which is where it came from.
  globe: false,
  storms: true,
  // How much a storm cell carries. `ring` is the cell and its count; `track`
  // adds where it has been; `full` adds where it is going and how fast. This
  // replaced a plain trails toggle, which could only say yes or no to the part
  // of it that was never the busiest.
  cells: "full",
  bounds: false,
  // How far back the burn-in reaches. Four minutes is the live reading and the
  // default; the longer windows turn the same layer into where the lightning
  // has been over the session's own hour.
  density: "4m",
  // The one layer that is fetched rather than derived, and the only thing on
  // this map that comes from outside the strike feed. Cloud by default, because
  // it is the context the strikes are missing, it covers the whole planet, and
  // it is not clutter over the reading: it sits behind the world rather than on
  // it. Rain is the same idea measured from underneath, a ground-radar
  // composite of what is actually falling, and the two are alternatives rather
  // than layers, since where they overlap they are drawing the same storm.
  // Off, the map is exactly what it was before, and nothing is requested.
  field: "cloud",
  graticule: true,
  frontiers: true,
  daylight: true,
  capitals: true,
  // Opt-in: the detecting network is context for the instrument rather than
  // part of the reading, and most of the time you are here for the weather.
  // Named for the threads because that is all there is to see: the detectors
  // themselves are drawn only in the moment they hear something.
  stations: false,
  persistence: "normal",
  // Which of the panel's larger groups are folded shut, by name. A map rather
  // than a setting each, because it is one kind of fact about a list that will
  // go on growing, and because a group nobody has touched should not have to
  // exist in here at all: absent means open, which is what a fresh panel is.
  //
  // Separate from the toggles below, which answer a different question. Those
  // say whether a reading is wanted at all, and a curve that never fills is one
  // somebody may want gone for good. Folding says only "not while I am looking
  // at something else", and is expected to be undone a minute later.
  shut: {},
  // panel
  feed: true,
  trace: true,
  // The long view: the same rate the trace shows, banked by the minute and kept
  // for a day. Separate from `trace` because they answer different questions:
  // one is what is arriving now, the other is what kind of day it has been. And
  // because this one is empty for the first minutes of a session, which is
  // a reason someone might want it out of the way.
  day: true,
  // How far the network is hearing, split by daylight. Empty for the first
  // minutes of a session like the day curve, and for the same reason it is a
  // toggle rather than a fixture.
  reach: true,
  regions: true,
};

/** Phosphor decay, in milliseconds. */
export const PERSISTENCE = { short: 3500, normal: 7000, long: 15000 };

/**
 * How far back the burn-in reaches, in milliseconds.
 *
 * At four minutes this is weather: where it is raining lightning now, emptying
 * as the storms move on. Opened out, the same layer becomes the other reading,
 * which is where the lightning has been, and an hour of it draws the band the
 * planet actually fires in. Nothing is imported to do that and nothing is
 * stored: it is the session's own hour, and it goes when the tab does.
 *
 * The scale that draws it has to move with this. Counts saturate at a hundred
 * strikes in a cell, which is extreme in four minutes and ordinary in an hour,
 * so the saturation point is scaled by the window (see `burnFull` in the map)
 * or every cell that matters clips to solid white together.
 */
export const DENSITY = { "4m": 4 * 60 * 1000, "20m": 20 * 60 * 1000, "1h": 60 * 60 * 1000 };

export function useSettings() {
  const [settings, setSettings] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_KEY);
      return { ...DEFAULTS, ...JSON.parse(saved || "{}") };
    } catch {
      return { ...DEFAULTS };
    }
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  }, [settings]);

  const set = useCallback((key, value) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  }, []);

  const reset = useCallback(() => setSettings({ ...DEFAULTS }), []);

  return { settings, set, reset };
}
