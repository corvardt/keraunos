import { useCallback, useEffect, useState } from "react";

// Its own key rather than a field in the configuration, because the
// configuration has a [ defaults ] button and resetting the tube is not a
// request to be taught the instrument again.
const STORAGE_KEY = "keraunos-tour";

/**
 * Whether this browser has been walked through the instrument, and how to walk
 * it through again.
 *
 * `ready` gates the first run on the boot readout having cleared: the guide
 * points at real controls, and until then there are none on screen to point at.
 *
 * Read once at mount and never re-read. A tour that opened because another tab
 * wrote the key would be a tour interrupting a session already under way.
 */
export function useTour(ready) {
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === "seen";
    } catch {
      // No storage to remember it with. Never volunteer, rather than open
      // unbidden on every single visit; the header still carries it.
      return true;
    }
  });

  useEffect(() => {
    if (ready && !seen) setOpen(true);
  }, [ready, seen]);

  const close = useCallback(() => {
    setOpen(false);
    setSeen(true);
    try {
      localStorage.setItem(STORAGE_KEY, "seen");
    } catch {
      // Private mode. It will offer itself again next time, which is the
      // harmless direction to fail in.
    }
  }, []);

  const start = useCallback(() => setOpen(true), []);

  return { open, start, close };
}
