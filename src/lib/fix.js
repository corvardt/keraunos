// How well a strike was pinned down, as the network reports it.
//
// Every frame carries `sig` (the stations that heard the sferic) and `mcg`.
// What `mcg` means is documented nowhere we could find, so it was measured:
// take the bearing from the strike to each station, sort them, and find the
// largest angular gap between neighbours. That reproduces `mcg` exactly, at
// r = 1.000 over 296 captured frames with a median error of 0.2 degrees, which
// is the rounding, but only when the gap is computed over stations whose
// `status` has bit 8 set. So `mcg` is the maximum circular gap in degrees, and
// bit 8 marks the stations that were used in the solution rather than the ones
// that merely received the signal.
//
// It is worth carrying because it is the one honest measure of how well a
// strike was located, and the obvious alternative is not. The station count
// saturates: `sig` is capped at 40 entries and 44% of frames sit at that cap,
// so a count of 40 means "40 or more" and says nothing about the better half of
// the data. The gap does not saturate, and it is nearly independent of the
// count (r = -0.38): a strike heard by twenty stations all lying to its west
// is fixed far worse than one heard by ten arranged around it, and only the gap
// knows that.
//
// Over those 296 strikes the gap ran 49 to 270 degrees, median 206: most of
// what this network sees, it sees from one side.

export const USED_BY_SOLUTION = 8; // the status bit marking a contributing station

// Ringed by stations at one end, seen from a single direction at the other.
// Between them it is a ramp and not a verdict: the quantity is continuous, and
// where "good" stops being good is our judgement rather than the network's.
const SURROUNDED = 120;
const ONE_SIDED = 260;

/** Confidence in the position, 0 to 1, or null where nothing was reported. */
export function fixQuality(gap) {
  if (!Number.isFinite(gap)) return null;
  if (gap <= SURROUNDED) return 1;
  if (gap >= ONE_SIDED) return 0;
  return 1 - (gap - SURROUNDED) / (ONE_SIDED - SURROUNDED);
}

/** The same reading in words, for a panel that has room to say it. */
export function fixLabel(gap) {
  if (!Number.isFinite(gap)) return null;
  if (gap <= SURROUNDED) return "surrounded";
  if (gap <= 180) return "partial";
  return "one-sided";
}

/**
 * Ids of the stations that contributed to the solution, not merely those that
 * heard it. Ids rather than positions: the network registry already knows where
 * each one stands, and a strike that outlives the frame it arrived in should
 * carry a reference rather than a copy.
 */
export function usedStations(sig) {
  if (!Array.isArray(sig)) return [];
  const used = [];
  for (const station of sig) {
    if (station.status & USED_BY_SOLUTION && Number.isFinite(station.sta)) used.push(station.sta);
  }
  return used;
}
