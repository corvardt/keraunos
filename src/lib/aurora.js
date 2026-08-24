/**
 * The auroral oval: OVATION, off NOAA's Space Weather Prediction Center.
 *
 * The other thing the sky does with electricity, and the one layer here that is
 * not about the troposphere at all. A lightning map is a map of charge finding
 * its way to the ground through air; this is charge arriving from the sun and
 * being steered into the atmosphere by the earth's own field. They share a
 * planet, a medium and nothing else, which is exactly why this layer can be on
 * at the same time as everything else without any of the trouble the fields
 * give each other. The oval lives at the latitudes lightning does not, so it
 * cannot cover a reading, and it is the one addition that needed no argument
 * about which ink it may have.
 *
 * ── What the numbers are ────────────────────────────────────────────────────
 *
 * One value per whole degree of the planet: 360 longitudes by 181 latitudes,
 * 65,160 in all, each the modelled *probability of visible aurora* at that
 * point, in percent. Not a brightness and not a measurement: OVATION is a model
 * driven by the solar wind as it is read at L1, about an hour upstream of
 * us, which is what buys the forecast its lead time and is the whole reason the
 * product exists.
 *
 * That makes this the only layer on the instrument that has not happened yet,
 * and it is labelled as such wherever it is named. `ir.js` opens by saying that
 * nothing here is a forecast and that every pixel was measured; that stays true
 * of the weather. This is a different subject, carried in a different register,
 * and it is allowed in on the condition that it never pretends otherwise, so a
 * decoded frame carries both of the service's own times, and the lead between
 * them is the reading's honesty rather than a comment's claim.
 *
 * The footer answers the other question, which was going unanswered entirely:
 * whether the frame on the glass is still being kept current. A service that
 * stops replying leaves the last oval drawn, and a layer nobody is updating
 * looks exactly like a layer nothing is happening on.
 *
 * ── Why there is a floor ────────────────────────────────────────────────────
 *
 * The model reports a probability everywhere, including places the aurora has
 * never been. Below about five percent the field is dominated by its own noise:
 * measured against a live frame, cells at one percent reach the equator, which
 * is not a statement anybody would defend. At five the lowest cell in the world
 * sat at 48° of latitude, which is the auroral oval doing what it does.
 *
 * A floor on the probability rather than on the latitude, and that distinction
 * is the point. A hard latitude cut would be a lie during the one event this
 * layer exists to show: a severe storm pushes the oval down over places that
 * ordinarily never see it, and those cells arrive with high probabilities and
 * pass a probability floor exactly as they should. The floor removes noise, not
 * geography.
 */

import { useEffect, useState } from "react";

// Published to anyone who asks, with `access-control-allow-origin: *`, so this
// is fetched straight from the tab. No key, no account, and no proxy of our own
// in front of it, unlike EUMETSAT, which needs `functions/msg.js` because it
// will serve a picture and then not say who may read it.
const SOURCE = "https://services.swpc.noaa.gov/json/ovation_aurora_latest.json";

export const LON_COLS = 360;
export const LAT_ROWS = 181;
export const CELLS = LON_COLS * LAT_ROWS;

/** Below this, in percent, the model is reporting its own noise. See above. */
export const FLOOR = 5;

/**
 * How often the service is asked.
 *
 * SWPC republishes about every five minutes and the file carries a one-minute
 * `cache-control`, so anything faster than this re-fetches a frame that has not
 * changed. It is 148 KB on the wire once gzipped, the whole planet in one
 * request, which is the trade this layer makes against the tile pyramids: no
 * grid, no queue, no eviction, and no second request however far you pan.
 */
export const REFRESH_MS = 5 * 60 * 1000;

/**
 * Where a cell sits in the packed grid.
 *
 * The service publishes `[lon, lat, aurora]` triples in a fixed order, with
 * longitude 0…359 outermost and latitude −90…90 innermost, which makes the
 * whole of it addressable arithmetic and the coordinates in the payload
 * redundant. They are dropped on decode: keeping 65,160 two-element arrays
 * alive to hold numbers that are implied by their own position is three
 * megabytes of heap for a lookup that is one multiply.
 */
export const indexOf = (lon, lat) => lon * LAT_ROWS + (lat + 90);

/**
 * The payload, as a grid.
 *
 * Verified rather than trusted: the order above is a property of somebody
 * else's file, and a layout that quietly changed would not throw. It would
 * draw a plausible aurora in the wrong place, which is the failure this whole
 * instrument is least able to notice. So the triples are checked against the
 * positions they claim as they are read, and a file that disagrees is refused
 * whole rather than half-decoded.
 *
 * Values are clamped into a byte. The service quotes a percentage and cannot
 * exceed 100, so this is a guard on a malformed frame rather than a scaling.
 */
export function decode(payload) {
  const points = payload?.coordinates;
  if (!Array.isArray(points) || points.length !== CELLS) {
    throw new Error(`aurora: expected ${CELLS} points, got ${points?.length ?? "none"}`);
  }

  const grid = new Uint8Array(CELLS);
  for (let i = 0; i < CELLS; i++) {
    const point = points[i];
    const lon = point[0];
    const lat = point[1];
    if (indexOf(lon, lat) !== i) {
      throw new Error(`aurora: point ${i} is [${lon}, ${lat}], which is not where it should be`);
    }
    grid[i] = Math.max(0, Math.min(255, point[2]));
  }

  return {
    grid,
    // Both, because the gap between them is the reading's own honesty: the
    // solar wind was seen at one time and this is what it is expected to do at
    // another. Kept as the pair rather than the lead, so whoever reads them can
    // decide which of the two questions they are asking.
    observedAt: Date.parse(payload["Observation Time"]),
    forecastAt: Date.parse(payload["Forecast Time"]),
  };
}

/**
 * The probability at a point, in percent, or zero off the grid.
 *
 * Nearest cell rather than interpolated. The model's own resolution is the
 * degree, and smoothing between cells would draw a gradient the data does not
 * have. The layer's softness comes from how it is painted, not from inventing
 * values between the ones published.
 */
export function probabilityAt(grid, lon, lat) {
  if (!grid) return 0;
  // Longitude arrives signed from the map and unsigned from the service.
  const east = Math.round(((lon % 360) + 360) % 360) % LON_COLS;
  const north = Math.round(lat);
  if (north < -90 || north > 90) return 0;
  return grid[indexOf(east, north)];
}

/**
 * Every block worth drawing, as `[lon, lat, percent, lonSpan, latSpan]`, with
 * longitude signed and the spans in degrees.
 *
 * ── Why this is not simply every lit cell ───────────────────────────────────
 *
 * It was, and it made the globe crawl. The model publishes at a degree, and a
 * degree is about two pixels at world zoom, so drawing one mark per cell is
 * some nine thousand antialiased fills for a band a reader could not resolve
 * that finely if they tried. On the flat map that cost lands once per settle
 * and is merely wasteful. On the globe the bitmap is keyed to where the planet
 * is pointed, so it was nine thousand marks and three projections apiece on
 * every frame of a drag, which is what the turn was spending itself on.
 *
 * So the grid is walked at whatever step actually resolves on the glass, and
 * each step reports the strongest cell under it. The strongest rather than the
 * mean: the oval is a narrow band inside a mostly empty field, and averaging a
 * block that is half band and half nothing halves the band, and the layer would
 * fade exactly as it was zoomed out, which is the opposite of what a summary
 * should do.
 *
 * ── Why longitude is stepped separately ─────────────────────────────────────
 *
 * Because a degree of longitude is not a distance. At 70°, where the oval sits,
 * the meridians have closed to a third of their equatorial spacing, and at the
 * pole all 360 of them meet at a point, so a fixed step oversamples the top of
 * the oval by three times and the pole by everything. Dividing the step by the
 * cosine asks for marks that are square on the ground rather than square in the
 * table, which is both many fewer of them and an even band rather than one that
 * silts up around the pole.
 *
 * `spacing` is in degrees at the equator; 1 is every cell, which is what a
 * zoomed-in view asks for and what the check script measures against.
 */
export function litCells(grid, spacing = 1) {
  if (!grid) return [];

  const step = Math.max(1, Math.round(spacing));
  const lit = [];

  for (let lat = -90; lat <= 90; lat += step) {
    const latSpan = Math.min(step, 90 - lat + 1);
    // The cosine is taken at the edge of the row nearest the pole, which is
    // where the meridians are closest and so where the step has to be widest.
    // Taken at the middle instead, the poleward half of every row still
    // oversamples, and the error is small at 60° and unbounded at 89°.
    const edge = Math.abs(lat) > Math.abs(lat + latSpan - 1) ? lat : lat + latSpan - 1;
    const cos = Math.cos((Math.abs(edge) * Math.PI) / 180);
    // Capped at a quarter of the world: past that a "block" is no longer a
    // place, and one mark spanning 90° of longitude is a claim about ground it
    // was never asked about.
    const lonStep = Math.max(1, Math.min(90, Math.round(step / Math.max(cos, 1e-3))));

    for (let lon = 0; lon < LON_COLS; lon += lonStep) {
      const lonSpan = Math.min(lonStep, LON_COLS - lon);
      let peak = 0;
      for (let dlat = 0; dlat < latSpan; dlat++) {
        for (let dlon = 0; dlon < lonSpan; dlon++) {
          const value = grid[indexOf(lon + dlon, lat + dlat)];
          if (value > peak) peak = value;
        }
      }
      if (peak < FLOOR) continue;
      // Named at the middle of the block it stands for, so the mark is centred
      // on the ground it summarises rather than hung off its south-west corner.
      const midLon = lon + (lonSpan - 1) / 2;
      lit.push([
        midLon > 180 ? midLon - 360 : midLon,
        lat + (latSpan - 1) / 2,
        peak,
        lonSpan,
        latSpan,
      ]);
    }
  }
  return lit;
}

/**
 * The layer, held for as long as it is switched on.
 *
 * Nothing is fetched until somebody asks for it, and nothing is fetched while
 * the tab is in the background, the same rule the tile pyramids keep, and for
 * the same reason: a hidden page spending somebody else's bandwidth on a
 * picture nobody can see is a cost with no reader at the end of it.
 */
/**
 * How long a frame may sit on the glass before it stops being nearly true.
 *
 * The service publishes every five minutes and the oval itself moves over tens
 * of minutes, so a frame that failed to refresh once is still a fair picture
 * and saying anything about it would be noise. Four missed refreshes is twenty
 * minutes, which is long enough that what is drawn is a different sky from the
 * one outside, and long enough that the cause is an outage rather than a blip.
 */
const STALE_MS = 20 * 60 * 1000;

export function useAurora(on) {
  const [state, setState] = useState(null);

  useEffect(() => {
    if (!on) {
      // Dropped rather than kept warm. It is a 65 KB array and the far more
      // important half is that switching the layer back on should show what the
      // sun is doing now, not what it was doing when the layer was last closed.
      setState(null);
      return;
    }

    let live = true;
    let fresh = 0;
    let warned = false;
    const controller = new AbortController();

    const ask = async () => {
      if (document.hidden) return;
      try {
        const response = await fetch(SOURCE, { signal: controller.signal });
        if (!response.ok) throw new Error(`aurora: HTTP ${response.status}`);
        const decoded = decode(await response.json());
        if (!live) return;
        fresh = Date.now();
        warned = false;
        // Stamped with when it was fetched, not with the moment it models.
        // The panel already reads both of the service's own times out of the
        // payload. This is the other question, and only this can answer it:
        // whether what is on the glass is still being kept up.
        setState({ ...decoded, fresh, stale: false });
      } catch (error) {
        // A frame that does not arrive leaves the last one on the glass, which
        // is the honest state for a while: the oval moves over tens of minutes,
        // so the picture already drawn is still very nearly true. What was
        // missing is the end of that sentence: it stops being true, and
        // nothing said so. Only an abort is silent; that is this effect tearing
        // itself down.
        if (error.name === "AbortError" || !live) return;
        if (!warned) {
          warned = true;
          console.warn(`[keraunos] aurora: ${error.message}`);
        }
        if (fresh && Date.now() - fresh > STALE_MS) {
          setState((prev) => (prev && !prev.stale ? { ...prev, stale: true } : prev));
        }
      }
    };

    ask();
    const timer = setInterval(ask, REFRESH_MS);
    // A tab coming back to the front has been sitting on a frame that stopped
    // being refreshed when it went away, so it asks again on the way in rather
    // than waiting out the rest of an interval it did not spend looking.
    document.addEventListener("visibilitychange", ask);

    return () => {
      live = false;
      controller.abort();
      clearInterval(timer);
      document.removeEventListener("visibilitychange", ask);
    };
  }, [on]);

  return state;
}
