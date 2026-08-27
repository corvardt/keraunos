import { memo, useEffect } from "react";
import { usedStations } from "../../lib/fix.js";
import { record } from "../../lib/stations.js";
import { createFilter } from "../../lib/repeat.js";
import { unpack } from "../../lib/backfill.js";
import { decode } from "../../lib/lzw.js";

// Our own relay rather than Blitzortung directly.
//
// Blitzortung asks that a project using their data pull it from its own server,
// and this used to be one socket to theirs per open tab. The relay in `relay/`
// holds exactly one, whatever the audience, and passes the frames through
// untouched, so everything below this line is the same as it ever was.
//
// Configured rather than compiled in, because the relay is deployed separately
// from the site and the two need not share a hostname.
const FEED = import.meta.env.VITE_FEED_URL;
const RECONNECT_MS = 3000; // first retry; doubles from here
const MAX_RECONNECT_MS = 30000; // ceiling on the backoff
const GIVE_UP_AFTER = 4; // failed attempts before the feed is reported down

/**
 * Headless component: owns the websocket and pushes strikes upward.
 * `onDataReceived`, `onBackfill` and `onStatus` must be referentially stable,
 * or the effect tears the socket down and reconnects on every parent render.
 * `onBackfill` gets the relay's window, once, before any live strike.
 */
function Seeker({ onDataReceived, onBackfill, onStatus }) {
  useEffect(() => {
    let socket = null;
    let retry = null;
    let cancelled = false;
    let failures = 0;
    // Held across reconnects, not per socket: the relay's link can drop and
    // come back inside the seconds a repeat takes to arrive.
    const fresh = createFilter();

    // Which upstream node the relay is on, as it reports it. Choosing between
    // them is the relay's business now: it is the only client, so spreading
    // readers across the nodes is not a thing this end can do or needs to.
    let host = null;
    const report = (phase, message) => {
      if (!cancelled) onStatus?.({ phase, message, host });
    };

    // Said out loud rather than thrown. Without a relay there is no feed and
    // there is nothing this can do about it, and a socket opened on `undefined`
    // fails as a network error somewhere in the console, which reads exactly
    // like the network being down, and is the one thing it is not.
    if (!FEED) {
      report("down", "no relay configured: set VITE_FEED_URL");
      return undefined;
    }

    const connect = () => {
      if (cancelled) return;
      report("connecting", "connecting to the relay...");

      const ws = new WebSocket(FEED);
      // So a control frame can be told from a strike frame synchronously, by
      // type: the relay sends its own state as bytes and the feed's frames as
      // text. A blob would have to be read back asynchronously to find out
      // which of the two it was.
      ws.binaryType = "arraybuffer";
      socket = ws;

      ws.onopen = () => {
        failures = 0;
        // Linked, but not yet hearing anything: which node the relay is on, and
        // whether it has one at all, arrives in its first control frame. The
        // subscription the feed expects is sent by the relay, once, rather than
        // by every reader.
        report("connecting", "waiting for the network...");
      };

      ws.onmessage = (event) => {
        // The relay rather than the feed: its own state, or the window it was
        // holding. Never a live strike, which arrives as text.
        if (typeof event.data !== "string") {
          // The retained window, if the relay had one to hand over. Told
          // from the relay's own state by the bytes it starts with: both are
          // binary, and one of them is not JSON.
          const caught = unpack(event.data);
          if (caught) {
            // Marked as seen, so a strike that is both in the backfill and in
            // the first frames off the wire is drawn once.
            for (const strike of caught) fresh(strike.at, strike.lon, strike.lat);
            onBackfill?.(caught);
            return;
          }
          try {
            const link = JSON.parse(new TextDecoder().decode(event.data));
            host = link.node ?? null;
            report(
              link.live ? "live" : "connecting",
              link.live ? `receiving from ${host}` : "the relay has no link"
            );
          } catch {
            /* a control frame we cannot read says nothing about the feed */
          }
          return;
        }

        try {
          const { time, delay, lon, lat, sig, mcg } = JSON.parse(decode(event.data));
          // Reported twice is not struck twice. Dropped here, before anything
          // downstream has been told, so the map, the feed, the rate, the
          // storms and the thunder all count it once. Keyed on the millisecond
          // rather than the nanosecond, because that is the resolution the
          // backfill carries and the same strike has to key the same way
          // whichever of the two doors it came in by.
          if (!fresh(Math.round(time / 1e6), lon, lat)) return;
          const date = new Date(time / 1000000);
          // UTC, matching the footer clock. Local time would be the viewer's,
          // which says nothing useful about a strike over Java.
          const formattedTime = [date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds()]
            .map((n) => String(n).padStart(2, "0"))
            .join(":");
          // The station list is read once, here, and then dropped: the network
          // it describes is accumulated where the map can find it, and the
          // strike itself carries only the two figures derived from it.
          record(sig);

          // Reduced rather than passed on. A frame carries up to forty station
          // records, eight times a second, and nothing downstream wants them:
          // only how many were used, and how well they surrounded it.
          const used = usedStations(sig);
          onDataReceived?.({
            formattedTime,
            // The strike's own moment, in milliseconds. `delay` is what the
            // network reports about itself and is worth showing; this is what
            // the countdown is measured from.
            time: time / 1e6,
            delay,
            lon,
            lat,
            used,
            stations: used.length,
            gap: Number.isFinite(mcg) ? mcg : null,
          });
        } catch (err) {
          console.error("Error parsing message:", err);
        }
      };

      ws.onerror = () => report("error", "link error");

      ws.onclose = () => {
        // Ignore closes from sockets we've already replaced or unmounted, so a
        // flapping connection can't stack up several reconnect timers.
        if (cancelled || socket !== ws) return;
        host = null;
        failures++;
        if (failures >= GIVE_UP_AFTER) {
          report("down", `no response from the network after ${failures} attempts, still trying`);
        } else {
          report("connecting", "relinking...");
        }
        // Backoff, jittered. It is our own relay being retried now rather than
        // a volunteer's server, and the reasoning survives the move: an outage
        // is exactly when every open tab in the world would otherwise retry in
        // lockstep every three seconds for as long as it lasts.
        const wait = Math.min(MAX_RECONNECT_MS, RECONNECT_MS * 2 ** (failures - 1));
        retry = setTimeout(connect, wait * (0.8 + Math.random() * 0.4));
      };
    };

    connect();

    return () => {
      cancelled = true;
      clearTimeout(retry);
      if (!socket) return;

      socket.onclose = null;
      socket.onmessage = null;
      socket.onerror = null;

      if (socket.readyState === WebSocket.CONNECTING) {
        // Closing mid-handshake makes the browser log a failure. Let the
        // handshake finish and drop the socket on open instead; if it never
        // opens it fails on its own and is collected either way.
        socket.onopen = () => socket.close();
      } else {
        socket.close();
      }
    };
  }, [onDataReceived, onBackfill, onStatus]);

  return null;
}

// Renders nothing, but sits in the tree: without this it reconciles on
// every tick of the feed for no reason at all.
export default memo(Seeker);
