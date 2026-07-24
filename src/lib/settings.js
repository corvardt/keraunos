import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "keraunos-settings";
// Written before the rename; read once so saved configuration survives it.
const LEGACY_KEY = "lightning-settings";

export const DEFAULTS = {
  // screen
  scanlines: true,
  sweep: true,
  shake: true,
  // map
  storms: true,
  trails: true,
  bounds: false,
  graticule: true,
  daylight: true,
  capitals: true,
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
