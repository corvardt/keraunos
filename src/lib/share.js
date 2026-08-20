// How much of it we are getting.
//
// Everything else in this instrument is a reading of the weather. This is the
// one reading of the reading: the live arrival rate held up against how much
// lightning the planet is known to produce, so the question every visitor
// eventually asks — is this all of it? — has an answer on the screen rather
// than in a paragraph somewhere.
//
// The figure to hold it against is 44 flashes a second. It comes from the
// Optical Transient Detector, which spent five years in orbit counting flashes
// from above the weather rather than listening for them from beside it, and
// 44 ± 5 s⁻¹ is the global annual mean it settled on (Christian et al. 2003,
// JGR 108(D1), 4005; about 1.4 billion flashes a year). It is the closest thing
// there is to a true count, because a satellite looking down does not care
// whether a flash reached the ground or how many stations happened to be awake
// underneath it.
//
// What the gap between the two numbers is, and is not:
//
//   It is not a detection efficiency, and the temptation to call it one has to
//   be resisted out loud. Three things sit between the figures. The satellite
//   counted optical flashes, most of which never leave the cloud, and a VLF
//   network like this one hears cloud-to-ground far better than intracloud —
//   that is the bulk of the gap, and it makes the ratio read low. Against it,
//   what arrives here is strokes rather than flashes, and one cloud-to-ground
//   flash is commonly three or four of them, which pushes the ratio back up.
//   And the network's own coverage is not uniform: published comparisons put
//   Blitzortung's cloud-to-ground efficiency anywhere from about 25% to about
//   95% depending on how many stations are standing under the storm.
//
//   The first two of those do not cancel, and it is worth being exact about
//   where they leave the mark. Globally the intracloud-to-ground ratio runs
//   about 2 to 6, so somewhere near a quarter of all flashes reach the ground;
//   measured multiplicities put 2.6 to 3.7 return strokes in each of those.
//   A quarter of the flashes, three strokes apiece, is about three quarters of
//   44 — so an instrument that heard every cloud-to-ground stroke on the planet
//   would report something like 33 a second and still sit short of the tick.
//   The mark is not reachable, and that is not a flaw in the mark: it is the
//   difference between what the sky does and what the ground can hear of it.
//
//   Which is also why the tick is not moved to that 33. Both factors above are
//   wide, and multiplied they put the ceiling anywhere from the middle teens to
//   the middle fifties — wider than the scale it would be drawn on. A tick
//   there would carry far more uncertainty than the satellite's ±5 while
//   looking exactly as precise. Better a mark that is honestly somebody else's
//   measurement, with the reason it cannot be reached said in words.
//
//   What the bar is, then, is a share: the fraction of the world's flash rate
//   that this instrument is currently reporting, with all of the above baked
//   into it. That is worth showing, and it is worth showing as a comparison
//   rather than as a percentage with a decimal point on it.
//
// The mark is the annual mean and stays put. The real global rate breathes with
// the seasons — nearer 35 s⁻¹ in the northern winter and 55 in its summer, as
// the northern land masses do most of the world's thundering — and a mark that
// moved with them would be a second reading to interpret rather than the fixed
// point this exists to be.

/**
 * The global mean flash rate, flashes per second, and its stated uncertainty.
 * Every kind of lightning, cloud flashes included, which is why the bar drawn
 * against it is not expected to arrive.
 */
export const WORLD_RATE = 44;
export const WORLD_MARGIN = 5;

/** Where the scale ends. Above the satellite's own figure, so the mark sits inside it. */
export const SCALE_MAX = 55;

/**
 * The live rate as the same kind of number the world's is published in.
 *
 * Takes strikes per minute, because that is what the panel above it counts, and
 * hands back per second, because that is the unit the figure it is being
 * compared against was measured in. The fraction itself is not returned: it is
 * the bar against the mark, which is what the paragraph above argues it should
 * have been all along rather than a percentage with a decimal point on it.
 */
export function share(ratePerMinute) {
  return { perSecond: ratePerMinute / 60 };
}
