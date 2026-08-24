// Bringing an hour back.
//
// The CSV in `save.js` was a one-way door. Everything this instrument knows is
// derived from a stream nobody archives and held for an hour in a tab, and that
// file was the only part of it that survived the tab being closed, but nothing
// could read it back, so the one afternoon the storm was worth keeping could be
// taken away and never returned to. This is the other half of that door.
//
// What comes back is not a recording of a map. It is the strikes, and they are
// put into the same pipe the relay feeds: one at a time, in arrival order, at
// life size. Everything downstream then builds itself exactly as it does live:
// the feed, the storm cells with their tracks and headings, the rate and its
// trace, the burn-in, the ranking, the rewind track filling in behind you. That
// is for the simple reason that nothing downstream can tell the difference.
//
// Replaying the *derived* map instead would have been easier and worth much
// less. That path already exists: it is what rewinding does, and what it can
// show is the limit of what can be rebuilt from an instant. Storm cells are
// tracked forward strike by strike, which is why a rewound map carries no
// rings. An archive played through the front of the pipe carries all of them.

// The retention this instrument was built around, used here as the ceiling on
// what a file is allowed to bring in. A larger file is not refused. It is
// played from its last strikes back, which is the same window a session of that
// length would have kept anyway.
export const MAX_ROWS = 120000;
// Four numbers a row, as text: the ceiling above lands somewhere near 8 MB, so
// this is generous by a factor of four and still small enough that a file
// picked by accident is rejected rather than parsed for a minute.
export const MAX_BYTES = 32 * 1024 * 1024;
// The columns `saveStrikes` writes, which is the only shape this reads.
const HEADER = "flash_utc,received_utc,lon,lat";
// A strike cannot be heard before it happens, but the two times are taken off
// two different clocks, the network's and the browser's, and a browser whose
// clock is a moment behind writes rows that say it was. A second of slack
// accepts that and still rejects a file whose columns are the wrong way round.
const SKEW_MS = 1000;
// The beat the player drains on. The feed itself arrives about eight times a
// second, so this is finer than the thing it is imitating and costs one
// comparison per tick when there is nothing due.
const TICK_MS = 100;

/**
 * One row, in the shape the socket hands upward.
 *
 * The time is the flash's own, in UTC, so a replayed feed row reads as the
 * moment the strike happened rather than the moment it is being played. The
 * rebasing below moves the instrument's clock, not the record.
 *
 * Three fields the file does not carry, and none of them is inventable. Which
 * detectors placed a strike, how many, and how well they surrounded it are
 * facts about the network at that second; the export drops them because the
 * retained strike drops them, and the honest value here is the absence. What
 * reads them handles null already: the reach histogram takes no reading from a
 * strike with no stations, and the medians in the panel skip what is not a
 * number rather than counting it as zero.
 */
function frame(strike) {
  return {
    // `Date.parse` guarded the range at the door, so this cannot throw.
    formattedTime: new Date(strike.at).toISOString().slice(11, 19),
    // Seconds, as the feed reports it: the gap between the strike happening and
    // this browser hearing about it. It is the one figure in the panel that
    // survives the round trip through the file intact, because it is the gap
    // between the two columns.
    delay: Math.max(0, (strike.t - strike.at) / 1000),
    lon: strike.lon,
    lat: strike.lat,
    used: null,
    stations: null,
    gap: null,
  };
}

/**
 * A strike file, read.
 *
 * This is somebody else's download, which makes it the only untrusted input
 * this instrument has: everything else arrives from the relay in a shape the
 * relay guarantees. So it is read defensively and cheaply, with a split, four
 * numbers and bounds, and a row that fails any of that is dropped and counted
 * rather than allowed to become a NaN somewhere in a render loop an hour later.
 *
 * Throws with something worth reading when the file is not one of these at all.
 * The count of quietly dropped rows comes back instead, because a file that is
 * ninety-nine percent good is worth playing and worth being told about.
 */
export function parseArchive(text) {
  if (text.length > MAX_BYTES) {
    throw new Error("that file is too large to be an hour of strikes");
  }
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  if (lines[0]?.trim().toLowerCase().replace(/\s+/g, "") !== HEADER) {
    throw new Error(`not a strike file: the first line has to be ${HEADER}`);
  }

  const strikes = [];
  let dropped = 0;
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const parts = line.split(",");
    if (parts.length < 4) {
      dropped++;
      continue;
    }
    const at = Date.parse(parts[0]);
    const t = Date.parse(parts[1]);
    const lon = Number(parts[2]);
    const lat = Number(parts[3]);
    if (
      !Number.isFinite(at) ||
      !Number.isFinite(t) ||
      !Number.isFinite(lon) ||
      !Number.isFinite(lat) ||
      lon < -180 ||
      lon > 180 ||
      lat < -90 ||
      lat > 90 ||
      t < at - SKEW_MS
    ) {
      dropped++;
      continue;
    }
    strikes.push({ lon, lat, t, at });
  }

  // One strike is a dot, not an hour: there is nothing to play forward from it
  // and nothing for the transport to be a track of.
  if (strikes.length < 2) throw new Error("no strikes in that file");

  // Written in arrival order, so this is a no-op on a file this instrument
  // wrote. It is here for the one that has been cut and pasted together out of
  // two sessions, where it is the difference between a playable file and a
  // clock that jumps backwards halfway through.
  strikes.sort((a, b) => a.t - b.t);

  const trimmed = Math.max(0, strikes.length - MAX_ROWS);
  const kept = trimmed ? strikes.slice(-MAX_ROWS) : strikes;
  return {
    strikes: kept,
    // The file's own extent, by when the strikes happened rather than when they
    // were heard: it is what the header will show, and it is a claim about the
    // weather rather than about somebody's network.
    from: kept[0].at,
    to: kept[kept.length - 1].at,
    dropped,
    trimmed,
  };
}

/**
 * The file, played.
 *
 * Every window, every decay and every accumulator in this instrument is
 * measured against the wall clock, because until now everything in it happened
 * now. Rather than teach all of them about a second kind of time, the file is
 * moved instead: its first strike is pinned to the moment playback starts, and
 * every strike after it keeps its own distance from that. An archive is then
 * indistinguishable from a session that began this second, and the burn window,
 * the clustering, the retention trim and the rewind track all work untouched.
 *
 * What that costs is the clock in the corner, which would otherwise read as the
 * present. `shift` is the whole of the correction and it is a display concern:
 * subtract it and the time is the archive's own again.
 *
 * A hidden tab is throttled to about a tick a second, so the drain releases
 * everything that has come due rather than one strike a tick. That is the same
 * burst a hidden tab gets from a live socket, and it lands in the same queue,
 * which is capped for exactly this reason.
 */
export function createPlayer(strikes, { onStrike, onEnd, tick = TICK_MS } = {}) {
  const shift = Date.now() - strikes[0].t;
  let cursor = 0;
  let id = null;

  const stop = () => {
    clearInterval(id);
    id = null;
  };

  const drain = () => {
    const now = Date.now();
    while (cursor < strikes.length && strikes[cursor].t + shift <= now) {
      onStrike?.(frame(strikes[cursor++]));
    }
    // The end of a file is not a network that has fallen over, and the two look
    // identical from underneath: strikes stop arriving. Said out loud here so
    // the instrument can say which one it is.
    if (cursor >= strikes.length) {
      stop();
      onEnd?.();
    }
  };

  return {
    shift,
    start() {
      if (id) return;
      id = setInterval(drain, tick);
      // The first strike is due the instant playback starts, and waiting a tick
      // for it means the map sits empty while the transport has already begun.
      drain();
    },
    stop,
  };
}
