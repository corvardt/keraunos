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
  shake: true,
  // Silent unless asked for. A page that makes noise on arrival is a page that
  // gets closed on arrival.
  clicks: false,
  // layout
  sidebar: true,
  chrome: true,
  // map
  storms: true,
  // How much a storm cell carries. `ring` is the cell and its count; `track`
  // adds where it has been; `full` adds where it is going and how fast. This
  // replaced a plain trails toggle, which could only say yes or no to the part
  // of it that was never the busiest.
  cells: "full",
  bounds: false,
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
  // panel
  feed: true,
  trace: true,
  regions: true,
};

/** Phosphor decay, in milliseconds. */
export const PERSISTENCE = { short: 3500, normal: 7000, long: 15000 };

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
