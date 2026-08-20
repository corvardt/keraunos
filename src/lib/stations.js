// The detecting network, as it reveals itself.
//
// Nobody publishes the station list, but every strike names the stations that
// heard it and where they stand. Listening is therefore enough to draw the
// network, and drawing it that way is more honest than a roster would be: what
// appears is the part of the network that is currently working, discovered by
// the weather as it moves over them. An empty region means nothing was heard
// there, which is a real thing to be able to see on a map of lightning.
//
// Keyed by station id, which is stable, so a detector found once is not found
// again on every strike it hears. The set is bounded by the network itself (a
// couple of thousand) rather than by the length of the session, so it is never
// evicted; a station that has gone quiet is still a station, and the map says
// so by letting its mark go dim rather than by removing it.

const network = new Map();

/** Folds a frame's station list into what is already known. */
export function record(sig, now = Date.now()) {
  if (!Array.isArray(sig)) return;
  for (const station of sig) {
    const { sta, lat, lon } = station;
    if (!Number.isFinite(sta) || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    // Null island is the Gulf of Guinea, not a detector: a station reporting
    // (0, 0) has no position rather than an interesting one.
    if (!lat && !lon) continue;
    const known = network.get(sta);
    if (known) known.heard = now;
    else network.set(sta, { lon, lat, heard: now });
  }
}

/** Every station heard from this session, newest sighting carried on each. */
export const stations = () => network;
