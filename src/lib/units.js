/**
 * Kilometres to whatever the reader asked to be told in.
 *
 * Only the readouts change. Everything upstream of a label stays in kilometres:
 * the strike geometry, the thunder delay, the reach bins, the cluster radii and
 * the tracking gates are all metric and stay that way, because they are the
 * instrument rather than the report. This converts at the last step, where a
 * number is about to be printed, so there is exactly one place a unit can be
 * wrong and it is a visible one.
 */
const MI_PER_KM = 0.621371;

export const distance = (km, units) => (units === "mi" ? km * MI_PER_KM : km);
export const distanceUnit = (units) => (units === "mi" ? "mi" : "km");
export const speedUnit = (units) => (units === "mi" ? "mph" : "km/h");

/**
 * A figure quoted in prose, rather than read off the instrument.
 *
 * The guide states the instrument's own limits in round numbers, because a
 * sentence saying a name appears within 400 km is making a point about roughly
 * how close, not reporting a measurement. Converted exactly those become 249
 * and 1,243, which read as precision the sentence never had, so the imperial
 * figure is rounded to two significant digits. Metric is returned untouched:
 * the numbers were chosen round in the first place.
 */
export function about(km, units) {
  return units === "mi" ? Number((km * MI_PER_KM).toPrecision(2)) : km;
}
