# Boot as a reveal, not a curtain

The boot screen is a `fixed inset-0 bg-void` overlay. The map mounts and draws
underneath it the whole time — `WorldMap` never waits on `booted`, which gates
only the keyboard handler and the tour. So the screen is already a curtain over
a working instrument, and the cheapest visual loading state is to stop painting
over the map and retract the curtain instead.

## Why there is no staged reveal

The first pass at this proposed four stages, one per signal `Boot` already
receives. Two of them do not exist:

- **`outlines` is settled before the first paint.** It is
  `geoData.features.length` off a static import. There is no frame in which the
  graticule is up and the countries are not, so "graticule alone" is a state
  nobody can be shown.
- **`names` draws nothing.** `water.geo.json` is never rendered. It goes into
  `detail.water` and is read only by `locate`, to call a strike "Coral Sea"
  instead of "open water". There is no water layer in `worldmap.jsx` to tint
  in. Stepping the veil's opacity when it lands would be an opacity change with
  no causal relation to anything on screen — the exact thing this was meant to
  avoid.

What is left after those come out is one crossfade, which is what the sequence
would have had to collapse to anyway once the flicker risk landed.

## What it does

Two states: the veil is opaque, and then it is gone.

The change is what ends it. It used to be the clocks — the readout held until
all three lines had settled, including a websocket to a network run by
volunteers, up to `CEILING_MS`. Now it holds on one fact: `names !== null`.
Until they land the map is naming Texas "USA", which is the one gap a reader
would read as a fault rather than as a wait. That is also the only signal whose
duration varies with the network — 270 KB against the bundle's 66.

The uplink no longer holds the door. Nothing on the map needs it to draw and the
footer carries it from here on, so its line is simply left unfinished when the
readout stands down — which is what a log looks like when the machine stops
reading it.

`FLOOR_MS` stays: on a warm cache the fetch beats it, and without a floor the
screen is a flash rather than a readout. `CEILING_MS` stays as the escape from a
fetch that neither resolves nor rejects; past it the map names coarsely, exactly
as it does when the fetch fails outright.

## Cost

Three lines in `Boot` and their comments. No new drawing code, no new assets, no
new state, no CSS: `.boot-out` already retracts the veil, and the
`prefers-reduced-motion` block in `App.css` already cancels it to a cut.
