/**
 * The two fields that can sit behind the map, and the cadence each runs on.
 *
 * One at a time, never both. They are looking at opposite ends of the same
 * column: infrared at the top of it from orbit, radar at what is falling out of
 * the bottom from the ground. So where they overlap they land on the same
 * storm, and two washes with two sets of bright cores over one another is one
 * wash too many for a map whose subject is the strikes on top of it.
 *
 * Both sources present the same four calls, so the map is written once and
 * reads the cadence out of here.
 *
 * This table used to live in `worldmap.jsx`, which was the only thing that
 * wanted it. The footer wants the moment now as well (see `momentFor`), and
 * that is a number that must not be arrived at twice: a map drawing 08:20 while
 * the footer says the sky is from 08:30 is a worse failure than either being
 * wrong on its own, because there is nothing on screen to say which to believe.
 */

import {
  createSky,
  REFRESH_MS as IR_REFRESH_MS,
  STEP_MS as IR_STEP_MS,
  LAG_MS as IR_LAG_MS,
} from "./ir.js";
import {
  createRain,
  REFRESH_MS as RAIN_REFRESH_MS,
  STEP_MS as RAIN_STEP_MS,
  LAG_MS as RAIN_LAG_MS,
} from "./rain.js";

export const FIELDS = {
  cloud: {
    label: "cloud",
    make: createSky,
    refresh: IR_REFRESH_MS,
    step: IR_STEP_MS,
    lag: IR_LAG_MS,
  },
  rain: {
    label: "rain",
    make: createRain,
    refresh: RAIN_REFRESH_MS,
    step: RAIN_STEP_MS,
    lag: RAIN_LAG_MS,
  },
};

/** The named field, or null when the setting is off or unknown to this table. */
export const fieldFor = (kind) => FIELDS[kind] ?? null;

/**
 * Which moment the field is showing.
 *
 * Rounded to the ten minutes the satellites and the radar composites themselves
 * run at. Live, that is the clock less the time it takes a scan to reach a
 * server; rewound, it is where the transport is standing, which is what makes
 * the weather move when the map is scrubbed instead of hanging over the past
 * like a still.
 *
 * A lower bound on the age of what is actually drawn, and it is worth being
 * clear that it is only that. This is the moment the services were *asked* for,
 * and both answer it the same way, with the newest frame at or before it, so a
 * dish that has published nothing recently is showing something older than this
 * says. It is the honest number to put in front of a reader anyway: it is the
 * one the whole screen shares, and a per-tile age would be five different
 * numbers for one picture.
 */
export function momentFor(kind, replayAt, now) {
  const field = fieldFor(kind);
  if (!field) return null;
  return momentAt(field.step, field.lag, replayAt, now);
}

/**
 * The same arithmetic, for a fetched layer that is not one of the two fields.
 *
 * The coverage layer is the only such thing so far: it is not weather behind
 * the map and does not take a turn with the others, but it comes off a service
 * on a published step and is exactly as late as they are, so it picks its
 * moment the same way. Written once here rather than twice, because two
 * roundings that were meant to agree and quietly stopped is the failure this
 * file exists to prevent.
 */
export function momentAt(step, lag, replayAt, now) {
  const at = replayAt ?? now - lag;
  return Math.floor(at / step) * step;
}
