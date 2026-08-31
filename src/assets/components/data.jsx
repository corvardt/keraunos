import { useMemo } from "react";
import Panel, { Group } from "./panel.jsx";
import { motion, surge } from "../../lib/storms.js";
import { fixSpreadKm } from "../../lib/fix.js";
import { stations } from "../../lib/stations.js";
import { STEP_KM } from "../../lib/reach.js";

/**
 * Everything the instrument knows, as figures.
 *
 * The map refuses most numbers, and is right to: a reading laid over the
 * weather competes with it, which is why the fix gap came out of the sidebar
 * and became the sheaf drawn around each strike. But the figures did not stop
 * existing when they stopped being shown, and several of them are computed on
 * every pass and read by nothing at all — how many detectors this session has
 * heard from, how the two halves of the sky differ in reach, how far the cell
 * winding up over the Gulf has climbed above its own baseline.
 *
 * This is where they go. There is no picture here to compete with, so every
 * figure can carry the thing that makes it honest: what it is counted over,
 * and where it stops being a measurement. Nothing on this page is derived
 * anywhere else, and nothing is stored: it is the same session state the panels
 * are drawn from, read once more with the arithmetic left visible.
 *
 * Mounted only while it is open, which is what lets it be this expensive. The
 * medians below walk the retained window on every render, and the render only
 * happens for as long as somebody is looking at the page.
 */

const num = (n) => n.toLocaleString("en-US");

/** A figure that is not there yet, said the same way everywhere. */
const DASH = "—";

/**
 * One row: what it is, what it reads, and the units it reads in.
 *
 * Denser than the sidebar's `Readout`, deliberately. That one is a single
 * reading given the room to be glanced at from across a desk; this is a table,
 * and a table is read by running an eye down the left edge and stopping. So the
 * label carries the weight and the value sits at the right margin where the
 * decimal points line up.
 *
 * `note` is the caveat, and it is part of the row rather than a hover: a figure
 * whose limits are only visible to a pointer is a figure that is unqualified on
 * a phone and in a screenshot.
 */
function Row({ label, value, unit, note }) {
  return (
    <div className="flex break-inside-avoid flex-col gap-0.5 border-b border-line py-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-2xs uppercase tracking-label text-dim">{label}</span>
        <span className="shrink-0 text-xs text-text glow">
          {value}
          {unit && value !== DASH && <span className="ml-1 text-2xs text-dim">{unit}</span>}
        </span>
      </div>
      {note && <p className="text-2xs leading-relaxed text-dim">{note}</p>}
    </div>
  );
}

/**
 * Two columns where there is room for two, one where there is not.
 *
 * Newspaper columns rather than a grid, and the difference is visible. A grid
 * lays the rows out in pairs and stretches each to the height of whichever of
 * the two carried the longer caveat, so a one-line reading beside a four-line
 * one has its rule pushed to the bottom of a void. Every figure here is
 * qualified and the qualifications are not the same length, so that is most of
 * them. Columns pack each side independently and every rule sits under the row
 * it belongs to.
 */
function Columns({ children }) {
  return <div className="sm:columns-2 sm:gap-x-6">{children}</div>;
}

/** Minutes as the instrument says them elsewhere: 1h 04m, or 12m. */
function span(ms) {
  if (!ms) return DASH;
  const minutes = Math.round(ms / 60000);
  const hours = Math.floor(minutes / 60);
  return hours ? `${hours}h ${String(minutes % 60).padStart(2, "0")}m` : `${minutes}m`;
}

const clock = (ms) => new Date(ms).toISOString().slice(11, 16);

/** The middle value of a run of numbers, or null where there are none. */
function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const half = sorted.length >> 1;
  return sorted.length % 2 ? sorted[half] : (sorted[half - 1] + sorted[half]) / 2;
}

// How many of the most recent strikes the fix figures are taken over.
//
// Not the whole retained hour, and the reason is what the number means rather
// than what it costs. How well the network is placing what it hears is a
// property of which stations are awake and where the weather is standing, and
// both move; an hour of it averaged together is the middle of a quantity that
// was several different quantities while it was being measured. The last few
// thousand is the present state of the network, which is the only version of
// this figure worth printing.
const FIX_OVER = 2000;

export default function Data({
  stats,
  day24,
  reach,
  regions,
  storms,
  status,
  fieldHealth,
  history,
  replaying,
  archiveRange,
  onClose,
}) {
  // The retained window, read once. `history` is a ref rather than state
  // because nothing upstream re-renders when a strike lands, so the arrival
  // count is what says this is worth walking again.
  const held = useMemo(() => {
    const list = history.current;
    if (!list.length) return null;
    const gaps = [];
    for (let i = Math.max(0, list.length - FIX_OVER); i < list.length; i++) {
      const gap = list[i].gap;
      if (Number.isFinite(gap)) gaps.push(gap);
    }
    const gap = median(gaps);
    return {
      count: list.length,
      windowMs: list[list.length - 1].t - list[0].t,
      gap,
      // The gap in the units it actually costs: how far out the position may
      // be, which is the only reason the angle matters.
      spread: gap === null ? null : fixSpreadKm(gap),
      fixes: gaps.length,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [history, stats.total]);

  // The cells, at their extremes. Every figure here is already carried on the
  // storm objects or memoised onto them, so this is a walk rather than a
  // computation.
  const cells = useMemo(() => {
    let busiest = null;
    let fastest = null;
    let oldest = null;
    let biggest = null;
    for (const storm of storms) {
      if (!busiest || storm.count > busiest.count) busiest = storm;
      if (!oldest || storm.age > oldest.age) oldest = storm;
      const track = motion(storm);
      if (track && (!fastest || track.kmh > fastest.kmh)) fastest = { storm, ...track };
      const rate = surge(storm);
      if (rate && (!biggest || rate.sigma > biggest.sigma)) biggest = { storm, ...rate };
    }
    return { busiest, fastest, oldest, biggest };
  }, [storms]);

  // The network, as it has revealed itself. A module-level registry rather than
  // state: it is written by the socket and read here, and a count of it is a
  // count of the detectors this session has actually heard from, which is not
  // the same as the network and does not claim to be.
  const detectors = stations().size;

  // The cloud pyramid's own account of itself, or null while the layer is off.
  const sky = fieldHealth?.cloud ?? null;
  const night = reach?.night;
  const day = reach?.day;
  const gain =
    day?.tail && night?.tail ? Math.round(((night.tail - day.tail) / day.tail) * 100) : null;

  return (
    <Panel title="data" width={640} onClose={onClose}>
      <Group title="the sky">
        <Columns>
          <Row label="Strike rate" value={num(stats.rate)} unit="/min" />
          <Row
            label="Detected this session"
            value={num(stats.total)}
            note="Arrivals down this tab's own link. The hour handed over on connection is weather, not detection, and is not counted here."
          />
          <Row
            label="Retained"
            value={held ? num(held.count) : DASH}
            unit="strikes"
            note={held ? `over ${span(held.windowMs)}` : null}
          />
          <Row label="Cells tracked" value={num(stats.storms)} />
          <Row
            label="Winding up"
            value={num(stats.surging)}
            unit={stats.surging === 1 ? "cell" : "cells"}
            note="Flash rate two Poisson sigma above its own baseline, at a rate worth calling a storm."
          />
          <Row
            label="Busiest cell"
            value={cells.busiest ? num(cells.busiest.count) : DASH}
            unit="strikes"
            note={cells.busiest ? `${cells.busiest.extent} bins across` : null}
          />
          <Row
            label="Fastest cell"
            value={cells.fastest ? Math.round(cells.fastest.kmh) : DASH}
            unit="km/h"
            note={
              cells.fastest
                ? `bearing ${Math.round((cells.fastest.bearing + 360) % 360)}°`
                : "no cell watched long enough to state a course"
            }
          />
          <Row
            label="Longest lived"
            value={cells.oldest ? span(cells.oldest.age * 1000) : DASH}
          />
          <Row
            label="Biggest jump"
            value={cells.biggest ? cells.biggest.sigma.toFixed(1) : DASH}
            unit="σ"
            note={cells.biggest ? `${Math.round(cells.biggest.rate)} flashes/min` : null}
          />
          <Row
            label="Busiest minute"
            value={day24?.peak ? num(day24.peak.rate) : DASH}
            unit="/min"
            note={day24?.peak ? `at ${clock(day24.peak.t)} UTC` : null}
          />
        </Columns>
        {regions.length > 0 && (
          <div className="mt-3 border-t border-line pt-2">
            <div className="pb-1 text-2xs uppercase tracking-label text-dim">
              Where it is burning
            </div>
            {regions.map((region) => (
              <div
                key={region.place}
                className="flex items-baseline justify-between gap-3 py-0.5"
              >
                <span className="truncate text-xs text-dim">{region.place}</span>
                <span className="shrink-0 text-xs text-text">{num(region.count)}</span>
              </div>
            ))}
          </div>
        )}
      </Group>

      <Group title="the network">
        <Columns>
          <Row
            label="Detectors heard from"
            value={detectors ? num(detectors) : DASH}
            note="Stations that have appeared in a solution this session. The roster is not published; this is the part of the network the weather has walked over while the tab was open."
          />
          <Row
            label="Detectors per fix"
            value={stats.stations ?? DASH}
            unit="median"
            note="The feed caps its list at forty, so forty means forty or more."
          />
          <Row
            label="Fix gap"
            value={held?.gap === null || !held ? DASH : Math.round(held.gap)}
            unit="°"
            note={
              held?.fixes
                ? `widest angle of sky with no station in it, over the last ${num(held.fixes)} strikes`
                : null
            }
          />
          <Row
            label="Position may be out by"
            value={held?.spread ? Math.round(held.spread) : DASH}
            unit="km"
            note="What that gap costs. A strike heard from every side is pinned; one heard from a single quarter is not."
          />
          <Row
            label="Reach by day"
            value={day?.median ? num(Math.round(day.median)) : DASH}
            unit="km"
            note={day?.tail ? `p90 ${num(Math.round(day.tail))} km · ${num(day.n)} strikes` : "listening"}
          />
          <Row
            label="Reach by night"
            value={night?.median ? num(Math.round(night.median)) : DASH}
            unit="km"
            note={
              night?.tail ? `p90 ${num(Math.round(night.tail))} km · ${num(night.n)} strikes` : "listening"
            }
          />
          <Row
            label="Night gain"
            value={gain === null ? DASH : `${gain > 0 ? "+" : ""}${gain}`}
            unit="%"
            note="The D layer decaying after sunset, measured in nothing but lightning. East-west propagation asymmetry is comparable in size and is left in, so under five per cent is noise."
          />
          <Row
            label="Farthest bin reached"
            value={reach?.span ? num(reach.span * STEP_KM) : DASH}
            unit="km"
            note="Distance to the most distant station that helped place a strike. A floor on the reach, not a measurement of it: where it stops is mostly a fact about where volunteers live."
          />
        </Columns>
      </Group>

      <Group title="the instrument">
        <Columns>
          <Row
            label="Link"
            value={status.phase}
            note={status.host ?? status.message}
          />
          <Row
            label="Clock"
            value={archiveRange ? "archive" : replaying ? "rewound" : "live"}
            note={archiveRange ?? null}
          />
          {/* `delay` is already a fixed-point string by the time it reaches a
              panel: the flush formats it, so no two readouts can disagree
              about how many decimals a latency has. */}
          <Row
            label="Feed delay"
            value={stats.delay ?? DASH}
            unit="s"
            note="Median, as the network reports it. It stops counting before the frame leaves the network, so the trip here is longer than this says."
          />
          <Row label="Watched" value={span(day24?.watchedMs)} />
          <Row
            label="Handed over on arrival"
            value={span(day24?.seededMs)}
            note="The relay's own window, absorbed at the times the strikes actually happened rather than as arrivals."
          />
          <Row
            label="Curve span"
            value={span(day24?.spanMs)}
            unit="of 24h"
          />
          {/* The map reports one entry per tiled layer, and null for a layer
              that is switched off, so the key is present whether or not there
              is a field behind it. */}
          {sky && (
            <>
              <Row
                label="Sky coverage"
                value={Math.round((sky.held / sky.whole) * 100)}
                unit="%"
                note={`${num(sky.held)} of ${num(sky.whole)} tiles under the view`}
              />
              <Row
                label="Tiles short of a dish"
                value={num(sky.partial)}
                note={
                  sky.waiting
                    ? `${num(sky.waiting)} still in the air`
                    : "a tile missing a satellite draws its territory as clear sky, which is a reading and a wrong one"
                }
              />
            </>
          )}
        </Columns>
      </Group>
    </Panel>
  );
}
