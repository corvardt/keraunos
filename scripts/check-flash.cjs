// Checks that the coverage layer's reading of an imager tile is the reading
// EUMETSAT put in it.
//
// The same bind the rain field is in and worse. That service at least publishes
// its colour scheme; this one publishes a picture with the ramp already baked
// into the raster, a style document with no colormap in it to invert, and a
// legend graphic. So the table in `flash.js` was sampled off that legend, which
// means it is a reading of an image of a scale — and the whole of it rests on
// EUMETSAT not quietly restyling the layer.
//
// Which they may. Nothing in the WMS would announce it, the tiles would go on
// arriving 200 OK, and the map would go on drawing a plausible field of flashes
// at plausible intensities over a plausible map. The only thing that can catch
// it is holding the table against live pixels and asking whether the colours
// coming back are still colours the table contains.
//
// The live half asks EUMETSAT directly rather than through `/msg`, because there
// is no site running out here to carry it. That the proxy would carry it is
// checked separately, and by reading the proxy.
//
//   node scripts/check-flash.cjs

const { pathToFileURL } = require("url");
const path = require("path");
const fs = require("fs");
const { decodePng } = require("./png.cjs");

const UPSTREAM = "https://view.eumetsat.int/geoserver/wms";

import(pathToFileURL(path.join(__dirname, "../src/lib/flash.js")).href).then(async (flash) => {
  const {
    positionFor,
    countFor,
    STOPS,
    withinReach,
    url,
    tileFrame,
    SAMPLES,
    MAX_LEVEL,
    levelFor,
    LAG_MS,
    STEP_MS,
  } = flash;

  let ok = true;
  const check = (pass, what, detail) => {
    console.log(`  ${pass ? "✓" : "✗"}  ${what}${detail ? `  ${detail}` : ""}`);
    ok &= pass;
  };
  const near = (a, b, slack) => Math.abs(a - b) <= slack;

  // ── The ramp ──────────────────────────────────────────────────────────────
  console.log("the ramp");
  // The two ends, read straight off the legend bar's first and last interior
  // pixels. If these move, the layer has been restyled and everything below is
  // measuring a scale that no longer exists.
  check(positionFor(255, 255, 201) === 0, "the pale end is the bottom of the ramp");
  check(positionFor(139, 0, 38) === 1, "the dark end is the top");

  // Every stop must read back as itself. This is the inversion being a function:
  // if two stops are close enough in RGB that one reads as the other, the ramp
  // has a fold in it and everything above the fold is being under-reported.
  let folded = 0;
  for (let i = 0; i < STOPS.length; i++) {
    const [r, g, b] = STOPS[i];
    if (Math.round(positionFor(r, g, b) * (STOPS.length - 1)) !== i) folded++;
  }
  check(folded === 0, "and every stop between them reads back as itself", `${STOPS.length} stops, ${folded} folded`);

  // A colour from the middle of the bar, and one nowhere near it. The second is
  // the honest limit of this layer: there is no "not on the scale" answer, so a
  // colour the ramp never produces still reads as something. It is why the
  // alpha channel does the gating and the ramp is only asked about pixels the
  // service actually painted.
  check(near(positionFor(0xfd, 0x8d, 0x3c), 0.47, 0.06), "a mid-ramp orange reads mid-ramp", positionFor(0xfd, 0x8d, 0x3c).toFixed(2));
  check(positionFor(0, 0, 255) >= 0 && positionFor(0, 0, 255) <= 1, "an impossible colour still lands on the ramp");

  console.log("\nthe counts");
  // The three ticks the legend actually prints. Nothing between them is claimed
  // and nothing outside them exists: the bar starts at one flash and stops at
  // twenty or more.
  check(near(countFor(0), 1, 0.001), "the pale end is one flash", countFor(0).toFixed(2));
  check(near(countFor(0.529), 10, 0.05), "the middle tick is ten", countFor(0.529).toFixed(2));
  check(near(countFor(1), 20, 0.001), "the dark end is twenty or more", countFor(1).toFixed(2));
  let climbing = true;
  for (let i = 0; i < 100; i++) if (countFor((i + 1) / 100) <= countFor(i / 100)) climbing = false;
  check(climbing, "and the count climbs throughout");
  check(countFor(-1) === 1 && countFor(2) === 20, "off the ends it clamps rather than extrapolating");

  // ── The ground ────────────────────────────────────────────────────────────
  console.log("\nwhat ground is asked for");
  // Mercator hands the polar rows an enormous share of the tile grid, and the
  // product stops at 70°. Every one of those tiles used to be a request paid
  // for, decoded, and found empty — which is also indistinguishable from an
  // imager that saw no lightning, so it is not merely wasteful.
  check(withinReach(tileFrame(2, 2, 2)), "a tile over Africa is asked for");
  check(!withinReach(tileFrame(3, 0, 0)), "the top-left of the world is not");
  check(!withinReach(tileFrame(4, 15, 8)), "nor the far side of the Pacific");
  check(withinReach(tileFrame(0, 0, 0)), "the whole world at level 0 is, since most of it is in range");

  console.log("\nthe request");
  const at = Date.UTC(2026, 7, 20, 14, 15, 0);
  const address = url(tileFrame(3, 4, 3), at);
  const asked = new URLSearchParams(address.slice(address.indexOf("?") + 1));
  check(address.startsWith("/msg?"), "goes through our own origin", address.slice(0, 5));
  check(asked.get("LAYERS") === "mtg_fd:li_afa", "for the imager layer", asked.get("LAYERS"));
  check(asked.get("CRS") === "EPSG:3857", "in the grid the tiles are cut on", asked.get("CRS"));
  // Asked finer than it is stored, and reduced by peak here. A flash is a few
  // pixels of a 4.5km grid, and a server asked to resample that down to one
  // sample per few hundred kilometres hands back nothing at all.
  const fetchPx = Number(asked.get("WIDTH"));
  check(
    fetchPx === Number(asked.get("HEIGHT")) && fetchPx > SAMPLES && fetchPx % SAMPLES === 0,
    "asked finer than it is stored, in whole blocks",
    `${fetchPx} -> ${SAMPLES}`
  );
  check(asked.get("TIME") === "2026-08-20T14:15:00Z", "named at a moment", asked.get("TIME"));

  // The proxy is the other half of this request and lives in another file. A
  // layer added here and not there is a 400 for every tile and an empty map —
  // silently, since an empty coverage layer is what a quiet sky looks like.
  const proxy = fs.readFileSync(path.join(__dirname, "../functions/msg.js"), "utf8");
  check(proxy.includes('"mtg_fd:li_afa"'), "and the proxy is allowed to carry it");
  const maxSide = Number(/const MAX_SIDE = (\d+)/.exec(proxy)?.[1]);
  check(fetchPx <= maxSide, "at a size the proxy will pass", `${fetchPx} <= ${maxSide}`);

  console.log("\nthe pyramid");
  const projection = { scale: () => 1e6 };
  check(levelFor(projection) === MAX_LEVEL, "the level is clamped to where the imager stops");
  check(MAX_LEVEL === 6, "which is one level shallower than the weather fields", `${MAX_LEVEL}`);

  // ── Against the live service ──────────────────────────────────────────────
  console.log("\nagainst the service");
  let capabilities;
  try {
    capabilities = await fetch(
      `${UPSTREAM}?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetCapabilities`
    ).then((r) => r.text());
  } catch {
    console.log("  ~  no network; the live half of this check was skipped");
    console.log(ok ? "\nflash: ok" : "\nflash: FAILED");
    process.exit(ok ? 0 : 1);
  }

  // What the service says it is holding. The last time in the dimension is the
  // newest frame published, and the lag has to clear it — this server answers a
  // moment it does not have with a 502 rather than with the nearest thing it
  // does, so an optimistic lag is not a stale layer, it is no layer.
  const layer = capabilities.slice(capabilities.indexOf("<Name>mtg_fd:li_afa</Name>"));
  const extent = /<Dimension name="time"[^>]*>([^<]+)</.exec(layer)?.[1] ?? "";
  const newest = Date.parse(extent.split("/")[1] ?? "");
  check(Number.isFinite(newest), "the layer advertises a time extent", extent.split("/")[1]);
  const behind = Math.round((Date.now() - newest) / 60000);
  const moment = Math.floor((Date.now() - LAG_MS) / STEP_MS) * STEP_MS;
  check(moment <= newest, "the moment the map asks for has been published", `newest is ${behind} min old`);
  // And not so far back that the layer is showing a different storm from the one
  // the strikes are drawing. Two steps of slack, as the rain check allows.
  check(
    Date.now() - moment <= LAG_MS + 2 * STEP_MS,
    "and is not older than it has to be",
    `${Math.round((Date.now() - moment) / 60000)} min back`
  );

  // A live tile, and the only question that matters about it: are the colours
  // coming back still colours this table knows? Over the ITCZ, which is where
  // there is always something firing — and at level 2, which is coarse enough
  // that one tile covers a whole continent's worth of chances.
  const frame = tileFrame(2, 2, 2);
  const params = new URLSearchParams(url(frame, moment).slice("/msg?".length));
  const response = await fetch(`${UPSTREAM}?${params}`);
  check(response.ok, "a tile is served", `HTTP ${response.status}`);
  if (response.ok) {
    const { data } = decodePng(Buffer.from(await response.arrayBuffer()));
    let lit = 0;
    let off = 0;
    let worst = 0;
    const seen = new Set();
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 128) continue;
      lit++;
      const position = positionFor(data[i], data[i + 1], data[i + 2]);
      seen.add(Math.round(position * 20));
      // How far the pixel actually was from the ramp, rather than where it
      // landed on it. This is the number that moves if the layer is restyled.
      const [r, g, b] = STOPS[Math.round(position * (STOPS.length - 1))];
      const d = Math.sqrt((data[i] - r) ** 2 + (data[i + 1] - g) ** 2 + (data[i + 2] - b) ** 2);
      if (d > worst) worst = d;
      if (d > 70) off++;
    }
    // A tile with no flashes in it would pass every test below by having nothing
    // to fail on. The imager watches a third of the planet including the ITCZ,
    // so at level 2 over Africa this is close to a certainty — but it is not
    // one, and a run that read nothing has checked nothing.
    check(lit > 0, "the tile had flashes in it to read", `${lit} lit samples`);

    // And the reason it is asked at FETCH_PX. This is the reduction the map
    // does, run here: how many of the stored samples survive it. Asked at
    // SAMPLES instead, a tile this coarse came back with four lit pixels over
    // the whole of Africa on an afternoon the ITCZ was firing across it, which
    // is the failure this check exists to keep from coming back.
    const reduce = fetchPx / SAMPLES;
    let blocks = 0;
    for (let row = 0; row < SAMPLES; row++) {
      for (let col = 0; col < SAMPLES; col++) {
        let hit = false;
        for (let dy = 0; dy < reduce && !hit; dy++) {
          for (let dx = 0; dx < reduce && !hit; dx++) {
            if (data[((row * reduce + dy) * fetchPx + col * reduce + dx) * 4 + 3] >= 128) hit = true;
          }
        }
        if (hit) blocks++;
      }
    }
    check(blocks > 0, "and they survive the reduction to stored samples", `${blocks} of ${SAMPLES * SAMPLES} blocks lit`);

    if (lit > 0) {
      // Not zero. A GetMap resamples, and a pixel on the boundary between a red
      // core and clear sky is a blend of two ramp entries far apart, which lands
      // off the curve rather than between two neighbours on it. What must not
      // happen is that being most of them: that would mean the ramp itself is
      // wrong rather than its edges being soft.
      check(off / lit < 0.15, "and its colours are on the published ramp", `${off}/${lit} off, worst ${worst.toFixed(0)}`);
      // One band is not a failure — a quiet five minutes over one continent can
      // honestly be all faint single flashes — so this reports rather than
      // judges. It is here because a table that had collapsed to one value would
      // look exactly like this, and the run should say so out loud.
      console.log(`  ·  intensities read: ${seen.size} of a possible 21`);
    }
  }

  console.log(ok ? "\nflash: ok" : "\nflash: FAILED");
  process.exit(ok ? 0 : 1);
});
