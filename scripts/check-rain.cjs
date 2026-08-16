// Checks that the rain field's reading of a radar tile is the reading the
// service put in it.
//
// This layer is the only one here that takes its measurement back out of a
// picture. RainViewer renders the composite to a colour scheme before serving
// it and ignores the parameter that is supposed to choose which one, so the map
// inverts a published palette: colour in, dBZ out. That is exact while the
// palette is the one in `rain.js` and while the tile is requested unsmoothed,
// and it is nonsense the moment either stops being true — silently, and in the
// worst way, because a wrong table still produces a plausible field over a
// plausible map.
//
// So the table is checked against a tile off the live service, every colour of
// it, rather than against itself.
//
//   node scripts/check-rain.cjs

const { pathToFileURL } = require("url");
const path = require("path");
const zlib = require("zlib");

// PNG is decoded here rather than through a canvas, since there isn't one. Only
// the one case the tile cache serves: 8-bit RGBA, no interlacing.
function decodePng(buffer) {
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  const depth = buffer[24];
  const colour = buffer[25];
  if (depth !== 8 || colour !== 6) throw new Error(`unexpected PNG: depth ${depth}, type ${colour}`);

  let at = 8;
  const parts = [];
  while (at < buffer.length) {
    const length = buffer.readUInt32BE(at);
    const type = buffer.toString("ascii", at + 4, at + 8);
    if (type === "IDAT") parts.push(buffer.subarray(at + 8, at + 8 + length));
    at += 12 + length;
  }

  const raw = zlib.inflateSync(Buffer.concat(parts));
  const bpp = 4;
  const stride = width * bpp;
  const out = Buffer.alloc(height * stride);
  let pos = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[pos++];
    const line = raw.subarray(pos, pos + stride);
    pos += stride;
    const row = out.subarray(y * stride, (y + 1) * stride);
    const prior = y ? out.subarray((y - 1) * stride, y * stride) : Buffer.alloc(stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? row[i - bpp] : 0;
      const b = prior[i];
      const c = i >= bpp ? prior[i - bpp] : 0;
      let value = line[i];
      if (filter === 1) value += a;
      else if (filter === 2) value += b;
      else if (filter === 3) value += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        value += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      row[i] = value & 255;
    }
  }
  return { width, height, data: out };
}

import(pathToFileURL(path.join(__dirname, "../src/lib/rain.js")).href).then(async (rain) => {
  const { dbzFor, scalarFor, frameFor, url, SAMPLES, MAX_LEVEL, levelFor, LAG_MS, STEP_MS } = rain;

  let ok = true;
  const check = (pass, what, detail) => {
    console.log(`  ${pass ? "✓" : "✗"}  ${what}${detail ? `  ${detail}` : ""}`);
    ok &= pass;
  };

  // ── The scale ─────────────────────────────────────────────────────────────
  console.log("the scale");
  check(dbzFor(0, 0, 0, 0) === null, "nothing is read where nothing was measured");
  // Transparent is outside coverage and must never be confused with no rain:
  // most of the planet has no radar over it, and a layer that drew "no echo"
  // there would be claiming clear skies over every ocean on earth.
  check(dbzFor(255, 0, 255, 0) === null, "  even when the colour would otherwise mean something");
  check(dbzFor(1, 2, 3, 255) === null, "a colour outside the scheme is not invented");

  // Anchors read straight off the published table.
  const anchors = [
    [[0x00, 0xa3, 0xe0, 0xff], 20],
    [[0x00, 0x4e, 0x78, 0xff], 32],
    [[0xff, 0xc5, 0x00, 0xff], 38],
    [[0xc1, 0x00, 0x00, 0xff], 50],
    [[0xff, 0x62, 0xff, 0xff], 62],
  ];
  for (const [[r, g, b, a], dbz] of anchors) {
    const read = dbzFor(r, g, b, a);
    check(read === dbz, `  #${r.toString(16)}${g.toString(16)}${b.toString(16)} reads ${dbz} dBZ`, `(${read})`);
  }

  // The top of the scheme reuses one colour across many values, and the map
  // takes the lowest: the conservative direction, and the only one that does
  // not invent intensity out of a palette that has run out of colours.
  check(dbzFor(255, 255, 255, 255) === 65, "saturated white reads as the lowest it can mean", `(${dbzFor(255, 255, 255, 255)})`);
  check(dbzFor(0, 255, 0, 255) === 75, "off-scale green likewise", `(${dbzFor(0, 255, 0, 255)})`);

  check(scalarFor(0) === 0 && scalarFor(5) === 0, "the scalar floors below drizzle");
  check(scalarFor(60) === 1 && scalarFor(90) === 1, "and pins past hail");
  let rising = true;
  for (let dbz = 5; dbz < 60; dbz++) if (scalarFor(dbz + 1) <= scalarFor(dbz)) rising = false;
  check(rising, "and rises throughout between them");

  // ── The frames ────────────────────────────────────────────────────────────
  console.log("\nresolving a moment");
  const past = [
    { time: 1000, path: "/a" },
    { time: 2000, path: "/b" },
    { time: 3000, path: "/c" },
  ];
  check(frameFor(past, 2500 * 1000).path === "/b", "the newest frame at or before the moment");
  check(frameFor(past, 2000 * 1000).path === "/b", "  the moment itself counts as at");
  // Both edges answer rather than leaving a hole, because both are exactly
  // where a reader scrubbing the transport ends up.
  check(frameFor(past, 500 * 1000).path === "/a", "older than anything held gets the oldest");
  check(frameFor(past, 9000 * 1000).path === "/c", "newer than the last gets the last");
  check(frameFor([], 0) === null, "an empty index answers nothing");

  console.log("\nthe request");
  const address = url("https://host", "/v2/radar/abc", 4, 4, 6);
  check(address === "https://host/v2/radar/abc/256/4/4/6/2/0_0.png", "one tile's address", address);
  // Both zeroes are load-bearing. Smoothing interpolates between palette
  // entries and produces colours the table above does not contain; the snow
  // flag puts frozen precipitation in a second table over the same pixels.
  check(address.endsWith("/0_0.png"), "  asked unsmoothed, and in one colour table");

  // ── Against the live service ──────────────────────────────────────────────
  console.log("\nagainst a tile off the service");
  let index;
  try {
    index = await fetch("https://api.rainviewer.com/public/weather-maps.json").then((r) => r.json());
  } catch {
    console.log("  ~  no network; the live half of this check was skipped");
    console.log(ok ? "\nrain: ok" : "\nrain: FAILED");
    process.exit(ok ? 0 : 1);
  }

  const frames = index.radar?.past ?? [];
  check(frames.length > 0, "the index lists frames", `(${frames.length})`);
  const newest = frames[frames.length - 1];
  // Frames land every ten minutes, so the newest one is anywhere from brand new
  // to a full step old depending on where in the cycle this runs. What has to
  // hold is not its age but that the moment the map actually asks for resolves
  // to a frame that exists: the live moment is a step boundary a lag back, and
  // if the lag were shorter than the service's own publishing delay the map
  // would key a moment against a frame that had not been published when it
  // asked, and cache the wrong picture under it until the key moved on.
  const asked = Math.floor((Date.now() - LAG_MS) / STEP_MS) * STEP_MS;
  const resolved = frameFor(frames, asked);
  check(resolved !== null, "the moment the map asks for resolves to a frame");
  check(
    resolved.time * 1000 <= asked,
    "  and to one published at or before it",
    `${Math.round((asked - resolved.time * 1000) / 60000)} min before`
  );
  // Staleness is bounded by the lag plus a step: the map is never showing rain
  // older than that, which for a ten-minute product is the whole of the slack.
  const stale = Math.round((Date.now() - resolved.time * 1000) / 60000);
  check(stale <= (LAG_MS + 2 * STEP_MS) / 60000, "what is drawn is recent", `${stale} min old`);

  // Tiles over four separate radar networks, so a scheme change cannot hide in
  // the one country that happens to be quiet.
  const over = [
    ["4/4/6", "eastern USA"],
    ["4/8/5", "Europe"],
    ["4/7/5", "western Europe"],
    ["3/2/3", "North America"],
  ];
  let seen = 0;
  let unknown = 0;
  const scale = new Set();
  for (const [tile, where] of over) {
    const [z, x, y] = tile.split("/");
    const response = await fetch(url(index.host, newest.path, z, x, y));
    if (!response.ok) {
      check(false, `${where}: tile served`, `HTTP ${response.status}`);
      continue;
    }
    const { data } = decodePng(Buffer.from(await response.arrayBuffer()));
    let bad = 0;
    let lit = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (!data[i + 3]) continue;
      lit++;
      const dbz = dbzFor(data[i], data[i + 1], data[i + 2], data[i + 3]);
      if (dbz === null) bad++;
      else scale.add(dbz);
    }
    seen += lit;
    unknown += bad;
    check(bad === 0, `${where}: every colour is in the table`, `${lit} lit, ${bad} unknown`);
  }

  // A tile that is entirely transparent would pass the test above by having
  // nothing to fail on, so the run has to have actually read some weather.
  check(seen > 1000, "the tiles had weather in them to read", `${seen} lit samples`);
  check(unknown === 0, "nothing anywhere fell outside the scheme");
  check(scale.size > 10, "and the readings span a real range", `${scale.size} distinct dBZ`);

  // The pyramid stops where the map does, not where the radar does.
  const projection = { scale: () => 1e6 };
  check(levelFor(projection) === MAX_LEVEL, "the level is clamped to the deepest the map reaches");
  check(256 % SAMPLES === 0, "a served tile reduces to stored samples in whole blocks");

  console.log(ok ? "\nrain: ok" : "\nrain: FAILED");
  process.exit(ok ? 0 : 1);
});
