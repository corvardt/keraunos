// Drives the rate window at cadences a browser actually produces and checks
// that the figure it reports is the traffic that went in.
//
// This is the reading the whole panel is hung on: the strikes-per-minute
// readout, the trace under it, and the coverage gauge, which divides it by
// sixty and holds it against the 44 flashes a second the planet makes. So it is
// also the one figure whose failure is invisible — a wrong rate draws a
// perfectly plausible curve and a perfectly plausible bar.
//
// It has failed once, exactly here. The window was 120 flushes long and assumed
// each covered 500ms; a browser throttles timers in a tab it cannot see, and
// measured in a hidden tab this app's own interval was firing every five
// seconds. A hundred and twenty of those is ten minutes of arrivals reported as
// one minute, and the gauge claimed to be hearing four times all the lightning
// on earth. Nothing on screen could have said so.
//
//   node scripts/check-rate.cjs

const { pathToFileURL } = require("url");
const path = require("path");

import(pathToFileURL(path.join(__dirname, "../src/lib/rate.js")).href).then(
  ({ createRate, WINDOW_MS }) => {
    let ok = true;
    const check = (pass, what, detail) => {
      console.log(`  ${pass ? "✓" : "✗"}  ${what}${detail ? `  ${detail}` : ""}`);
      ok &= pass;
    };

    const t0 = Date.UTC(2026, 6, 24, 12, 0);

    /**
     * Runs a constant rate into the window at a given flush interval, for long
     * enough that the window is full, and reports what it says.
     *
     * The strikes per flush are dealt out so that they sum to exactly the rate
     * asked for over each minute, whatever the cadence: the point of the test
     * is the cadence, so the traffic must not vary with it.
     */
    const run = (perMinute, everyMs, forMs = 4 * WINDOW_MS) => {
      const rate = createRate(t0);
      const flushes = Math.round(forMs / everyMs);
      for (let i = 1; i <= flushes; i++) {
        const to = Math.floor((i * everyMs * perMinute) / WINDOW_MS);
        const from = Math.floor(((i - 1) * everyMs * perMinute) / WINDOW_MS);
        rate.record(to - from, t0 + i * everyMs);
      }
      return rate.read(t0 + flushes * everyMs);
    };

    // The cadence the app asks for, and the ones a browser gives it instead.
    // 500ms is a tab in front; 5s was measured in a hidden one; 60s is where
    // Chrome's intensive throttling lands after a few minutes out of sight.
    console.log("a steady 600 strikes a minute, at every cadence a tab produces");
    for (const [label, everyMs] of [
      ["in front, 500ms", 500],
      ["hidden, 5s", 5000],
      ["deeply throttled, 60s", 60000],
    ]) {
      const read = run(600, everyMs);
      // 2%, whatever the cadence. A tolerance scaled to the interval is how
      // this check would have passed on the very failure it exists for: at a
      // 60s cadence, "within one flush" is within the whole window, which
      // permits any answer between nothing and double and asserts nothing.
      // Prorating the straddling span is what makes one flat figure defensible.
      check(
        Math.abs(read.perMinute - 600) <= 12,
        `${label} reads the rate it was given`,
        `(${read.perMinute})`
      );
    }

    // The failure this was written for, stated as the thing it must not do.
    // Before the fix this read 7,200: 120 samples five seconds apart, summed
    // and called a minute.
    console.log("\nthe throttle does not inflate the reading");
    const hidden = run(600, 5000);
    check(hidden.perMinute < 900, "a hidden tab does not report a multiple of the truth", `(${hidden.perMinute})`);
    check(
      hidden.samples.length < 20,
      "and holds a minute of samples, not a hundred and twenty",
      `(${hidden.samples.length})`
    );

    // Coming back to the front is the moment somebody is actually looking, so
    // the figure has to be true then rather than a minute later. The window is
    // a minute of arrivals however they were flushed, so the first read after
    // the cadence recovers is already right.
    console.log("\ncoming back to the front");
    const back = createRate(t0);
    let t = t0;
    for (let i = 0; i < 30; i++) {
      back.record(50, (t += 5000)); // ten minutes hidden, 600/min
    }
    for (let i = 0; i < 20; i++) {
      back.record(5, (t += 500)); // ten seconds in front, same 600/min
    }
    const settled = back.read(t);
    check(
      Math.abs(settled.perMinute - 600) <= 60,
      "the first read after the tab returns is already true",
      `(${settled.perMinute})`
    );

    // A window that never expires anything is the same bug wearing a different
    // hat: it would read a session total as a rate.
    console.log("\nthe window is a minute and stays one");
    const long = run(600, 500, 30 * WINDOW_MS);
    check(Math.abs(long.perMinute - 600) <= 10, "half an hour in, still a minute", `(${long.perMinute})`);
    check(long.spanMs <= WINDOW_MS, "the span never exceeds the window", `(${long.spanMs}ms)`);

    // A quiet window is a real reading and has to survive: a lull must read
    // zero rather than holding the last thing that arrived.
    console.log("\nsilence");
    const quiet = createRate(t0);
    quiet.record(400, t0);
    const after = quiet.read(t0 + WINDOW_MS + 1000);
    check(after.perMinute === 0, "arrivals older than the window are gone", `(${after.perMinute})`);
    check(after.samples.length === 0, "and take their samples with them");

    // A session younger than its own window reports what it heard rather than
    // an extrapolation of it. Twenty seconds of 600-a-minute is 200 strikes,
    // and claiming 600 would be inventing the other forty seconds.
    console.log("\na session younger than the window");
    const fresh = run(600, 500, 20000);
    check(
      Math.abs(fresh.perMinute - 200) <= 10,
      "reports the traffic actually watched",
      `(${fresh.perMinute})`
    );
    check(Math.abs(fresh.spanMs - 20000) <= 1000, "and says how much of a minute that was", `(${fresh.spanMs}ms)`);

    console.log(ok ? "\nrate: ok" : "\nrate: FAILED");
    process.exit(ok ? 0 : 1);
  }
);
