# Keraunos

κεραυνός: the thunderbolt.

**Every lightning strike on earth, as it is detected.**
[**Open the instrument →**](https://keraunos.corvardt.com)

![The instrument running: storm cells over the Gulf and the Caribbean labelled with their flash counts, beside a panel reporting the strike rate, the session curve, the state of the link and which regions are firing](docs/shots/hero.png)

Live strikes from [Blitzortung](https://www.blitzortung.org/), plotted on a world
map as they arrive. Strikes flash and fade, busy cells burn into the map, and
clusters are tracked as storm cells with heading, speed, and a jump ring when
flash rate spikes.

No account, no key. A relay holds one upstream connection to Blitzortung and
passes frames through unchanged. Nothing is stored server-side; everything the
page derives is lost when the tab closes.

## Using it

| | |
| --- | --- |
| **Point** | Reads out place, coordinates and strike count for the 1° cell under the pointer |
| **Pick** | Click the map, a feed row, or a place to narrow to it; click a cell to narrow to the cell. `esc` clears |
| **Move** | Drag to pan, wheel/pinch to zoom to ~200 km across. Region names along the top jump there |
| **Rewind** | An hour of history on the bottom track, handed over full at session start. Drag to scrub; ×8/×30 catch up to live, life size keeps pace |
| **Here** | Browser geolocation on request, frames the map on it, shows distance and thunder countdown to the nearest strike. Session only |
| **Link** | Zoomed in, the URL carries `#lon/lat/zoom` |
| **Save** | Configuration exports retained strikes as CSV, or the current frame as PNG |
| **Hold** | Feed stops advancing while the pointer rests on it, queues arrivals behind |
| **Guide** | Seven-step walkthrough, opens itself on first visit; `g` afterwards, `esc` to skip |
| **Data** | `d`: every session figure, grouped by sky / network / instrument |

**Keys.** `k` key panel · `c` configuration · `d` data · `g` guide · `t` dark/light ·
`esc` close panel or clear selection. `+`/`-` zoom, `0` resets view. Rewind
track takes arrow keys, `home`, `end`.

![The key panel open over a running map, cataloguing every mark on it](docs/shots/key.png)

## Four dials on the map

| Dial | Stops | |
| --- | --- | --- |
| **view** | flat · globe | Flat map, or the same data on a draggable sphere |
| **field** | off · cloud · rain | Background layer; see below |
| **cells** | off · ring · track · full | Ring: cell + count. Track: + history. Full: + heading and speed |
| **burn** | 4m · 20m · 1h | How far back the burn-in reaches |

## Panel readings

| Reading | |
| --- | --- |
| **Rate** | Strikes/min over the last 60s, with trace, and cell count. `↑` marks cells in a lightning jump |
| **Session** | Arrivals by the minute for the tab's lifetime, midnight UTC marked, peak minute called out |
| **Link** | Median delay strike→browser, median detector count per strike |
| **Reach** | How far strikes were heard, day vs night. Night runs longer: ionospheric reflection height rises from ~60-70 km (day) to ~85-90 km (night) |
| **Here** | Distance to nearest strike and thunder countdown, once `here` is pressed |
| **Most active** | Places with cells currently burning, click to narrow |
| **Strike feed** | Each arrival as it lands; click to narrow |

## Configuration

`c` opens it. Stored in-browser only.

| Group | What it holds |
| --- | --- |
| **Tube** | Phosphor colour (white/green/amber/ice/oil/crimson/demon, dark only), contrast, bloom |
| **Layout** | Side panel, header, footer visibility |
| **Screen** | Scanlines, sweep, strike shake, detector clicks, thunder |
| **Map** | Cell bounds, graticule, frontiers, daylight, capitals, detector threads, strike persistence |
| **Panel** | Which readings are shown |
| **Session** | CSV / PNG exports |

Thunder needs a position set first: it's the delay between a strike and its
sound reaching there.

![The same map on the crimson phosphor](docs/shots/crimson.png)

## Things worth knowing

### Who heard it

Blitzortung is volunteer hardware; each strike is a time-of-arrival fix from
stations someone hosts. **Detector threads** draw a line from a strike to every
station that helped place it. A full sheaf means the strike was pinned from all
sides; a fan means it was heard from one direction. Typical strikes have a gap
past 200° in their ring of stations. Detector positions aren't published; the
map infers them from strikes over ~30s of listening.

![Detector threads running from a strike to each station that heard it](docs/shots/network.png)

### The two fields

Infrared (cloud) reads storm tops from orbit; radar (rain) reads what's falling,
from ground stations. Alternatives, not layers — they draw the same storm where
they overlap. Cloud covers the whole planet; rain only where ground radar
exists, so empty means "clear" on one and "unwatched" on the other.

### How far back you can go

Up to an hour, capped at 120,000 retained strikes (shorter at high global rate).
A session opens on whatever window the relay is holding. Scrubbing resumes
forward playback rather than freezing a frame; ×8/×30 speed catches up to live.
Storm rings and tracks are replayed too, walked to the scrub position at their
own 20s sampling cadence. Bolts and the chassis knock aren't replayed.

### Place names

Capitals light up only while a burning cell is within 400 km, fading with it.
Pointing at the map names whatever's under the cursor on demand.

### Leaving with something

The stream isn't archived; closing the tab loses the retained hour.

**CSV**: `flash_utc`, `received_utc`, `lon`, `lat`, one row per retained strike.
**PNG**: the frame as drawn, at whatever scrub position — a link can't carry
strikes, only coordinates, so a shared URL opens on live weather instead.

## One socket, not one per reader

Blitzortung asks that consumers relay from their own server rather than
connecting per-client. `relay/` is that server: a single Cloudflare Durable
Object with one upstream connection, fanning frames out to every visitor.

It also retains the last hour (a few hundred KB) and hands it to a new tab as
one binary frame before the live feed starts, so a fresh session doesn't open
on an empty map. Persisted every 10s in 5-minute buckets so a deploy or
eviction costs nothing; no reader state is stored anywhere.

## Running it yourself

```sh
npm install
npm run dev      # dev server
npm run build    # production build
npm run lint
npm run check    # checks the palette, the geometry and the fetched fields against live data
```

Needs a relay for strikes. Deploy to your own Cloudflare account, or run
locally:

```sh
cd relay && npm install
npm run dev      # serves ws://localhost:8787/feed
npm run deploy   # to your account, once wrangler is logged in
```

Then point the site at it: copy `.env.example` to `.env.local`, set
`VITE_FEED_URL`. Set `ALLOWED_ORIGINS` in `relay/wrangler.jsonc` before exposing
the relay publicly, or anyone who finds the hostname can spend its single
socket.

No API keys anywhere.

`node scripts/KeraunosSeeker.cjs`: standalone Node client, connects to
Blitzortung directly and prints the stream to the terminal.

Screenshots in this file are captured from the running instrument:

```sh
npm run shots                  # all of them, into docs/shots and public/og.png
npm run shots -- hero          # one
VIEW=-99.4/41.2/6 npm run shots -- hero   # framed somewhere else
URL=http://localhost:5173 npm run shots   # against the dev server rather than production
```

Each shot soaks briefly before firing (a fresh load is a black rectangle).
Pick a `VIEW` that's active at run time, or the shot shows nothing happening.

## Not a warning system

For watching weather, not deciding what to do about it. Blitzortung's data is
for private/entertainment use only, explicitly not for storm warning,
overvoltage claims, or risk analysis, and not for protection of life or
property — neither is this. The distance-to-nearest-strike and thunder
countdown readings are arithmetic on a feed that misses most cloud-to-cloud
discharge and anything outside detector range. A quiet map is not a safe sky.

For decisions, use your national meteorological service.

## Sources

The [MIT licence](LICENSE) covers the code here only.

**Strikes**: [Blitzortung](https://www.blitzortung.org/) and its volunteers,
under Blitzortung's own terms (private/non-commercial, no storm warning). Not
this project's to relicense; a self-hosted instance is bound directly by those
terms.

**Weather fields**: read live, not redistributed. Cloud from
[RealEarth](https://realearth.ssec.wisc.edu/) (SSEC, UW-Madison) and
[EUMETSAT](https://www.eumetsat.int/); rain from
[RainViewer](https://www.rainviewer.com/). Both restrict redistribution and
commercial use.

**Fonts**: IBM Plex Mono, SIL OFL 1.1, licence in `public/fonts/OFL.txt`.

**Geometry**: `src/lib/world.json` — Natural Earth 110m Admin 0, public domain.
`src/lib/us.json` — Leaflet's US states example, derived from US Census
boundaries, public domain. `src/lib/water.geo.json` and unused predecessor
`src/lib/water.json` — named water bodies, provenance untraced.

**Palettes**: borrowed phosphor hues credited in `src/lib/palette.js`.
