// Captures the instrument for the README, by driving the real thing rather
// than by mocking it.
//
// The pictures have to be regenerable, because the map they show is the
// weather on the morning they were taken. A screenshot pasted in once decays
// quietly: the palette moves, a readout is renamed, the storm cells gain a
// figure, and the document keeps showing the instrument as it was. Running
// this again costs two minutes and settles the question.
//
// Each shot soaks before it fires. Strikes have to arrive, the detecting
// network assembles itself from about half a minute of listening, and the
// burn-in needs its window; a page grabbed on load is a black rectangle and a
// fair picture of nothing.
//
//   npm run dev                       # in another terminal
//   node scripts/shots.cjs            # all shots
//   node scripts/shots.cjs hero       # one
//
// The view is a hash, so the frame is set by the address: #lon/lat/k. Pick a
// region that is firing at the time of the run — the panel's activity ranking
// says which — or the hero shows an empty ocean at three in the morning.
//
// Two ways of making a reading big enough to read, and they are not the same
// thing. `zoom` is browser zoom: the viewport is divided by it and the device
// pixel ratio multiplied, so the interface reflows larger and the shot still
// lands at `size`. `clip` is a crop: the layout is untouched and a rectangle of
// it is kept. Detail shots want the crop, because the feature is on the map and
// the map does not reflow; the hero wants the zoom, because its subject is the
// interface itself.

const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer-core");

const URL = process.env.KERAUNOS_URL || "http://localhost:5173/";
const CHROME = process.env.CHROME || "/usr/bin/google-chrome";
const OUT = path.join(__dirname, "..", "docs", "shots");

// Somewhere with weather in it. Override with VIEW=lon/lat/k.
const VIEW = process.env.VIEW || "18.5/38.2/6";

const SHOTS = {
  // The hero: the whole instrument, which is the one shot where the frame is
  // the subject. The world view is the honest default but a poor picture — at
  // moderate activity it is four white dots on black, and it scales down to an
  // empty frame. Zoomed, the same instrument is visibly doing something.
  //
  // Browser zoom rather than a crop, so the panel comes with it. 1.5 is the
  // hard ceiling at this width — the layout stacks the sidebar under the map
  // below 1024px and 1600 / 1.5 is 1067 — but 1.25 is the one to use. At 1.5
  // the panel is taller than the frame, so the recent list arrives with one
  // row in it and the region tabs run off their own row; the readings get
  // bigger and there are fewer of them, which is the wrong trade for a picture
  // whose whole subject is an instrument with a lot of dials.
  hero: {
    view: VIEW,
    settings: {},
    soak: 90_000,
    size: { width: 1600, height: 1000 },
    zoom: 1.25,
  },

  // The detector threads: which stations heard each strike. This is the
  // reading that belongs to the people who host the hardware, and it is off by
  // default because most of the time you are here for the weather.
  //
  // The threads run off every edge of the crop, which is the truth of it: the
  // stations that heard a Ionian strike are in another country.
  network: {
    view: VIEW,
    settings: { stations: true, field: "off" },
    soak: 90_000,
    size: { width: 1600, height: 1000 },
    clip: { x: 100, y: 150, width: 1120, height: 520 },
  },

  // The catalogue, over a running map. Cropped to the panel and the map either
  // side of it, stopping at the sidebar so no readout is cut in half, and
  // ending on a finished entry — the catalogue obviously continues, and a crop
  // that ends mid-sentence only looks like a mistake.
  key: {
    view: VIEW,
    settings: {},
    soak: 45_000,
    keys: ["k"],
    size: { width: 1600, height: 1000 },
    clip: { x: 300, y: 0, width: 960, height: 545 },
  },

  // A borrowed palette, to show the tube is a medium and not a colour scheme.
  // Cropped to hold both halves of the argument: the map, and the panel where
  // the same phosphor is doing the bars and the figures.
  crimson: {
    view: VIEW,
    settings: { phosphor: "crimson" },
    soak: 60_000,
    size: { width: 1600, height: 1000 },
    clip: { x: 400, y: 30, width: 1200, height: 545 },
  },

  // The social card: what a pasted link renders as. Sized for the preview crop
  // rather than for reading, and shipped from `public/` because it has to be
  // served from the site root for the crawlers to fetch it.
  //
  // Crimson rather than the default white. The card is seen once, at thumbnail
  // size, in a feed of other things, and the white tube — which is right on a
  // screen you are looking into — goes to grey mush at that size.
  og: {
    view: VIEW,
    settings: { phosphor: "crimson" },
    soak: 60_000,
    size: { width: 1200, height: 630 },
    scale: 1,
    out: path.join(__dirname, "..", "public", "og.png"),
  },
};

async function capture(browser, name, shot) {
  const page = await browser.newPage();
  // Browser zoom is a smaller viewport at a higher pixel ratio: the page lays
  // itself out in fewer CSS pixels and every one of them is drawn larger, which
  // is what the zoom control does. Clipped shots are left at scale 1.5 instead,
  // which is density and not zoom — the layout is identical and the crop is
  // merely sharper. Neither goes to 2: a 1600-wide frame is already about twice
  // the width GitHub renders a README image at, and doubling again quadruples
  // what every clone carries for a sharpness nobody can see.
  const zoom = shot.zoom ?? 1;
  const density = shot.scale ?? (shot.clip ? 1.5 : 1);
  await page.setViewport({
    width: Math.round(shot.size.width / zoom),
    height: Math.round(shot.size.height / zoom),
    deviceScaleFactor: zoom === 1 ? density : zoom,
  });

  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));

  // Seed configuration and mark the guide as walked, before the app boots.
  await page.evaluateOnNewDocument(
    (settings) => {
      localStorage.setItem("keraunos-settings", JSON.stringify(settings));
      localStorage.setItem("keraunos-tour", "seen");
    },
    shot.settings,
  );

  await page.goto(URL + "#" + shot.view, { waitUntil: "networkidle2", timeout: 60_000 });

  // The guide opens itself on a first visit and the seeded flag may not be the
  // one it reads, so close whatever is open before soaking.
  await wait(4000);
  await page.keyboard.press("Escape");

  process.stdout.write(`  ${name}: soaking ${Math.round(shot.soak / 1000)}s`);
  await wait(shot.soak);

  for (const key of shot.keys ?? []) {
    await page.keyboard.press(key);
    await wait(1200);
  }

  const file = shot.out ?? path.join(OUT, `${name}.png`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await page.screenshot({ path: file, ...(shot.clip ? { clip: shot.clip } : {}) });
  const kb = Math.round(fs.statSync(file).size / 1024);
  process.stdout.write(` → ${path.relative(process.cwd(), file)} (${kb} kB)\n`);
  if (errors.length) console.log(`    page errors: ${errors.slice(0, 3).join(" · ")}`);

  await page.close();
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  fs.mkdirSync(OUT, { recursive: true });

  const only = process.argv.slice(2);
  const wanted = only.length ? only : Object.keys(SHOTS);
  for (const name of wanted) {
    if (!SHOTS[name]) throw new Error(`no such shot: ${name} (have: ${Object.keys(SHOTS).join(", ")})`);
  }

  console.log(`capturing from ${URL} at #${VIEW}`);
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: "new",
    args: ["--no-sandbox", "--disable-gpu", "--hide-scrollbars"],
  });

  try {
    for (const name of wanted) await capture(browser, name, SHOTS[name]);
  } finally {
    await browser.close();
  }
})();
