// Burn-in, as a function of the strikes and an instant.
//
// The live map builds this incrementally — a cell is touched, it brightens, it
// is left alone, it fades — because doing it that way costs nothing per strike.
// Replay cannot: scrubbing to a moment four minutes ago means asking what the
// map looked like then, and the only honest answer is to derive it from the
// strikes that had happened by then.
//
// One difference from the incremental version, and it is deliberate. Live, a
// cell that keeps firing accumulates its count from the moment it was born, for
// as long as it stays alive. Here the count is the strikes inside the burn
// window, so a cell that has been working for an hour replays as the last four
// minutes of itself. That is what the burn is supposed to mean, and the heat
// scale is logarithmic, so the difference is a shade at most.

export function binStrikes(strikes, now, { size, burnMs, activeMs }) {
  const cells = new Map();

  for (const strike of strikes) {
    // The future has not happened yet, and the past has let go.
    const t = strike.t;
    if (t > now || now - t > burnMs) continue;

    const lon = Math.floor(strike.lon / size) * size;
    const lat = Math.floor(strike.lat / size) * size;
    const key = `${lon},${lat}`;
    const cell = cells.get(key);
    if (cell) {
      cell.count++;
      if (t > cell.last) cell.last = t;
    } else {
      cells.set(key, { lon, lat, count: 1, last: t });
    }
  }

  const bins = [];
  for (const cell of cells.values()) {
    bins.push({
      lon: cell.lon,
      lat: cell.lat,
      count: cell.count,
      fade: 1 - (now - cell.last) / burnMs,
      hot: now - cell.last < activeMs,
    });
  }
  return bins;
}
