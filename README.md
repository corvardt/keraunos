# Keraunos

κεραυνός: the thunderbolt.

Live lightning strikes from the [Blitzortung](https://www.blitzortung.org/) network,
streamed over WebSocket and plotted on a d3 world map. Rendered as a phosphor
instrument: strikes arrive at full white and decay, worked cells burn into the
map, and clusters are tracked as storm cells with a bearing and a ground speed.
The instrument also reports on itself, showing how well each strike was located
and by which detectors, and the last hour can be rewound and replayed.

## Running

```sh
npm install
npm run dev      # dev server
npm run build    # production build
npm run lint
npm run check    # capitals, solar position, storm tracking
```

No configuration or API keys are required.

`KeraunosSeeker.cjs` is a standalone Node client that prints the same stream to
the terminal: `node KeraunosSeeker.cjs`.

## Using it

| | |
| --- | --- |
| **Point** | The map reads out the place under the pointer, its coordinates, and the strike count for that 1° cell |
| **Pick** | Click the map, a feed row, or a ranked place to narrow the feed to it; click a storm cell to narrow to the cell rather than the country. Click again or press `esc` to clear |
| **Move** | Drag to pan, wheel or pinch to zoom to ~200 km; the region names across the top of the tube jump straight there |
| **Rewind** | The track along the bottom of the tube holds up to the last hour. Drag anywhere on it to set the clock down at that moment; it then runs forward at life size until it catches up and hands back to live. It is drawn from the first frame and fills toward the half a minute it needs before there is anything worth scrubbing into |
| **Here** | Asks the browser for your location (only when pressed) and frames the map on it, then reads out how far away the nearest strike is, and how long until its thunder. Session only: not stored, not sent anywhere |
| **Link** | Zoomed in, the address carries the view as `#lon/lat/k`, so a view can be handed to someone |
| **Hold** | The feed stops advancing while the pointer rests on it, and queues arrivals behind |
| **Guide** | Seven steps that light each control on the running map in turn. Opens itself once on a first visit; `g` or `guide` afterwards, `esc` to skip |
| **Keys** | `k` key panel · `c` configuration · `g` guide · `t` tube/paper · `+` `-` zoom · `0` whole world · `esc` close or clear. The rewind track takes arrow keys, `home` and `end` when focused |

The guide is the way in and the key panel is the reference; they are not the
same document and neither one replaces the other. The guide runs on the live
instrument, dimming everything except the control it is talking about and
leaving that control working, so the first minute is spent using the thing
rather than reading about it. It says the seven things worth knowing before you
can read the map at all, and then stops.

The key panel (`k`) is the catalogue the guide hands off to: every mark on the
map and every figure beside it, in full, for looking up. Configuration (`c`) is
stored in `localStorage` and covers five groups:

| Group | What it holds |
| --- | --- |
| **Tube** | Phosphor (white, green, amber, ice), contrast, and bloom: the medium itself, before anything is drawn on it |
| **Layout** | Whether the side panel, header and footer are shown at all |
| **Screen** | Scanlines, refresh sweep, strike shake, detector clicks |
| **Map** | Storm cells and how much detail they carry, the density window, cell bounds, graticule, frontiers, daylight, capitals, detector threads, phosphor persistence |
| **Panel** | Rate trace, activity ranking, strike feed |

## Layout

| Path | Role |
| --- | --- |
| `src/assets/components/Seeker.jsx` | Headless websocket client; decodes frames, records the detecting network, reports strikes and connection status upward |
| `src/assets/components/worldmap.jsx` | d3 Mercator map: land matrix, burn-in and storm layers, and the live strike loop |
| `src/assets/components/transport.jsx` | The rewind track: seek into the retained window and play forward from there |
| `src/assets/components/tour.jsx` | The guided pass: lights one real control at a time and leaves the hole open |
| `src/lib/view.js` | Pan/zoom as a screen transform over the fitted world; clamping, region framing, visible extent |
| `src/lib/storms.js` | Clusters strikes into cells and tracks them between passes to derive motion |
| `src/lib/burn.js` | Burn-in as a pure function of the strikes and an instant, which is what makes replay possible |
| `src/lib/tour.js` | Whether this browser has been walked through the instrument, and when the walk may start |
| `src/lib/fix.js` | How well a strike was located, derived from the stations that fixed it |
| `src/lib/stations.js` | The detecting network, assembled from the strikes as they arrive |
| `src/lib/geo.js` | Bucketed point-in-polygon lookup shared by the map and the place log, and great-circle distance |
| `src/lib/frontiers.js` | Interior borders, extracted from the country polygons already bundled |
| `src/lib/theme.js`, `src/lib/palette.js` | The medium, and the derivation that customises it without letting CSS and canvas drift apart |
| `src/lib/click.js` | The detector tick, synthesised rather than sampled |
| `src/lib/sun.js` | Solar position and the terminator; lightning is a daily rhythm before it is anything else |
| `src/lib/capitals.js` | Capitals as sparse orientation marks; checked against the country polygons by `npm run check:capitals` |
| `src/lib/world.json` | Country boundaries; the only geometry the first frame needs |
| `src/lib/us.json`, `src/lib/water.geo.json` | US states and named seas, fetched after mount (see below) |
| `scripts/shrink-geo.cjs` | Rounds the boundary data to a precision the tube can show (`npm run shrink:geo`) |
| `scripts/build-water.cjs` | Regenerates the above from the raw `src/lib/water.json` dump (`npm run build:water`) |

## Notes on the fix

Every frame carries more than a position. `sig` is the list of stations that
heard the sferic, with their coordinates, and `mcg` is a number nobody
documents. It was measured rather than guessed: take the bearing from the strike
to each station, sort them, and find the largest angular gap between neighbours.
That reproduces `mcg` at r = 1.000 over 296 captured frames, with a median error
of 0.2 degrees, which is the rounding. But only when the gap is computed over
stations whose `status` has bit 8 set, which is therefore what that bit means:
used in the solution, as opposed to merely having received the signal.

So `mcg` is the maximum circular gap in degrees, and it is the honest measure of
how well a strike was pinned. The obvious alternative is not: `sig` is capped at
40 entries and 44% of frames sit at that cap, so a station count of 40 means "40
or more" and says nothing about the better half of the data. The gap does not
saturate, and it is nearly independent of the count (r = -0.38). A strike heard
by twenty stations all lying to its west is fixed far worse than one heard by
ten arranged around it, and only the gap knows that.

Over those 296 strikes the gap ran 49 to 270 degrees, median 206: most of what
this network sees, it sees from one side. The map says so in two ways. The mark
is drawn at 0.72 to 1.0 of full weight, gently, since this is a caveat on the
reading rather than a verdict on it, and the ping and the bolt are never
softened because how well a strike was placed says nothing about whether it
happened. And with detector threads turned on, each strike throws a line back to
every station that helped place it, for under a second: a strike caught in a
full sheaf was pinned from every side, one wearing a fan was heard from a single
direction. Nobody publishes where the detectors are, so their positions are
assembled from the strikes themselves.

## Notes on rewinding

How far back there is to go is not a fixed number. An hour is retained, but
only if an hour fits: a strike costs about 64 bytes and the ceiling is 120,000
of them, so at the quiet end of the world's rate the hour is comfortable and at
the peak the ceiling binds first and the window is shorter. Nothing pretends
otherwise. The span is measured from the oldest strike actually held, so the
track is as long as the history there is, and it grows as the session runs.

Retention and clustering are two numbers for a reason. A storm cell exists for
tens of minutes and is tracked between passes; built over an hour it would be
the union of everywhere the storm had been, which is neither a cell nor where it
is. So the clustering keeps its twelve minutes while the history around it grew.
They were one constant, and lengthening it would have quietly wrecked the other.

Replay derives rather than remembers. Everything the live pipeline builds
incrementally is a pure function of the strikes and a time, so scrubbing is that
function called with a different time. `burn.js` is that function, extracted so
the live map and the replayed one cannot disagree about what a burn is.

It runs on two clocks for the same reason the live map does: the marks decay
visibly and want the fast one, at 10 Hz, while the burn-in is a slow
accumulation and is rebuilt at 2 Hz exactly as it is live. Both are quantised so
a tick landing inside the same slice reuses the last derivation. On a full
25,000 strike window that is 1.8 ms per burn and 0.5 ms per mark filter, about
8 ms/s in total.

The window is now an hour rather than twelve minutes, which would have made
every one of those passes five times longer had they stayed as filters over the
whole of it. They do not: strikes are appended in arrival order, so any window
over them is a contiguous run whose start is found by bisection and passed on as
a slice. The clustering asks for twelve minutes of the hour and walks twelve
minutes; a burn asks for four and walks four. Cost follows the window each pass
actually uses rather than the history it is drawn from, which is what makes
lengthening the history a change in depth rather than in price.

Setting the clock down starts it running forward again at life size, rather than
freezing a frame: what you want from a map of a storm is to watch the storm
move. Three things are deliberately not replayed. Storm rings are tracked
forward strike by strike and cannot be reconstructed from an instant, so rather
than show stale rings over a past sky the map shows none. Bolts and the chassis
knock are events, and an event does not happen twice. And live arrivals keep
draining silently behind you, so returning to live finds the present already
there rather than empty.

## Notes on the guide

The instrument is legible once you know six or seven things and opaque until
you do, and none of those things are guessable from a header reading `tube |
guide key cfg`. That is a real cost of the terseness and worth paying, but only
if something pays it back.

So the guide dims the tube and cuts a hole over one real control at a time.
Which means the map keeps drawing behind it, the feed keeps releasing, and the
lit control still works: the hole is four bands around a gap rather than a
mask, so there is genuinely nothing over it to click through. Pressing `here`
while the guide is explaining `here` is the shortest version of the
explanation. The dim is what advances the step, so the two gestures never
compete for the same pixel.

Seven steps and no more. The key panel already says everything, at length, and
a guide that also said everything would be a worse copy of it read at the worst
possible moment. These are only the things you cannot read the map without: what
a mark is, how to interrogate one, how to move, what the four figures on the
right are measuring, what the ranking is counting, that the last hour is still
there, and where the rest of it lives. The last step points at `key`
and gets out of the way.

Steps drop themselves when there is nothing to point at. Each names the
elements it is about, and a step whose elements are all switched off is not a
step: turn the side panel off and the guide is five steps long and never
mentions a feed. That filter runs after the first commit rather than during it,
since during render the document is still the one from before the guide
existed, and anything mounting alongside it would read as switched off.

It runs once, on a first visit, after the boot readout clears. That flag is its
own key in `localStorage` rather than a field in the configuration, because the
configuration has a `[ defaults ]` button and resetting the phosphor is not a
request to be taught the instrument again.

## Notes on the labels

Capitals are lit by the weather rather than drawn as furniture. A permanent
label set competes with the strikes for the same eye, and this is not an atlas:
the only moment a place name earns its space is when something is happening
there and you need to know where "there" is. A capital therefore surfaces when
a burning cell is within 400 km of it and fades on the same four-minute decay
as the smudge underneath. A quiet map carries no names at all; pointing at it
already names whatever is under the cursor, in the corner, on demand.

That radius is a real distance, not a span in degrees. Four degrees of
longitude is 445 km over Nairobi and 223 km over Oslo, so a degree box would
let a storm place itself from twice as far away in the tropics as in
Scandinavia. The lookup still walks a box of 1° cells (it has to; that is how
the bins are keyed), but the box widens with latitude to contain the circle it
stands in for, and each candidate is checked against the true distance.

What survives is then collision-culled in prominence order, so a squall over
the Low Countries lights Brussels or Amsterdam rather than both on top of each
other. Adding a capital to the list can never make the map busier.

The labels ride the burn-in layer rather than the live loop: they change on the
same twice-a-second cadence as the cells that light them, and `fillText` per
label per frame is not a cost worth paying for something that changes at 2 Hz.

## Notes on the map

The view is a plain screen transform over a fitted Mercator: `screen = k·p + t`.
Mercator is linear in scale and translate, so that composition folds back into a
real projection; every caller, `invert` included, keeps working without knowing
a view exists.

The land matrix is built for the visible extent at a spacing that follows the
zoom, so its cost is bounded however far in you go. The spacing tightens as
`k^0.75` rather than `k`: holding the on-screen gap constant is right over an
ocean and wrong once the tube is all land, where a continent fills in as a solid
field. The gap therefore opens gently with zoom, about 5px to 13px across the
range. Building it takes about 11 ms at world zoom, so it waits for the view to
settle; in between, the finished bitmap is drawn through the delta transform
rather than re-plotted.

Each layer bitmap carries the view it was drawn for. That looks redundant next
to a settled view held in a ref, and is not: the settled view is assigned during
render, while the bitmap it describes is not replaced until the effect that
draws it has run, an effect that waits for paint and then takes 10 to 30 ms.
Read from a shared ref, the frames in between transform the outgoing bitmap by
the incoming view, which at the end of a drag is the identity, and the map jumps
a pan's worth sideways for a frame before snapping back. A bitmap can always
answer where it belongs; the component has already moved on.

There was once a margin, building land beyond the visible edges so a small pan
would still find some under it. It never reached the screen: the layer canvases
are exactly viewport-sized, so everything built outside was clipped at paint. At
3x zoom that was 9,239 of 15,288 dots discarded every settle, for an edge that
stayed empty regardless. Covering the edge for real means canvases larger than
the viewport, and they are already the largest allocation in the app, so the
honest version is the one that builds what it draws.

Frontiers are drawn as dots rather than strokes, and only the interior ones. The
boundary data is topologically clean, so an edge shared by two countries is a
frontier and an edge belonging to one is coastline: 2,630 of 10,286 edges, over
313 pairs. Drawing only the shared ones keeps the founding decision intact, that
land is a dot matrix and not a filled coastline. They fade in as the view
becomes a region and out again above 12x, where the source geometry (62 km
between vertices at the median) is coarser than what is on screen and a river
border would be drawn straighter than it runs.

Strikes are held in degrees rather than pixels and projected per frame, so the
view can move underneath a strike that is still burning.

## Notes on the palette

The palette lives in CSS so that the stylesheet and the canvas can never drift
apart: the canvas reads the same custom properties out of computed style as it
draws. Customising it therefore paints nothing. `palette.js` derives new values
for those same tokens and writes them back inline, and Tailwind classes, glow
shadows and the canvas all follow without knowing anything was customised.
Derivation always starts from what `index.css` declares for the current theme,
never from what is currently applied, or a run of adjustments would compound
into a palette nobody chose.

Phosphors are ratios rather than colours, because a phosphor does not repaint a
grey: it decides which part of the beam survives the coating. They multiply the
neutral palette and are normalised by their own luminance, so a tint changes the
hue of a value and not its weight. Without that, green would arrive as a
brightening and amber as a dimming, and every contrast decision in the
stylesheet would quietly stop holding. Contrast moves everything that is not the
background away from it together, as signed distance, so the same arithmetic
serves light emitted on black and ink laid down on paper.

Across all 32 combinations of phosphor, contrast and medium, the hierarchy the
palette was built with survives: line under land under dim under text under
strike, with text never below 3:1 against the background.

## Notes on cost

The tree re-renders on a handful of independent clocks: strikes flush twice a
second, the feed releases a row every 130ms, storms recluster every two seconds.
Left alone, every one of those re-renders the map. The components are therefore
memoised and the handlers App passes down are stable, so a feed row arriving
reconciles that row and nothing else. The clock owns its own tick for the same
reason: the time changing is not a reason to re-render the map. The thunder
countdown owns one too, since the watch pass runs every two seconds and a count
moving in two-second steps would be worse than no count.

Point-in-polygon lookups are bucketed into a 10 degree grid of the globe.
Scanning every feature's bounding box is cheap until you do it often enough, and
building the land matrix asks 14,548 questions of it at world zoom: 2.5 million
box comparisons for 3,845 dots. Bucketed, that is 22,530 comparisons, and what
remains is the point-in-polygon work itself, which is the part that was ever the
point. Ocean is where it pays, since most of the planet is water and an empty
bucket answers instantly.

Pointer input is coalesced to one update per frame. A high-refresh mouse
outpaces the display, and each move would otherwise be a React render of the
largest component in the app.

The canvas loop is deliberately not keyed on the view. It reads position through
a ref, so panning never tears the loop down and reallocates the backing store
mid-drag.

## Notes on weight

Boundary data is most of what is shipped, so it is the only thing worth
measuring. Two things keep it down, and both are about what the display can
actually resolve rather than about compression.

Coordinates are rounded to three decimals, which is 111 m against a dot matrix
that samples at 11 km. `shrink:geo` measures before it writes and fails if
rounding changed a single lookup out of sixty thousand; the whole argument for
doing it is that it changes nothing, so it should stop being quiet the moment
that is untrue. Vertex count, by contrast, is already low and cannot be cut: at
a 10 km tolerance Helsinki, Tallinn, Algiers and Beirut all end up offshore.

Only `world.json` is needed to draw the first frame, since the land matrix is
built from it. The US states and the named seas are fetched after mount; they
are more than a third of the bundle and nothing can be named before a strike
arrives, which cannot happen before the socket opens. Until they land `locate`
answers at the resolution it has: "USA" rather than "Texas", "open water"
rather than "Coral Sea". The place cache is emptied when they arrive, or a cell
named coarsely in the first second would keep that name for the session and
carry it into the activity ranking.

Frontiers and the detector network add no bytes at all. The frontiers are
extracted from boundary data already bundled, once per session; the detectors
are assembled from the strikes as they arrive, which fills the map in over about
half a minute of listening.
