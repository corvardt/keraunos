# Keraunos

κεραυνός — the thunderbolt.

Live lightning strikes from the [Blitzortung](https://www.blitzortung.org/) network,
streamed over WebSocket and plotted on a d3 world map. Rendered as a phosphor
instrument: strikes arrive at full white and decay, worked cells burn into the
map, and clusters are tracked as storm cells with a bearing and a ground speed.

## Running

```sh
npm install
npm run dev      # dev server
npm run build    # production build
npm run lint
```

No configuration or API keys are required.

`KeraunosSeeker.cjs` is a standalone Node client that prints the same stream to
the terminal — `node KeraunosSeeker.cjs`.

## Using it

| | |
| --- | --- |
| **Point** | The map reads out the place under the pointer, its coordinates, and the strike count for that 1° cell |
| **Pick** | Click the map, a feed row, or a ranked place to narrow the feed to it; click again or press `esc` to clear |
| **Move** | Drag to pan, wheel or pinch to zoom to ~200 km; the region names across the top of the tube jump straight there |
| **Here** | Asks the browser for your location — only when pressed — and frames the map on it. Session only: not stored, not sent anywhere |
| **Hold** | The feed stops advancing while the pointer rests on it, and queues arrivals behind |
| **Keys** | `k` key panel · `c` configuration · `t` tube/paper · `+` `-` zoom · `0` whole world · `esc` close or clear |

Configuration (`c`) covers the screen effects, what the map draws, phosphor
persistence, and which panels are shown. It is stored in `localStorage`.

## Layout

| Path | Role |
| --- | --- |
| `src/assets/components/Seeker.jsx` | Headless websocket client; decodes frames and reports strikes + connection status upward |
| `src/assets/components/worldmap.jsx` | d3 Mercator map: land matrix, burn-in and storm layers, and the live strike loop |
| `src/lib/view.js` | Pan/zoom as a screen transform over the fitted world; clamping, region framing, visible extent |
| `src/lib/storms.js` | Clusters strikes into cells and tracks them between passes to derive motion |
| `src/lib/geo.js` | Bounding-box-indexed point-in-polygon lookup shared by the map and the place log |
| `src/lib/world.json`, `src/lib/us.json` | Country and US-state boundaries |
| `src/lib/water.geo.json` | Named seas and oceans, so water reads as "Coral Sea" rather than "open water" |
| `scripts/build-water.cjs` | Regenerates the above from the raw `src/lib/water.json` dump — `npm run build:water` |

## Notes on the map

The view is a plain screen transform over a fitted Mercator: `screen = k·p + t`.
Mercator is linear in scale and translate, so that composition folds back into a
real projection — every caller, `invert` included, keeps working without knowing
a view exists.

The land matrix is built for the visible extent at a spacing that follows the
zoom, so its cost is bounded however far in you go. The spacing tightens as
`k^0.75` rather than `k`: holding the on-screen gap constant is right over an
ocean and wrong once the tube is all land, where a continent fills in as a solid
field. The gap therefore opens gently with zoom, about 5px to 13px across the
range. Building it is tens of milliseconds, so it waits for the view to
settle; in between, the finished bitmap is drawn through the delta transform
rather than re-plotted. `GRID_MARGIN` trades pre-built land against that cost —
it is area-proportional, so raising it is more expensive than it looks.

Strikes are held in degrees rather than pixels and projected per frame, so the
view can move underneath a strike that is still burning.

## Notes on cost

The tree re-renders on a handful of independent clocks — strikes flush twice a
second, the feed releases a row every 130ms, storms recluster every two seconds.
Left alone, every one of those re-renders the map. The components are therefore
memoised and the handlers App passes down are stable, so a feed row arriving
reconciles that row and nothing else. The clock owns its own tick for the same
reason: the time changing is not a reason to re-render the map.

Pointer input is coalesced to one update per frame. A high-refresh mouse
outpaces the display, and each move would otherwise be a React render of the
largest component in the app.

The canvas loop is deliberately not keyed on the view. It reads position through
a ref, so panning never tears the loop down and reallocates the backing store
mid-drag.

