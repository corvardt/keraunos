// Drives the session-day accumulator with a known day of traffic and checks
// that what comes back out is the day that went in.
//
// It is a ring buffer over wall-clock minutes, which is the kind of thing that
// works perfectly for a session and then reports yesterday's traffic on the
// afternoon someone leaves the tab open past its own length. That failure is
// invisible on screen — a plausible curve, drawn from stale counts — so it is
// tested rather than watched for.
//
//   node scripts/check-day.cjs

const { pathToFileURL } = require("url");
const path = require("path");

const MINUTE = 60000;

import(pathToFileURL(path.join(__dirname, "../src/lib/day.js")).href).then(({ createDay }) => {
  let ok = true;
  const check = (pass, what, detail) => {
    console.log(`  ${pass ? "✓" : "✗"}  ${what}${detail ? `  ${detail}` : ""}`);
    ok &= pass;
  };

  const t0 = Date.UTC(2026, 6, 24, 0, 0);

  // A session that runs for three hours at a rate that varies by the minute.
  console.log("banking a session");
  const day = createDay();
  const rate = (minute) => 100 + (minute % 37) * 5;
  for (let minute = 0; minute < 180; minute++) {
    // Arrivals reach it in half-second batches, as they do in the app: 120 of
    // them to the minute, each a whole number of strikes, dealt out so they sum
    // to exactly the minute's rate.
    for (let batch = 0; batch < 120; batch++) {
      const to = Math.floor(((batch + 1) * rate(minute)) / 120);
      const from = Math.floor((batch * rate(minute)) / 120);
      day.record(to - from, t0 + minute * MINUTE + batch * 500);
    }
  }
  const read = day.read(t0 + 180 * MINUTE);
  check(read.series.length === 180, "180 minutes held", `(${read.series.length})`);
  check(
    read.series.every((point, i) => Math.abs(point.rate - rate(i)) < 1),
    "every minute reads the rate it was given"
  );
  check(read.spanMs === 180 * MINUTE, "the span is the session", `(${read.spanMs / MINUTE}m)`);
  const wanted = Math.max(...Array.from({ length: 180 }, (unused, i) => rate(i)));
  check(Math.abs(read.peak.rate - wanted) < 1, "the peak is the busiest minute", `(${read.peak.rate})`);

  // The minute in progress is short by however much of it has not happened, and
  // must not be drawn as a collapse in the rate.
  console.log("\nleaving out the minute in progress");
  const live = createDay();
  for (let minute = 0; minute < 10; minute++) live.record(300, t0 + minute * MINUTE);
  live.record(20, t0 + 10 * MINUTE + 4000); // four seconds into the eleventh
  const partial = live.read(t0 + 10 * MINUTE + 4000);
  check(partial.series.length === 10, "only settled minutes are returned", `(${partial.series.length})`);
  check(
    partial.series.every((point) => point.rate === 300),
    "none of them is the part-minute"
  );

  // The reading is rebuilt once a minute and handed back by identity between,
  // which is what keeps a panel that reads it twice a second from redrawing a
  // curve that has not moved.
  console.log("\nholding still between minutes");
  const same = live.read(t0 + 10 * MINUTE + 9000);
  check(same === partial, "same object within the minute");
  live.record(300, t0 + 11 * MINUTE);
  check(live.read(t0 + 11 * MINUTE + 1000) !== partial, "a new one once the minute turns");

  // Past a day the ring wraps, and a slot has to know whether it holds this
  // hour or the same hour yesterday.
  console.log("\nwrapping past a day");
  const long = createDay();
  for (let minute = 0; minute < 26 * 60; minute++) long.record(minute, t0 + minute * MINUTE);
  const wrapped = long.read(t0 + 26 * 60 * MINUTE);
  check(wrapped.series.length === 24 * 60, "a day is held, not more", `(${wrapped.series.length})`);
  check(
    wrapped.series[0].rate === 2 * 60,
    "the oldest two hours have rolled off",
    `(oldest reads ${wrapped.series[0].rate}, wanted ${2 * 60})`
  );
  check(
    wrapped.series[wrapped.series.length - 1].rate === 26 * 60 - 1,
    "the newest settled minute is the last one"
  );

  // A tab that was asleep did not see calm weather; it saw nothing. Those
  // minutes have to be absent from the curve rather than drawn as zero.
  console.log("\nkeeping a gap a gap");
  const slept = createDay();
  for (let minute = 0; minute < 5; minute++) slept.record(200, t0 + minute * MINUTE);
  for (let minute = 65; minute < 70; minute++) slept.record(200, t0 + minute * MINUTE);
  const gapped = slept.read(t0 + 70 * MINUTE);
  check(gapped.series.length === 10, "the hour asleep is absent, not zero", `(${gapped.series.length})`);
  check(
    gapped.series.every((point) => point.rate === 200),
    "nothing reads as a lull that was a gap"
  );

  console.log(ok ? "\nday: ok" : "\nday: FAILED");
  process.exit(ok ? 0 : 1);
});
