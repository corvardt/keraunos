// Taking something with you.
//
// Everything this instrument knows is derived from a stream nobody archives and
// held for an hour in a tab. Close it and the hour is gone, which is right for
// a live map and wrong for the one afternoon the storm was worth keeping. Two
// things can leave: the strikes, and the frame.

// A filename that sorts, and that says which session it came from without
// having to be opened. UTC, like every other time here.
function stamp(now) {
  return new Date(now).toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z").replace("T", "-");
}

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  // Released on the next task rather than here. The URL has to outlive the
  // click for as long as the browser takes to start reading it, which is not
  // synchronous everywhere, and a full history is several megabytes to leave
  // pinned for the rest of the session if it is never released at all.
  setTimeout(() => URL.revokeObjectURL(url));
}

/**
 * The retained history, as CSV.
 *
 * Exactly what is held and nothing reconstructed. A retained strike is four
 * numbers — where, when it was heard, and when it happened — because the memory
 * budget for the hour was set at four and the naming and the fix quality were
 * deliberately not kept past the flush that reported them. So the file has four
 * columns, and what it does carry it carries exactly: the gap between the two
 * times is the network's own delay, strike by strike.
 *
 * How much of an hour this is depends on how long the tab has been open and how
 * hard the world was firing, for the same reason the rewind track's length
 * does.
 */
export function saveStrikes(history, now = Date.now()) {
  const rows = ["flash_utc,received_utc,lon,lat"];
  for (const strike of history) {
    rows.push(
      [
        new Date(strike.at).toISOString(),
        new Date(strike.t).toISOString(),
        strike.lon.toFixed(4),
        strike.lat.toFixed(4),
      ].join(",")
    );
  }
  download(new Blob([rows.join("\n")], { type: "text/csv" }), `keraunos-${stamp(now)}.csv`);
  return history.length;
}

/**
 * The tube, as a picture.
 *
 * This is the one thing that can actually be handed to somebody. A link cannot:
 * the address already carries the view, but the strikes under it are this
 * session's own and cannot be sent with it, so a moment shared as a URL would
 * open on an empty map at the right coordinates. An image of the frame has the
 * weather in it.
 *
 * Which means it is also how a rewound moment leaves. Scrub the track to the
 * squall, then save: what is written is the frame as drawn, past or present,
 * because it is read off the canvas rather than re-derived from anything.
 *
 * The canvas alone, not the page around it. The scanlines, the sweep and the
 * bloom are CSS over the top and belong to the screen you are looking at rather
 * than to the reading.
 */
export function saveFrame(canvas, now = Date.now()) {
  if (!canvas) return false;
  canvas.toBlob((blob) => blob && download(blob, `keraunos-${stamp(now)}.png`));
  return true;
}
